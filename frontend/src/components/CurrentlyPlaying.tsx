import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CurrentSing, SongRead } from "../api";
import {
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  listKaraokeColorsOptions,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { formatDuration, parseServerTime } from "../duration";
import { useFavorites } from "../hooks/useFavorites";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
// The control row mirrors the song modal's, down to the stylesheet.
import "./SongControls.css";
import SongDetails from "./SongDetails";
import "./CurrentlyPlaying.css";

interface KaraokeStarted extends WingmanEvent {
  sing: CurrentSing;
}

interface CurrentlyPlayingProps {
  /** The host page owns Stop (in its reveal-on-move overlay); hide it here. */
  hideControls?: boolean;
  /**
   * Appended to the block's own class. The Home stage passes
   * `currently-playing-stage`, which restyles the block for the tile it sits
   * in; the host passes nothing and keeps today's rendering exactly.
   */
  className?: string;
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

/**
 * The running song. When USDX is idle the block itself is gone — only a song
 * modal the reader opened from it stays until they close it.
 */
export default function CurrentlyPlaying({
  hideControls = false,
  className,
}: CurrentlyPlayingProps) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const current = useQuery(getCurrentSingOptions());
  const colors = useQuery(listKaraokeColorsOptions());
  const favorites = useFavorites();
  // The same list the wishlist tile and the host already hold, so the wish mark
  // on the stage costs no extra request.
  const wishlist = useWishlist();
  const [askStop, setAskStop] = useState(false);
  // The song the reader opened the modal for, if any. It travels with the
  // state: the sing can end while the modal is open (USDX finished it, or
  // somebody else stopped it), and the block going away must not take the
  // reader's open modal with it.
  const [details, setDetails] = useState<SongRead | null>(null);

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

  // A sing that ends takes its Stop confirmation with it: the flag would
  // otherwise survive the idle gap and put the dialog back over the *next*
  // song, one stray tap away from stopping it. Not folded into the
  // `karaoke.ended` handler — a plain refetch can also come back empty.
  useEffect(() => {
    if (sing === null) setAskStop(false);
  }, [sing]);

  // Rendered outside the block below as well as instead of it, so that the end
  // of the sing closes the block and leaves the modal standing.
  const modal =
    details !== null ? (
      <SongDetails song={details} onClose={() => setDetails(null)} />
    ) : null;

  if (!sing) return modal;

  const song = sing.song;
  const duration = song.duration_seconds;
  // The clock starts when Wingman launches USDX, which then takes a moment to
  // boot before the first note — so the elapsed time can overtake the total.
  // Once it has, the total is provably wrong and showing it only misleads; the
  // bar stays full.
  const showTotal = duration !== null && elapsed <= duration;
  const favorite = favorites.ids.has(song.id);
  const wished = wishlist.mine(song.id);
  const canWish = auth.can("wishlist.add");
  const showControls =
    !hideControls &&
    (favorites.available || canWish || auth.can("karaoke.stop"));

  const hexFor = (name: string): string | undefined =>
    colors.data?.colors.find((color) => color.name === name)?.hex;

  const cover = <SongCover song={song} className="currently-playing-cover" />;

  return (
    <>
      <section
        className={
          className ? `currently-playing ${className}` : "currently-playing"
        }
        aria-label="Now playing"
      >
        {/* The host is a TV nobody taps: it keeps the bare cover, which is also
            what its grid places. */}
        {hideControls ? (
          cover
        ) : (
          <button
            type="button"
            className="currently-playing-cover-button"
            aria-label={`Details for ${song.title}`}
            onClick={() => setDetails(song)}
          >
            {cover}
          </button>
        )}

        <div className="currently-playing-info">
          <h2 className="currently-playing-title">{song.title}</h2>
          <p className="currently-playing-artist">{song.artist}</p>
          <p className="currently-playing-elapsed">
            {formatDuration(elapsed)}
            {showTotal && ` / ${formatDuration(duration)}`}
          </p>
        </div>

        {/* Off the host the bar is always in the DOM, hidden rather than
            dropped when the song has no known duration: 6px appearing halfway
            through a sing would shove everything below it down. The host keeps
            today's markup, so its grid rows are untouched. */}
        {(duration !== null || !hideControls) && (
          <div
            className="currently-playing-bar"
            aria-hidden="true"
            style={duration === null ? { visibility: "hidden" } : undefined}
          >
            <span
              style={{
                width:
                  duration === null
                    ? "0%"
                    : `${Math.min(100, (elapsed / duration) * 100)}%`,
              }}
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

        {/* Mirrors the song modal's row: two 48px marks either side of one
            large, unfilled control. Here the large one is Stop. */}
        {showControls && (
          <div className="currently-playing-controls">
            {favorites.available && (
              <button
                type="button"
                className={
                  favorite
                    ? "song-control song-control-favorite song-control-favorite-on"
                    : "song-control song-control-favorite"
                }
                aria-pressed={favorite}
                aria-label={
                  favorite ? "Remove from favorites" : "Add to favorites"
                }
                onClick={() => favorites.toggle(song.id)}
              >
                <Icon name="heart" />
              </button>
            )}
            {auth.can("karaoke.stop") && (
              <button
                type="button"
                className="song-control song-control-lead song-control-stop"
                aria-label="Stop"
                title="Stop"
                disabled={stop.isPending}
                onClick={() => setAskStop(true)}
              >
                <Icon name="stop" />
              </button>
            )}
            {canWish && (
              <button
                type="button"
                className={
                  wished
                    ? "song-control song-control-wish song-control-wish-on"
                    : "song-control song-control-wish"
                }
                aria-pressed={wished}
                aria-label={wished ? "Remove wish" : "Wish"}
                onClick={() => {
                  if (wished) wishlist.unwish(song.id);
                  else wishlist.wish(song.id);
                }}
              >
                <Icon name={wished ? "playlist-check" : "playlist-plus"} />
              </button>
            )}
          </div>
        )}
      </section>

      {modal}

      {!hideControls && askStop && (
        <ConfirmModal
          title="Stop the song"
          message={`Stop "${song.title}"? Scores for an unfinished song are not recorded.`}
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
