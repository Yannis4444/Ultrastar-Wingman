import QRCode from "react-qr-code";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import "./Host.css";

/**
 * The screen next to the TV where USDX runs: what is playing plus the QR code
 * guests scan to open the app on their phones.
 *
 * This page is public like every other one for now — the trusted host session
 * that makes it admin without being spoofable lands in phase 4.
 */
export default function Host() {
  return (
    <div className="host-page">
      <CurrentlyPlaying />
      <div className="host-join">
        <QRCode
          value={window.location.origin}
          size={192}
          bgColor="#ffffff"
          fgColor="#021720"
        />
        <p>Scan to join</p>
      </div>
    </div>
  );
}
