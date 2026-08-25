import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { PlayerRead, UserRead } from "../api";
import {
  deletePlayerMutation,
  deleteUserMutation,
  getMeQueryKey,
  listPlayersOptions,
  listPlayersQueryKey,
  listUsersOptions,
  listUsersQueryKey,
  setPlayerAvatarMutation,
  updateUserMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail, errorMessage } from "../errors";
import AddPlayerForm from "./AddPlayerForm";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import PlayerAvatar from "./PlayerAvatar";
import "./PeopleAdmin.css";

/** `guest` is the anonymous fallback, not an account role — the backend rejects it. */
const ASSIGNABLE_ROLES = ["user", "trusted", "admin"];

/** Mirrors the backend's limit so an oversized file never leaves the browser. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_MESSAGES: Record<string, string> = {
  avatar_too_large: "That image is larger than 5 MB.",
  avatar_too_many_pixels:
    "That picture has far too many pixels. Scale it down and try again.",
  unsupported_avatar_type:
    "Only jpeg, png and webp images work — and the file has to really be one.",
};

/**
 * One person in the party: the player they sing as, the account they log in with,
 * or — while an account's player is missing — only the account.
 */
interface Person {
  key: string;
  name: string;
  player: PlayerRead | null;
  account: UserRead | null;
}

function accountMessage(error: unknown, fallback: string): string {
  return errorDetail(error) === "last_admin"
    ? "There has to be one administrator left."
    : errorMessage(error, fallback);
}

/**
 * Whether this person logs in. `registered` says so on its own, so the split
 * survives a viewer who may see the players but not the accounts behind them.
 */
function hasAccount(person: Person): boolean {
  return person.account !== null || person.player?.registered === true;
}

function byName(one: Person, other: Person): number {
  return one.name.localeCompare(other.name);
}

/**
 * Everybody who sings, in two sections: the accounts and the guests. Players and
 * accounts are the same people seen from two sides — a registered player *is* an
 * account — so they belong in one list, and the section is the mark that says
 * which is which.
 *
 * `players.view` shows the roster, `players.manage` adds the pictures, the new
 * player and the guest deletions, `users.manage` adds the roles and the account
 * deletions. The caller gates on at least one of them.
 */
