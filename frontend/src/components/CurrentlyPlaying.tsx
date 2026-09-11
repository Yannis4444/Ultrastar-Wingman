import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentSing } from "../api";
import {
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  listKaraokeColorsOptions,
} from "../api/@tanstack/react-query.gen";
import { formatDuration } from "../duration";
import { useNow } from "../hooks/useNow";
import { parseServerTime } from "../duration";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import "./CurrentlyPlaying.css";

interface KaraokeStarted extends WingmanEvent {
  sing: CurrentSing;
}

/**
 * The running song on the host screen — a TV across the room that nobody taps.
 * It shows the whole picture: the cover, the time, the progress bar and the
 * singers on their slot colours. No controls: the host page owns Stop, in its
 * reveal-on-movement overlay.
 *
 * The phone's half of this used to live here behind a `variant` prop. It does
 * not any more: `HomeStage` is a player with three modes and a fixed height,
 * which has almost nothing in common with a TV block beyond the cache entry
 * they both read.
 */
export default function CurrentlyPlaying() {
  const queryClient = useQueryClient();
  const current = useQuery(getCurrentSingOptions());
  const colors = useQuery(listKaraokeColorsOptions());

  // The events carry the whole payload, so no refetch is needed.
  useWingmanEvent<KaraokeStarted>("karaoke.started", (message) =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: message.sing }),
  );
  useWingmanEvent("karaoke.ended", () =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  );

  const sing = current.data?.sing ?? null;
  const now = useNow(sing !== null);
  // A clock skew between server and browser must not show a negative time.
  const elapsed =
    sing === null
      ? 0
      : Math.max(
          0,
          Math.floor((now - parseServerTime(sing.started_at)) / 1000),
        );

  if (sing === null) return null;

  const song = sing.song;
  const duration = song.duration_seconds;
  // The clock starts when Wingman launches USDX, which then takes a moment to
  // boot before the first note — so the elapsed time can overtake the total.
  // Once it has, the total is provably wrong and showing it only misleads; the
  // bar stays full.
  const showTotal = duration !== null && elapsed <= duration;

  const hexFor = (name: string): string | undefined =>
    colors.data?.colors.find((color) => color.name === name)?.hex;

  return (
    <section className="currently-playing" aria-label="Now playing">
      <SongCover song={song} className="currently-playing-cover" />

      <div className="currently-playing-info">
        <h2 className="currently-playing-title">{song.title}</h2>
        <p className="currently-playing-artist">{song.artist}</p>
        <p className="currently-playing-elapsed">
          {formatDuration(elapsed)}
          {showTotal && ` / ${formatDuration(duration)}`}
        </p>
      </div>

      {duration !== null && (
        <div className="currently-playing-bar" aria-hidden="true">
          <span
            style={{ width: `${Math.min(100, (elapsed / duration) * 100)}%` }}
          />
        </div>
      )}

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
    </section>
  );
}
