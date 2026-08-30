import type { ReactNode } from "react";
import type { SongRead, TagRead } from "../api";
import {
  type BuiltInTags,
  DEFAULT_BUILT_IN_TAGS,
  tagColorClass,
  tagGlyph,
} from "../tags";
import { Icon } from "./icons";
import SongCover from "./SongCover";
import "./SongListItem.css";

interface SongListItemProps {
  song: SongRead;
  onClick: () => void;
  /** Small passive marker after the title: this song is in my favorites. */
  favorite?: boolean;
  /** Small passive marker after the title: I have sung this song before. */
  sung?: boolean;
  /**
   * The tags this song wears that asked to be on the row — the reader's own
   * `show_in_list` ones, from `markTags`. They follow the two marks above in
   * DOM order (§1.4) and are passive like them: tags are set in the song modal.
   */
  tags?: TagRead[];
  /**
   * How the party configured the built-ins: the colour each is drawn in, and
   * whether it belongs on a song row at all. From `useTags`, passed in rather
   * than read here — a list is hundreds of these, and hundreds of query
   * subscriptions for one handful of values is a hundred times the work. Left
   * out, they look the way they always did: the pink heart and the blue
   * microphone on, the two facets off. Only the marks and the two boolean
   * facets are read; a valued facet is never a mark (§1.3).
   */
  builtIns?: BuiltInTags;
  /**
   * Right-aligned trailing text inside the row: the one value this list is
   * about (the time a song was played, a duration). Not a control — anything
   * clickable belongs in `actions`.
   */
  meta?: ReactNode;
  /**
   * Controls next to the row (playlist reordering). They sit beside the row
   * button, never inside it: nested buttons are invalid HTML.
   */
  actions?: ReactNode;
  /**
   * What goes in front of the cover — the drag grip of a playlist's edit mode.
   * Same reason as `actions`: beside the row button, never inside it.
   */
  leading?: ReactNode;
}

export default function SongListItem({
  song,
  onClick,
  favorite,
  sung,
  tags,
  builtIns = DEFAULT_BUILT_IN_TAGS,
  meta,
  actions,
  leading,
}: SongListItemProps) {
  const item = (
    <button type="button" className="song-list-item" onClick={onClick}>
      <SongCover song={song} />
      <span className="song-text">
        {/* The title attribute recovers what the ellipsis cuts ("[DUET]"). */}
        <span className="song-title" title={song.title}>
          <span className="song-title-text">{song.title}</span>
          {sung && builtIns.sung.show_in_list && (
            <span
              className={`song-mark song-mark-sung ${tagColorClass(builtIns.sung.color)}`}
              title="You sang this"
            >
              <Icon name="mic" />
            </span>
          )}
          {favorite && builtIns.favorites.show_in_list && (
            <span
              className={`song-mark song-mark-favorite ${tagColorClass(builtIns.favorites.color)}`}
              title="In your favorites"
            >
              <Icon name="heart" />
            </span>
          )}
          {/* The two facets the file answers, after the two per-reader marks
              and before the tags (§1.4). They are off the rows by default —
              half a library is a duet — and a party that wants them turns them
              on in the Tags admin. */}
          {song.is_duet && builtIns.duet.show_in_list && (
            <span
              className={`song-mark song-mark-duet ${tagColorClass(builtIns.duet.color)}`}
              title="A duet"
            >
              <Icon name="users" />
            </span>
          )}
          {song.has_video && builtIns.video.show_in_list && (
            <span
              className={`song-mark song-mark-video ${tagColorClass(builtIns.video.color)}`}
              title="Has a video"
            >
              <Icon name="video" />
            </span>
          )}
          {(tags ?? []).map((tag) => (
            <span
              key={tag.id}
              className={`song-mark song-mark-tag ${tagColorClass(tag.color)}`}
              title={tag.name}
            >
              <Icon name={tagGlyph(tag.icon)} />
            </span>
          ))}
        </span>
        <span className="song-artist">{song.artist}</span>
      </span>
      {meta && <span className="song-meta">{meta}</span>}
    </button>
  );

  if (!actions && !leading) return item;
  return (
    <div className="song-list-row">
      {leading}
      {item}
      {actions && <span className="song-list-actions">{actions}</span>}
    </div>
  );
}
