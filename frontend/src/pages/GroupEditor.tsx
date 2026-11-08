import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { GroupList, GroupRead, GroupUpdate } from "../api";
import {
  createGroupMutation,
  deleteGroupMutation,
  listGroupsQueryKey,
  updateGroupMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import EditorActions from "../components/EditorActions";
import GroupCapabilities from "../components/GroupCapabilities";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { errorDetail, groupMessage } from "../errors";
import { ADMIN, GUEST, USER, isBuiltIn } from "../groups";
import { useGroups } from "../hooks/useGroups";
import "./Tags.css";
import "./TagEditor.css";
import "./GroupEditor.css";

/** The longest a group name may get (`auth.permissions.MAX_GROUP_NAME_LENGTH`). */
const MAX_NAME_LENGTH = 32;

/** What a built-in is, in one line: the reason it has no name field and no
 *  Delete. Admin never gets here — it is not edited at all. */
const BUILT_IN_LINE: Record<string, string> = {
  [GUEST]:
    "Every phone without an account is a guest. A built-in group keeps its name.",
  [USER]:
    "Every account is in User, without being put there. A built-in group keeps its name.",
};

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

/** "3 accounts are", "1 account is". */
function accounts(count: number): string {
  return count === 1 ? "1 account is" : `${count} accounts are`;
}

/**
 * The group editor, at `/user/groups/new` and `/user/groups/:groupId`. Admin
 * holds every right by rule and has nothing to edit, so its address — which no
 * link leads to — replaces itself with the list.
 */
export default function GroupEditor() {
  const { groupId } = useParams();
  if (groupId === ADMIN) return <Navigate to="/user/groups" replace />;
  // Keyed, so walking from one group to another starts a fresh draft.
  return <Editor key={groupId ?? "new"} groupId={groupId} />;
}

/**
 * One group (permission-groups.md §9.1), in the tag editor's order: the name —
 * or, for Guest and User, the heading alone over one line saying a built-in
 * keeps its name — then every capability as one checkbox column, then, for a
 * group with members, where people are put in it, then the sticky Save with a
 * danger Delete beside it for a group that is not built in.
 *
 * Save sends the group's **own** rows alone: the stored ticks the reader left
 * on and the boxes they ticked. A box drawn ticked because User grants it is
 * never in the body, so saving a group never turns User's rights into rows of
 * its own. A gated §6 sub-page behind `permissions.manage`.
 */
function Editor({ groupId }: { groupId: string | undefined }) {
  const creating = groupId === undefined;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("permissions.manage");
  const groups = useGroups(allowed);
  const key = listGroupsQueryKey();

  // A create ends on the group it made, at a route of its own, so the fact
  // that the press landed travels with the navigation (the tag editor's way).
  const justCreated =
    (useLocation().state as { created?: boolean } | null)?.created === true;

  const found = groups.data?.groups.find((group) => group.id === groupId);
  const user = groups.data?.groups.find((group) => group.id === USER);
  const builtIn = groupId !== undefined && isBuiltIn(groupId);

  const [name, setName] = useState("");
  const [own, setOwn] = useState<Set<string>>(new Set());
  const [base, setBase] = useState<{ name: string; own: Set<string> }>({
    name: "",
    own: new Set(),
  });
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Take the draft from a group the server answered with. */
  const seedFrom = (group: GroupRead) => {
    const rows = new Set(group.capabilities ?? []);
    setName(group.name);
    setOwn(rows);
    setBase({ name: group.name.trim(), own: new Set(rows) });
  };

  // Seeded once: a `groups.changed` refetch while somebody is ticking must not
  // move the boxes under their hand.
  if (!seeded && (creating ? groups.isSuccess : found !== undefined)) {
    setSeeded(true);
    if (found !== undefined) seedFrom(found);
  }

  const create = useMutation(createGroupMutation());
  const update = useMutation(updateGroupMutation());
  const remove = useMutation({
    ...deleteGroupMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void navigate("/user/groups");
    },
    onError: (cause) =>
      setError(groupMessage(cause, "Could not delete the group.")),
  });

  const trimmed = name.trim();
  // In the catalogue's order, so a body reads like the page.
  const catalogue = groups.data?.capabilities ?? [];
  const ownRows = catalogue.filter((capability) => own.has(capability));
  const nameChanged = !builtIn && trimmed !== base.name;
  const rowsChanged = !sameSet(own, base.own);
  const pending = creating || nameChanged || rowsChanged;
  const acknowledged = saved || (justCreated && !pending && !saving);
  // A group that adds to User draws User's rights ticked and locked; Guest and
  // User are bundles of their own and draw only their rows.
  const inherited = new Set(builtIn ? [] : (user?.capabilities ?? []));
  const held = new Set(auth.capabilities);

  const saveNote = saving
    ? "Saving…"
    : !builtIn && trimmed === ""
      ? "It needs a name before it can be saved."
      : error !== null
        ? "It did not go through. The message at the top of the page says why."
        : !pending && !acknowledged
          ? "Nothing has changed yet."
          : null;
  const saveDisabled = (!builtIn && trimmed === "") || !pending || saving;

  const refusal = (cause: unknown): string =>
    errorDetail(cause) === "duplicate_group_name"
      ? `A group called "${trimmed}" already exists. Pick another name.`
      : groupMessage(cause, "Could not save the group.");

  const save = async () => {
    if (saveDisabled) return;
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const made = await create.mutateAsync({
          body: { name: trimmed, capabilities: ownRows },
        });
        // Into the cache before the route changes, so the editor at the new
        // address has its group before the refetch answers.
        queryClient.setQueryData<GroupList>(key, (old) =>
          old === undefined
            ? old
            : {
                ...old,
                groups: [
                  ...old.groups.filter((group) => group.id !== made.id),
                  made,
                ],
              },
        );
        void queryClient.invalidateQueries({ queryKey: key });
        // REPLACE (§6): `/new` stands in for the group it became.
        void navigate(`/user/groups/${encodeURIComponent(made.id)}`, {
          replace: true,
          state: { created: true },
        });
        return;
      }
      const body: GroupUpdate = {};
      if (nameChanged) body.name = trimmed;
      if (rowsChanged) body.capabilities = ownRows;
      const answered = await update.mutateAsync({
        path: { group_id: groupId },
        body,
      });
      seedFrom(answered);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setSaved(false);
      setError(refusal(cause));
    } finally {
      setSaving(false);
    }
  };

  // Only once the listing answered and still does not know this group: a
  // draft already seeded keeps its form.
  const gone = !creating && groups.isSuccess && found === undefined && !seeded;
  const members = found?.member_count ?? 0;
  const title = creating
    ? "New group"
    : builtIn
      ? (found?.name ?? "")
      : "Edit group";

  return (
    <div className="tags-page tag-editor group-editor">
      <PageHeader title={title} back="/user/groups" />

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {!allowed && (
            <p className="settings-notice">
              Groups are the host's to set up. Ask the host for access.
            </p>
          )}

          {allowed && (
            <>
              {groups.isPending && <Loading />}

              {groups.isError && (
                <p className="error-notice tags-notice" role="alert">
                  Could not load the groups.
                </p>
              )}

              {gone && (
                <p className="error-notice tags-notice" role="alert">
                  This group is gone.{" "}
                  <Link to="/user/groups">Back to the groups</Link>
                </p>
              )}

              {seeded && (
                <>
                  {error && (
                    <p className="error-notice tags-notice" role="alert">
                      {error}
                    </p>
                  )}

                  <form
                    className="tag-editor-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    {builtIn ? (
                      <p className="tag-editor-hint">
                        {BUILT_IN_LINE[groupId] ?? ""}
                      </p>
                    ) : (
                      <label className="tag-editor-field">
                        <span>Name</span>
                        <input
                          className="text-input text-input-quiet"
                          value={name}
                          maxLength={MAX_NAME_LENGTH}
                          onChange={(event) => {
                            setSaved(false);
                            setName(event.target.value);
                          }}
                        />
                      </label>
                    )}

                    <GroupCapabilities
                      groupId={groupId ?? ""}
                      groupName={creating ? trimmed || "the new group" : name}
                      catalogue={catalogue}
                      own={own}
                      stored={base.own}
                      inherited={inherited}
                      isAdmin={auth.isAdmin}
                      held={held}
                      onToggle={(capability, granted) => {
                        setSaved(false);
                        setOwn((old) => {
                          const next = new Set(old);
                          if (granted) next.add(capability);
                          else next.delete(capability);
                          return next;
                        });
                      }}
                    />

                    {/* Membership is the accounts page's alone: one write
                        path, one place where its rules are checked. */}
                    {!builtIn && members > 0 && (
                      <p className="section-note group-editor-members">
                        {accounts(members)} in this group. Put people in it on{" "}
                        <Link to="/user/accounts">Players &amp; accounts</Link>.
                      </p>
                    )}

                    <EditorActions
                      note={saveNote}
                      saved={acknowledged}
                      saveDisabled={saveDisabled}
                    >
                      {!creating && !builtIn && (
                        <button
                          type="button"
                          className="button button-danger"
                          disabled={remove.isPending}
                          onClick={() => setDeleting(true)}
                        >
                          Delete group
                        </button>
                      )}
                    </EditorActions>
                  </form>
                </>
              )}
            </>
          )}
        </>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete group"
          message={
            members === 0
              ? `Delete the group "${base.name}"? Nobody is in it.`
              : members === 1
                ? `Delete the group "${base.name}"? Its one member loses the rights it gives them. Their account stays.`
                : `Delete the group "${base.name}"? Its ${members} members lose the rights it gives them. Their accounts stay.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(false);
            remove.mutate({ path: { group_id: groupId ?? "" } });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
