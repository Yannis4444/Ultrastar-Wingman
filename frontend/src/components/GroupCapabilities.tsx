import { Fragment } from "react";
import { GUEST } from "../groups";
import { Icon, type IconName } from "./icons";
import "./GroupCapabilities.css";

/** One glyph per area of the catalogue (the prefix before the dot), so an area
 *  is found by shape before it is read. Existing icon names only. "Group" means
 *  a permission group now, so the catalogue's sections are its *areas*. */
const AREA_ICONS: Record<string, IconName> = {
  achievements: "trophy",
  songs: "music",
  karaoke: "mic",
  // `songs` already owns the `music` glyph; labelling an area is a job.
  music: "volume",
  players: "users",
  wishlist: "playlist-plus",
  playlists: "list",
  tags: "tag",
  comments: "comment",
  devices: "card",
  downloads: "download",
  usdb: "globe",
  stats: "chart",
  settings: "gear",
  users: "user",
  permissions: "shield",
};

/** Areas whose name is not simply their capitalized prefix. */
const AREA_NAMES: Record<string, string> = { usdb: "USDB" };

/**
 * What a capability actually lets somebody do, in the words the user handbook
 * uses. The row itself only carries the verb (the area heading carries the
 * noun), which is short enough to be ambiguous on its own. A capability with no
 * entry here — one the backend grew after this file — still renders and is
 * still editable, just without the sentence.
 */
const DESCRIPTIONS: Record<string, string> = {
  "achievements.manage":
    "Create achievements, edit what they ask for, and switch them off and on. That includes the ones Wingman ships. Everybody sees the badges.",
  "songs.view": "See the song list and open a song.",
  "songs.rescan": "Read the song folders again to pick up new files.",
  "songs.edit":
    "Fix a song's title, artist, language, genre, year or edition. It is written into the song's own file, so Ultrastar Deluxe shows it too.",
  "songs.delete":
    "Delete a song for good, its folder on the disk included. Nothing can undo it.",
  "karaoke.sing": "Start a song on the Ultrastar Deluxe machine.",
  "karaoke.stop": "Stop the song that is running now.",
  "music.view": "See what the background music is playing.",
  "music.control": "Pause and skip the background music, and set its volume.",
  "music.manage": "Switch the background music on and choose what it plays.",
  "players.view": "See the players, and pick who is singing.",
  "players.avatar": "Change anybody's picture. Your own never needs a right.",
  "players.manage": "Add players, hide them for the evening, and delete them.",
  "wishlist.view": "See what everybody wished for.",
  "wishlist.add": "Put a song on the wishlist, and take it off again.",
  "wishlist.manage": "Take a song off the wishlist for everybody.",
  "playlists.view": "See shared playlists and the songs in them.",
  "playlists.manage": "Create and edit own playlists.",
  "playlists.moderate":
    "Change and delete somebody else's playlists: the global ones, and the ones shared with you. Needs manage too.",
  "tags.manage":
    "Create tags, say who each one is for, and delete them. Putting a tag on a song is granted per tag.",
  "comments.write":
    "Say something under a song. Needs an account, because a comment carries your name.",
  "comments.moderate":
    "Delete anybody's comment. Taking your own back never needs a right.",
  "devices.manage":
    "Set up a player selector, map its readers and buttons, and say which card belongs to whom. Singing with one needs nothing extra.",
  "downloads.view": "See the download queue.",
  "downloads.manage": "Start downloads, retry them, and clear them.",
  "usdb.search": "Search usdb.animux.de for new songs.",
  "stats.view": "See the scoreboard of the party that is running.",
  "stats.history":
    "See the parties before tonight, and anybody's whole record.",
  "stats.manage": "Rename a party in the statistics.",
  "stats.moderate":
    "Put a recorded score on another singer, or delete it. The score itself and the song stay as Ultrastar Deluxe reported them.",
  "stats.hide":
    "Take a party off the list on the Scores tab, or put it back. It keeps every score it has.",
  "settings.view": "See Wingman's settings.",
  "settings.manage": "Change every setting, the USDB login included.",
  "users.view": "See who has an account and which groups they are in.",
  "users.manage":
    "Put accounts in groups and take them out, and delete accounts. Admin stays an administrator's.",
  "permissions.manage":
    "Make groups, rename them, say what each one may do, and delete them.",
};

/**
 * Why a grant would do nothing. Some rights are about a row that belongs to
 * somebody: creating a playlist goes through `account_id` (401 without an
 * account). Ticking that for Guest would be a lie, so the box is disabled —
 * unless the value is already on, which has to stay clearable.
 *
 * `playlists.moderate` is *not* inert for a guest: it reaches into other
 * people's shared lists, which needs no account of one's own. It does need
 * `playlists.manage` alongside it, and that sentence lives in the description —
 * this function only sees one capability at a time.
 */
const GUEST_INERT: Record<string, string> = {
  "playlists.manage":
    "A playlist belongs to an account, so a guest has none to create or edit.",
};

