import type { LoudnessCounts, LoudnessPassStatus } from "./api";

/** What the explaining line says while no pass has run since Wingman started. */
export const LOUDNESS_PASS_NOTE =
  "Writes a ReplayGain tag into every song that has none yet. Singing pauses it.";

function songs(count: number): string {
  return count === 1 ? "1 song" : `${count} songs`;
}

/** Every outcome that left the file without a tag Wingman wrote or found. */
function untagged(counts: LoudnessCounts): number {
  return (
    counts.unsupported +
    counts.silent +
    counts.missing +
    counts.in_use +
    counts.failed
  );
}

/**
 * The counts of a pass as short sentences: "Tagged 300 songs. 20 had a tag
 * already. 15 could not be tagged." A count of nothing is left out.
 */
export function loudnessCountsSentence(counts: LoudnessCounts): string {
  const sentences: string[] = [];
  if (counts.tagged > 0) sentences.push(`Tagged ${songs(counts.tagged)}.`);
  if (counts.already_tagged > 0) {
    sentences.push(`${counts.already_tagged} had a tag already.`);
  }
  const left = untagged(counts);
  if (left > 0) sentences.push(`${left} could not be tagged.`);
  return sentences.join(" ");
}

/**
 * The line under the pass's button: what it does before it ran, the progress
 * while it runs, and how it ended until the next press. A pass that could not
 * start has nothing to say here; its sentence is the error notice's.
 */
export function loudnessPassLine(status: LoudnessPassStatus): string {
  if (status.state === "stopping") return "Stopping after this song.";
  if (status.state === "running") {
    if (status.total === 0) return "Looking for songs without a tag…";
    // The song in hand is the next one after those already done.
    const position = `${Math.min(status.done + 1, status.total)} of ${status.total}`;
    if (status.waiting) {
      return `${position}. Paused until Ultrastar Deluxe closes.`;
    }
    return status.song === null
      ? `${position}.`
      : `${position}: ${status.song.title} by ${status.song.artist}`;
  }
  if (status.ended === "finished") {
    if (status.total === 0) return "Every song has its loudness already.";
    return loudnessCountsSentence(status.counts);
  }
  if (status.ended === "stopped") {
    const counts = loudnessCountsSentence(status.counts);
    const stopped = `Stopped after ${status.done} of ${status.total}.`;
    return counts === "" ? stopped : `${stopped} ${counts}`;
  }
  return LOUDNESS_PASS_NOTE;
}