export default function PeopleAdmin() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const mayViewPlayers = auth.can("players.view");
  const mayManagePlayers = auth.can("players.manage");
  const mayManageUsers = auth.can("users.manage");

  const players = useQuery({
    ...listPlayersOptions(),
    // A direct navigation by somebody who may only manage accounts must not 403.
    enabled: auth.loaded && mayViewPlayers,
  });
  const users = useQuery({
    ...listUsersOptions(),
    enabled: auth.loaded && mayManageUsers,
  });

  const [deletingPlayer, setDeletingPlayer] = useState<PlayerRead | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<UserRead | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  // Which row the message belongs under, not which player it is about: every row
  // has an uploader of its own, and the failure has to show up under the one
  // that was used.
  const [avatarError, setAvatarError] = useState<{
    target: string;
    message: string;
  } | null>(null);
  // The mutation's own `variables` only carry the player id, so the target of
  // the upload in flight is remembered here for `onError`.
  const avatarTarget = useRef("");

  const refreshPlayers = (): void =>
    void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });

  const refreshAccounts = (): void => {
    setAccountError(null);
    void queryClient.invalidateQueries({ queryKey: listUsersQueryKey() });
    // Deleting an account unlinks its player, and demoting or deleting yourself
    // changes what the rest of the UI may show.
    void queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
    refreshPlayers();
  };

  const setRole = useMutation({
    ...updateUserMutation(),
    onSuccess: refreshAccounts,
    onError: (cause) =>
      setAccountError(accountMessage(cause, "Could not change the role.")),
  });

  const removeAccount = useMutation({
    ...deleteUserMutation(),
    onSuccess: refreshAccounts,
    onError: (cause) =>
      setAccountError(accountMessage(cause, "Could not delete the account.")),
  });

  const removePlayer = useMutation({
    ...deletePlayerMutation(),
    onSuccess: refreshPlayers,
  });

  const setAvatar = useMutation({
    ...setPlayerAvatarMutation(),
    onSuccess: () => {
      setAvatarError(null);
      refreshPlayers();
    },
    onError: (error) =>
      setAvatarError({
        target: avatarTarget.current,
        message:
          AVATAR_MESSAGES[errorDetail(error) ?? ""] ??
          errorMessage(error, "Could not upload the image."),
      }),
  });

  const upload = (player: PlayerRead, input: HTMLInputElement): void => {
    const file = input.files?.[0];
    // Cleared right away, so picking the very same file again after a rejection
    // is another change event and not a click that does nothing.
    input.value = "";
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError({
        target: player.id,
        message: AVATAR_MESSAGES.avatar_too_large,
      });
      return;
    }
    avatarTarget.current = player.id;
    setAvatar.mutate({ path: { player_id: player.id }, body: { file } });
  };

  const playerList = players.data?.players ?? [];
  const userList = users.data?.users ?? [];
  const accountByPlayer = new Map<string, UserRead>();
  for (const user of userList) {
    if (user.player_id !== null) accountByPlayer.set(user.player_id, user);
  }
  const people: Person[] = playerList.map((player) => ({
    key: player.id,
    name: player.name,
    player,
    account: accountByPlayer.get(player.id) ?? null,
  }));
  // An account whose player was deleted — and every account at all when the
  // viewer may not see the players — still has to be listable.
  const playerIds = new Set(playerList.map((player) => player.id));
  const withoutPlayer: Person[] = userList
    .filter((user) => user.player_id === null || !playerIds.has(user.player_id))
    .map((user) => ({
      key: user.id,
      name: user.username,
      player: null,
      account: user,
    }));

  const accounts = [...people.filter(hasAccount), ...withoutPlayer].sort(
    byName,
  );
  const guests = people.filter((person) => !hasAccount(person));
  // A heading with nothing under it still says the category exists; without the
  // right to see or add anything in it, it says nothing at all.
  const showAccounts = accounts.length > 0 || mayManageUsers;
  const showGuests = guests.length > 0 || mayManagePlayers;
  // "Nobody yet" is a claim, and it needs the answers to be in: said while the
  // lists are still on their way it reads as a roster that lost its rows, and
  // said after a failure it is not true at all.
  const rosterKnown =
    (!mayViewPlayers || players.isSuccess) &&
    (!mayManageUsers || users.isSuccess);

  const row = (person: Person) => {
    const { key, name, player, account } = person;
    // Not the same as `account !== null`: a viewer without `users.manage` sees
    // that somebody is registered but never the account itself.
    const registered = hasAccount(person);
    return (
      <li key={key}>
        <div className="people-row">
          {player !== null && mayManagePlayers ? (
            // The avatar itself is the upload target; the `image` badge is the
            // affordance the old text button used to be.
            <label className="people-avatar-label">
              <PlayerAvatar player={player} />
              <Icon name="image" className="people-avatar-hint" />
              <input
                type="file"
                className="visually-hidden"
                accept="image/jpeg,image/png,image/webp"
                aria-label={`Avatar for ${name}`}
                onChange={(event) => upload(player, event.target)}
              />
            </label>
          ) : (
            <PlayerAvatar player={player} />
          )}
          <span className="people-name">
            {name}
            {account !== null && account.id === auth.user?.id && (
              <span className="people-you"> (you)</span>
            )}
          </span>
          {account !== null && mayManageUsers && (
            <span className="people-role-wrap">
              <select
                className="people-role"
                aria-label={`Role of ${name}`}
                value={account.role}
                disabled={setRole.isPending}
                onChange={(event) =>
                  setRole.mutate({
                    path: { user_id: account.id },
                    body: { role: event.target.value },
                  })
                }
              >
                {(ASSIGNABLE_ROLES.includes(account.role)
                  ? ASSIGNABLE_ROLES
                  : [account.role, ...ASSIGNABLE_ROLES]
                ).map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" />
            </span>
          )}
          {/* Somebody registered is deleted as an account: that keeps the player,
            as a guest, and only then can the player itself go. Deleting it
            straight away would leave an account without one. */}
          {registered
            ? account !== null &&
              mayManageUsers && (
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label={`Delete account ${name}`}
                  onClick={() => setDeletingAccount(account)}
                >
                  <Icon name="trash" />
                </button>
              )
            : player !== null &&
              mayManagePlayers && (
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label={`Delete ${name}`}
                  onClick={() => setDeletingPlayer(player)}
                >
                  <Icon name="trash" />
                </button>
              )}
        </div>
        {player !== null && avatarError?.target === player.id && (
          <p className="error-notice people-notice" role="alert">
            {avatarError.message}
          </p>
        )}
      </li>
    );
  };

  return (
    <>
      {(players.isError || users.isError || accountError) && (
        <p className="error-notice people-notice" role="alert">
          {accountError ??
            (players.isError
              ? "Could not load the players."
              : "Could not load the accounts.")}
        </p>
      )}

      {rosterKnown && !showAccounts && !showGuests && (
        <p className="people-empty">No players yet.</p>
      )}

      {showAccounts && (
        <>
          {/* The heading names its list, so which section a row stands in is
              read out and not only seen. */}
          <h2 id="people-accounts">Accounts</h2>
          {accounts.length > 0 ? (
            <ul className="people-list" aria-labelledby="people-accounts">
              {accounts.map(row)}
            </ul>
          ) : (
            rosterKnown && (
              <p className="people-empty">Nobody has registered yet.</p>
            )
          )}
        </>
      )}

      {showGuests && (
        <>
          <h2 id="people-guests">Guests</h2>
          {mayManagePlayers && <AddPlayerForm />}
          {guests.length > 0 ? (
            <ul className="people-list" aria-labelledby="people-guests">
              {guests.map(row)}
            </ul>
          ) : (
            rosterKnown && <p className="people-empty">No guests yet.</p>
          )}
        </>
      )}

      {deletingPlayer && (
        <ConfirmModal
          title="Delete player"
          message={`Delete "${deletingPlayer.name}"? Recorded scores keep the name.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            removePlayer.mutate({ path: { player_id: deletingPlayer.id } });
            setDeletingPlayer(null);
          }}
          onCancel={() => setDeletingPlayer(null)}
        />
      )}

      {deletingAccount && (
        <ConfirmModal
          title="Delete account"
          message={`Delete the account "${deletingAccount.username}"? Its player stays as a guest, so the scores keep an owner.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            removeAccount.mutate({ path: { user_id: deletingAccount.id } });
            setDeletingAccount(null);
          }}
          onCancel={() => setDeletingAccount(null)}
        />
      )}
    </>
  );
}
