import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { SongRead } from "../api";
import {
  listSongsOptions,
  listSongsQueryKey,
  rescanSongsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AddSongsModal from "../components/AddSongsModal";
import FilterPanel, { type FilterRow } from "../components/FilterPanel";
import { Icon, type IconName } from "../components/icons";
import SongDetails from "../components/SongDetails";
import SongListItem from "../components/SongListItem";
import { shortTime } from "../duration";
import { errorMessage } from "../errors";
import { useDownloadEvents } from "../hooks/useDownloadEvents";
import { useFavorites } from "../hooks/useFavorites";
import { useRecentlyPlayed } from "../hooks/useRecentlyPlayed";
import { useSungSongs } from "../hooks/useSungSongs";
import { useTags } from "../hooks/useTags";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { SONG_SOURCES } from "../songSources";
import {
  ANY_VALUE,
  BOOLEAN_FACET_IDS,
  BUILT_IN_TAGS,
  type CriteriaOverrides,
  criteriaOffAny,
  defaultCriterion,
  effectiveCriteria,
  type FacetId,
  facetShown,
  facetValues,
  FAVORITES_ONLY,
  isBooleanFacet,
  markTags,
  NO_OVERRIDES,
  passesSongCriteria,
  sameOverrides,
  SUNG_ONLY,
  type TagCriterion,
  tagColorClass,
  tagGlyph,
  VALUED_FACET_IDS,
  withoutDefaultHiding,
} from "../tags";
import "./Songs.css";

/**
 * The chips this page owns; playlists live on /songs/playlists. All, Favorites
 * and Sung are presets over one criteria state and Filter is "anything else",
 * so exactly one of the four is ever pressed. Recent is a mode of its own — a
 * time-ordered list rather than a criterion — and while it is on it is the
 * pressed chip, with the criteria still narrowing what it holds.
 */
const ALL = "all";
const FAVORITES = "favorites";
const RECENT = "recent";
const SUNG = "sung";
const FILTER = "filter";

/**
 * The clock time a song last started, on the recently-played tab only. The 24h
 * clock rather than "3 minutes ago": a party runs for one evening, so the time
 * is unambiguous, it matches the captions the scores already print, and it does
 * not need a timer ticking behind the list.
 */
function recentTime(
  recentMode: boolean,
  startedAt: Map<string, string>,
  songId: string,
): ReactNode {
  const at = startedAt.get(songId);
  if (!recentMode || at === undefined) return null;
  return <span className="song-duration">{shortTime(at)}</span>;
}

/**
 * One filter chip. Only the pressed one spells its filter out; the others are
 * their glyph alone, named for a screen reader and for a hover. Five labelled
 * chips no longer fit a phone's width, and the label that earns the room is the
 * one saying which list the reader is looking at.
 *
 * `label` is the accessible name and stays put; `text` is what the pressed chip
 * shows, which for Filter counts the criteria and therefore moves.
 *
 * `opensPanel` is the Filter chip alone: every other chip switches the list
 * where it stands, and a button that instead opens a dialog has to say so
 * before it is pressed.
 */
function FilterChip({
  label,
  text,
  icon,
  iconClassName,
  on,
  opensPanel,
  onClick,
}: {
  label: string;
  text?: string;
  icon: IconName;
  iconClassName?: string;
  on: boolean;
  opensPanel?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "songs-chip songs-chip-on" : "songs-chip songs-chip-icon"}
      aria-pressed={on}
      aria-haspopup={opensPanel ? "dialog" : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} className={iconClassName} />
      {on && (text ?? label)}
    </button>
  );
}

function matches(song: SongRead, needle: string): boolean {
  return (
    song.id === needle ||
    song.title.toLowerCase().includes(needle) ||
    song.artist.toLowerCase().includes(needle)
  );
}

