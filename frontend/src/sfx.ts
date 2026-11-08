/**
 * The host screen's sound effects (docs/dev/sound-effects.md): the reel's
 * ticks and landing, the badges' whoosh and the soft thud they land with.
 *
 * Nothing here is a file. Every effect is a recipe — noise or an oscillator,
 * a filter and an envelope — scheduled on the page's one AudioContext
 * (`musicGraph.ts`) into the effects bus, which `MusicSink` holds at
 * master × effects on the host tab with the music sink's lease and at 0
 * everywhere else. So switching the effects off, a phone, a second host tab
 * and a graph the browser has not let start all come to the same thing:
 * `playEffect` finds no output and plays nothing — never a prompt, never an
 * error.
 *
 * The recipes are pure functions over a context and a destination, so the
 * tests can hand them a fake one and read off what was scheduled.
 */

import { effectsOutput } from "./musicGraph";

/** One sounding effect: `stop` cuts it, sounded or still to come. */
export interface Voice {
  stop(): void;
}

/** A recipe: the nodes for one effect, starting at `when` on the context's clock. */
export type Recipe = (
  context: BaseAudioContext,
  destination: AudioNode,
  when: number,
) => Voice;

/** Envelopes end here rather than at zero: an exponential ramp cannot reach 0. */
const SILENT = 0.0001;

/** A second of white noise, made once per context and shared by every effect. */
const NOISE_SECONDS = 1;
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(context: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(context);
  if (cached !== undefined) return cached;
  const length = Math.round(context.sampleRate * NOISE_SECONDS);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}

/** A gain node shaped as a percussive envelope: up to `peak` in `attack`
 *  seconds, then an exponential fall to silence at `end`. */
function envelope(
  context: BaseAudioContext,
  when: number,
  peak: number,
  attack: number,
  end: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(SILENT, when + end);
  return gain;
}

/** Noise from a random point of the buffer, through `filter`, for `length` s. */
function noiseBurst(
  context: BaseAudioContext,
  filter: BiquadFilterNode,
  when: number,
  length: number,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = noise(context);
  source.connect(filter);
  const offset = Math.random() * (NOISE_SECONDS - length);
  source.start(when, Math.max(0, offset), length);
  return source;
}

function voiceOf(
  sources: AudioScheduledSourceNode[],
  nodes: AudioNode[],
): Voice {
  // Let the graph go once the last source is done; `stop` ends it early.
  let left = sources.length;
  for (const source of sources) {
    source.onended = () => {
      left -= 1;
      if (left === 0) for (const node of nodes) node.disconnect();
    };
  }
  return {
    stop() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped: nothing to cut.
        }
      }
    },
  };
}

// --- the recipes ----------------------------------------------------------------
//
// The `peak`s are the envelopes'. What comes out of a filter is less, and that
// is what the room hears; measured in Chrome at master 100 and effects 100
// (docs/dev/sound-effects.md): a tick 0.06 to 0.12 of full scale, the landing
// about 0.25, a whoosh about 0.2 and the thud about 0.1 — every one of them
// short and under the peaks of a song played at its evened-out level.

/** Each cover the reel carries past the line: a dry, woody click, 25 ms. */
export const TICK = {
  frequency: 2600,
  q: 3,
  peak: 0.3,
  attack: 0.001,
  length: 0.025,
} as const;

export const tick: Recipe = (context, destination, when) => {
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(TICK.frequency, when);
  filter.Q.setValueAtTime(TICK.q, when);
  const gain = envelope(context, when, TICK.peak, TICK.attack, TICK.length);
  filter.connect(gain);
  gain.connect(destination);
  const source = noiseBurst(context, filter, when, TICK.length + 0.005);
  return voiceOf([source], [filter, gain]);
};

/** The reel comes to rest: a low knock under a short clack, a quarter second. */
export const LAND = {
  knockFrom: 170,
  knockTo: 70,
  knockPeak: 0.22,
  knockLength: 0.22,
  clackFrequency: 1400,
  clackQ: 2,
  clackPeak: 0.4,
  clackLength: 0.05,
} as const;

export const land: Recipe = (context, destination, when) => {
  const knock = context.createOscillator();
  knock.type = "sine";
  knock.frequency.setValueAtTime(LAND.knockFrom, when);
  knock.frequency.exponentialRampToValueAtTime(LAND.knockTo, when + 0.12);
  const knockGain = envelope(
    context,
    when,
    LAND.knockPeak,
    0.003,
    LAND.knockLength,
  );
  knock.connect(knockGain);
  knockGain.connect(destination);
  knock.start(when);
  knock.stop(when + LAND.knockLength + 0.01);

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(LAND.clackFrequency, when);
  filter.Q.setValueAtTime(LAND.clackQ, when);
  const clackGain = envelope(
    context,
    when,
    LAND.clackPeak,
    0.001,
    LAND.clackLength,
  );
  filter.connect(clackGain);
  clackGain.connect(destination);
  const clack = noiseBurst(context, filter, when, LAND.clackLength + 0.005);

  return voiceOf([knock, clack], [knockGain, filter, clackGain]);
};

