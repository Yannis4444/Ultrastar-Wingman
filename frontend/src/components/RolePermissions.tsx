import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { GroupList } from "../api";
import {
  listGroupsOptions,
  listGroupsQueryKey,
  updateGroupMutation,
} from "../api/@tanstack/react-query.gen";
import { errorMessage } from "../errors";
import { Icon, type IconName } from "./icons";
import "./RolePermissions.css";

/** The backend hardwires Admin to every capability, so it is never editable.
 * A stopgap until the groups page (permission-groups.md §9.1): the matrix runs
 * over every other group `GET /groups` answers, in its order. */
const LOCKED_GROUP = "admin";

/** One glyph per section, so a group is found by shape before it is read.
 * Existing icon names only. */
const GROUP_ICONS: Record<string, IconName> = {
  achievements: "trophy",
  songs: "music",
  karaoke: "mic",
  // `songs` already owns the `music` glyph; labelling a group is a job.
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

/** Groups whose name is not simply their capitalized prefix. */
const GROUP_NAMES: Record<string, string> = { usdb: "USDB" };

/**
 * What a capability actually lets somebody do, in the words the user handbook
 * uses. The row itself only carries the verb (the group heading carries the
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
    "Put other accounts in groups and take them out, and delete them.",
  "permissions.manage": "Change this table.",
};

/**
 * Why a grant would do nothing, or `null` when it works. The backend accepts
 * every capability for every editable role, but some rights are about a row that
 * belongs to somebody: creating a playlist goes through `account_id` (401
 * without an account), and both a favorite and an own-player picture need an
 * account to belong to. Ticking those for `guest` would be a lie, so the box is
 * disabled — unless the value is already on, which has to stay clearable.
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

function inertReason(role: string, capability: string): string | null {
  return role === "guest" ? (GUEST_INERT[capability] ?? null) : null;
}

/** Ids have to survive in an `aria-describedby` list, where a space separates
 * entries — dots are fine, but keep the shape simple. */
function rowId(capability: string): string {
  return `perm-${capability.replace(".", "-")}`;
}

/** The whole group/capability matrix: one row per capability, one column per
 * editable group. Needs `permissions.manage`; the page around it gates. */
export default function RolePermissions() {
  const queryClient = useQueryClient();
  const key = listGroupsQueryKey();
  const permissions = useQuery(listGroupsOptions());
  const [error, setError] = useState<string | null>(null);
  // The row that was last written and how it went, for the acknowledgement next
  // to its name — the notice above the matrix is out of sight from most rows.
  const [ack, setAck] = useState<{ capability: string; ok: boolean } | null>(
    null,
  );
  // The snapshot to restore when a PUT fails. A ref, not the mutation context,
  // because the generated mutation options fix the context type to `unknown`.
  const rollback = useRef<GroupList | undefined>(undefined);

  const save = useMutation({
    ...updateGroupMutation(),
    onMutate: async (variables) => {
      // Without this a request already in flight can land after the optimistic
      // write and put the old checkboxes back.
      await queryClient.cancelQueries({ queryKey: key });
      rollback.current = queryClient.getQueryData<GroupList>(key);
      setError(null);
      queryClient.setQueryData<GroupList>(key, (old) =>
        old === undefined
          ? old
          : {
              ...old,
              groups: old.groups.map((group) =>
                group.id === variables.path.group_id
                  ? {
                      ...group,
                      capabilities: variables.body.capabilities ?? null,
                    }
                  : group,
              ),
            },
      );
    },
    // The answer is the one group; the rest of the list (counts) refetches.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (cause) => {
      queryClient.setQueryData<GroupList>(key, rollback.current);
      setError(errorMessage(cause, "Could not save the permissions."));
    },
  });

  // "Saved" is an acknowledgement, not a state — it fades after a moment. A
  // failure stays until the next tick: it is the reason the box jumped back.
  useEffect(() => {
    if (ack === null || !ack.ok) return;
    const timer = setTimeout(() => setAck(null), 2000);
    return () => clearTimeout(timer);
  }, [ack]);

  const data = permissions.data;
  const roles: Record<string, string[]> | undefined =
    data === undefined
      ? undefined
      : Object.fromEntries(
          data.groups.map((group) => [group.id, group.capabilities ?? []]),
        );
  const groupNames: Record<string, string> = Object.fromEntries(
    (data?.groups ?? []).map((group) => [group.id, group.name]),
  );
  // In the backend's one order: Guest, User, the others by name.
  const columns = (data?.groups ?? [])
    .map((group) => group.id)
    .filter((id) => id !== LOCKED_GROUP);
  // The catalogue, sorted, so same-prefix capabilities sit together.
  const capabilities = [...(data?.capabilities ?? [])].sort();
  const groups: [string, string[]][] = [];
  for (const capability of capabilities) {
    const group = capability.split(".")[0];
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0] === group) last[1].push(capability);
    else groups.push([group, [capability]]);
  }

  const toggle = (role: string, capability: string, granted: boolean): void => {
    const current = roles?.[role] ?? [];
    save.mutate(
      {
        path: { group_id: role },
        body: {
          capabilities: granted
            ? [...current, capability]
            : current.filter((name) => name !== capability),
        },
      },
      // Per row, so the acknowledgement lands where the tick happened.
      {
        onSuccess: () => setAck({ capability, ok: true }),
        onError: () => setAck({ capability, ok: false }),
      },
    );
  };

  return (
    <>
      {(permissions.isError || error) && (
        <p className="error-notice permissions-notice" role="alert">
          {error ?? "Could not load the permissions."}
        </p>
      )}

      {roles && columns.length > 0 && (
        <div
          className="perm-matrix"
          style={{ "--perm-roles": columns.length } as CSSProperties}
        >
          <p className="perm-hint">
            Every tick is saved right away. Admins are not in the table: they
            always hold every right, so nothing here can lock the host out.
          </p>
          {/* Decoration: every checkbox names its own role and capability. */}
          <div className="perm-head" aria-hidden="true">
            <span />
            {columns.map((role) => (
              <span
                key={role}
                className="perm-head-role"
                title={groupNames[role] ?? role}
              >
                {groupNames[role] ?? role}
              </span>
            ))}
          </div>
          {groups.map(([group, names]) => (
            <Fragment key={group}>
              <h2 className="perm-group">
                <Icon
                  name={GROUP_ICONS[group] ?? "gear"}
                  className="perm-group-icon"
                />
                {GROUP_NAMES[group] ?? group}
              </h2>
              <ul className="perm-list">
                {names.map((capability) => {
                  const description = DESCRIPTIONS[capability];
                  const id = rowId(capability);
                  return (
                    <li key={capability} className="perm-row">
                      <div className="perm-label">
                        <span className="perm-line">
                          {/* The group heading carries the noun, the row the
                              verb; the description spells both out. */}
                          <span className="perm-name">
                            {capability.slice(capability.indexOf(".") + 1)}
                          </span>
                          {ack?.capability === capability &&
                            (ack.ok ? (
                              <span className="perm-saved" role="status">
                                Saved
                              </span>
                            ) : (
                              // No live region: the notice above the matrix
                              // already announces the failure.
                              <span className="perm-failed">Not saved</span>
                            ))}
                        </span>
                        {description !== undefined && (
                          <p className="perm-description" id={id}>
                            {description}
                          </p>
                        )}
                      </div>
                      {columns.map((role) => {
                        const granted =
                          roles[role]?.includes(capability) ?? false;
                        const reason = inertReason(role, capability);
                        const locked = reason !== null && !granted;
                        const reasonId = `${id}-${role}-reason`;
                        const describedBy = [
                          description === undefined ? null : id,
                          locked ? reasonId : null,
                        ].filter((part) => part !== null);
                        return (
                          // A label, so the tap target is the whole 44px cell
                          // and not just the 22px box.
                          <label className="perm-cell" key={role}>
                            <input
                              type="checkbox"
                              aria-label={`${capability} for ${groupNames[role] ?? role}`}
                              aria-describedby={
                                describedBy.length === 0
                                  ? undefined
                                  : describedBy.join(" ")
                              }
                              checked={granted}
                              disabled={locked}
                              title={reason ?? undefined}
                              onChange={(event) =>
                                toggle(role, capability, event.target.checked)
                              }
                            />
                            {locked && (
                              <span className="visually-hidden" id={reasonId}>
                                {reason}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
