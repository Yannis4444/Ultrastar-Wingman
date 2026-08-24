import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CurrentSing } from "../api";
import {
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  listKaraokeColorsOptions,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { formatDuration, parseServerTime } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import ConfirmModal from "./ConfirmModal";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import "./CurrentlyPlaying.css";

interface KaraokeStarted extends WingmanEvent {
  sing: CurrentSing;
}

interface CurrentlyPlayingProps {
  /** The host page owns Stop (in its reveal-on-move overlay); hide it here. */
  hideControls?: boolean;
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
  return Math.max(0, Math.floor((now - parseServerTime(startedAt)) / 1000));
}

/** The running song, or nothing at all when USDX is idle. */
export default function CurrentlyPlaying({
  hideControls = false,
}: CurrentlyPlayingProps) {
  const queryClient = useQueryClient();
  const auth = useAuth();
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
        <div className="currently-playing-info">
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
                <li key={slot.color}>
                  <span
                    className="currently-playing-dot"
                    /* The slot's USDX color, fetched from the backend. */
                    style={{
                      backgroundColor:
                        hexFor(slot.color) ?? "var(--color-darkerer)",
                    }}
                    aria-hidden="true"
                  />
                  <PlayerAvatar player={slot.player} />
                  <span className="currently-playing-name">
                    {slot.player?.name}
                  </span>
                </li>
              ))}
          </ul>
        </div>

        {sing.song.duration_seconds !== null && (
          <div className="currently-playing-bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(100, (elapsed / sing.song.duration_seconds) * 100)}%`,
              }}
            />
          </div>
        )}

        {!hideControls && auth.can("karaoke.stop") && (
          <button
            type="button"
            className="button button-danger"
            disabled={stop.isPending}
            onClick={() => setAskStop(true)}
          >
            Stop
          </button>
        )}
      </section>

      {!hideControls && askStop && (
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
