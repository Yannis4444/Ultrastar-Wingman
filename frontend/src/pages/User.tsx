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
  oidcPendingOptions,
  oidcPendingQueryKey,
  setPlayerAvatarMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ChooseNameForm from "../components/ChooseNameForm";
import { Icon } from "../components/icons";
import LoginForm from "../components/LoginForm";
import ManageMenu from "../components/ManageMenu";
import MyCards from "../components/MyCards";
import PlayerAvatar from "../components/PlayerAvatar";
import ScoreHistogram from "../components/ScoreHistogram";
import ScoreSummary from "../components/ScoreSummary";
import UserAchievements from "../components/UserAchievements";
import { errorDetail, errorMessage } from "../errors";
import { REPOSITORY_URL } from "../links";
import { manageEntries } from "../manage";
import { CHART_MIN_SCORES } from "../stats";
import "./User.css";

/** Mirrors the backend's limit so an oversized file never leaves the browser. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_MESSAGES: Record<string, string> = {
  avatar_too_large: "That image is larger than 5 MB.",
  avatar_too_many_pixels:
    "That picture has far too many pixels. Scale it down and try again.",
  unsupported_avatar_type:
    "Only jpeg, png, and webp images work, and the file has to really be one.",
};

const SSO_ERROR_PREFIX = "error:";

/**
 * The outcome of a first sign-on: the account does not exist yet, and the
 * singer is asked what to call it. The form itself is drawn off
 * `GET /auth/oidc/pending` and not off this parameter, which the effect below
 * strips and a reload would lose while the pending login still stands.
 */
