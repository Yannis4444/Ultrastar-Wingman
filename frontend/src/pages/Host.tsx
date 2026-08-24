import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { exchangeHostTokenMutation } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import LatestScores from "../components/LatestScores";
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
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="host-page">
      <CurrentlyPlaying />
      <LatestScores />
      <div className="host-side">
        <div className="host-header">
          <img className="host-logo" src="/logo.png" alt="Ultrastar Wingman" />
          <span>Ultrastar Wingman</span>
        </div>
        <div className="host-join">
          <QRCode
            value={window.location.origin}
            size={192}
            bgColor="#ffffff"
            fgColor="#021720"
          />
          <p>Scan to join</p>
        </div>
        {auth.isHost && <p className="host-active">Host session active</p>}
        {error && (
          <p className="error-notice host-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
