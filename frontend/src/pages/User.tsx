import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PlayerRead } from "../api";
import {
  deletePlayerMutation,
  listPlayersOptions,
  listPlayersQueryKey,
  logoutMutation,
  setPlayerAvatarMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AddPlayerForm from "../components/AddPlayerForm";
import ConfirmModal from "../components/ConfirmModal";
import { Icon, type IconName } from "../components/icons";
import LoginForm from "../components/LoginForm";
import PlayerAvatar from "../components/PlayerAvatar";
import { errorDetail, errorMessage } from "../errors";
import "./User.css";

/** Mirrors the backend's limit so an oversized file never leaves the browser. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_MESSAGES: Record<string, string> = {
  avatar_too_large: "That image is larger than 5 MB.",
  unsupported_avatar_type:
    "Only jpeg, png and webp images work — and the file has to really be one.",
};

const SSO_ERROR_PREFIX = "error:";

/**
 * The slugs `auth/oidc.py` sends the browser home with. Coarse on purpose over
 * there, so these say what the singer can do about it rather than which check
 * refused the token.
 */
const SSO_MESSAGES: Record<string, string> = {
  oidc_disabled: "Single sign-on is switched off. Log in with a name instead.",
  provider_error: "The login provider refused the sign-in.",
  invalid_request: "That sign-in came back incomplete. Try again.",
  invalid_state: "That sign-in took too long or was already used. Try again.",
  discovery_failed:
    "Wingman could not reach the login provider. Ask the host to check the SSO settings.",
  token_failed: "The login provider did not finish the sign-in. Try again.",
  invalid_token:
    "The login provider's answer could not be trusted, so nobody was logged in.",
  login_failed: "The sign-in did not work. Try again.",
};

/** The admin surfaces, one navigation row each — never inline on this page. */
const MENU: {
  capability: string;
  label: string;
  to: string;
  icon: IconName;
}[] = [
  {
    capability: "settings.view",
    label: "Settings",
    to: "/settings",
    icon: "gear",
  },
  {
    capability: "users.manage",
    label: "Accounts",
    to: "/user/accounts",
    icon: "users",
  },
  {
    capability: "permissions.manage",
    label: "Permissions",
    to: "/user/permissions",
    icon: "shield",
  },
];

export default function User() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  // Read once, before the effect below strips it: the outcome of a redirect
  // login is a one-off event, not page state a reload should repeat.
  const [outcome] = useState(() => params.get("login"));
  useEffect(() => {
    if (!params.has("login")) return;
    // A copy: mutating the hook's own instance is a router footgun.
    const remaining = new URLSearchParams(params);
    remaining.delete("login");
    setParams(remaining, { replace: true });
  }, [params, setParams]);

  // `login=ok` needs no handling: the callback set the cookie before
  // redirecting, so this page load already asks /auth/me as the new account.
  const ssoError = outcome?.startsWith(SSO_ERROR_PREFIX)
    ? (SSO_MESSAGES[outcome.slice(SSO_ERROR_PREFIX.length)] ??
      SSO_MESSAGES.login_failed)
    : null;
  const players = useQuery(listPlayersOptions());
  const [showLogin, setShowLogin] = useState(false);
  const [deleting, setDeleting] = useState<PlayerRead | null>(null);
  const [avatarError, setAvatarError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });

  const logOut = useMutation({
    ...logoutMutation(),
    // Every cached answer belonged to the account that just left.
    onSettled: () => void queryClient.invalidateQueries(),
  });

  const deletePlayer = useMutation({
    ...deletePlayerMutation(),
    onSuccess: refresh,
  });

  const setAvatar = useMutation({
    ...setPlayerAvatarMutation(),
    onSuccess: () => {
      setAvatarError(null);
      refresh();
    },
    onError: (error, variables) =>
      setAvatarError({
        id: variables.path.player_id,
        message:
          AVATAR_MESSAGES[errorDetail(error) ?? ""] ??
          errorMessage(error, "Could not upload the image."),
      }),
  });

  const upload = (player: PlayerRead, file: File | undefined): void => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError({
        id: player.id,
        message: AVATAR_MESSAGES.avatar_too_large,
      });
      return;
    }
    setAvatar.mutate({ path: { player_id: player.id }, body: { file } });
  };

  const managePlayers = auth.can("players.manage");
  const ownPlayer =
    players.data?.players.find(
      (player) => player.id === auth.user?.player_id,
    ) ?? null;
  // `loaded` on every gate: `can` says yes until /auth/me answered, and a guest
  // must not see the admin rows (or their requests) at all.
  const menuRows = auth.loaded
    ? MENU.filter((row) => auth.can(row.capability))
    : [];

  return (
    <>
      {/* Nothing until /auth/me answered, so no identity state flashes. */}
      {auth.loaded &&
        (auth.user !== null ? (
          <div className="user-identity">
            <PlayerAvatar player={ownPlayer} className="user-identity-avatar" />
            <h1 className="user-identity-name">{auth.user.username}</h1>
            <p className="user-identity-role">{auth.user.role}</p>
            <button
              type="button"
              className="button"
              disabled={logOut.isPending}
              onClick={() => logOut.mutate({})}
            >
              Log out
            </button>
          </div>
        ) : auth.isHost ? (
          <>
            <div className="user-identity">
              <span
                className="user-identity-avatar user-identity-shield"
                aria-hidden="true"
              >
                <Icon name="shield" />
              </span>
              <h1 className="user-identity-name">Host screen</h1>
              <p className="user-identity-role">
                This browser has full access.
              </p>
              {!showLogin && (
                <button
                  type="button"
                  className="user-identity-switch"
                  onClick={() => setShowLogin(true)}
                >
                  Log in as a user instead
                </button>
              )}
            </div>
            {showLogin && <LoginForm ssoError={ssoError} />}
          </>
        ) : (
          <>
            <h1>You</h1>
            <LoginForm ssoError={ssoError} />
          </>
        ))}

      {menuRows.length > 0 && (
        <>
          <h2>Manage</h2>
          <nav className="user-menu">
            {menuRows.map((row) => (
              <Link key={row.to} className="user-menu-row" to={row.to}>
                <Icon name={row.icon} className="user-menu-icon" />
                <span className="user-menu-label">{row.label}</span>
                <Icon name="chevron-right" className="user-menu-icon" />
              </Link>
            ))}
          </nav>
        </>
      )}

      <h2>Players</h2>
      {managePlayers && <AddPlayerForm />}

      {players.isError && (
        <p className="error-notice players-notice" role="alert">
          Could not load the players.
        </p>
      )}

      {players.data?.players.length === 0 && (
        <p className="players-empty">No players yet.</p>
      )}

      <ul className="players-list">
        {(players.data?.players ?? []).map((player) => (
          <li key={player.id}>
            <div className="players-row">
              {managePlayers ? (
                // The avatar itself is the upload target; the pencil badge is
                // the affordance the old text button used to be.
                <label className="players-avatar-label">
                  <PlayerAvatar player={player} />
                  <Icon name="pencil" className="players-avatar-hint" />
                  <input
                    type="file"
                    className="visually-hidden"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={`Avatar for ${player.name}`}
                    onChange={(event) =>
                      upload(player, event.target.files?.[0] ?? undefined)
                    }
                  />
                </label>
              ) : (
                <PlayerAvatar player={player} />
              )}
              <span className="players-name">{player.name}</span>
              {managePlayers && (
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label={`Delete ${player.name}`}
                  onClick={() => setDeleting(player)}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
            {avatarError?.id === player.id && (
              <p className="error-notice players-notice" role="alert">
                {avatarError.message}
              </p>
            )}
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmModal
          title="Delete player"
          message={`Delete "${deleting.name}"? Recorded scores keep the name.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deletePlayer.mutate({ path: { player_id: deleting.id } });
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