const CHOOSE_NAME = "choose_name";

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
  // Not a slug the callback sends: this is what the choose-a-name step reports
  // when the login it was finishing is no longer there to finish.
  no_pending_login:
    "That sign-in took too long or was already finished. Try again.",
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

  if (scores.data.scores.length === 0) {
    return (
      <p className="user-stats-empty">
        Sing a song and your stats appear here.
      </p>
    );
  }

  return (
    <>
      {/* The same five numbers every other set of scores in the app is added
          up into (§7), and no favorites count: a favorite is a filter on the
          song list, not something achieved. Best and Worst go unnamed — every
          score on this page is the reader's own. */}
      <ScoreSummary scores={scores.data.scores} songs className="user-stats" />
      {/* The shape behind the numbers: where this singer's scores actually land
          across the full 0–10000 range. Flat on the page like the stat bar
          above it — the identity card is this page's one surface. */}
      {scores.data.scores.length >= CHART_MIN_SCORES && (
        <div className="user-stats-chart">
          <ScoreHistogram
            scores={scores.data.scores}
            height={96}
            label="Your score distribution"
          />
        </div>
      )}
      {/* Inside this component on purpose: it is the only place that knows the
          five numbers have something behind them, so the row can never lead to
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

  // A sign-on that came back for a name and then lost it: the form reports the
  // slug here, because the sentence and the table it comes from are this page's.
  const [lostSlug, setLostSlug] = useState<string | null>(null);
  // Is a first sign-on waiting for a name in this browser? Asked on every load
  // rather than read off `?login=`, which a reload drops while the pending
  // login stands. A 404 is the ordinary answer and never a failure to retry.
  const pendingLogin = useQuery({
    ...oidcPendingOptions(),
    enabled: auth.loaded && auth.user === null,
    retry: false,
    // And on a load alone: a singer who leaves the tab while thinking of a name
    // must not come back to a form that vanished without a word. The expiry is
    // reported when they submit, which is where there is something to say.
    refetchOnWindowFocus: false,
  });
  const forgetPendingLogin = (): void =>
    void queryClient.invalidateQueries({ queryKey: oidcPendingQueryKey() });
  // Once the form has been on screen, the `?login=` outcome is spent: what
  // becomes of the pending login after that is the form's to report, and a
  // singer who gave the name up is not somebody who came back too late.
  const [nameWasAsked, setNameWasAsked] = useState(false);
  useEffect(() => {
    if (pendingLogin.isSuccess) setNameWasAsked(true);
  }, [pendingLogin.isSuccess]);

  // `login=ok` needs no handling: the callback set the cookie before
  // redirecting, so this page load already asks /auth/me as the new account.
  const ssoError =
    lostSlug !== null
      ? (SSO_MESSAGES[lostSlug] ?? SSO_MESSAGES.login_failed)
      : outcome?.startsWith(SSO_ERROR_PREFIX)
        ? (SSO_MESSAGES[outcome.slice(SSO_ERROR_PREFIX.length)] ??
          SSO_MESSAGES.login_failed)
        : // Sent back to be named, and there was nothing left to name by the
          // time the page loaded: the pending login expired, or an admin
          // switched SSO off in between. The slug says which.
          outcome === CHOOSE_NAME && pendingLogin.isError && !nameWasAsked
          ? (SSO_MESSAGES[
              errorDetail(pendingLogin.error) ?? "no_pending_login"
            ] ?? SSO_MESSAGES.login_failed)
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
  // The one form in the anonymous half of this page: the name a first sign-on
  // is waiting for, or the login form. Nothing at all while the answer is on
  // its way, so a sign-on coming back does not flash the login form first.
  // `isSuccess`, never the data alone: a query that fails on a refetch keeps
  // the answer it had, and a pending login that was given up is gone the moment
  // the refetch says so. And never once the form has reported it lost: whatever
  // the refetch says, the sentence explaining it belongs to the login form.
  const askingForAName = pendingLogin.isSuccess && lostSlug === null;
  const loginArea = pendingLogin.isLoading ? null : askingForAName ? (
    <ChooseNameForm
      preset={pendingLogin.data.username}
      onCancel={forgetPendingLogin}
      onLost={(slug) => {
        setLostSlug(slug);
        forgetPendingLogin();
      }}
    />
  ) : (
    <LoginForm ssoError={ssoError} />
  );
  // The same rows the host screen lists on its own manage view; the back arrow
  // of the pages behind them leads here because nothing says otherwise.
  const menuRows = manageEntries(auth);

  return (
    <>
      {/* Nothing until /auth/me answered, so no identity state flashes. */}
      {auth.loaded &&
        (auth.user !== null ? (
          <>
            {/* Home's head in another voice (§7): the picture beside a
                column of declared rows — name, role, the one action — that
                adds up to the picture's own 88px. */}
            <div className="user-identity">
              <div className="user-identity-head">
                {ownPlayer !== null ? (
                  // The avatar is the way to change it — the `image` badge is
                  // the affordance, the file input behind the label does the
                  // work. No capability gates it: your own picture is
                  // identity, like your favorites, so there is nothing for the
                  // host to grant.
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
                <div className="user-identity-text">
                  <h1 className="user-identity-name">{auth.user.username}</h1>
                  <p className="user-identity-role">{auth.user.role}</p>
                  <button
                    type="button"
                    className="button user-identity-action"
                    disabled={logOut.isPending}
                    onClick={() => logOut.mutate({})}
                  >
                    Log out
                  </button>
                </div>
              </div>
              {avatarError !== null && (
                <p className="error-notice user-identity-error" role="alert">
                  {avatarError}
                </p>
              )}
            </div>
            <UserStats playerId={auth.user.player_id} />
            {/* The rest of the record: what those scores earned. After the
                numbers because it is what they add up to, and before *Manage*
                because it is still the singer's own page and not an errand. */}
            <UserAchievements playerId={auth.user.player_id} />
            {/* The cards that pick this singer at the player selector. After
                the record because it is a thing to set up rather than a thing
                to read, and before *Manage* because it is still the singer's
                own page: claiming your own card is identity, not an errand the
                host hands out. It draws nothing at all in a room with no
                selector in it. */}
            <MyCards />
          </>
        ) : auth.isHost ? (
          <>
            <div className="user-identity">
              <div className="user-identity-head">
                <span
                  className="user-identity-avatar user-identity-shield"
                  aria-hidden="true"
                >
                  <Icon name="shield" />
                </span>
                <div className="user-identity-text">
                  <h1 className="user-identity-name">Host screen</h1>
                  {/* The same line an account's tile carries: the host session
                      is an administrator, it is just not a person. */}
                  <p className="user-identity-role">{auth.role}</p>
                  {!showLogin && (
                    <button
                      type="button"
                      className="button user-identity-action"
                      onClick={() => setShowLogin(true)}
                    >
                      Log in as a user
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showLogin && loginArea}
          </>
        ) : (
          <>
            <h1>You</h1>
            {loginArea}
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
