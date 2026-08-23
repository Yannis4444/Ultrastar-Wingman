import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { UserRead } from "../api";
import {
  deleteUserMutation,
  getMeQueryKey,
  listUsersOptions,
  listUsersQueryKey,
  updateUserMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage } from "../errors";
import ConfirmModal from "./ConfirmModal";
import "./UsersAdmin.css";

/** `guest` is the anonymous fallback, not an account role — the backend rejects it. */
const ASSIGNABLE_ROLES = ["user", "trusted", "admin"];

function message(error: unknown, fallback: string): string {
  return errorDetail(error) === "last_admin"
    ? "There has to be one administrator left."
    : errorMessage(error, fallback);
}

/** Accounts, their roles and the delete button. Needs `users.manage`. */
export default function UsersAdmin() {
  const queryClient = useQueryClient();
  const users = useQuery(listUsersOptions());
  const [deleting, setDeleting] = useState<UserRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: listUsersQueryKey() });
    // Demoting or deleting yourself changes what the rest of the UI may show.
    void queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
  };

  const setRole = useMutation({
    ...updateUserMutation(),
    onSuccess: refresh,
    onError: (cause) => setError(message(cause, "Could not change the role.")),
  });

  const remove = useMutation({
    ...deleteUserMutation(),
    onSuccess: refresh,
    onError: (cause) => setError(message(cause, "Could not delete the user.")),
  });

  return (
    <>
      <h2>Accounts</h2>

      {(users.isError || error) && (
        <p className="error-notice users-notice" role="alert">
          {error ?? "Could not load the accounts."}
        </p>
      )}

      <ul className="users-list">
        {(users.data?.users ?? []).map((user) => (
          <li key={user.id} className="users-row">
            <span className="users-name">{user.username}</span>
            <select
              className="text-input"
              aria-label={`Role of ${user.username}`}
              value={user.role}
              disabled={setRole.isPending}
              onChange={(event) =>
                setRole.mutate({
                  path: { user_id: user.id },
                  body: { role: event.target.value },
                })
              }
            >
              {(ASSIGNABLE_ROLES.includes(user.role)
                ? ASSIGNABLE_ROLES
                : [user.role, ...ASSIGNABLE_ROLES]
              ).map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button-danger"
              aria-label={`Delete account ${user.username}`}
              onClick={() => setDeleting(user)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmModal
          title="Delete account"
          message={`Delete the account "${deleting.username}"? Its player stays as a temporary one, so the scores keep an owner.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            remove.mutate({ path: { user_id: deleting.id } });
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
