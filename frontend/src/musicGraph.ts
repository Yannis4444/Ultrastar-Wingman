/**
 * The host screen's loudness graph: each `<audio>` of the music sink played
 * through a Web Audio gain node carrying the song's evened-out loudness
 * (`replayGainFactor`), because a quiet song has to come *up* and an element's
 * `volume` stops at 1.
 *
 * Module state, not refs: one AudioContext for the page, made at the first
 * play, and one source node per element for that element's life. A browser
 * allows `createMediaElementSource` once per element — a second call throws
 * `InvalidStateError` — and an element routed into a graph is heard only
 * through it from then on, so the context is never closed and the nodes are
 * never made again: not on StrictMode's second mount, not on a re-render, not
 * when the sink mounts again. The map is keyed on the element, so a new one
 * gets new nodes and an old one is let go of with it.
 *
 * Where there is no Web Audio (no `AudioContext`, or one that cannot be made)
 * nothing is routed, and `levelOf` folds the loudness into the element's own
 * volume instead, as far as a volume can go.
 */

let audioContext: AudioContext | null = null;
let gains = new WeakMap<HTMLMediaElement, GainNode>();
// Elements the context would not take: asked once, then played the old way,
// so a play does not make a gain node it throws away every time.
let unroutable = new WeakSet<HTMLMediaElement>();
let stateHandler: (() => void) | null = null;

/** How quickly a level moves under a song that is sounding — a tenth of a
 *  second's time constant, so a change mid-song is no click and no jump. */
const GLIDE_SECONDS = 0.1;

/** The page's AudioContext, made on first use; null where there is none. */
function context(): AudioContext | null {
  if (audioContext !== null) return audioContext;
  const Context = window.AudioContext as typeof AudioContext | undefined;
  if (typeof Context !== "function") return null;
  try {
    audioContext = new Context();
  } catch {
    return null;
  }
  audioContext.addEventListener("statechange", () => stateHandler?.());
  return audioContext;
}

/** Route `element` through its own gain node the first time it is asked;
 *  afterwards only the gain moves. An element that cannot be routed plays as
 *  before, with the factor folded into its volume (`levelOf`). */
export function route(element: HTMLMediaElement, factor: number): void {
  if (gains.has(element)) {
    setLoudness(element, factor);
    return;
  }
  if (unroutable.has(element)) return;
  const graph = context();
  if (graph === null) return;
  let gain: GainNode | null = null;
  try {
    gain = graph.createGain();
    gain.gain.value = factor;
    gain.connect(graph.destination);
    // Last, and only once the rest stands: from this call on the element is
    // heard through the graph alone, and it cannot be asked twice.
    graph.createMediaElementSource(element).connect(gain);
    gains.set(element, gain);
  } catch {
    // Left out of the graph, which leaves it audible the old way — and the
    // node let go of, which its edge to the destination would keep alive.
    gain?.disconnect();
    unroutable.add(element);
  }
}

/** Whether `element` plays through the graph. */
export function isRouted(element: HTMLMediaElement): boolean {
  return gains.has(element);
}

/** The element's loudness, on its node. A step while the element is silent —
 *  it is given a new file, which pauses it — and a short glide under a song
 *  that is sounding, whose numbers moved mid-play: a step there would click.
 *  The fades are the element's own volume, never this. */
export function setLoudness(element: HTMLMediaElement, factor: number): void {
  const gain = gains.get(element);
  if (gain === undefined || audioContext === null) return;
  const param = gain.gain;
  if (param.value === factor) return;
  if (element.paused) {
    // Nothing is heard, so a glide still running may be dropped outright.
    param.cancelScheduledValues(0);
    param.value = factor;
  } else {
    // No cancel here: it would drop the param back to its last plain value
    // for a moment. A new target glides on from wherever the last one is.
    param.setTargetAtTime(factor, audioContext.currentTime, GLIDE_SECONDS);
  }
}

/** What the element's own `volume` is set to: the printed volumes alone while
 *  the node carries the loudness, and without a node the loudness folded in as
 *  far as a volume can go — down, never up. */
export function levelOf(
  element: HTMLMediaElement,
  volume: number,
  factor: number,
): number {
  return gains.has(element) ? volume : volume * Math.min(1, factor);
}

/** Wake the graph — making it first, when nothing has played yet. Inside a
 *  gesture this is what lets it start, and a context made there is born
 *  running; outside one a browser may leave it waiting, which `audible` then
 *  says. */
export function resumeAudio(): void {
  const graph = context();
  if (graph !== null && graph.state !== "running") {
    graph.resume().catch(() => {});
  }
}

/** Whether a playing element is actually heard: one outside the graph always,
 *  one in it only while the graph runs. */
export function audible(element: HTMLMediaElement): boolean {
  return !gains.has(element) || audioContext?.state === "running";
}

/** The sink's ear on the graph's state; unmounting hands in nothing. */
export function onAudioState(handler: (() => void) | null): void {
  stateHandler = handler;
}

/** Only for the tests: forget the graph, so each test makes its own. */
export function resetLoudnessGraph(): void {
  audioContext = null;
  gains = new WeakMap();
  unroutable = new WeakSet();
  stateHandler = null;
}
