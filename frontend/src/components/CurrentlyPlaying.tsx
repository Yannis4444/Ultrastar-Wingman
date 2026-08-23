import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CurrentSing } from "../api";
import {
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  listKaraokeColorsOptions,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { formatDuration } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import ConfirmModal from "./ConfirmModal";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import "./CurrentlyPlaying.css";

interface KaraokeStarted extends WingmanEvent {
  sing: CurrentSing;
}

/**
 * The backend timestamps in UTC, but SQLite can round-trip the offset away and
 * a naive string would be read as local time.
 */
function parsedStart(startedAt: string): number {
  return Date.parse(
    /(Z|[+-]\d\d:?\d\d)$/.test(startedAt) ? startedAt : `${startedAt}Z`,
  );
}

function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [startedAt]);

  if (startedAt === null) return 0;
  // A clock skew between server and browser must not show a negative time.
  return Math.max(0, Math.floor((now - parsedStart(startedAt)) / 1000));
}

/** The running song, or nothing at all when USDX is idle. */
export default function CurrentlyPlaying() {
  const queryClient = useQueryClient();
  const current = useQuery(getCurrentSingOptions());
  const colors = useQuery(listKaraokeColorsOptions());
  const [askStop, setAskStop] = useState(false);

  const stop = useMutation({
    ...stopSingingMutation(),
    onSuccess: () =>
      queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  });

  // The events carry the whole payload, so no refetch is needed.
  useWingmanEvent<KaraokeStarted>("karaoke.started", (message) =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: message.sing }),
  );
  useWingmanEvent("karaoke.ended", () =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  );

  const sing = current.data?.sing ?? null;
  const elapsed = useElapsedSeconds(sing?.started_at ?? null);

  if (!sing) return null;

  const hexFor = (name: string): string | undefined =>
    colors.data?.colors.find((color) => color.name === name)?.hex;

  return (
    <>
      <section className="currently-playing" aria-label="Now playing">
        <SongCover song={sing.song} className="currently-playing-cover" />
        <h2 className="currently-playing-title">{sing.song.title}</h2>
        <p className="currently-playing-artist">{sing.song.artist}</p>
        <p className="currently-playing-elapsed">
          {formatDuration(elapsed)}
          {sing.song.duration_seconds !== null &&
            ` / ${formatDuration(sing.song.duration_seconds)}`}
        </p>

        <ul className="currently-playing-players">
          {sing.slots
            .filter((slot) => slot.player !== null)
            .map((slot) => (
              <li key={slot.color} style={{ borderColor: hexFor(slot.color) }}>
                <PlayerAvatar player={slot.player} />
                <span>{slot.player?.name}</span>
              </li>
            ))}
        </ul>

        <button
          type="button"
          className="button button-danger"
          disabled={stop.isPending}
          onClick={() => setAskStop(true)}
        >
          Stop
        </button>
      </section>

      {askStop && (
        <ConfirmModal
          title="Stop the song"
          message={`Stop "${sing.song.title}"? Scores for an unfinished song are not recorded.`}
          confirmLabel="Stop"
          danger
          onConfirm={() => {
            setAskStop(false);
            stop.mutate({});
          }}
          onCancel={() => setAskStop(false)}
        />
      )}
    </>
  );
}
