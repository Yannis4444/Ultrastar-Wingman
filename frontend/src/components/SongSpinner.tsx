import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { SongRead, SpinRequest, WishRead } from "../api";
import { listSongsOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useFavorites } from "../hooks/useFavorites";
import { useHostSpin } from "../hooks/useHostSpin";
import { useTags } from "../hooks/useTags";
import { useWishlist } from "../hooks/useWishlist";
import {
  readSpinTarget,
  SPIN_TARGETS,
  writeSpinTarget,
  type SpinTarget,
} from "../spinTarget";
import { defaultTagCriteria, passesTagCriteria } from "../tags";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import PlayerSelection from "./PlayerSelection";
import SongCover from "./SongCover";
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

/** The two wishlist pools, the only ones a landed song can come off. */
function isWishScope(scope: SpinRequest["scope"] | undefined): boolean {
  return scope === "wishlist" || scope === "weighted";
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
 * The Random song page's column (ui-guidelines §7), one layout for both places
 * the reel runs: the *This screen* · *Host screen* pills, the *Pick from*
 * select and the pool size, the reel's window, the result — with the wishlist
 * take-off beside it where there is one — and one action row of SPIN and Play.
 *
 * On *This screen* the reel is this phone's (`SongReel`, which owns the
 * animation): the winner is picked here the instant SPIN is pressed, and Play
 * opens the player selection over the landed song. On *Host screen* the room's
 * one selection is spun on the TV (`useHostSpin`): the window keeps the reel's
 * empty tile until the TV has landed, then shows the cover; Play moves the
 * room on to its singers over that same selection.
 *
 * A finished spin never opens the song modal by itself — on this screen the
 * cover and the result line are the way in, and the user takes it.
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
  // The landed song this phone is picking singers for, on this screen.
  const [singing, setSinging] = useState<SongRead | null>(null);
  const [askTakeOver, setAskTakeOver] = useState(false);
  const [keptTarget, setKeptTarget] = useState<SpinTarget>(readSpinTarget);

  const canSing = auth.can("karaoke.sing");
  // The host reel needs the right to start a song; a fixed pool without a
  // playlist to name has nothing the server could spin.
  const hostOffered =
    canSing && (fixed === undefined || playlistId !== undefined);
  // Without the pills the reel is this screen's, whatever this device kept.
  const target: SpinTarget = hostOffered ? keptTarget : "local";
  const onHost = target === "host";
  const host = useHostSpin({ active: onHost });

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

  /** The same pool for the TV: the playlist where there is one, else the select's scope. */
  const request: SpinRequest =
    fixed !== undefined && playlistId !== undefined
      ? { scope: "playlist", playlist_id: playlistId }
      : { scope };

  const startSpin = () => {
    if (candidates.length === 0) return;
    if (onHost) {
      host.press(request);
      return;
    }
    if (spinning) return;
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

  /** The pills: back on this screen gives the room back — the one way out. */
  const chooseTarget = (next: SpinTarget) => {
    if (next === target) return;
    if (onHost) host.release();
    setKeptTarget(next);
    writeSpinTarget(next);
  };

  const settled = spinning ? null : winner;
  const hostSpun = host.phase === "spun" && host.selection !== null;
  // The wishlist tile's take-off for everybody, offered where the reel landed
  // on a wish: the host who spun the wishlist and will not sing this one says
  // so here instead of going back to Home. Only on the two wishlist pools —
  // never on a playlist's reel — and only while the song is still wished for,
  // so the button goes with the wish and the result stays. On the TV's spin
  // the pool is the selection's own, or what this phone asked for in the
  // frames where `/pick` has already taken the spin off.
  const landedWish: SongRead | null = onHost
    ? hostSpun &&
      host.revealed &&
      isWishScope(host.selection?.spin?.scope ?? host.asked?.scope)
      ? host.shown
      : null
    : fixed === undefined && isWishScope(scope)
      ? settled
      : null;
  const takeOff =
    landedWish !== null &&
    auth.can("wishlist.manage") &&
    wishes.some((wish) => wish.song.id === landedWish.id)
      ? landedWish
      : null;

  /** The result slot's sentence on the TV's spin, one per state. */
  const hostLine = (() => {
    if (host.shown !== null) return null;
    if (hostSpun) {
      // Said, not only drawn: the phone is in the singer's hand while
      // everybody looks at the TV.
      return (
        <p className="spinner-state" role="status">
          Spinning on the host screen…
        </p>
      );
    }
    if (host.phase === "blocked") {
      return (
        <p className="spinner-state">
          {host.blockedTitle === undefined ? (
            "Somebody else is picking singers."
          ) : (
            <>
              Somebody is picking singers for <em>{host.blockedTitle}</em>.
            </>
          )}
        </p>
      );
    }
    if (host.emptyLine !== null) {
      return <p className="spinner-state">{host.emptyLine}</p>;
    }
    if (host.phase === "lost") {
      return (
        <p className="spinner-state">Somebody else took over the selection.</p>
      );
    }
    return null;
  })();

  const spinDisabled = onHost
    ? host.busy || !host.ready || candidates.length === 0
    : spinning || candidates.length === 0;

  return (
    <>
      <div className="spinner">
        {/* Where the reel runs: two words, centred over the pool, never a bank
            of choices. The way out of the TV's spin is the first of them. */}
        {hostOffered && (
          <fieldset className="spinner-target">
            <legend className="visually-hidden">Where the reel runs</legend>
            {SPIN_TARGETS.map(({ value, label }) => (
              <label key={value} className="spinner-target-pill">
                <input
                  type="radio"
                  name="spin-target"
                  value={value}
                  className="visually-hidden"
                  checked={target === value}
                  disabled={spinning}
                  onChange={() => chooseTarget(value)}
                />
                <span className="spinner-target-text">
                  {value === "host" && <Icon name="tv" />}
                  {label}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {/* One quiet select, not a bank of pills: four choices made once an
            evening must not compete with the reel and the SPIN below (§7).
            The `<label>` wraps the select, which is what names it. On the TV's
            spin it stays live: a pool changed under a held selection leaves
            the TV on it until the next press. */}
        {fixed === undefined && (
          <label className="spinner-pick">
            <span className="spinner-pick-label">Pick from</span>
            <select
              className="text-input text-input-quiet spinner-pick-select"
              value={scope}
              disabled={onHost ? host.busy : spinning}
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

        {onHost ? (
          <>
            {/* The reel is the TV's alone: the empty window's tile until it
                has landed there, then the cover at rest. Remounted between
                the two, so every wait starts from the tile again. A plain
                frame — the song modal's Sing would race this phone's lock. */}
            <SongReel
              key={host.shown === null ? "host-waiting" : "host-landed"}
              spin={host.shown === null ? null : { id: 1, winner: host.shown }}
              fillers={[]}
              settled
            />
            {/* Loaded under the tile while the TV spins, so the cover is there
                the moment it lands instead of popping in after. */}
            {host.selection !== null && host.shown === null && (
              <SongCover
                song={host.selection.song}
                className="spinner-preload"
                loading="eager"
              />
            )}
          </>
        ) : (
          <SongReel
            key="local"
            spin={spin}
            fillers={candidates}
            // Remounted on the way back from the TV: a reel that had landed is
            // drawn landed, not spun again.
            settled={!spinning}
            onSettled={settle}
            onOpen={setDetails}
          />
        )}

        {/* The slot is held open before the first spin so SPIN never jumps —
            but it stays empty: the page title already says "Random song". A
            three-cell grid, so the take-off stands beside the song it takes
            off and the title stays centred whether it is there or not. */}
        <div className="spinner-result">
          {onHost
            ? (hostLine ??
              (host.shown && (
                <div className="spinner-words">
                  <span className="spinner-winner-title">
                    {host.shown.title}
                  </span>
                  <span className="spinner-winner-artist">
                    {host.shown.artist}
                  </span>
                </div>
              )))
            : winner && (
                <button
                  // Remounted when a spin starts and again when it lands, so
                  // the rise-in plays for every reveal, not only the first —
                  // the previous winner steps back with it while the reel runs.
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
          {/* The wishlist tile's own trash, beside the song and never inside
              its button: no confirmation, and it goes with the wish. */}
          {takeOff && (
            <button
              type="button"
              className="icon-button icon-button-bordered spinner-take-off"
              aria-label={`Take ${takeOff.title} off the wishlist for everybody`}
              onClick={() => wishlist.clear(takeOff.id)}
            >
              <Icon name="trash" />
            </button>
          )}
        </div>
        {/* Mounted before the reveal and filled on it: a live region that
            appears with its text in it is not reliably read out. */}
        {onHost && (
          <p className="visually-hidden" aria-live="polite">
            {hostSpun && host.shown !== null
              ? `${host.shown.title} by ${host.shown.artist}`
              : ""}
          </p>
        )}

        {onHost && host.notice && (
          <p className="error-notice spinner-notice" role="alert">
            {host.notice}
          </p>
        )}

        {/* One action row: SPIN, the page's gesture, and beside it Play — the
            way on to the singers in both modes. */}
        <div className="spinner-actions">
          {/* Uppercased in CSS: the caps are the look, "Spin" is the name. On
              the TV's spin it is live while the reel there runs: the press
              that shows the result. */}
          <SpinButton
            spinning={onHost ? host.rolling : spinning}
            disabled={spinDisabled}
            onClick={startSpin}
          >
            {onHost ? host.label : "Spin"}
          </SpinButton>
          {canSing &&
            (onHost && host.phase === "blocked" ? (
              <button
                type="button"
                className="button spinner-play"
                onClick={() => setAskTakeOver(true)}
              >
                Take over
              </button>
            ) : (
              <button
                type="button"
                className="button spinner-play"
                disabled={onHost ? !host.playable : settled === null}
                onClick={() => {
                  if (onHost) host.play();
                  else if (settled !== null) setSinging(settled);
                }}
              >
                <Icon name="play" className="spinner-play-icon" />
                Play
              </button>
            ))}
        </div>
      </div>

      {details && (
        <SongDetails song={details} onClose={() => setDetails(null)} />
      )}

      {singing && (
        <PlayerSelection song={singing} onClose={() => setSinging(null)} />
      )}

      {host.adoption && (
        <PlayerSelection
          song={host.adoption.selection.song}
          adopt={host.adoption}
          onClose={host.handedOver}
        />
      )}

      {askTakeOver && (
        <ConfirmModal
          title="Take over the selection"
          message="Whoever is picking now loses their singers."
          confirmLabel="Take over"
          danger
          onConfirm={() => {
            setAskTakeOver(false);
            host.takeOver(request);
          }}
          onCancel={() => setAskTakeOver(false)}
        />
      )}
    </>
  );
}