/** The sentence a box drawn ticked on User's behalf carries. */
export const THROUGH_USER = "Every account holds this through User.";

/** The sentence a box the reader may not hand out carries (rule 2). */
export const NOT_HELD = "You can only hand out a right you hold yourself.";

/** Ids have to survive in an `aria-describedby` list, where a space separates
 *  entries — dots are fine, but keep the shape simple. */
function rowId(capability: string): string {
  return `perm-${capability.replace(".", "-")}`;
}

interface GroupCapabilitiesProps {
  /** The group being edited: its id and its name, for the boxes' names. */
  groupId: string;
  groupName: string;
  /** The catalogue, in the backend's order (`GroupList.capabilities`). */
  catalogue: string[];
  /** The group's own rows as the draft stands: what Save sends. */
  own: ReadonlySet<string>;
  /** The group's own rows as stored. Rule 2 binds on the change, so a stored
   *  row the reader unticked by mistake may be ticked again whatever they hold. */
  stored: ReadonlySet<string>;
  /** User's rows. A group that is not built in adds to them, so they are drawn
   *  ticked and locked there; empty for Guest and User themselves. */
  inherited: ReadonlySet<string>;
  /** Whether the reader is an administrator, who may hand out anything. */
  isAdmin: boolean;
  /** What the reader holds on this request, whatever group it came from. */
  held: ReadonlySet<string>;
  onToggle: (capability: string, granted: boolean) => void;
}

/**
 * Every capability of the catalogue as one checkbox column for one group
 * (permission-groups.md §9.1): the area headings with their glyphs, one row per
 * capability with its verb and its sentence, and the box. No column head — the
 * page's name says whose column it is.
 *
 * Controlled: it holds nothing. A box is disabled, with its reason in `title`
 * and a `visually-hidden` sentence, when User already gives it (drawn ticked,
 * never part of `own`), when it would be inert for Guest, or when the reader is
 * not an administrator and would be handing out a right they lack. A stored row
 * stays a live box whatever the reader holds: taking away is free, and so is
 * putting back what was unticked by mistake.
 */
export default function GroupCapabilities({
  groupId,
  groupName,
  catalogue,
  own,
  stored,
  inherited,
  isAdmin,
  held,
  onToggle,
}: GroupCapabilitiesProps) {
  // Sorted, so same-area capabilities sit together.
  const sorted = [...catalogue].sort();
  const areas: [string, string[]][] = [];
  for (const capability of sorted) {
    const area = capability.split(".")[0];
    const last = areas[areas.length - 1];
    if (last !== undefined && last[0] === area) last[1].push(capability);
    else areas.push([area, [capability]]);
  }

  /** Why the box cannot be changed here, or `null` when it can. */
  const reason = (capability: string): string | null => {
    if (own.has(capability)) return null;
    if (inherited.has(capability)) return THROUGH_USER;
    if (groupId === GUEST && capability in GUEST_INERT)
      return GUEST_INERT[capability];
    // Putting a stored row back is no change to the group (§5), so only a
    // right that would be new is the reader's to hold.
    if (!isAdmin && !held.has(capability) && !stored.has(capability))
      return NOT_HELD;
    return null;
  };

  return (
    <div className="perm-matrix">
      {areas.map(([area, names]) => (
        <Fragment key={area}>
          <h2 className="perm-area">
            <Icon
              name={AREA_ICONS[area] ?? "gear"}
              className="perm-area-icon"
            />
            {AREA_NAMES[area] ?? area}
          </h2>
          <ul className="perm-list">
            {names.map((capability) => {
              const description = DESCRIPTIONS[capability];
              const id = rowId(capability);
              const why = reason(capability);
              const reasonId = `${id}-reason`;
              const describedBy = [
                description === undefined ? null : id,
                why === null ? null : reasonId,
              ].filter((part) => part !== null);
              return (
                <li key={capability} className="perm-row">
                  <div className="perm-label">
                    {/* The area heading carries the noun, the row the verb;
                        the description spells both out. */}
                    <span className="perm-name">
                      {capability.slice(capability.indexOf(".") + 1)}
                    </span>
                    {description !== undefined && (
                      <p className="perm-description" id={id}>
                        {description}
                      </p>
                    )}
                  </div>
                  {/* A label, so the tap target is the whole 44px cell and not
                      just the 22px box. */}
                  <label className="perm-cell">
                    <input
                      type="checkbox"
                      aria-label={`${capability} for ${groupName}`}
                      aria-describedby={
                        describedBy.length === 0
                          ? undefined
                          : describedBy.join(" ")
                      }
                      checked={own.has(capability) || inherited.has(capability)}
                      disabled={why !== null}
                      title={why ?? undefined}
                      onChange={(event) =>
                        onToggle(capability, event.target.checked)
                      }
                    />
                    {why !== null && (
                      <span className="visually-hidden" id={reasonId}>
                        {why}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}
