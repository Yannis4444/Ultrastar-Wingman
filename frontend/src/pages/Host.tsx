import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import type { WishRead } from "../api";
import {
  exchangeHostTokenMutation,
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  getJoinInfoOptions,
  getJoinInfoQueryKey,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import HostAchievements, {
  type HostAchievementsPhase,
} from "../components/HostAchievements";
import HostResults from "../components/HostResults";
import HostSelection, {
  type HostSelectionPhase,
} from "../components/HostSelection";
import { Icon } from "../components/icons";
import SessionLeaderboard from "../components/SessionLeaderboard";
import SongCover from "../components/SongCover";
import { useSessionStanding } from "../hooks/useSessionStanding";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
import { manageEntries } from "../manage";
import type { LeaderboardOrder } from "../stats";
import "./Host.css";

/** The query parameter the server puts into the URL it logs and opens. */
const TOKEN_PARAM = "hostToken";

/** The setting that overrides the address the QR code encodes. */
const JOIN_URL_SETTING = "host.join_url";

/** One performance ranks nobody — the standing starts once there is a second. */
const MIN_SINGS = 2;

/** Rail wishes with a leaderboard above them, and without it. */
const WISHES_WITH_STANDING = 3;
const WISHES_ALONE = 5;

interface SettingChanged extends WingmanEvent {
  key: string;
}

/** Reads the token and takes it out of the URL, so it is never shared or re-sent. */
function takeToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(TOKEN_PARAM);
  if (token === null) return null;
  url.searchParams.delete(TOKEN_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  return token;
}

/**
 * True after `delay` ms without input; drives cursor hiding, the overlay and
 * every `.host-reveal` cluster (the leaderboard's order pills). One timer for
 * the whole page — a second one would let the chrome fade out in pieces.
 */
function useIdle(delay = 3000): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    let timer = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), delay);
    };
    wake();
    for (const event of events) window.addEventListener(event, wake);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [delay]);

  return idle;
}

/**
 * The stage while USDX is idle and nothing has been scored: whose screen this
 * is, and what to do about it. It is the only state that says the name — a TV
 * playing a song does not need to be told which app it is, and the rail needs
 * the room.
 *
 * `scan` is false where there is no code to scan: the beat between two singers
 * of the achievements takeover shows the brand, and the rail with the QR in it
 * is not on the screen for those seconds.
 */
function HostBrand({ scan = true }: { scan?: boolean }) {
  return (
    <div className="host-brand">
      <img className="host-logo" src="/logo.png" alt="" />
      <span className="host-brand-name">Ultrastar Wingman</span>
      {scan && <p className="host-scan-hint">Scan the code to pick a song</p>}
    </div>
  );
}

/**
 * What the crowd wants to sing, in the rail beside the QR code: wishes feed the
 * spinner's odds, they are not a queue, so they belong next to the way in
 * rather than on the stage.
 */
