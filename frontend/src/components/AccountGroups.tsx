import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { GroupRead, UserList, UserRead } from "../api";
import {
  getMeQueryKey,
  listGroupsQueryKey,
  listUsersQueryKey,
  setUserGroupsMutation,
} from "../api/@tanstack/react-query.gen";
import { groupMessage } from "../errors";
import { ADMIN, addedRights, isAssignable } from "../groups";
import GroupSquare from "./GroupSquare";
import Modal from "./Modal";
import PickerRow from "./PickerRow";
import "./PickerRow.css";
import "./AccountGroups.css";

/** Why a row cannot be pressed, in its meta line — a disabled `PickerRow` has
 *  no other place for a reason. */
const ADMIN_ONLY = "Only an administrator can change this";
const NOT_HELD = "Carries a right you do not hold";

interface AccountGroupsProps {
  /** The account as the accounts listing has it now, so a write that landed
   *  redraws the rows. */
  account: UserRead;
  /** The name the row reads, the account's player or its username. */
  name: string;
  /** Every group, in the backend's one order (`GET /groups`). */
  groups: GroupRead[];
  /** Whether the reader is an administrator (rule 1). */
  isAdmin: boolean;
  onClose: () => void;
}

/**
 * *Groups of Fry* (permission-groups.md §9.2): the panel behind an account
 * row's groups button, one `PickerRow` per group somebody can be put in — every
 * one but Guest and User — a `plus` to put them in, a `check` on the ones the
 * account is in (`marks` `plus`: a person in a group, not a song on a list).
 *
 * A tap is one `PUT /users/{id}/groups` carrying the account's whole set with
 * that row flipped; every row waits for its round trip. Taking somebody out
 * of a group is never disabled but for Admin; putting them in is, for a reader
 * who is not an administrator, wherever the group carries a right they lack
 * (`can_assign`), and Admin is an administrator's either way. A refusal is one
 * notice in the panel.
 */
export default function AccountGroups({
  account,
  name,
  groups,
  isAdmin,
  onClose,
}: AccountGroupsProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const write = useMutation({
    ...setUserGroupsMutation(),
    onSuccess: (answered) => {
      setError(null);
      // The answer is the account as it now stands: into the listing at once,
      // so the pressed mark moves before the refetch comes back.
      queryClient.setQueryData<UserList>(listUsersQueryKey(), (old) =>
        old === undefined
          ? old
          : {
              ...old,
              users: old.users.map((user) =>
                user.id === answered.id ? answered : user,
              ),
            },
      );
      // `groups.changed` reaches every page too; this page should not wait
      // for the socket. The member counts and, for somebody editing their own
      // account, what this browser may do.
      for (const queryKey of [
        listUsersQueryKey(),
        listGroupsQueryKey(),
        getMeQueryKey(),
      ])
        void queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause) =>
      setError(groupMessage(cause, "Could not change the groups.")),
  });

  const assignable = groups.filter((group) => isAssignable(group.id));

  /** The meta line: what the group gives, or why the row cannot be pressed. */
  const reason = (group: GroupRead, member: boolean): string | null => {
    if (group.id === ADMIN && !isAdmin) return ADMIN_ONLY;
    if (!member && !group.can_assign) return NOT_HELD;
    return null;
  };

  return (
    <Modal title={`Groups of ${name}`} onClose={onClose}>
      <p className="section-note account-groups-note">
        A group adds its rights to what every account holds.
        {!isAdmin &&
          " Only an administrator puts somebody in Admin or takes them out."}
      </p>
      {error !== null && (
        <p className="error-notice account-groups-error" role="alert">
          {error}
        </p>
      )}
      <ul className="picker-list" aria-label={`Groups of ${name}`}>
        {assignable.map((group) => {
          const member = account.groups.includes(group.id);
          const why = reason(group, member);
          return (
            <PickerRow
              key={group.id}
              lead={<GroupSquare groupId={group.id} />}
              title={group.name}
              meta={why ?? addedRights(group)}
              pressed={member}
              marks="plus"
              // Every row waits for the round trip, the playlist picker's
              // way: the body is the whole set as the listing has it, so a
              // second tap before the first answer would send a set without
              // the first flip, and whichever answer landed last would win.
              disabled={why !== null || write.isPending}
              onClick={() => {
                setError(null);
                write.mutate({
                  path: { user_id: account.id },
                  body: {
                    // The whole set, with this row flipped.
                    groups: member
                      ? account.groups.filter((id) => id !== group.id)
                      : [...account.groups, group.id],
                  },
                });
              }}
            />
          );
        })}
      </ul>
    </Modal>
  );
}
