/**
 * The host screen's sound effects (docs/dev/sound-effects.md): the badges'
 * whoosh and the thud they land with. (The reel had ticks and a landing of
 * its own until 2026-11-09, when the user found them too much.)
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
// is what the room hears; the first cut was measured in Chrome at master 100
// and effects 100 (docs/dev/sound-effects.md, with what the 2026-11-09 numbers
// are reckoned to give): a whoosh about 0.25 and the thud up to about 0.3 —
// both short and under the peaks of a song played at its evened-out level.

/**
 * A badge thrown onto the stage: air, swelling in the first 80 ms — the throw
 * is fastest as it starts (HostAchievements.css) — and falling away in pitch
 * and level as the badge slows, gone by 0.45 s, the moment it lands. The
 * sweep is wider and the level higher since 2026-11-09 (the user's "a bit
 * more epic"): it starts brighter and ends lower, so the same throw reads as
 * a bigger thing passing.
 */
export const WHOOSH = {
  fromFrequency: 2800,
  toFrequency: 300,
  q: 1,
  peak: 0.5,
  swell: 0.08,
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

/**
 * The badge settles: a low thud, quieter than the whoosh but with weight — a
 * sine dropping to the bottom of what a TV's speakers give over 0.3 s, under
 * a short burst of low-passed noise, the impact itself. The user asked for
 * "a bit more epic" on 2026-11-09, and this is the thud's share of it: lower,
 * longer and heavier, still a thud.
 */
export const THUD = {
  from: 150,
  to: 45,
  peak: 0.2,
  length: 0.3,
  impactFrequency: 300,
  impactPeak: 0.25,
  impactLength: 0.07,
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

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(THUD.impactFrequency, when);
  const impactGain = envelope(
    context,
    when,
    THUD.impactPeak,
    0.002,
    THUD.impactLength,
  );
  filter.connect(impactGain);
  impactGain.connect(destination);
  const impact = noiseBurst(context, filter, when, THUD.impactLength + 0.005);

  return voiceOf([body, impact], [gain, filter, impactGain]);
};

export const RECIPES = { whoosh, thud } as const;
export type EffectName = keyof typeof RECIPES;

// --- playing them -------------------------------------------------------------

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
  try {
    return RECIPES[name](context, destination, when);
  } catch {
    // A graph that refused a node: an effect is never worth an error.
    return null;
  }
}
