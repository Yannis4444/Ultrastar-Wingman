import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  CommentAuthor,
  CommentRead,
  PlayerRead,
  SongMetadata,
  SongRead,
} from "../api";
import {
  addPlaylistEntryMutation,
  addSongCommentMutation,
  assignTagMutation,
  createPlaylistMutation,
  deleteSongCommentMutation,
  deleteSongMutation,
  editSongMutation,
  getPlaylistQueryKey,
  listPlaylistsOptions,
  listPlaylistsQueryKey,
  listPlayersOptions,
  listSongCommentsOptions,
  listSongCommentsQueryKey,
  listSongScoresOptions,
  listTagAssignmentsQueryKey,
  removePlaylistEntryMutation,
  unassignTagMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { asPlayer } from "../avatars";
import { chartTheme } from "../chartTheme";
import { timeAgo } from "../duration";
import { errorDetail, errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import { useTags } from "../hooks/useTags";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
import { songHistory } from "../stats";
import { tagColorClass, tagGlyph } from "../tags";
import ConfirmModal from "./ConfirmModal";
import IconStat from "./IconStat";
import { Icon, type IconName } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import PickerRow from "./PickerRow";
import PlayerAvatar from "./PlayerAvatar";
import PlayerSelection from "./PlayerSelection";
import PlaylistCover from "./PlaylistCover";
import RankedScoreList from "./RankedScoreList";
import ScoreStrip from "./ScoreStrip";
import SongCover from "./SongCover";
// The control row is shared with the Home stage.
import "./SongControls.css";
// The Tags sub-view builds its own rows out of the picker's classes: a tag row
// is the same 40px square and name, but its trailing mark is a padlock and
// never the playlist family's `list-check` (§3).
import "./PickerRow.css";
import "./SongDetails.css";

interface SongDetailsProps {
  song: SongRead;
  onClose: () => void;
}

/** One song's comments changed — somebody said something, or one was deleted. */
interface CommentsChanged extends WingmanEvent {
  song_id: string;
  count: number;
}

/** How many all-time scores the best-scores view lists. */
const BEST_SCORES = 10;

/**
 * How many scores a summary needs before a chart is drawn under it (§7). The
 * same number the user page and an open score group use; the list itself is
 * drawn either way.
 */
const CHART_MIN_SCORES = 4;

/** What the backend accepts in one comment; the field stops there too. */
const COMMENT_MAX_LENGTH = 1000;

/** How far the composer grows with what is typed — about five lines. */
const COMPOSER_MAX_HEIGHT = 132;

/**
 * A count the listing behind it has not delivered yet — or never will. The
 * app's no-value mark everywhere a number is expected (§1.3), and not "0",
 * which would be an answer rather than the absence of one.
 */
const UNKNOWN = "—";

/** A comment whose account is gone still says something worth reading. */
const FORMER_MEMBER = "Former member";

/**
 * Why the backend refused to delete a song. Each of these is something the
 * person in front of the screen can act on, which a generic "could not delete"
 * would not be.
 */
/**
 * Why the backend refused to save the metadata. The editor writes the song's
 * `.txt` — the file USDX itself reads — so every one of these is about that
 * file, and every one of them is something the person can do something about.
 */
const EDIT_REFUSALS: Record<string, string> = {
  song_file_changed:
    "This song's file changed while the editor was open. It was downloaded again, or somebody edited it by hand. Close this and open it again to see what it says now.",
  song_txt_missing:
    "The song's file is not there any more. Rescan the library to find out what happened to it.",
  song_txt_unreadable:
    "Wingman cannot write this file back without garbling the rest of it. Its encoding is one nothing here can reproduce.",
  song_files_in_use:
    "Its file is still open. Close Ultrastar Deluxe and try again.",
  value_not_encodable:
    "This file cannot spell one of those values: it was written in an old encoding that has no such letters.",
};

/** The song's fields the editor writes, as the form holds them: all text. */
type EditForm = Record<
  "title" | "artist" | "language" | "genre" | "year" | "edition",
  string
>;

/** The form filled in with what a song says now. */
function formOf(song: SongRead): EditForm {
  return {
    title: song.title,
    artist: song.artist,
    language: song.language ?? "",
    genre: song.genre ?? "",
    year: song.year === null ? "" : String(song.year),
    edition: song.edition ?? "",
  };
}

/** An emptied field is no value at all — in a txt, no header rather than an
 * empty one, which is what the backend does with a `null`. */
function said(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

/** What the form is asking for. */
function valuesOf(form: EditForm): SongMetadata {
  return {
    title: form.title,
    artist: form.artist,
    language: said(form.language),
    genre: said(form.genre),
    year: form.year.trim() === "" ? null : Number(form.year),
    edition: said(form.edition),
  };
}

/** What the editor was opened on. The backend compares it against the file as
 * it is *now* and refuses when the two have drifted apart, so a save can never
 * put these values back over a download that happened in the meantime. */
function metadataOf(song: SongRead): SongMetadata {
  return {
    title: song.title,
    artist: song.artist,
    language: song.language,
    genre: song.genre,
    year: song.year,
    edition: song.edition,
  };
}

const DELETE_REFUSALS: Record<string, string> = {
  song_is_playing: "That song is playing right now. Stop it first.",
  song_files_in_use:
    "Its files are still open. Close Ultrastar Deluxe and try again.",
  song_directory_is_a_library_root:
    "This song's folder holds your whole song library, so deleting it would take every other song with it. Fix the folder first.",
};

function authorName(author: CommentAuthor | null): string {
  return author?.username ?? FORMER_MEMBER;
}

/**
 * `PlayerAvatar` draws a player, and a comment carries only who wrote it. A
 * deleted account is nobody at all — `null` is the empty square.
 */
function asAuthor(author: CommentAuthor | null): PlayerRead | null {
  return author === null
    ? null
    : asPlayer(author.username, author.player_id, author.avatar_version);
}

/** Grows the composer with what is typed, up to a few lines. */
function grow(field: HTMLTextAreaElement): void {
  field.style.height = "auto";
  // `scrollHeight` is content plus padding, but the app is `border-box`: the
  // two hairlines have to be added back or the field settles two pixels short
  // of what it holds and scrolls its own last line under the border.
  const border = field.offsetHeight - field.clientHeight;
  const wanted = Math.min(field.scrollHeight + border, COMPOSER_MAX_HEIGHT);
  // jsdom measures nothing, and a 0px composer would be unusable in a browser
  // whose layout has not happened yet.
  field.style.height = wanted > 0 ? `${wanted}px` : "";
}

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  // Sub-views swap the modal content; closing them returns to the song. Always
  // from the song itself: the one caller that opened straight into the picker
  // was Currently Playing's playlist button, and that button is gone.
  const [view, setView] = useState<
    "main" | "scores" | "playlists" | "tags" | "comments" | "edit"
  >("main");
  // The song as the editor last saved it. The song itself is a prop — a row out
  // of whatever listing opened this modal — so without this the hero would go
  // on showing the old title until that listing has fetched itself again.
  const [saved, setSaved] = useState<SongRead | null>(null);
  // What is in the editor's fields. Filled from the song when it opens.
  const [form, setForm] = useState<EditForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // There is no has_audio flag; the preview 404s for songs without audio and
  // the element's error event is the only signal.
  const [noAudio, setNoAudio] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The inline name field of the "New playlist…" row, and what is in it.
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  // The composer's text, and the comment whose deletion is being confirmed.
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<CommentRead | null>(null);
  // Whether the song's own deletion is waiting for a yes.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const wishlist = useWishlist();
  const favorites = useFavorites();
  const tags = useTags();

  // Everything the modal *shows* comes from here: the song it was opened with
  // until somebody corrects it, and what the backend answered after that. The
  // id never changes with an edit, so everything the modal *does* still goes
  // through `song`.
  const shown = saved ?? song;

  // What this reader may know about the song's tags, and what they may change.
  // `bySong` also carries the tags a `tags.manage` holder may not view; those
  // belong on the admin page, never here.
  const carried = (tags.bySong.get(song.id) ?? []).filter(
    (tag) => tag.can_view,
  );
  const assignable = tags.tags.filter((tag) => tag.can_assign);
  const carriedIds = new Set(carried.map((tag) => tag.id));

  const canManagePlaylists = auth.user !== null && auth.can("playlists.manage");
  // Both wait for `/auth/me` rather than assuming the right the way the rest of
  // the modal does: an editor offered to somebody who turns out not to hold the
  // right is a form that can only end in a refusal, and the deletion inside it
  // is the one wrong guess worth avoiding altogether.
  const canEditSong = auth.loaded && auth.can("songs.edit");
  const canDeleteSong = auth.loaded && auth.can("songs.delete");
  // One listing for the whole picker: `song_id` makes the backend fill each
  // row's `contains`, which is the check mark — never a detail request per row.
  // Nothing outside the sub-view needs it, so it waits for the sub-view.
  const playlists = useQuery({
    ...listPlaylistsOptions({ query: { song_id: song.id } }),
    enabled: auth.loaded && canManagePlaylists && view === "playlists",
  });
  // Every list the caller may put a song into: their own, the ones shared with
  // them as write or admin, and — for a moderator — the global ones.
  const mine = (playlists.data?.playlists ?? []).filter(
    (list) => list.can_edit,
  );

  // All-time and newest first, so the top of the list needs sorting here. The
  // whole archive rather than tonight, hence `stats.history` and not
  // `stats.view`.
  const songScores = useQuery({
    ...listSongScoresOptions({ path: { song_id: song.id } }),
    enabled: auth.loaded && auth.can("stats.history"),
  });
  const allScores = songScores.data?.scores ?? [];
  const ranked = [...allScores].sort((a, b) => b.score - a.score);
  const best = ranked.slice(0, BEST_SCORES);
  // The whole history, not the listed ten: the summary describes the song.
  const history = songHistory(allScores);

  // Only for the avatars in the ranking, so it waits for the sub-view. A singer
  // without a player record — a guest, a deleted player, or a caller who may
  // not list players at all — still gets the initial `PlayerAvatar` draws.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view") && view === "scores",
  });
  const players = new Map(
    (playerList.data?.players ?? []).map((player) => [player.id, player]),
  );

  // Both directions refetch the playlist (the check mark) and the list
  // (`song_count`, which the playlist dialog shows).
  const refreshPlaylist = (playlistId: string): void => {
    void queryClient.invalidateQueries({
      queryKey: getPlaylistQueryKey({ path: { playlist_id: playlistId } }),
    });
    void queryClient.invalidateQueries({ queryKey: listPlaylistsQueryKey() });
  };

  const addToPlaylist = useMutation({
    ...addPlaylistEntryMutation(),
    onSuccess: (_data, options) => refreshPlaylist(options.path.playlist_id),
    onError: (error, options) => {
      if (errorDetail(error) === "duplicate_entry") {
        // Already in there is what the tap wanted; the refetch shows the check.
        refreshPlaylist(options.path.playlist_id);
        return;
      }
      setNotice(errorMessage(error, "Could not add the song to the playlist."));
    },
  });

  const removeFromPlaylist = useMutation({
    ...removePlaylistEntryMutation(),
    onSuccess: (_data, options) => refreshPlaylist(options.path.playlist_id),
    onError: (error) =>
      setNotice(errorMessage(error, "Could not remove the song.")),
  });

  // "New playlist…" makes a private list and puts the song in it — two
  // requests, because the create endpoint takes no songs. A list that was
  // created but could not be filled still exists, so the failure of the second
  // one says exactly that instead of "could not create the playlist".
  const createList = useMutation({
    ...createPlaylistMutation(),
    onSuccess: (created) => {
      setNaming(false);
      setNewName("");
      addToPlaylist.mutate({
        path: { playlist_id: created.id },
        body: { song_id: song.id },
      });
    },
    onError: (error) =>
      setNotice(errorMessage(error, "Could not create the playlist.")),
  });

  // Both directions refetch the assignments, which is where a mark on a song
  // row and the glyphs on the Tags row come from. The backend broadcasts
  // `song_tags.changed` as well, for every other reader in the room.
  const refreshTags = (): void => {
    void queryClient.invalidateQueries({
      queryKey: listTagAssignmentsQueryKey(),
    });
  };
  const tagFailed = (error: unknown): void =>
    setNotice(
      errorDetail(error) === "missing_tag_permission:assign"
        ? "That tag is not yours to set. Ask the host."
        : errorMessage(error, "Could not change the tag."),
    );

  const setTag = useMutation({
    ...assignTagMutation(),
    onSuccess: refreshTags,
    onError: tagFailed,
  });
  const clearTag = useMutation({
    ...unassignTagMutation(),
    onSuccess: refreshTags,
    onError: tagFailed,
  });

  // What everybody said about the song, oldest first. Asked for as the modal
  // opens rather than with the sub-view: the count is the option row's value,
  // so the row cannot wait for the view it leads into. Reading takes only
  // `songs.view`, which is what got this reader to the song in the first place.
  const comments = useQuery(
    listSongCommentsOptions({ path: { song_id: song.id } }),
  );
  const said = comments.data?.comments ?? [];

  const refreshComments = (): void => {
    void queryClient.invalidateQueries({
      queryKey: listSongCommentsQueryKey({ path: { song_id: song.id } }),
    });
  };

  // Somebody else in the room said something, or a moderator took one away.
  // The bodies are not on the bus, so the list refetches itself — which is
  // what moves the count on the option row as well.
  useWingmanEvent<CommentsChanged>("comments.changed", (message) => {
    if (message.song_id === song.id) refreshComments();
  });

  // The composer sits under the list, so every row that arrives — your own
  // post, or somebody else's over the socket — pushes it down by its own
  // height while the scroll position stays put. Two consequences to undo,
  // both only once the field is on screen at all:
  useEffect(() => {
    const field = composer.current;
    if (!field) return;
    // Re-entering the sub-view mounts a fresh textarea, and the draft that
    // survived in state has to be measured against it again.
    grow(field);
    // And the writer whose thought is still in the field follows it down
    // rather than being left looking at the comment above.
    if (document.activeElement === field)
      field.scrollIntoView({ block: "nearest" });
  }, [view, said.length]);

  const say = useMutation({
    ...addSongCommentMutation(),
    onSuccess: () => {
      setDraft("");
      const field = composer.current;
      if (field) {
        // Back to two rows, and still the focused element: the next thought
        // usually follows the one just sent.
        field.style.height = "";
        field.focus();
      }
      refreshComments();
    },
    onError: (error) =>
      setNotice(errorMessage(error, "Could not post your comment.")),
  });

  // The song itself, files and all. Only an administrator holds `songs.delete`
  // by default, and the weight of it sits in the confirmation, not in a red row.
  const removeSong = useMutation({
    ...deleteSongMutation(),
    onSuccess: () => {
      // Every listing in the app carried this song — the library, the wishlist,
      // the playlists, the reel. Naming them one by one here would go stale the
      // next time one is added, so the whole cache is asked again.
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error) => {
      const refusal = DELETE_REFUSALS[errorDetail(error) ?? ""];
      setNotice(refusal ?? errorMessage(error, "Could not delete the song."));
    },
  });

  // Wrong or missing metadata, corrected. It goes into the song's `.txt` rather
  // than into the row alone: the file is what USDX reads and what the next
  // library scan re-imports, so a row-only edit would last until the next start.
  const saveDetails = useMutation({
    ...editSongMutation(),
    onSuccess: (updated) => {
      // The modal shows the new values at once; every listing behind it — the
      // library, the playlists, the wishlist, the reel — is asked again, since
      // each of them carries its own copy of the row.
      setSaved(updated);
      void queryClient.invalidateQueries();
      setView("main");
    },
    onError: (error) => {
      const refusal = EDIT_REFUSALS[errorDetail(error) ?? ""];
      setNotice(
        refusal ??
          errorMessage(
            error,
            "Could not save the details. A title and an artist are needed, and neither may run over one line.",
          ),
      );
    },
  });

  const unsay = useMutation({
    ...deleteSongCommentMutation(),
    onSuccess: refreshComments,
    onError: (error) =>
      setNotice(errorMessage(error, "Could not delete the comment.")),
  });

  const post = (): void => {
    const body = draft.trim();
    if (body === "" || say.isPending) return;
    setNotice(null);
    say.mutate({ path: { song_id: song.id }, body: { body } });
  };

  // Duration lives in the preview player and artist in the hero, so the
  // details keep only what the modal does not show anyway.
  const rows: { icon: IconName; label: string; value: string | null }[] = [
    // `flag` is "a language or a country" (§3); `globe` means global sharing.
    { icon: "flag", label: "Language", value: shown.language },
    // Not `tag`: that glyph is the tags feature's, one row further down (§3).
    { icon: "music", label: "Genre", value: shown.genre },
    {
      icon: "calendar",
      label: "Year",
      value: shown.year === null ? null : String(shown.year),
    },
    { icon: "disc", label: "Edition", value: shown.edition },
    { icon: "user", label: "Creator", value: shown.creator },
    // The id already names the source ("usdb:24435"), so one row covers both.
    { icon: "database", label: "Source", value: shown.id },
  ];

  // The fields the editor writes, in the order §5 fixes. The creator is not
  // among them: it says who built the karaoke file, which is not a fact about
  // the song anybody here is fixing.
  const fields: { name: keyof EditForm; label: string; numeric?: boolean }[] = [
    { name: "title", label: "Title" },
    { name: "artist", label: "Artist" },
    { name: "language", label: "Language" },
    { name: "genre", label: "Genre" },
    { name: "year", label: "Year", numeric: true },
    { name: "edition", label: "Edition" },
  ];

  if (selectingPlayers) {
    return <PlayerSelection song={shown} onClose={onClose} />;
  }

  if (view === "edit" && form !== null) {
    const incomplete = form.title.trim() === "" || form.artist.trim() === "";
    // One request at a time: a save landing after the folder is gone is a 404
    // into a modal that is already closing, and the other way round it would
    // write values nobody will ever read.
    const busy = saveDetails.isPending || removeSong.isPending;
    return (
      <>
        <Modal
          title="Edit details"
          bare
          onClose={() => {
            setNotice(null);
            setForm(null);
            setView("main");
          }}
        >
          <form
            className="song-edit"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canEditSong || incomplete || busy) return;
              setNotice(null);
              saveDetails.mutate({
                path: { song_id: song.id },
                // What the fields say, and what they were filled from: the
                // second is how the backend knows whether the file moved on
                // meanwhile.
                body: { values: valuesOf(form), expected: metadataOf(shown) },
              });
            }}
          >
            {fields.map(({ name, label, numeric }) => (
              <label className="song-edit-field" key={name}>
                <span>{label}</span>
                <input
                  className="text-input text-input-quiet"
                  type={numeric ? "number" : "text"}
                  inputMode={numeric ? "numeric" : undefined}
                  min={numeric ? 0 : undefined}
                  max={numeric ? 9999 : undefined}
                  value={form[name]}
                  disabled={!canEditSong || busy}
                  onChange={(event) =>
                    setForm({ ...form, [name]: event.target.value })
                  }
                />
              </label>
            ))}
            {/* A locked form says why it is locked (§1). The reader who gets
                here without `songs.edit` holds `songs.delete` alone, so the
                fields are the song as it stands and the button below is the
                only thing they came for. */}
            <p className="song-details-notice">
              {canEditSong
                ? "The values go into the song's own file, so Ultrastar Deluxe shows them too. Its lyrics and its music are not touched."
                : "Your role may not change these values. Ask the host for access."}
            </p>
            {notice && (
              <p className="song-details-notice" role="alert">
                {notice}
              </p>
            )}
            {canEditSong && (
              <button
                type="submit"
                className="button button-primary song-edit-save"
                disabled={incomplete || busy}
              >
                Save
              </button>
            )}
            {/* The whole song, at the foot and under everything that only
                corrects it. Nothing on the way here is red (§1.6); the weight
                sits in the confirmation and in this one button. */}
            {canDeleteSong && (
              <div className="song-edit-delete">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={busy}
                  onClick={() => {
                    setNotice(null);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete song
                </button>
              </div>
            )}
          </form>
        </Modal>
        {/* Over the editor rather than instead of it: cancelling comes back to
            the form the reader was looking at. */}
        {confirmingDelete && (
          <ConfirmModal
            title="Delete song"
            message={`"${shown.title}" by ${shown.artist} leaves the library and its folder is deleted from the disk. There is no undo.`}
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              setConfirmingDelete(false);
              removeSong.mutate({ path: { song_id: song.id } });
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </>
    );
  }

  if (view === "scores") {
    return (
      <Modal title="Best scores" bare onClose={() => setView("main")}>
        {/* The song's whole history in the scores page's idiom, so the ranking
            below has something to be read against. The best and worst singers
            are left out of it: rank 1 names one of them one row further down. */}
        {history !== null && (
          <p className="song-scores-stats">
            <IconStat icon="hash" label="Times sung" value={history.sings} />
            <IconStat icon="arrow-up" label="Best" value={history.best} />
            <IconStat icon="arrow-down" label="Worst" value={history.worst} />
            <IconStat icon="average" label="Average" value={history.average} />
          </p>
        )}
        {/* Four scores are the fewest that make a picture (§7): a couple of
            dots have no spread to show and no median worth drawing a line for,
            and the ranking below says everything they do. The modal is flat on
            `--bg`, so the rings are painted for that ground (§1.1). */}
        {allScores.length >= CHART_MIN_SCORES && (
          <div className="song-scores-strip">
            <ScoreStrip
              scores={allScores}
              label="Every score this song ever got"
              dated
              surface={chartTheme.pageBg}
            />
          </div>
        )}
        <RankedScoreList scores={best} players={players} label="Best scores" />
      </Modal>
    );
  }

  if (view === "playlists") {
    const busy =
      addToPlaylist.isPending ||
      removeFromPlaylist.isPending ||
      createList.isPending;
    return (
      <Modal
        title="Add to playlist"
        bare
        onClose={() => {
          // Leaving the sub-view abandons a half-typed name: coming back to a
          // field the reader does not remember opening is worse than the row.
          setNaming(false);
          setNewName("");
          setView("main");
        }}
      >
        {playlists.isPending && <Loading />}
        {/* The listing is the whole picker; without it the reader would face a
            "New playlist…" row alone and read it as "you have none". */}
        {playlists.isError && (
          <p className="song-details-notice" role="alert">
            Could not load your playlists.
          </p>
        )}
        <ul className="picker-list">
          {mine.map((list) => (
            <PickerRow
              key={list.id}
              lead={<PlaylistCover songIds={list.cover_song_ids} />}
              title={list.name}
              meta={`${list.song_count} ${list.song_count === 1 ? "song" : "songs"}`}
              // The listing filled this in for the song the picker is about; a
              // row never asks for the playlist itself to find out.
              pressed={list.contains === true}
              disabled={busy}
              onClick={() => {
                setNotice(null);
                if (list.contains === true) {
                  removeFromPlaylist.mutate({
                    path: { playlist_id: list.id, song_id: song.id },
                  });
                } else {
                  addToPlaylist.mutate({
                    path: { playlist_id: list.id },
                    body: { song_id: song.id },
                  });
                }
              }}
            />
          ))}
          {/* The way out of an empty picker, and the shortcut past the
              playlists page for a full one. What it makes is private: a list
              born from one song is nobody else's business until it is shared
              on its own manage page. */}
          <li>
            {naming ? (
              <form
                className="song-playlists-new"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newName.trim();
                  if (name === "") return;
                  setNotice(null);
                  createList.mutate({ body: { name, is_global: false } });
                }}
              >
                <input
                  className="text-input text-input-quiet song-playlists-name-input"
                  aria-label="New playlist name"
                  placeholder="Playlist name"
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <button
                  type="submit"
                  className="icon-button"
                  aria-label="Create the playlist and add the song"
                  disabled={busy || newName.trim() === ""}
                >
                  {/* The plus the collapsed row led with, now the control that
                      commits it — never a bare `check` (§3). */}
                  <Icon name="plus" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="picker-row"
                onClick={() => {
                  setNotice(null);
                  setNaming(true);
                }}
              >
                <span className="picker-row-glyph">
                  <Icon name="plus" />
                </span>
                <span className="picker-row-text">
                  <span className="picker-row-title">New playlist…</span>
                </span>
              </button>
            )}
          </li>
        </ul>
        {notice && (
          <p className="song-details-notice" role="alert">
            {notice}
          </p>
        )}
      </Modal>
    );
  }

  if (view === "tags") {
    const busy = setTag.isPending || clearTag.isPending;
    // A tag nobody in this seat may set and nobody has set is a row that says
    // nothing and does nothing. One sentence is the honest version of that list.
    const useful = assignable.length > 0 || carried.length > 0;
    return (
      <Modal
        title="Tags"
        bare
        onClose={() => {
          setNotice(null);
          setView("main");
        }}
      >
        {tags.isPending ? (
          <Loading />
        ) : useful ? (
          <ul className="picker-list">
            {tags.tags.map((tag) => {
              const on = carriedIds.has(tag.id);
              // The §4 song-control idiom: the glyph is the tag's colour when
              // the song wears it and `--color-darkerer` when it does not, so
              // one look down the list says which tags are on.
              const glyph = (
                <span className="picker-row-glyph">
                  <Icon
                    name={tagGlyph(tag.icon)}
                    className={
                      on ? tagColorClass(tag.color) : "song-tag-glyph-off"
                    }
                  />
                </span>
              );
              const name = (
                <span className="picker-row-text">
                  <span className="picker-row-title" title={tag.name}>
                    {tag.name}
                  </span>
                </span>
              );
              if (!tag.can_assign) {
                const why = "You may see this tag but not set it";
                return (
                  <li key={tag.id}>
                    {/* Not a button: there is nothing to press. The padlock is
                        what says so, and it is the row's only trailing mark. */}
                    <div className="picker-row song-tag-locked">
                      {glyph}
                      {name}
                      <span className="picker-row-mark" title={why}>
                        <Icon name="lock" />
                      </span>
                    </div>
                  </li>
                );
              }
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    className="picker-row"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => {
                      setNotice(null);
                      const path = { song_id: song.id, tag_id: tag.id };
                      if (on) clearTag.mutate({ path });
                      else setTag.mutate({ path });
                    }}
                  >
                    {glyph}
                    {name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="song-details-notice">
            No tags on this song, and none of them is yours to set.
          </p>
        )}
        {notice && (
          <p className="song-details-notice" role="alert">
            {notice}
          </p>
        )}
      </Modal>
    );
  }

  if (view === "comments") {
    // Writing takes the right *and* an account: a comment carries a name, and
    // the host screen is an administrator without one.
    const canWrite = auth.user !== null && auth.can("comments.write");
    const whoMayWrite = auth.isHost
      ? "The host screen has no name to sign a comment with. Say it from your own phone."
      : auth.user === null
        ? "Comments carry a name, so writing one takes an account. Log in to say something."
        : "Your role may not comment. Ask the host for access.";
    return (
      <>
        <Modal
          title="Comments"
          bare
          onClose={() => {
            setNotice(null);
            setView("main");
          }}
        >
          {comments.isPending && <Loading />}
          {comments.isError && (
            <p className="song-details-notice" role="alert">
              Could not load the comments.
            </p>
          )}
          {comments.isSuccess && said.length === 0 && (
            <p className="song-details-notice">
              Nobody has said anything about this song yet.
            </p>
          )}
          {said.length > 0 && (
            <ul className="song-comments">
              {said.map((comment) => (
                <li key={comment.id} className="song-comment">
                  <PlayerAvatar player={asAuthor(comment.author)} />
                  <div className="song-comment-text">
                    <p className="song-comment-head">
                      <span className="song-comment-author">
                        {authorName(comment.author)}
                      </span>
                      <span className="song-comment-time">
                        {timeAgo(comment.created_at)}
                      </span>
                    </p>
                    <p className="song-comment-body">{comment.body}</p>
                  </div>
                  {/* Your own words are always yours; anybody else's takes
                      `comments.moderate`, which is what `can_delete` says. */}
                  {comment.can_delete && (
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={`Delete ${authorName(comment.author)}'s comment`}
                      disabled={unsay.isPending}
                      onClick={() => {
                        setNotice(null);
                        setDeleting(comment);
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {auth.loaded &&
            (canWrite ? (
              <form
                className="song-comment-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  post();
                }}
              >
                <textarea
                  ref={composer}
                  className="text-input text-input-quiet song-comment-input"
                  aria-label="Say something about this song"
                  placeholder="Say something…"
                  rows={2}
                  maxLength={COMMENT_MAX_LENGTH}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    grow(event.target);
                  }}
                  onKeyDown={(event) => {
                    // Enter is a newline — a comment is prose, not a chat
                    // line — so the keyboard's send is Ctrl/Cmd+Enter.
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault();
                      post();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="icon-button"
                  aria-label="Send"
                  disabled={draft.trim() === "" || say.isPending}
                >
                  <Icon name="send" />
                </button>
              </form>
            ) : (
              <p className="song-details-notice">{whoMayWrite}</p>
            ))}
          {notice && (
            <p className="song-details-notice" role="alert">
              {notice}
            </p>
          )}
        </Modal>
        {deleting && (
          <ConfirmModal
            title="Delete comment"
            message="The comment disappears for everybody, and there is no undo."
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              unsay.mutate({
                path: { song_id: song.id, comment_id: deleting.id },
              });
              setDeleting(null);
            }}
            onCancel={() => setDeleting(null)}
          />
        )}
      </>
    );
  }

  const wished = wishlist.mine(song.id);
  const favorite = favorites.ids.has(song.id);
  const hasControls =
    favorites.available || auth.can("karaoke.sing") || auth.can("wishlist.add");

  return (
    <>
      <Modal title={shown.title} hideTitle bare onClose={onClose}>
        <div className="song-hero">
          <SongCover song={shown} className="song-hero-cover" />
          <h3 className="song-hero-title">{shown.title}</h3>
          <p className="song-hero-artist">{shown.artist}</p>
        </div>

        {!noAudio && (
          <audio
            className="song-preview"
            controls
            preload="metadata"
            src={`/api/v1/songs/${encodeURIComponent(song.id)}/audio`}
            onError={() => setNoAudio(true)}
          />
        )}

        {hasControls && (
          <div className="song-details-controls">
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
            {auth.can("karaoke.sing") && (
              <button
                type="button"
                className="song-control song-control-lead song-control-sing"
                aria-label="Sing"
                onClick={() => setSelectingPlayers(true)}
              >
                <Icon name="play" />
              </button>
            )}
            {auth.can("wishlist.add") && (
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
                  setNotice(null);
                  if (wished) wishlist.unwish(song.id);
                  else wishlist.wish(song.id);
                }}
              >
                <Icon name={wished ? "playlist-check" : "playlist-plus"} />
              </button>
            )}
          </div>
        )}

        {(notice || wishlist.error !== null) && (
          <p className="song-details-notice" role="alert">
            {notice ??
              errorMessage(
                wishlist.error,
                "Could not change your wish. Log in or ask the host for access.",
              )}
          </p>
        )}

        <div className="song-options">
          <button
            type="button"
            className="song-option"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <Icon name="info" className="song-option-icon" />
            <span className="song-option-label">Details</span>
            {/* A glyph swap, not a rotation: every collapsed option row points
                right, whether it expands inline or opens a sub-view, and
                rotating `chevron-down` by 180° would point it up. */}
            <Icon
              name={detailsOpen ? "chevron-down" : "chevron-right"}
              className="song-option-chevron"
            />
          </button>
          {/* Always in the DOM: `hidden` keeps the metadata findable (search,
              screen-reader "show all") without conditional rendering. */}
          <ul className="song-details-list" hidden={!detailsOpen}>
            {rows.map(({ icon, label, value }) => (
              <li key={label} title={label}>
                <Icon name={icon} />
                <span>{value ?? "unknown"}</span>
              </li>
            ))}
          </ul>

          {/* Offered on the strength of the right alone, not of the listing: a
              reader with no list yet is exactly who the "New playlist…" row
              inside is for, and the listing has not been asked for at this
              point anyway. */}
          {canManagePlaylists && (
            <button
              type="button"
              className="song-option"
              onClick={() => setView("playlists")}
            >
              <Icon name="list-plus" className="song-option-icon" />
              <span className="song-option-label">Add to playlist</span>
              <Icon name="chevron-right" className="song-option-chevron" />
            </button>
          )}

          {/* The last row, and the one place a song is changed at all: what
              the details say, and — at the foot of that same form — whether
              the song stays in the library. One row rather than two, because
              both are the same errand, and a reader who holds only the right
              to delete finds the fields locked and the button live. */}
          {(canEditSong || canDeleteSong) && (
            <button
              type="button"
              className="song-option"
              onClick={() => {
                setNotice(null);
                // Filled from what is on screen — which is what the backend is
                // told the edit was based on when it is saved.
                setForm(formOf(shown));
                setView("edit");
              }}
            >
              <Icon name="pencil" className="song-option-icon" />
              <span className="song-option-label">Edit details</span>
              <Icon name="chevron-right" className="song-option-chevron" />
            </button>
          )}
        </div>

        {/* The summary strip closes the modal (§5): the three counted things as
            a glyph over its number, each opening the sub-view it counts. The
            rows above hold content and actions; these hold numbers. */}
        <div className="song-summary">
          {/* A trophy with nothing behind it would be a promise the song cannot
              keep — unlike a tag or a comment, nobody can put the first score on
              a song from here. Without `stats.history` the query never runs, so
              the button is absent for the same reason the old row was. */}
          {best.length > 0 && (
            <button
              type="button"
              className="song-summary-stat song-summary-scores"
              onClick={() => setView("scores")}
            >
              <IconStat
                icon="trophy"
                label="Best scores"
                value={best[0].score}
              />
            </button>
          )}

          {/* Absent only when the reader may neither see nor set a single tag: a
              button leading into an empty list is worse than no button (§5). At
              zero it stays — putting the first tag on a song is what it is for. */}
          {tags.tags.length > 0 && (
            <button
              type="button"
              className="song-summary-stat"
              onClick={() => setView("tags")}
            >
              {/* The two listings answer separately, and the tags one first, so
                  the count waits for both of them — exactly as the comments one
                  below does. A zero drawn in between would say "no tags on this
                  song" about a song whose assignments are still in flight, and
                  a zero drawn after the assignments *failed* would say it about
                  a song nobody could look up at all. */}
              <IconStat
                icon="tag"
                label="Tags"
                value={tags.isSuccess ? carried.length : UNKNOWN}
              />
            </button>
          )}

          {/* Nobody is kept out of this one: reading what the room said about a
              song is part of looking at it, and being the first to say something
              is exactly what a zero leads to. Writing needs an account, and that
              is said inside. */}
          <button
            type="button"
            className="song-summary-stat"
            onClick={() => {
              setNotice(null);
              setView("comments");
            }}
          >
            {/* Zero once the listing says so, and not a moment earlier: while it
                is in flight — or after it failed, when `said` stays empty for
                good — "0" would be a claim nobody checked. */}
            <IconStat
              icon="comment"
              label="Comments"
              value={comments.isSuccess ? said.length : UNKNOWN}
            />
          </button>
        </div>
      </Modal>
    </>
  );
}