function HostWishes({ wishes }: { wishes: WishRead[] }) {
  return (
    /* The heading names the region; an `aria-label` saying the same words
       would only be a second copy to keep in step with it. */
    <section className="host-wishes" aria-labelledby="host-wishes-heading">
      <h2 id="host-wishes-heading">Most wished</h2>
      <ol>
        {wishes.map((wish) => (
          <li key={wish.song.id}>
            <SongCover song={wish.song} className="host-wishes-cover" />
            <span className="host-wishes-song">
              <span className="host-wishes-title">{wish.song.title}</span>
              <span className="host-wishes-artist">{wish.song.artist}</span>
            </span>
            <span className="host-wishes-count">{wish.count}×</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The screen next to the TV where USDX runs. Two columns, each with one job:
 * the stage on the left is whatever the party is doing right now (a song, the
 * scores it just got, or the brand), and the rail on the right is how to take
 * part — the QR code first, then the standing and the wishes.
 *
 * Opened with `?hostToken=…` it trades that one-time token for a permanent
 * trusted admin session — the only way to become the host (no IP or header
 * check; the old app trusted `X-Forwarded-For`, which any client can set).
 */
export default function Host() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const idle = useIdle();
  const [error, setError] = useState<string | null>(null);
  const [askStop, setAskStop] = useState(false);
  // What a scoreboard is read for, and the Scores page's default too.
  const [order, setOrder] = useState<LeaderboardOrder>("best");
  // Whose turn the stage is between songs: the badges a finished song earned
  // play first, and the results follow them.
  const [earned, setEarned] = useState<HostAchievementsPhase>("idle");
  // The room picking the next song owns the stage too, between the badges above
  // it and the results below.
  const [picking, setPicking] = useState<HostSelectionPhase>("idle");

  const exchange = useMutation({
    ...exchangeHostTokenMutation(),
    // The session cookie is set now: everything cached was fetched as a guest.
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: () =>
      setError(
        "That host link does not work any more. It can only be used once. " +
          "Check the server log for the current one.",
      ),
  });

  const { mutate } = exchange;
  useEffect(() => {
    // The token is stripped before the request, so React's double-invoked
    // development effect finds nothing to send the second time.
    const token = takeToken();
    if (token !== null) mutate({ body: { token } });
  }, [mutate]);

  // Shares CurrentlyPlaying's cache entry; only the overlay Stop needs it here.
  const current = useQuery(getCurrentSingOptions());
  const sing = current.data?.sing ?? null;

  const join = useQuery(getJoinInfoOptions());
  const joinUrl = join.data?.url ?? window.location.origin;
  // A corrected address must reach the TV without somebody walking over to it.
  useWingmanEvent<SettingChanged>("setting.changed", ({ key }) => {
    if (key === JOIN_URL_SETTING) {
      void queryClient.invalidateQueries({ queryKey: getJoinInfoQueryKey() });
    }
  });

  // Fetched once for the whole page: the rail ranks with it, the stage's score
  // bars take their avatars from it.
  const standing = useSessionStanding(order);
  const showStanding =
    auth.can("stats.view") &&
    standing.sings >= MIN_SINGS &&
    standing.entries.length > 0;

  const wishlist = useWishlist();
  const wishes = [...wishlist.wishes]
    .sort((a, b) => b.count - a.count)
    .slice(0, showStanding ? WISHES_WITH_STANDING : WISHES_ALONE);

  // Only what this session may actually open, so a guest that found the host
  // URL sees the stage and nothing else.
  const manage = manageEntries(auth);

  const stop = useMutation({
    ...stopSingingMutation(),
    onSuccess: () =>
      queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  });

  // New achievements take the whole screen (§7): while they are actually on it
  // the rail is not rendered at all — no QR card, no standing, no wishes — and
  // the stage runs the full width. `waiting`, the beat held for badges that may
  // never come, leaves the rail where it is; a rail that blinked out for every
  // song that earned nobody anything would be the beat made visible.
  const badges = earned === "playing";
  // The room picking the next song takes the screen the same way (the user's
  // decision, 2026-09-06): nobody needs the code while the slots are filling up,
  // and the cards along the foot want the width the rail was holding.
  const picked = picking === "selecting";
  // Badges win the stage from a selection — they are the seconds a singer gets —
  // so `HostSelection` is suppressed by `badges` alone and never by this. It
  // keeps reporting `"selecting"` underneath them, which is what leaves the rail
  // down across the hand-over and brings the cards straight back.
  const takeover = badges || picked;

  return (
    <div
      className={`host-page${takeover ? " host-takeover" : ""}${idle ? " host-idle" : ""}`}
    >
      <div className="host-stage">
        <CurrentlyPlaying variant="host" />
        {/* Somebody is picking singers for the next song: the stage shows the
            song and its slots filling up, and takes the whole screen for it.
            It gives way to the badges a finished song earned, and it stands in
            front of the results — the room is looking at what happens next, not
            at what just happened. */}
        <HostSelection onPhase={setPicking} suppressed={badges} />
        {/* The badges a finished song earned take the stage before its scores
            do. `HostResults` stays mounted underneath them the whole time —
            it is what listens for the next scores and for the next song — and
            simply waits its turn; the brand stands in while the stage is
            holding for badges that may follow, and nothing at all while they
            are actually on it. The blank beat between two singers is the
            takeover's own, and it hands the stage the brand rather than
            leaving the TV empty for it — without the scan line, the rail
            holding the code being down for those seconds. */}
        <HostAchievements
          onPhase={setEarned}
          fallback={<HostBrand scan={false} />}
        />
        <HostResults
          players={standing.players}
          fallback={takeover ? null : <HostBrand />}
          suppressed={earned !== "idle" || picked}
        />
      </div>

      {!takeover && (
        <div className="host-rail">
          {/* First in the rail because it is the one thing a guest is looking
              for — nothing below it may push it off the top. */}
          <div className="host-join">
            <QRCode
              value={joinUrl}
              size={512}
              viewBox="0 0 512 512"
              bgColor="#ffffff"
              fgColor="#021720"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
            <p className="host-join-label">Scan to join</p>
            {/* Only `http://` is dropped — it is what a phone assumes anyway.
                An `https://` join URL has to keep its scheme, or the guest who
                types the line instead of scanning it lands on the wrong
                protocol. */}
            <p className="host-join-url">{joinUrl.replace(/^http:\/\//, "")}</p>
          </div>
          {showStanding && (
            <SessionLeaderboard
              entries={standing.entries}
              order={order}
              onOrder={setOrder}
              players={standing.players}
            />
          )}
          {wishes.length > 0 && <HostWishes wishes={wishes} />}
        </div>
      )}

      {/* Everything mouse-only lives here; hiding is opacity-only so the
          strings stay in the DOM and Tab still reaches the buttons. */}
      <div className="host-controls">
        {/* The host's own manage view, not the phone's user page: this screen
            has no tab bar to find its way back from. */}
        {manage.length > 0 && (
          <Link
            to="/host/manage"
            className="icon-button host-icon-button"
            aria-label="Manage"
          >
            <Icon name="gear" />
          </Link>
        )}
        {sing !== null && auth.can("karaoke.stop") && (
          <button
            type="button"
            className="icon-button host-icon-button icon-button-danger"
            aria-label="Stop"
            disabled={stop.isPending}
            onClick={() => setAskStop(true)}
          >
            <Icon name="stop" />
          </button>
        )}
        {auth.isHost && (
          <p className="host-active">This browser holds host rights</p>
        )}
        {error && (
          <p className="error-notice host-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {askStop && sing !== null && (
        <ConfirmModal
          title="Stop the song"
          message={`Stop "${sing.song.title}"? Scores for an unfinished song are not recorded.`}
          confirmLabel="Stop"
          danger
          onConfirm={() => {
            setAskStop(false);
            stop.mutate({});
          }}
          onCancel={() => setAskStop(false)}
        />
      )}
    </div>
  );
}