/**
 * A badge thrown onto the stage: air, swelling in the first 70 ms — the throw
 * is fastest as it starts (HostAchievements.css) — and falling away in pitch
 * and level as the badge slows, gone by 0.45 s, the moment it lands.
 */
export const WHOOSH = {
  fromFrequency: 2200,
  toFrequency: 420,
  q: 0.9,
  peak: 0.37,
  swell: 0.07,
  length: 0.45,
} as const;

export const whoosh: Recipe = (context, destination, when) => {
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(WHOOSH.fromFrequency, when);
  filter.frequency.exponentialRampToValueAtTime(
    WHOOSH.toFrequency,
    when + WHOOSH.length,
  );
  filter.Q.setValueAtTime(WHOOSH.q, when);
  const gain = envelope(
    context,
    when,
    WHOOSH.peak,
    WHOOSH.swell,
    WHOOSH.length,
  );
  filter.connect(gain);
  gain.connect(destination);
  const source = noiseBurst(context, filter, when, WHOOSH.length + 0.01);
  return voiceOf([source], [filter, gain]);
};

/** The badge settles: a soft low thud, quieter than the whoosh, 0.16 s. */
export const THUD = {
  from: 120,
  to: 55,
  peak: 0.11,
  length: 0.16,
} as const;

export const thud: Recipe = (context, destination, when) => {
  const body = context.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(THUD.from, when);
  body.frequency.exponentialRampToValueAtTime(THUD.to, when + THUD.length);
  const gain = envelope(context, when, THUD.peak, 0.004, THUD.length);
  body.connect(gain);
  gain.connect(destination);
  body.start(when);
  body.stop(when + THUD.length + 0.01);
  return voiceOf([body], [gain]);
};

export const RECIPES = { tick, land, whoosh, thud } as const;
export type EffectName = keyof typeof RECIPES;

// --- playing them -------------------------------------------------------------

/** Ticks closer than this are one: at full speed the reel carries more than a
 *  cover a frame past the line, and a click per frame is a buzz, not a reel. */
export const MIN_TICK_GAP_S = 0.03;
let lastTick: { context: BaseAudioContext; at: number } | null = null;

/**
 * Play `name` now, or `delay` seconds from now on the audio clock. `null` when
 * nothing would be heard — the effects are off or not this tab's, or the graph
 * is not running — and nothing is made at all then.
 */
export function playEffect(name: EffectName, delay = 0): Voice | null {
  const output = effectsOutput();
  if (output === null) return null;
  const { context, destination } = output;
  const when = context.currentTime + Math.max(0, delay);
  if (name === "tick") {
    if (
      lastTick !== null &&
      lastTick.context === context &&
      when - lastTick.at < MIN_TICK_GAP_S
    ) {
      return null;
    }
    lastTick = { context, at: when };
  }
  try {
    return RECIPES[name](context, destination, when);
  } catch {
    // A graph that refused a node: an effect is never worth an error.
    return null;
  }
}

/** Only for the tests: forget the last tick. */
export function resetEffects(): void {
  lastTick = null;
}

/** What the host screen's reel sounds like: `SongReel`'s `sounds`. */
export const REEL_SOUNDS = {
  pass: () => {
    playEffect("tick");
  },
  land: () => {
    playEffect("land");
  },
};

// --- following the reel ---------------------------------------------------------

/**
 * The vertical offset a computed `transform` puts an element at, in px — the
 * reel's real position mid-transition, read off the browser rather than worked
 * out from a second clock. `none` is 0; anything unreadable is `null`.
 */
export function translateYOf(transform: string): number | null {
  const value = transform.trim();
  if (value === "" || value === "none") return 0;
  const match = /^matrix(3d)?\(([^)]*)\)$/.exec(value);
  if (match === null) return null;
  const numbers = match[2].split(",").map((part) => Number(part.trim()));
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  if (match[1] === "3d") return numbers.length === 16 ? numbers[13] : null;
  return numbers.length === 6 ? numbers[5] : null;
}

/**
 * Which cover of the reel stands at the window's line, counted from the top,
 * for a reel `offset` px up (negative) and covers `cover` px high. It changes
 * as a cover's edge crosses the line in the window's middle — the moment the
 * tick belongs to.
 */
export function coverAtLine(offset: number, cover: number): number {
  // `+ 0` turns the -0 a reel at rest would give into 0.
  return Math.round(-offset / cover) + 0;
}
