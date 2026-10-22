import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { SongRead, SpinRequest, WishRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useFavorites } from "../hooks/useFavorites";
import { useTags } from "../hooks/useTags";
import { useWishlist } from "../hooks/useWishlist";
import { defaultTagCriteria, passesTagCriteria } from "../tags";
import HostSpin from "./HostSpin";
import { Icon } from "./icons";
import SongDetails from "./SongDetails";
import SongReel, { type Spin } from "./SongReel";
import SpinButton from "./SpinButton";
import "./SongSpinner.css";

type Scope = "all" | "favorites" | "wishlist" | "weighted";

const SCOPES: [Scope, string][] = [
  ["all", "All songs"],
  ["favorites", "Favorites"],
  ["wishlist", "Wishlist"],
  ["weighted", "Wishlist (weighted)"],
];

function pool(
  scope: Scope,
  songs: SongRead[],
  favorites: SongRead[],
  wishes: WishRead[],
): SongRead[] {
  if (scope === "all") return songs;
  if (scope === "favorites") return favorites;
  if (scope === "wishlist") return wishes.map((wish) => wish.song);
  // Weighted: a song wished for three times gets three tickets.
  return wishes.flatMap((wish) => Array<SongRead>(wish.count).fill(wish.song));
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the reel can land on, in one line under the *Pick from* select. The
 * empty cases say what to do about it — an empty scope is an invitation, not a
 * shrug.
 */
function poolCaption(
  scope: Scope,
  songs: SongRead[],
  favorites: SongRead[],
  wishes: WishRead[],
): string {
  if (scope === "all") {
    return songs.length === 0
      ? "No songs in the library yet"
      : count(songs.length, "song", "songs");
  }
  if (scope === "favorites") {
    return favorites.length === 0
      ? "Nothing favorited yet"
      : count(favorites.length, "favorite", "favorites");
  }
  if (wishes.length === 0) return "Nothing on the wishlist yet";
  const wished = count(wishes.length, "wished song", "wished songs");
  if (scope === "wishlist") return wished;
  const tickets = wishes.reduce((sum, wish) => sum + wish.count, 0);
  return `${wished} · ${count(tickets, "wish", "wishes")}`;
}

interface SongSpinnerProps {
  /**
   * A fixed pool to spin — the songs of one playlist. The *Pick from* select
   * then has nothing to choose between and goes away, and neither the library
   * nor the favorites are fetched: the caller already holds the songs.
   */
  songs?: SongRead[];
  /**
   * The playlist the fixed pool is, for the reel on the host screen: the
   * server picks from that playlist where the phone's reel picks from `songs`.
   */
  playlistId?: string;
}

/**
 * The Random song page's column: the *Pick from* select and the pool size, the
 * reel (`SongReel`, which owns the animation), the result, the SPIN button and
 * under it the quiet way of spinning on the host screen instead. The winner is
 * picked here the instant SPIN is pressed, and the reel is told to land on it;
 * a spin on the host screen is the server's pick, and the TV's reel lands on
 * it (`HostSpin`).
 *
 * A finished spin never opens the song modal by itself — the cover and the
 * result line are the way in, and the user takes it.
 */
export default function SongSpinner({
  songs: fixed,
  playlistId,
}: SongSpinnerProps) {
  const auth = useAuth();
  const [scope, setScope] = useState<Scope>("all");
  const [spin, setSpin] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<SongRead | null>(null);
  const [details, setDetails] = useState<SongRead | null>(null);
  // The spin on the host screen this phone asked for, while its modal is up.
  const [hostSpin, setHostSpin] = useState<SpinRequest | null>(null);

  const library = useQuery({
    ...listSongsOptions(),
    enabled: fixed === undefined,
  }).data?.songs;
  const wishlist = useWishlist();
  const wishes = wishlist.wishes;
  const favoriteIds = useFavorites({ enabled: fixed === undefined }).ids;
  const tags = useTags();
  // The reel is the song list in another shape, so it hides the same songs
  // (§7). Only the library scope: a wish and a playlist are somebody's own
  // choice, and hiding what they deliberately asked for would be a bug.
  const criteria = useMemo(() => defaultTagCriteria(tags.tags), [tags.tags]);
  const songs = useMemo(
    () =>
      // Nothing to land on until the tags are in: the criteria are empty while
      // they load, so every hidden song would be a candidate — and the reel
      // picks the instant SPIN is pressed. An empty pool disables SPIN exactly
      // as an unloaded library does, which is the state this already is in.
      tags.isPending
        ? []
        : (library ?? []).filter((song) =>
            passesTagCriteria(song.id, tags.bySong, criteria),
          ),
    [library, criteria, tags.bySong, tags.isPending],
  );
  // The favorites come off the *unfiltered* library, like the wishes: somebody
  // hearted these songs on purpose, and a tag folding them away would be a bug
  // (§7). So this pool also never waits for the tag listings.
  const favorites = useMemo(
    () => (library ?? []).filter((song) => favoriteIds.has(song.id)),
    [library, favoriteIds],
  );
  const candidates = fixed ?? pool(scope, songs, favorites, wishes);
  /** An option with nothing behind it cannot be picked; *All songs* always can
      — an empty library is the library's state, not a closed door. */
  const empty = (value: Scope): boolean =>
    value === "all"
      ? false
      : (value === "favorites" ? favorites : wishes).length === 0;

  const startSpin = () => {
    if (spinning || candidates.length === 0) return;
    // The winner is decided here, and the reel gets the same pool for the
    // covers that fly past — with its duplicates, which is the weighted scope.
    // Under reduced motion the reel lands in the same breath and `spinning` is
    // over before the die's first roll is due.
    setSpin({
      id: (spin?.id ?? 0) + 1,
      winner: candidates[Math.floor(Math.random() * candidates.length)],
    });
    setSpinning(true);
  };

  const settle = (song: SongRead) => {
    setWinner(song);
    setSpinning(false);
  };

  /** The same pool, spun on the TV: the playlist where there is one, else the select's scope. */
  const spinOnHost = () => {
    if (spinning || candidates.length === 0) return;
    setHostSpin(
      fixed !== undefined && playlistId !== undefined
        ? { scope: "playlist", playlist_id: playlistId }
        : { scope },
    );
  };

  const settled = spinning ? null : winner;
  // The host reel needs the right to start a song; a fixed pool without a
  // playlist to name has nothing the server could spin.
  const hostOffered =
    auth.can("karaoke.sing") &&
    (fixed === undefined || playlistId !== undefined);
  // The wishlist tile's take-off for everybody, offered where the reel landed
  // on a wish: the host who spun the wishlist and will not sing this one says
  // so here instead of going back to Home. Only on the two wishlist pools —
  // never on a playlist's reel — and only while the song is still wished for,
  // so the button goes with the wish and the result stays.
  const offerTakeOff =
    fixed === undefined &&
    (scope === "wishlist" || scope === "weighted") &&
    settled !== null &&
    auth.can("wishlist.manage") &&
    wishes.some((wish) => wish.song.id === settled.id);

  return (
    <>
      <div className="spinner">
        {/* One quiet select, not a bank of pills: four choices made once an
            evening must not compete with the reel and the SPIN below (§7).
            The `<label>` wraps the select, which is what names it. */}
        {fixed === undefined && (
          <label className="spinner-pick">
            <span className="spinner-pick-label">Pick from</span>
            <select
              className="text-input text-input-quiet spinner-pick-select"
              value={scope}
              disabled={spinning}
              onChange={(event) => setScope(event.target.value as Scope)}
            >
              {SCOPES.map(([value, label]) => (
                <option key={value} value={value} disabled={empty(value)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* The count stays in a fixed pool: it is what the reel can land on,
            not a setting. */}
        <p className="spinner-pool">
          {fixed
            ? count(fixed.length, "song", "songs")
            : poolCaption(scope, songs, favorites, wishes)}
        </p>

        <SongReel
          spin={spin}
          fillers={candidates}
          onSettled={settle}
          onOpen={setDetails}
        />

        {/* The slot is held open before the first spin so SPIN never jumps —
            but it stays empty: the page title already says "Random song". */}
        <div className="spinner-result">
          {winner && (
            <button
              // Remounted when a spin starts and again when it lands, so the
              // rise-in plays for every reveal, not only the first — the
              // previous winner steps back with it while the reel runs.
              key={`${spin?.id ?? 0}-${spinning ? "spinning" : "settled"}`}
              type="button"
              className="spinner-winner"
              disabled={settled === null}
              onClick={() => setDetails(settled)}
            >
              <span className="spinner-winner-title">{winner.title}</span>
              <span className="spinner-winner-artist">{winner.artist}</span>
            </button>
          )}
        </div>

        {/* Uppercased in CSS: the caps are the look, "Spin" is the name. */}
        <SpinButton
          spinning={spinning}
          disabled={spinning || candidates.length === 0}
          onClick={startSpin}
        >
          Spin
        </SpinButton>

        {/* The quiet second way, never the gradient: the reel on the TV is
            the room's, and SPIN above stays the gesture that opened the page.
            Drawn only with something to land on, like SPIN is enabled. */}
        {hostOffered && candidates.length > 0 && (
          <button
            type="button"
            className="button spinner-host"
            disabled={spinning}
            onClick={spinOnHost}
          >
            Spin on the host screen
          </button>
        )}

        {/* Last in the column, so SPIN and the host button never move when it
            comes and goes. No confirmation, like the tile's own trash. */}
        {offerTakeOff && (
          <button
            type="button"
            className="button spinner-take-off"
            onClick={() => wishlist.clear(settled.id)}
          >
            <Icon name="trash" />
            <span>Take off the wishlist</span>
          </button>
        )}
      </div>

      {details && (
        <SongDetails song={details} onClose={() => setDetails(null)} />
      )}

      {hostSpin && (
        <HostSpin spin={hostSpin} onClose={() => setHostSpin(null)} />
      )}
    </>
  );
}
