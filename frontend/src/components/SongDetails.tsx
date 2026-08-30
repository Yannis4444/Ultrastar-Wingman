import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { CommentAuthor, CommentRead, PlayerRead, SongRead } from "../api";
import {
  addPlaylistEntryMutation,
  addSongCommentMutation,
  assignTagMutation,
  createPlaylistMutation,
  deleteSongCommentMutation,
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

/** What the backend accepts in one comment; the field stops there too. */
const COMMENT_MAX_LENGTH = 1000;

/** How far the composer grows with what is typed — about five lines. */
const COMPOSER_MAX_HEIGHT = 132;

/** A comment whose account is gone still says something worth reading. */
const FORMER_MEMBER = "Former member";

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

/**
 * How many tag glyphs the Tags row draws before it gives up and counts them
 * instead (§5). Past three the glyphs stop being recognisable at a glance and
 * start crowding the row's label.
 */
const TAG_GLYPHS = 3;

export default function SongDetails({ song, onClose }: SongDetailsProps) {
  const [selectingPlayers, setSelectingPlayers] = useState(false);
  // Sub-views swap the modal content; closing them returns to the song. Always
  // from the song itself: the one caller that opened straight into the picker
  // was Currently Playing's playlist button, and that button is gone.
  const [view, setView] = useState<
    "main" | "scores" | "playlists" | "tags" | "comments"
  >("main");
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
  const composer = useRef<HTMLTextAreaElement>(null);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const wishlist = useWishlist();
  const favorites = useFavorites();
  const tags = useTags();

  // What this reader may know about the song's tags, and what they may change.
  // `bySong` also carries the tags a `tags.manage` holder may not view; those
  // belong on the admin page, never here.
  const carried = (tags.bySong.get(song.id) ?? []).filter(
    (tag) => tag.can_view,
  );
  const assignable = tags.tags.filter((tag) => tag.can_assign);
  const carriedIds = new Set(carried.map((tag) => tag.id));

  const canManagePlaylists = auth.user !== null && auth.can("playlists.manage");
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
    { icon: "flag", label: "Language", value: song.language },
    // Not `tag`: that glyph is the tags feature's, one row further down (§3).
    { icon: "music", label: "Genre", value: song.genre },
    {
      icon: "calendar",
      label: "Year",
      value: song.year === null ? null : String(song.year),
    },
    { icon: "disc", label: "Edition", value: song.edition },
    { icon: "user", label: "Creator", value: song.creator },
    // The id already names the source ("usdb:24435"), so one row covers both.
    { icon: "database", label: "Source", value: song.id },
  ];

  if (selectingPlayers) {
    return <PlayerSelection song={song} onClose={onClose} />;
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
      ? "The host screen has no name to sign a comment with — say it from your own phone."
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
    <Modal title={song.title} hideTitle bare onClose={onClose}>
      <div className="song-hero">
        <SongCover song={song} className="song-hero-cover" />
        <h3 className="song-hero-title">{song.title}</h3>
        <p className="song-hero-artist">{song.artist}</p>
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

        {best.length > 0 && (
          <button
            type="button"
            className="song-option"
            onClick={() => setView("scores")}
          >
            <Icon
              name="trophy"
              className="song-option-icon song-option-trophy"
            />
            <span className="song-option-label">Best scores</span>
            <span className="song-option-score">{best[0].score}</span>
            <Icon name="chevron-right" className="song-option-chevron" />
          </button>
        )}

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

        {/* Absent when the reader may not view a single tag: a row leading into
            an empty list is worse than no row (§5). It is the tags this reader
            knows about that decide, not the ones on this song — putting the
            first tag on a song is the point of the sub-view. */}
        {tags.tags.length > 0 && (
          <button
            type="button"
            className="song-option"
            onClick={() => setView("tags")}
          >
            <Icon name="tag" className="song-option-icon" />
            <span className="song-option-label">Tags</span>
            {carried.length > 0 && (
              <span className="song-option-tags">
                {carried.length > TAG_GLYPHS
                  ? `${carried.length} tags`
                  : carried.map((tag) => (
                      <Icon
                        key={tag.id}
                        name={tagGlyph(tag.icon)}
                        className={tagColorClass(tag.color)}
                      />
                    ))}
              </span>
            )}
            <Icon name="chevron-right" className="song-option-chevron" />
          </button>
        )}

        {/* Last of the option rows (§5), and the one row nobody is kept out
            of: reading what the room said about a song is part of looking at
            it. Writing is what needs an account, and that is said inside. */}
        <button
          type="button"
          className="song-option"
          onClick={() => {
            setNotice(null);
            setView("comments");
          }}
        >
          <Icon name="comment" className="song-option-icon" />
          <span className="song-option-label">Comments</span>
          {said.length > 0 && (
            <span className="song-option-count">{said.length}</span>
          )}
          <Icon name="chevron-right" className="song-option-chevron" />
        </button>
      </div>
    </Modal>
  );
}
