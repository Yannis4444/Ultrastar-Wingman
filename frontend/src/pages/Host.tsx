import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import {
  exchangeHostTokenMutation,
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  getJoinInfoOptions,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import { Icon } from "../components/icons";
import LatestScores from "../components/LatestScores";
import SongCover from "../components/SongCover";
import { useWishlist } from "../hooks/useWishlist";
import "./Host.css";

/** The query parameter the server puts into the URL it logs and opens. */
const TOKEN_PARAM = "hostToken";

/** Reads the token and takes it out of the URL, so it is never shared or re-sent. */
function takeToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(TOKEN_PARAM);
  if (token === null) return null;
  url.searchParams.delete(TOKEN_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  return token;
}

/** True after `delay` ms without input; drives cursor hiding and the overlay. */
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
 * What the stage shows while USDX is idle and no scores are up: the crowd's
 * favourites — wishes feed the spinner's odds, they are not a queue.
 */
function HostIdle() {
  const wishlist = useWishlist();
  const wishes = [...wishlist.wishes]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (wishes.length === 0) {
    return <p className="host-scan-hint">Scan the code to pick a song</p>;
  }

  return (
    <section className="host-wishes" aria-label="Most wished">
      <h2>Most wished</h2>
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
 * The screen next to the TV where USDX runs: what is playing plus the QR code
 * guests scan to open the app on their phones.
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

  const exchange = useMutation({
    ...exchangeHostTokenMutation(),
    // The session cookie is set now: everything cached was fetched as a guest.
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: () =>
      setError(
        "That host link does not work any more — it can only be used once. " +
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

  const stop = useMutation({
    ...stopSingingMutation(),
    onSuccess: () =>
      queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  });

  return (
    <div className={`host-page${idle ? " host-idle" : ""}`}>
      <div className="host-stage">
        <CurrentlyPlaying hideControls />
        <LatestScores fallback={<HostIdle />} />
      </div>

      <div className="host-rail">
        <div className="host-brand">
          <img className="host-logo" src="/logo.png" alt="" />
          <span>Ultrastar Wingman</span>
        </div>
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
          <p className="host-join-url">{joinUrl.replace(/^https?:\/\//, "")}</p>
        </div>
      </div>

      {/* Everything mouse-only lives here; hiding is opacity-only so the
          strings stay in the DOM and Tab still reaches the buttons. */}
      <div className="host-controls">
        <Link
          to="/settings"
          className="icon-button host-icon-button"
          aria-label="Settings"
        >
          <Icon name="gear" />
        </Link>
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
        {auth.isHost && <p className="host-active">Host session active</p>}
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
