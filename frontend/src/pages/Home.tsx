import { useQuery } from "@tanstack/react-query";
import { healthOptions } from "../api/@tanstack/react-query.gen";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import Spinner from "../components/Spinner";
import UsdxSetupBanner from "../components/UsdxSetupBanner";
import WishlistTile from "../components/WishlistTile";
import "./Home.css";

const REPOSITORY = "https://github.com/Yannis4444/Ultrastar-Wingman";

export default function Home() {
  const health = useQuery(healthOptions());

  return (
    <>
      <div className="home-header">
        <img className="home-logo" src="/logo.png" alt="Ultrastar Wingman" />
        <h1>Ultrastar Wingman</h1>
        <div className="home-meta">
          {/* No version until /health answers — an empty slot beats "undefined". */}
          <span>{health.data ? `Version ${health.data.version}` : ""}</span>
          <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </div>
      <UsdxSetupBanner />
      <CurrentlyPlaying />
      <Spinner />
      <WishlistTile />
    </>
  );
}
