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
  oidcConfigOptions,
  setPlayerAvatarMutation,
  updatePlayerMutation,
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
    "Only jpeg, png, and webp images work, and the file has to really be one.",
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

/** An account the identity provider answers for, rather than a password here. */
function isSingleSignOn(account: UserRead): boolean {
  return account.auth_provider === "oidc";
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
 * `players.view` shows the roster, `players.avatar` adds the pictures,
 * `players.manage` the new player and the guest deletions, `users.view` the
 * accounts behind the names and `users.manage` their roles and deletions. The
 * caller gates on at least one of the last four.
 */
export default function PeopleAdmin() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const mayViewPlayers = auth.can("players.view");
  const mayManagePlayers = auth.can("players.manage");
  // Everybody's picture, not the reader's own — that one is on the user page and
  // needs no right at all.
  const mayChangePictures = auth.can("players.avatar");
  const mayViewUsers = auth.can("users.view") || auth.can("users.manage");
  const mayManageUsers = auth.can("users.manage");

  const players = useQuery({
    ...listPlayersOptions(),
    // A direct navigation by somebody who may only manage accounts must not 403.
    enabled: auth.loaded && mayViewPlayers,
  });
  const users = useQuery({
    ...listUsersOptions(),
    enabled: auth.loaded && mayViewUsers,
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

  // Hiding is for the evening: it takes the player out of the singer picker and
  // their account's wishes off the wishlist, and their next login clears it again.
  const setHidden = useMutation({
    ...updatePlayerMutation(),
    onSuccess: () => {
      setAccountError(null);
      refreshPlayers();
    },
    onError: (cause) =>
      setAccountError(errorMessage(cause, "Could not change that player.")),
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
  // The name the login button carries, asked for only once an account here
  // actually signs in that way. Public and the login form's own cache entry.
  const anySingleSignOn = userList.some(isSingleSignOn);
  const oidc = useQuery({ ...oidcConfigOptions(), enabled: anySingleSignOn });
  const providerName = oidc.data?.display_name.trim() || "single sign-on";
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
  const showAccounts = accounts.length > 0 || mayViewUsers;
  const showGuests = guests.length > 0 || mayManagePlayers;
  // "Nobody yet" is a claim, and it needs the answers to be in: said while the
  // lists are still on their way it reads as a roster that lost its rows, and
  // said after a failure it is not true at all.
  const rosterKnown =
    (!mayViewPlayers || players.isSuccess) &&
    (!mayViewUsers || users.isSuccess);

  const row = (person: Person) => {
    const { key, name, player, account } = person;
    // Not the same as `account !== null`: a viewer without `users.view` sees
    // that somebody is registered but never the account itself.
    const registered = hasAccount(person);
    return (
      <li key={key}>
        <div className="people-row">
          {player !== null && mayChangePictures ? (
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
          <span
            className={
              player?.hidden ? "people-name people-name-hidden" : "people-name"
            }
          >
            {name}
            {account !== null && account.id === auth.user?.id && (
              <span className="people-you"> (you)</span>
            )}
            {/* Where the account's picture can come from and why it has no
                password to forget: the identity provider answers for it. */}
            {account !== null && isSingleSignOn(account) && (
              <span className="people-provider">
                Signs in with {providerName}
              </span>
            )}
          </span>
          {/* Out of sight for the evening: gone from the singer picker, and their
              account's wishes off the wishlist — the scores, the sessions and the
              statistics all keep naming them, and logging in puts them back. */}
          {player !== null && mayManagePlayers && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Hide ${name} from player selection`}
              aria-pressed={player.hidden}
              disabled={setHidden.isPending}
              onClick={() =>
                setHidden.mutate({
                  path: { player_id: player.id },
                  body: { hidden: !player.hidden },
                })
              }
            >
              <Icon name={player.hidden ? "eye-off" : "eye"} />
            </button>
          )}
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
          {/* The way out of a forgotten password, which has no reset flow: the
              player row survives the account and is picked up again by name. */}
          <p className="section-note">
            A forgotten password is no disaster: delete the account and register
            the same name again. The player keeps every score.
          </p>
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
          {/* Registering that name links this very player row, scores and all —
              `_attach_player` on the backend. Nobody has to be told to delete
              the guest first, so the note says so. */}
          <p className="section-note">
            A guest is taken over by whoever registers that name. The scores
            they sang tonight come along.
          </p>
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
