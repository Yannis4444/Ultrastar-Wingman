import {
  audible,
  isRouted,
  levelOf,
  onAudioState,
  resetLoudnessGraph,
  resumeAudio,
  route,
  setLoudness,
} from "./musicGraph";

/** A gain node whose param records how it was moved. */
function fakeGain() {
  return {
    gain: {
      value: 1,
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** An `<audio>` that says it is playing, or not. */
function element(paused: boolean): HTMLAudioElement {
  const audio = document.createElement("audio");
  Object.defineProperty(audio, "paused", { get: () => paused });
  return audio;
}

/** A context that routes once per element, as a browser does. */
function fakeContext(state: AudioContextState = "running") {
  const routed = new Set<HTMLMediaElement>();
  const gains: ReturnType<typeof fakeGain>[] = [];
  const listeners: (() => void)[] = [];
  const context = {
    state,
    currentTime: 12,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    created: 0,
    gains,
    createGain: vi.fn(() => {
      const gain = fakeGain();
      gains.push(gain);
      return gain;
    }),
    createMediaElementSource: vi.fn((element: HTMLMediaElement) => {
      if (routed.has(element)) {
        throw new DOMException("already routed", "InvalidStateError");
      }
      routed.add(element);
      return { connect: vi.fn() };
    }),
    addEventListener(_type: string, listener: () => void) {
      listeners.push(listener);
    },
    become(next: AudioContextState) {
      context.state = next;
      for (const listener of listeners) listener();
    },
  };
  // A constructor `new` can be called with, handing out this one context.
  const Context = vi.fn(function () {
    context.created += 1;
    return context;
  });
  return { context, Context };
}

beforeEach(() => {
  resetLoudnessGraph();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("routes an element once and only moves its gain afterwards", () => {
  const { context, Context } = fakeContext();
  vi.stubGlobal("AudioContext", Context);
  const element = document.createElement("audio");

  route(element, 0.5);
  route(element, 0.25);
  setLoudness(element, 2);

  expect(Context).toHaveBeenCalledTimes(1);
  expect(context.gains).toHaveLength(1);
  expect(context.gains[0].gain.value).toBe(2);
  expect(isRouted(element)).toBe(true);
});

it("leaves the loudness off the volume of a routed element", () => {
  vi.stubGlobal("AudioContext", fakeContext().Context);
  const element = document.createElement("audio");
  route(element, 0.5);
  expect(levelOf(element, 0.8, 0.5)).toBe(0.8);
});

it("folds the loudness into the volume without Web Audio, down only", () => {
  const element = document.createElement("audio");
  route(element, 0.5);
  expect(isRouted(element)).toBe(false);
  expect(levelOf(element, 0.8, 0.5)).toBeCloseTo(0.4);
  expect(levelOf(element, 0.8, 2)).toBe(0.8);
  // Nothing to resume, nothing to swallow the sound.
  resumeAudio();
  expect(audible(element)).toBe(true);
});

it("plays an element a context cannot take the old way", () => {
  const { context, Context } = fakeContext();
  context.createMediaElementSource.mockImplementation(() => {
    throw new DOMException("no", "InvalidStateError");
  });
  vi.stubGlobal("AudioContext", Context);
  const element = document.createElement("audio");
  route(element, 0.5);
  expect(isRouted(element)).toBe(false);
  expect(levelOf(element, 1, 0.5)).toBe(0.5);
});

it("says a routed element is heard only while the graph runs", () => {
  const { context, Context } = fakeContext("suspended");
  vi.stubGlobal("AudioContext", Context);
  const element = document.createElement("audio");
  const heard = vi.fn();
  onAudioState(heard);

  route(element, 1);
  expect(audible(element)).toBe(false);
  resumeAudio();
  expect(context.resume).toHaveBeenCalledTimes(1);

  context.become("running");
  expect(heard).toHaveBeenCalledTimes(1);
  expect(audible(element)).toBe(true);
  // A running graph is not asked again.
  resumeAudio();
  expect(context.resume).toHaveBeenCalledTimes(1);
});

it("connects each element's gain into the destination once", () => {
  const { context, Context } = fakeContext();
  vi.stubGlobal("AudioContext", Context);
  const background = element(true);
  const reel = element(true);

  for (const factor of [0.5, 0.7, 1.2]) {
    route(background, factor);
    route(reel, factor);
  }

  expect(context.createGain).toHaveBeenCalledTimes(2);
  expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
  for (const gain of context.gains) {
    expect(gain.connect).toHaveBeenCalledTimes(1);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
  }
});

it("steps a silent element's level and glides a sounding one's", () => {
  const { context, Context } = fakeContext();
  vi.stubGlobal("AudioContext", Context);
  const silent = element(true);
  const sounding = element(false);
  route(silent, 1);
  route(sounding, 1);
  const [quiet, loud] = context.gains;

  setLoudness(silent, 0.5);
  expect(quiet.gain.value).toBe(0.5);
  expect(quiet.gain.setTargetAtTime).not.toHaveBeenCalled();

  setLoudness(sounding, 0.5);
  expect(loud.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 12, 0.1);
  // Never cancelled under a sounding song: that would drop it back a moment.
  expect(loud.gain.cancelScheduledValues).not.toHaveBeenCalled();
});

it("asks the context to take an element once", () => {
  const { context, Context } = fakeContext();
  context.createMediaElementSource.mockImplementation(() => {
    throw new DOMException("no", "InvalidStateError");
  });
  vi.stubGlobal("AudioContext", Context);
  const audio = element(true);

  route(audio, 0.5);
  route(audio, 0.5);

  expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  expect(context.createGain).toHaveBeenCalledTimes(1);
  // The node made for it is not left hanging on the destination.
  expect(context.gains[0].disconnect).toHaveBeenCalledTimes(1);
  expect(isRouted(audio)).toBe(false);
});

it("makes the graph on a press before anything has played", () => {
  const { context, Context } = fakeContext("suspended");
  vi.stubGlobal("AudioContext", Context);

  resumeAudio();

  expect(Context).toHaveBeenCalledTimes(1);
  expect(context.resume).toHaveBeenCalledTimes(1);
});