export default function Songs() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const favorites = useFavorites();
  const recent = useRecentlyPlayed();
  const sung = useSungSongs();
  const tags = useTags();
  const [search, setSearch] = useState("");
  // Only so clearing can hand the caret back: the X disappears with the text it
  // clears, and focus would otherwise land nowhere.
  const searchInput = useRef<HTMLInputElement>(null);
  const [overrides, setOverrides] = useState<CriteriaOverrides>(NO_OVERRIDES);
  const [recentMode, setRecentMode] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<SongRead | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingSongs, setAddingSongs] = useState(false);

  const songs = useQuery(listSongsOptions());
  const rescan = useMutation({
    ...rescanSongsMutation(),
    onSuccess: () => {
      setScanning(true);
      setNotice(null);
    },
    onError: (error) =>
      setNotice(
        error?.status === "running"
          ? "A scan is already running."
          : errorMessage(error, "Could not start the scan."),
      ),
  });

  // A finished download refetches the list — no rescan needed for a new song.
  useDownloadEvents();

  useWingmanEvent("songs.scan_started", () => {
    setScanning(true);
    setNotice(null);
  });
  useWingmanEvent("songs.scan_finished", () => {
    setScanning(false);
    void queryClient.invalidateQueries({ queryKey: listSongsQueryKey() });
  });
  // Somebody with `songs.delete` took a song out of the library. Same treatment
  // as a finished scan: the list this page shows is what changed.
  useWingmanEvent("songs.deleted", () => {
    void queryClient.invalidateQueries({ queryKey: listSongsQueryKey() });
  });

  // Nothing sung yet (or the party is over) means no tab: an empty one nobody
  // in the room can fill is worse than none at all. It stays while the reader
  // is standing on it, though — a chip vanishing under the finger would leave
  // the page with no pressed filter and no way back.
  const showRecent = recent.songs.length > 0 || recentMode;

  // What the page is actually filtering on: the defaults the tags dictate, with
  // whatever the reader set in the panel laid over them.
  const criteria = useMemo(
    () => effectiveCriteria(tags.tags, tags.builtIns, overrides),
    [tags.tags, tags.builtIns, overrides],
  );
  // Which chip that state is. A preset is matched on the overrides, not on the
  // result, so a reader who dials the defaults back in by hand lands on `All`
  // rather than on a Filter chip claiming criteria nobody set.
  const preset = sameOverrides(overrides, NO_OVERRIDES)
    ? ALL
    : sameOverrides(overrides, FAVORITES_ONLY)
      ? FAVORITES
      : sameOverrides(overrides, SUNG_ONLY)
        ? SUNG
        : FILTER;
  const pressed = recentMode ? RECENT : preset;

  /** Press a preset chip: it replaces the state and leaves the Recent mode. */
  const selectPreset = (next: CriteriaOverrides) => {
    setOverrides(next);
    setRecentMode(false);
  };

  /**
   * One criterion moved in the panel. A value that is already the criterion's
   * default drops out of the overrides instead of being stored, so setting a
   * tag to *Yes* and back to *Any* returns the page to `All`.
   */
  const setCriterion = (key: string, value: string) => {
    setOverrides((previous) => {
      const next: CriteriaOverrides = {
        favorite: previous.favorite,
        sung: previous.sung,
        tags: previous.tags,
        facets: previous.facets,
      };
      if (key === "favorite" || key === "sung") {
        next[key] = value === "any" ? undefined : (value as TagCriterion);
        return next;
      }
      // A facet's default is *Any* whichever kind it is — but the two kinds
      // spell it differently: a boolean facet's row is the tri-state, whose
      // *Any* is the word, and a valued one's select uses `ANY_VALUE`. Reading
      // the wrong one would store an override that means "the default", and the
      // *All* chip would never come back.
      if (key.startsWith("facet:")) {
        const facet = key.slice("facet:".length) as FacetId;
        const byFacet = new Map(previous.facets);
        const untouched = isBooleanFacet(facet)
          ? value === "any"
          : value === ANY_VALUE;
        if (untouched) byFacet.delete(facet);
        else byFacet.set(facet, value);
        next.facets = byFacet;
        return next;
      }
      const tagId = key.slice("tag:".length);
      const byTag = new Map(previous.tags);
      if (value === defaultCriterion(tags.tags.find((tag) => tag.id === tagId)))
        byTag.delete(tagId);
      else byTag.set(tagId, value as TagCriterion);
      next.tags = byTag;
      return next;
    });
  };

  const all = songs.data?.songs;
  const needle = search.trim().toLowerCase();
  // Recent has a list of its own; every other state reads the whole library and
  // lets the criteria do the narrowing.
  const base = recentMode
    ? // Undefined while it loads, so the tab shows the skeleton instead of
      // claiming nothing has been sung.
      recent.isPending
      ? undefined
      : recent.songs
    : all;
  // Same reason: an empty history in flight would flash "you have not sung
  // anything yet" over a full record — but only when the answer is asked for.
  const waitingForSung = criteria.sung !== "any" && sung.isPending;

  const shown = useMemo(() => {
    // Until the tags are in, the list would show what a tag is about to hide —
    // a `broken` song flashing past is exactly what the flag exists to prevent.
    if (tags.isPending || waitingForSung) return undefined;
    const visible = base?.filter((song) =>
      passesSongCriteria(song, tags.bySong, criteria, {
        favorite: favorites.ids.has(song.id),
        sung: sung.ids.has(song.id),
      }),
    );
    return needle ? visible?.filter((song) => matches(song, needle)) : visible;
  }, [
    base,
    needle,
    criteria,
    tags.bySong,
    tags.isPending,
    waitingForSung,
    favorites.ids,
    sung.ids,
  ]);
  // Everything this filter holds carries a hidden-by-default tag. Worth its own
  // sentence: "no favorites yet" over a shelf full of archived favorites is a
  // lie, and the reader would go looking for the songs they know are there. The
  // question is asked of the criteria alone — with the untouched hiding lifted,
  // is there anything here? — so an empty list the reader filtered down to
  // nothing themselves keeps the plainer sentence.
  const relaxed = useMemo(
    () => withoutDefaultHiding(tags.tags, overrides, criteria),
    [tags.tags, overrides, criteria],
  );
  const allHidden =
    needle === "" &&
    shown?.length === 0 &&
    (base ?? []).some((song) =>
      passesSongCriteria(song, tags.bySong, relaxed, {
        favorite: favorites.ids.has(song.id),
        sung: sung.ids.has(song.id),
      }),
    );

  // The facets the party offers as rows, in *Built-in* order (§7). A facet with
  // *Show in filter* off is not a criterion at all, so it is not here either.
  const shownFacets = useMemo(
    () =>
      [...BOOLEAN_FACET_IDS, ...VALUED_FACET_IDS].filter((facet) =>
        facetShown(tags.builtIns, facet),
      ),
    [tags.builtIns],
  );

  // `All` only earns its place next to another chip; on its own beside a link
  // it would be a chip that does nothing. A guest with no account and no tags
  // still gets the panel when the party shows a facet: filtering by genre is
  // for everybody in the room (facets.md).
  const canOpenFilter =
    favorites.available ||
    sung.available ||
    tags.tags.length > 0 ||
    shownFacets.length > 0;
  const canFilter = canOpenFilter || showRecent;
  const canBrowsePlaylists = auth.loaded && auth.can("playlists.view");
  // No source this role may search means nothing for the picker to offer.
  const canAddSongs = SONG_SOURCES.some((source) =>
    auth.can(source.capability),
  );

  // One row per criterion, in the order §7 fixes: the two built-in marks, then
  // the facets the party shows in the filter, then the tags. A mark nothing can
  // be said about — no account, no player — has no row, the same way its chip
  // has no place in the row above.
  const filterRows: FilterRow[] = [];
  if (favorites.available)
    filterRows.push({
      key: "favorite",
      kind: "tri-state",
      name: BUILT_IN_TAGS.favorites.name,
      icon: BUILT_IN_TAGS.favorites.icon,
      // Its row reads like a tag's, so its glyph wears the colour the party
      // gave the mark — whether or not the mark itself is on the song rows.
      colorClass: tagColorClass(tags.builtIns.favorites.color),
      value: criteria.favorite,
    });
  if (sung.available)
    filterRows.push({
      key: "sung",
      kind: "tri-state",
      name: BUILT_IN_TAGS.sung.name,
      icon: BUILT_IN_TAGS.sung.icon,
      colorClass: tagColorClass(tags.builtIns.sung.color),
      value: criteria.sung,
    });
  for (const facet of shownFacets) {
    const built = tags.builtIns[facet];
    const shared = {
      key: `facet:${facet}`,
      name: BUILT_IN_TAGS[facet].name,
      icon: BUILT_IN_TAGS[facet].icon,
      colorClass: tagColorClass(built.color),
    };
    if (isBooleanFacet(facet))
      filterRows.push({
        ...shared,
        kind: "tri-state",
        value: criteria.booleans.get(facet) ?? "any",
      });
    else
      filterRows.push({
        ...shared,
        kind: "select",
        value: criteria.values.get(facet) ?? ANY_VALUE,
        // The whole library, never the filtered list: options that vanished as
        // the reader narrowed would take away the way back.
        options: facetValues(facet, all),
      });
  }
  for (const tag of tags.tags)
    filterRows.push({
      key: `tag:${tag.id}`,
      kind: "tri-state",
      name: tag.name,
      icon: tagGlyph(tag.icon),
      colorClass: tagColorClass(tag.color),
      value: criteria.tags.get(tag.id) ?? "any",
    });

  return (
    /* One column for the whole page, so the sticky toolbar, the chips and the
       rows share a gutter on the desktop as they do on a phone. */
    <div className="songs-page">
      {/* The bottom nav already names the page; the heading stays for the
          document outline and for screen readers. */}
      <h1 className="visually-hidden">Songs</h1>
      <div className="songs-toolbar">
        <div className="songs-search">
          {/* A label around the icon and the field, so the glyph is part of the
              tap target that focuses it — the clear button beside it must stay
              outside, or every click on it would focus the input as well. */}
          <label className="songs-search-field">
            <Icon name="search" />
            <input
              ref={searchInput}
              type="search"
              value={search}
              placeholder="Search songs"
              aria-label="Search songs"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {/* Only while something is typed: an X on an empty field is a
              control that does nothing. */}
          {search !== "" && (
            <button
              type="button"
              className="icon-button songs-search-clear"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                setSearch("");
                // The button vanishes with the text, so the focus it held would
                // fall back to the document; the field is where typing goes on.
                searchInput.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>

      {(canFilter || canBrowsePlaylists) && (
        <div className="songs-chips">
          {/* Only the chips that filter this page are the filter group; the
              playlists chip leaves it. */}
          {canFilter && (
            <div className="songs-filters" role="group" aria-label="Filter">
              {/* The one chip with no glyph of its own, so it keeps its label
                  whether it is pressed or not. */}
              <button
                type="button"
                className={
                  pressed === ALL ? "songs-chip songs-chip-on" : "songs-chip"
                }
                aria-pressed={pressed === ALL}
                onClick={() => selectPreset(NO_OVERRIDES)}
              >
                All
              </button>
              {favorites.available && (
                <FilterChip
                  label={BUILT_IN_TAGS.favorites.name}
                  icon={BUILT_IN_TAGS.favorites.icon}
                  iconClassName={tagColorClass(tags.builtIns.favorites.color)}
                  on={pressed === FAVORITES}
                  onClick={() => selectPreset(FAVORITES_ONLY)}
                />
              )}
              {showRecent && (
                <FilterChip
                  label="Recent"
                  icon="clock"
                  on={pressed === RECENT}
                  onClick={() => setRecentMode(true)}
                />
              )}
              {sung.available && (
                <FilterChip
                  label={BUILT_IN_TAGS.sung.name}
                  icon={BUILT_IN_TAGS.sung.icon}
                  iconClassName={tagColorClass(tags.builtIns.sung.color)}
                  on={pressed === SUNG}
                  onClick={() => selectPreset(SUNG_ONLY)}
                />
              )}
              {/* The way into everything the four presets cannot say. It counts
                  what is off *Any*, the hidden-by-default tags included: those
                  are narrowing the list as much as anything the reader set. */}
              {canOpenFilter && (
                <FilterChip
                  label="Filter"
                  text={`Filter · ${criteriaOffAny(criteria)}`}
                  icon="filter"
                  on={pressed === FILTER}
                  opensPanel
                  onClick={() => setFiltering(true)}
                />
              )}
            </div>
          )}
          {/* Icon only like the unpressed filters, and for the same reason —
              the `list` glyph beside them is unambiguous. */}
          {canBrowsePlaylists && (
            <Link
              to="/songs/playlists"
              className="songs-chip songs-chip-link"
              aria-label="Playlists"
              title="Playlists"
            >
              <Icon name="list" />
            </Link>
          )}
        </div>
      )}

      {/* What the library holds and the two ways to change it. Outside the list
          branch on purpose: adding songs is exactly what an empty or unreadable
          library calls for. */}
      <div className="songs-count">
        {shown && (
          <span>
            {shown.length} {shown.length === 1 ? "song" : "songs"}
          </span>
        )}
        {auth.can("songs.rescan") && (
          <button
            type="button"
            className="icon-button songs-count-reload"
            disabled={scanning || rescan.isPending}
            aria-label={scanning ? "Scanning…" : "Rescan"}
            title={scanning ? "Scanning…" : "Rescan the library"}
            onClick={() => rescan.mutate({})}
          >
            <Icon
              name="refresh"
              className={scanning ? "songs-tool-spin" : undefined}
            />
          </button>
        )}
        {canAddSongs && (
          <button
            type="button"
            className="icon-button icon-button-bordered songs-add"
            aria-label="Add songs"
            title="Add songs from an online source"
            onClick={() => setAddingSongs(true)}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>

      {notice && <p className="songs-notice songs-notice-error">{notice}</p>}

      {/* The recently-played tab has a list of its own, so it waits for that one. */}
      {((recentMode ? recent.isPending : songs.isPending) ||
        tags.isPending ||
        waitingForSung) && (
        <div className="songs-skeleton" aria-label="Loading songs">
          {[0, 1, 2, 3, 4].map((row) => (
            <span key={row} />
          ))}
        </div>
      )}

      {songs.isError && (
        <p className="songs-notice songs-notice-error" role="alert">
          Could not load the song library.{" "}
          <button type="button" onClick={() => void songs.refetch()}>
            Retry
          </button>
        </p>
      )}

      {shown && (
        <>
          {shown.length === 0 ? (
            <p className="songs-notice">
              {needle
                ? `No song matches "${search.trim()}".`
                : allHidden
                  ? "Every song here carries a tag that keeps it out of the list."
                  : recentMode
                    ? recent.songs.length === 0
                      ? "Nothing has been sung yet."
                      : "No song matches the filter."
                    : pressed === FAVORITES
                      ? "No favorites yet. Open a song and tap the heart."
                      : pressed === SUNG
                        ? "You have not sung anything yet. Songs you get a score on show up here."
                        : pressed === FILTER
                          ? "No song matches the filter."
                          : canAddSongs
                            ? "The library is empty. Add songs from an online source, or run a rescan once they are on disk."
                            : "The library is empty. Run a rescan once songs are on disk."}
            </p>
          ) : (
            <div className="songs-list">
              {shown.map((song) => (
                <SongListItem
                  key={song.id}
                  song={song}
                  favorite={favorites.ids.has(song.id)}
                  sung={sung.ids.has(song.id)}
                  tags={markTags(tags.bySong.get(song.id))}
                  builtIns={tags.builtIns}
                  meta={recentTime(recentMode, recent.startedAt, song.id)}
                  onClick={() => setSelected(song)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {filtering && (
        <FilterPanel
          rows={filterRows}
          onSet={setCriterion}
          onReset={() => setOverrides(NO_OVERRIDES)}
          onClose={() => setFiltering(false)}
        />
      )}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}

      {addingSongs && <AddSongsModal onClose={() => setAddingSongs(false)} />}
    </div>
  );
}
