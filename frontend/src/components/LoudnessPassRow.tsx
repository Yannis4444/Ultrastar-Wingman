import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoudnessPassStatus } from "../api";
import {
  readLoudnessPassOptions,
  readLoudnessPassQueryKey,
  startLoudnessPassMutation,
  stopLoudnessPassMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage } from "../errors";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { LOUDNESS_PASS_NOTE, loudnessPassLine } from "../loudness";
import "./SettingField.css";
import "./LoudnessPassRow.css";

/** The event carries the pass without the song in hand: every socket gets
    it, and a song a tag hides from guests must not ride along. */
interface LoudnessChanged extends WingmanEvent {
  loudness: Omit<LoudnessPassStatus, "song">;
}

/**
 * Whether `next` is the message of a running pass taking its next song in
 * hand, the one worth asking the GET for the song. Not the first message with
 * a count (`old.total` still 0: no song yet), and not a wait ending (`old`
 * waiting): the song is the one before the wait, or the next message brings
 * one. Nothing to compare with before the GET has answered, which is under
 * way and brings the song itself.
 */
function takesNextSong(
  old: LoudnessPassStatus | undefined,
  next: LoudnessChanged["loudness"],
): boolean {
  return (
    old !== undefined &&
    next.state === "running" &&
    !next.waiting &&
    next.total > 0 &&
    old.total > 0 &&
    !old.waiting
  );
}

/**
 * An action under the Normalize loudness setting, not a setting: the setting
 * tags every download, and this tags the songs that were in the library
 * before. Nothing runs by itself, so the host presses it and watches it run.
 * Drawn for `settings.manage` alone, the right its three routes take.
 */
export default function LoudnessPassRow() {
  const queryClient = useQueryClient();
  const key = readLoudnessPassQueryKey();
  const status = useQuery(readLoudnessPassOptions());

  useWingmanEvent<LoudnessChanged>("loudness.changed", ({ loudness }) => {
    // What the event carries goes straight in. The song in hand is only in
    // the answer to the GET, so a running pass asks for it once per song:
    // on the message that takes the next song in hand, and on none of the
    // others (the count, a wait beginning or ending, a stop), which keep it.
    // A GET still under way left before this message, and its answer would
    // put an older pass back: it is asked again instead, so the newest wins.
    const old = queryClient.getQueryData<LoudnessPassStatus>(key);
    const asking = queryClient.isFetching({ queryKey: key }) > 0;
    queryClient.setQueryData<LoudnessPassStatus>(key, {
      ...loudness,
      song: loudness.state === "idle" ? null : (old?.song ?? null),
    });
    if (asking || takesNextSong(old, loudness)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });

  const write = {
    onSuccess: (pass: LoudnessPassStatus) => {
      queryClient.setQueryData(key, pass);
    },
  };
  const start = useMutation({
    ...startLoudnessPassMutation(),
    ...write,
    // Somebody else's press got there first: the state they started is the
    // one to show, and no error.
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const stop = useMutation({ ...stopLoudnessPassMutation(), ...write });

  const pass = status.data;
  const running = pass !== undefined && pass.state !== "idle";
  const refusal =
    start.isError && errorDetail(start.error) !== "loudness_running"
      ? errorMessage(start.error, "Could not start evening out the songs.")
      : stop.isError
        ? errorMessage(stop.error, "Could not stop evening out the songs.")
        : pass?.ended === "failed"
          ? (pass.error ?? "Could not start evening out the songs.")
          : null;

  return (
    <div className="setting-field">
      <div className="setting-row">
        <span className="setting-label">Songs already in the library</span>
        {running ? (
          <button
            type="button"
            className="button loudness-pass-button"
            disabled={pass?.state === "stopping" || stop.isPending}
            onClick={() => stop.mutate({})}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="button loudness-pass-button"
            disabled={pass === undefined || start.isPending}
            onClick={() => start.mutate({})}
          >
            Even out
          </button>
        )}
      </div>

      <p
        className={`setting-description loudness-pass-line${running ? " loudness-pass-progress" : ""}`}
      >
        {pass === undefined ? LOUDNESS_PASS_NOTE : loudnessPassLine(pass)}
      </p>

      {status.isError && (
        <p className="error-notice setting-error" role="alert">
          Could not load the progress of evening out the songs.
        </p>
      )}
      {refusal !== null && (
        <p className="error-notice setting-error" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
