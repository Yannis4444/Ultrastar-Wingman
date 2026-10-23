import type { LoudnessCounts, LoudnessPassStatus } from "./api";

/** What the explaining line says while no pass has run since Wingman started. */
export const LOUDNESS_PASS_NOTE =
  "Writes the loudness into every song that has none yet. Singing pauses it.";

function songs(count: number): string {
  return count === 1 ? "1 song" : `${count} songs`;
}

/** Every outcome that left the file without a loudness Wingman wrote or found. */
function notEvened(counts: LoudnessCounts): number {
  return (
    counts.unsupported +
    counts.silent +
    counts.missing +
    counts.in_use +
    counts.failed
  );
}

/**
 * The counts of a pass as short sentences, in the row's own verb: "Evened out
 * 300 songs. 20 had their loudness already. 15 could not be evened out." Never
 * "tag", which is a song's label (documentation.md). A count of nothing is
 * left out.
 */
export function loudnessCountsSentence(counts: LoudnessCounts): string {
  const sentences: string[] = [];
  if (counts.tagged > 0) sentences.push(`Evened out ${songs(counts.tagged)}.`);
  if (counts.already_tagged > 0) {
    const their = counts.already_tagged === 1 ? "its" : "their";
    sentences.push(`${counts.already_tagged} had ${their} loudness already.`);
  }
  const left = notEvened(counts);
  if (left > 0) sentences.push(`${left} could not be evened out.`);
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
    if (status.total === 0) return "Looking for songs to even out…";
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
