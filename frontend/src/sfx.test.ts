import { resetLoudnessGraph, resumeAudio, setEffectsLevel } from "./musicGraph";
import {
  coverAtLine,
  MIN_TICK_GAP_S,
  playEffect,
  resetEffects,
  THUD,
  thud,
  tick,
  TICK,
  translateYOf,
  whoosh,
  WHOOSH,
} from "./sfx";

/** An AudioParam that records what was scheduled on it. */
function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

type FakeParam = ReturnType<typeof fakeParam>;

interface FakeNode {
  kind: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connections: unknown[];
  [key: string]: unknown;
}

/** A context that builds plain records of every node an effect asks for. */
function fakeContext(state: AudioContextState = "running") {
  const nodes: FakeNode[] = [];
  const make = (kind: string, extra: Record<string, unknown>): FakeNode => {
    const node: FakeNode = {
      kind,
      connections: [],
      connect: vi.fn((target: unknown) => {
        node.connections.push(target);
        return target;
      }),
      disconnect: vi.fn(),
      ...extra,
    };
    nodes.push(node);
    return node;
  };
  const context = {
    state,
    currentTime: 3,
    sampleRate: 8000,
    destination: { kind: "destination" },
    buffers: 0,
    nodes,
    resume: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    createGain: vi.fn(() => make("gain", { gain: fakeParam() })),
    createBiquadFilter: vi.fn(() =>
      make("filter", { type: "", frequency: fakeParam(), Q: fakeParam() }),
    ),
    createOscillator: vi.fn(() =>
      make("oscillator", {
        type: "",
        frequency: fakeParam(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }),
    ),
    createBufferSource: vi.fn(() =>
      make("source", {
        buffer: null,
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }),
    ),
    createBuffer: vi.fn((_channels: number, length: number) => {
      context.buffers += 1;
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    }),
  };
  return context;
}

type FakeContext = ReturnType<typeof fakeContext>;

function of(context: FakeContext, kind: string): FakeNode[] {
  return context.nodes.filter((node) => node.kind === kind);
}

function asContext(context: FakeContext): BaseAudioContext {
  return context as unknown as BaseAudioContext;
}

const DESTINATION = { kind: "bus" } as unknown as AudioNode;

/** The envelope's peak: what the first linear ramp climbs to. */
function peakOf(gain: FakeNode): number {
  const param = gain.gain as FakeParam;
  return param.linearRampToValueAtTime.mock.calls[0][0] as number;
}

/** When the envelope has fallen silent, on the context's clock. */
function endOf(gain: FakeNode): number {
  const param = gain.gain as FakeParam;
  return param.exponentialRampToValueAtTime.mock.calls[0][1] as number;
}

beforeEach(() => {
  resetLoudnessGraph();
  resetEffects();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the recipes", () => {
  test("a tick is a few milliseconds of band-passed noise into the bus", () => {
    const context = fakeContext();
    tick(asContext(context), DESTINATION, 10);

    const [filter] = of(context, "filter");
    expect(filter.type).toBe("bandpass");
    const [gain] = of(context, "gain");
    expect(gain.connections).toEqual([DESTINATION]);
    expect(peakOf(gain)).toBe(TICK.peak);
    // Short: silent again within a few tens of milliseconds of its start.
    expect(endOf(gain) - 10).toBeLessThanOrEqual(0.04);
    const [source] = of(context, "source");
    expect(source.start).toHaveBeenCalledWith(
      10,
      expect.any(Number),
      expect.any(Number),
    );
  });

  test("a whoosh sweeps down and is gone well under a second", () => {
    const context = fakeContext();
    whoosh(asContext(context), DESTINATION, 2);

    const [filter] = of(context, "filter");
    const frequency = filter.frequency as FakeParam;
    expect(frequency.setValueAtTime).toHaveBeenCalledWith(
      WHOOSH.fromFrequency,
      2,
    );
    expect(frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      WHOOSH.toFrequency,
      2 + WHOOSH.length,
    );
    const [gain] = of(context, "gain");
    expect(peakOf(gain)).toBe(WHOOSH.peak);
    expect(endOf(gain) - 2).toBeLessThan(1);
  });

  test("the thud is a low body under a short impact, quieter than the whoosh", () => {
    const context = fakeContext();
    thud(asContext(context), DESTINATION, 5);

    const [body] = of(context, "oscillator");
    expect(body.type).toBe("sine");
    expect(body.start).toHaveBeenCalledWith(5);
    const stopAt = (body.stop as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as number;
    expect(stopAt - 5).toBeLessThan(0.4);
    const [filter] = of(context, "filter");
    expect(filter.type).toBe("lowpass");
    expect(of(context, "source")).toHaveLength(1);
    // Two envelopes, each straight into the bus, the body's the longer one.
    const [bodyGain, impactGain] = of(context, "gain").filter((gain) =>
      gain.connections.includes(DESTINATION),
    );
    expect(peakOf(bodyGain)).toBe(THUD.peak);
    expect(endOf(bodyGain) - 5).toBeLessThan(0.4);
    expect(endOf(impactGain) - 5).toBeLessThan(0.1);
    expect(THUD.peak).toBeLessThan(WHOOSH.peak);
  });

  test("the noise is made once per context", () => {
    const context = fakeContext();
    tick(asContext(context), DESTINATION, 0);
    whoosh(asContext(context), DESTINATION, 0);
    thud(asContext(context), DESTINATION, 0);

    expect(context.buffers).toBe(1);
  });

  test("stopping a voice stops every source in it", () => {
    const context = fakeContext();
    const voice = thud(asContext(context), DESTINATION, 0);
    voice.stop();

    expect(of(context, "oscillator")[0].stop).toHaveBeenCalledTimes(2);
    expect(of(context, "source")[0].stop).toHaveBeenCalledTimes(1);
  });

  test("a voice lets its nodes go once its last source has ended", () => {
    const context = fakeContext();
    thud(asContext(context), DESTINATION, 0);
    const [body] = of(context, "oscillator");
    const [impact] = of(context, "source");
    const [filter] = of(context, "filter");

    (body.onended as () => void)();
    expect(filter.disconnect).not.toHaveBeenCalled();
    (impact.onended as () => void)();
    expect(filter.disconnect).toHaveBeenCalled();
  });
});

describe("playing an effect", () => {
  /** The page's graph, made the way the sink's first press makes it. */
  function graph(state: AudioContextState = "running"): FakeContext {
    const context = fakeContext(state);
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );
    resumeAudio();
    return context;
  }

  test("plays into the bus at master × effects", () => {
    const context = graph();
    setEffectsLevel(0.4);

    expect(playEffect("tick")).not.toBeNull();

    const bus = of(context, "gain")[0];
    expect((bus.gain as FakeParam).value).toBe(0.4);
    expect(bus.connections).toEqual([context.destination]);
    // The tick's own envelope plays into the bus, not past it.
    expect(of(context, "gain")[1].connections).toEqual([bus]);
  });

  test("plays nothing at all while the effects are off", () => {
    const context = graph();
    setEffectsLevel(0);

    expect(playEffect("whoosh")).toBeNull();
    expect(context.nodes).toEqual([]);
  });

  test("never makes a graph, and skips one that is not running", () => {
    setEffectsLevel(1);
    // No graph yet: nothing made, nothing asked of the browser.
    const Context = vi.fn();
    vi.stubGlobal("AudioContext", Context);
    expect(playEffect("whoosh")).toBeNull();
    expect(Context).not.toHaveBeenCalled();

    resetLoudnessGraph();
    setEffectsLevel(1);
    const context = graph("suspended");
    context.resume.mockClear();
    expect(playEffect("whoosh")).toBeNull();
    expect(context.nodes).toEqual([]);
    // Skipped, not woken: only a press on the page does that.
    expect(context.resume).not.toHaveBeenCalled();
  });

  test("the switch going off silences the bus at once", () => {
    const context = graph();
    setEffectsLevel(0.5);
    playEffect("whoosh");
    const bus = of(context, "gain")[0];

    setEffectsLevel(0);

    expect((bus.gain as FakeParam).value).toBe(0);
  });

  test("a level moves the bus in one step, never a glide", () => {
    // An idle node's glide does not run in Chrome until something plays
    // through it, so the next effect would start near the old level.
    const context = graph();
    setEffectsLevel(0);
    setEffectsLevel(0.5);
    playEffect("whoosh");
    const bus = of(context, "gain")[0];

    setEffectsLevel(0.25);

    const gain = bus.gain as FakeParam;
    expect(gain.value).toBe(0.25);
    expect(gain.cancelScheduledValues).toHaveBeenCalled();
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  test("ticks closer together than the gap are one", () => {
    const context = graph();
    setEffectsLevel(1);

    expect(playEffect("tick")).not.toBeNull();
    expect(playEffect("tick")).toBeNull();
    context.currentTime += MIN_TICK_GAP_S * 1.5;
    expect(playEffect("tick")).not.toBeNull();
  });

  test("a delayed effect is scheduled ahead on the audio clock", () => {
    const context = graph();
    setEffectsLevel(1);

    playEffect("thud", 0.5);

    const [body] = of(context, "oscillator");
    expect(body.start).toHaveBeenCalledWith(context.currentTime + 0.5);
  });
});

describe("following the reel", () => {
  test("reads the vertical offset out of a computed transform", () => {
    expect(translateYOf("none")).toBe(0);
    expect(translateYOf("matrix(1, 0, 0, 1, 0, -1234.5)")).toBe(-1234.5);
    expect(
      translateYOf(
        "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -80, 0, 1)",
      ),
    ).toBe(-80);
    // The inline form jsdom hands back is not a position.
    expect(translateYOf("translateY(0)")).toBeNull();
    expect(translateYOf("matrix(1, 0, 0)")).toBeNull();
  });

  test("the cover at the line changes as an edge crosses the middle", () => {
    expect(coverAtLine(-1000, 200)).toBe(5);
    expect(coverAtLine(-1099, 200)).toBe(5);
    expect(coverAtLine(-1101, 200)).toBe(6);
    expect(coverAtLine(0, 200)).toBe(0);
  });
});
