import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PlayerRead } from "../api";
import {
  healthOptions,
  listPlayerScoresOptions,
  listPlayersOptions,
  listPlayersQueryKey,
  logoutMutation,
  setPlayerAvatarMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import IconStat from "../components/IconStat";
import { Icon } from "../components/icons";
import LoginForm from "../components/LoginForm";
import ManageMenu from "../components/ManageMenu";
import PlayerAvatar from "../components/PlayerAvatar";
import ScoreHistogram from "../components/ScoreHistogram";
import UserAchievements from "../components/UserAchievements";
import { errorDetail, errorMessage } from "../errors";
import { REPOSITORY_URL } from "../links";
import { manageEntries } from "../manage";
import { playerSummary } from "../stats";
import "./User.css";

/** Mirrors the backend's limit so an oversized file never leaves the browser. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** The `ScoreGroupList` threshold, verbatim: a couple of bars across twenty
 * buckets is noise rather than a shape. */
const HISTOGRAM_MIN_SCORES = 4;

const AVATAR_MESSAGES: Record<string, string> = {
  avatar_too_large: "That image is larger than 5 MB.",
  avatar_too_many_pixels:
    "That picture has far too many pixels. Scale it down and try again.",
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

/**
 * The account's own singing record, over every party it ever took part in.
 *
 * Scores are tied to a player, so an account without one has nothing to total
 * up — and neither has a singer who has not been scored yet, who gets a
 * sentence instead of a row of zeroes.
 */
function UserStats({ playerId }: { playerId: string | null }) {
  const auth = useAuth();
  const scores = useQuery({
    ...listPlayerScoresOptions({ path: { player_id: playerId ?? "" } }),
    enabled: auth.loaded && playerId !== null && auth.can("stats.view"),
  });

  if (playerId === null || !auth.can("stats.view")) return null;
  // Nothing while it loads, and nothing when it fails: a stat row is a bonus on
  // this page, not something worth a loading bar or an alert of its own.
  if (scores.data === undefined) return null;

  const summary = playerSummary(scores.data.scores);
  if (summary === null) {
    return (
      <p className="user-stats-empty">
        Sing a song and your stats appear here.
      </p>
    );
  }

  return (
    <>
      {/* What was sung before how well it went, and no favorites count: a
          favorite is a filter on the song list, not something achieved. */}
      <div className="user-stats">
        <IconStat
          className="user-stat"
          icon="hash"
          label="Sings"
          value={summary.sings}
          showLabel
        />
        <IconStat
          className="user-stat"
          icon="music"
          label="Songs"
          value={summary.songs}
          showLabel
        />
        <IconStat
          className="user-stat"
          icon="trophy"
          label="Best"
          value={summary.best}
          showLabel
        />
        <IconStat
          className="user-stat"
          icon="average"
          label="Average"
          value={summary.average}
          showLabel
        />
      </div>
      {/* The shape behind the numbers: where this singer's scores actually land
          across the full 0–10000 range. Flat on the page like the stat bar
          above it — the identity card is this page's one surface. */}
      {scores.data.scores.length >= HISTOGRAM_MIN_SCORES && (
        <div className="user-stats-chart">
          <ScoreHistogram
            scores={scores.data.scores}
            height={96}
            label="Your score distribution"
          />
        </div>
      )}
      {/* Inside this component on purpose: it is the only place that knows the
          four numbers have something behind them, so the row can never lead to
          an empty page. A quiet line tied to the block above by its hairline —
          no leading glyph, which is what made it read as a Manage errand. */}
      <Link className="user-stats-link" to="/user/stats">
        <span className="user-stats-link-label">All my scores</span>
        <Icon name="chevron-right" className="user-stats-link-chevron" />
      </Link>
    </>
  );
}

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
  // Only for the identity tile: the roster itself lives on /user/accounts, so
  // there is nothing to ask for until an account with a player is logged in.
  const ownPlayerId = auth.user?.player_id ?? null;
  const players = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && ownPlayerId !== null && auth.can("players.view"),
  });
  const [showLogin, setShowLogin] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const logOut = useMutation({
    ...logoutMutation(),
    // Every cached answer belonged to the account that just left.
    onSettled: () => void queryClient.invalidateQueries(),
  });

  const setAvatar = useMutation({
    ...setPlayerAvatarMutation(),
    onSuccess: () => {
      setAvatarError(null);
      void queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
    },
    onError: (error) =>
      setAvatarError(
        AVATAR_MESSAGES[errorDetail(error) ?? ""] ??
          errorMessage(error, "Could not upload the image."),
      ),
  });

  const upload = (player: PlayerRead, input: HTMLInputElement): void => {
    const file = input.files?.[0];
    // Cleared right away, so picking the very same file again after a rejection
    // is another change event and not a click that does nothing.
    input.value = "";
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(AVATAR_MESSAGES.avatar_too_large);
      return;
    }
    setAvatar.mutate({ path: { player_id: player.id }, body: { file } });
  };

  const ownPlayer =
    players.data?.players.find((player) => player.id === ownPlayerId) ?? null;
  // The same rows the host screen lists on its own manage view; the back arrow
  // of the pages behind them leads here because nothing says otherwise.
  const menuRows = manageEntries(auth);

  return (
    <>
      {/* Nothing until /auth/me answered, so no identity state flashes. */}
      {auth.loaded &&
        (auth.user !== null ? (
          <>
            <div className="user-identity">
              {ownPlayer !== null ? (
                // The avatar is the way to change it — the `image` badge is the
                // affordance, the file input behind the label does the work. No
                // capability gates it: your own picture is identity, like your
                // favorites, so there is nothing for the host to grant.
                <label className="user-identity-avatar-label">
                  <PlayerAvatar
                    player={ownPlayer}
                    className="user-identity-avatar"
                  />
                  <Icon name="image" className="user-identity-avatar-hint" />
                  <input
                    type="file"
                    className="visually-hidden"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Change your picture"
                    onChange={(event) => upload(ownPlayer, event.target)}
                  />
                </label>
              ) : (
                <PlayerAvatar
                  player={ownPlayer}
                  className="user-identity-avatar"
                />
              )}
              <h1 className="user-identity-name">{auth.user.username}</h1>
              <p className="user-identity-role">{auth.user.role}</p>
              {avatarError !== null && (
                <p className="error-notice user-identity-error" role="alert">
                  {avatarError}
                </p>
              )}
              <button
                type="button"
                className="button"
                disabled={logOut.isPending}
                onClick={() => logOut.mutate({})}
              >
                Log out
              </button>
            </div>
            <UserStats playerId={auth.user.player_id} />
            {/* The rest of the record: what those scores earned. After the
                numbers because it is what they add up to, and before *Manage*
                because it is still the singer's own page and not an errand. */}
            <UserAchievements playerId={auth.user.player_id} />
          </>
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
          <h2 className="user-manage-title">Manage</h2>
          <ManageMenu entries={menuRows} />
        </>
      )}

      <About />
    </>
  );
}

/**
 * The signature at the foot of the page: the mark, the name under it, and in
 * one quiet line the two facts a bug report needs — which release is running
 * and where to file it. Not a list of rows any more; nothing here is an
 * errand, so it gets the page's smallest voice rather than 48px of tap target.
 */
function About() {
  // From the backend, never from a constant in here: a frontend built against
  // one release and served by another would print the wrong number.
  const health = useQuery(healthOptions());

  return (
    <div className="about">
      {/* Decorative: the name is spelled out directly underneath, and a mark
          announced next to its own caption reads the app's name twice. */}
      <img className="about-logo" src="/logo.png" alt="" />
      <h2 className="about-name">Ultrastar Wingman</h2>
      <p className="about-meta">
        {/* Absent until the answer is in — never "Version undefined". The dot
            leaves with it, so the line never opens on a separator. */}
        {health.data !== undefined && (
          <>
            <span className="about-version">v{health.data.version}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <a
          className="about-repository"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="github" className="about-repository-icon" />
          GitHub
        </a>
      </p>
    </div>
  );
}
