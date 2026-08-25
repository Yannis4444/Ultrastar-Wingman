import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { healthOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import CurrentlyPlaying from "../components/CurrentlyPlaying";
import { Icon } from "../components/icons";
import UsdxSetupBanner from "../components/UsdxSetupBanner";
import WishlistTile from "../components/WishlistTile";
import "./Home.css";

const REPOSITORY = "https://github.com/Yannis4444/Ultrastar-Wingman";

export default function Home() {
  const health = useQuery(healthOptions());
  const auth = useAuth();

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
      <WishlistTile />
      {/* The slot machine has a page of its own; Home only points at it. */}
      {auth.can("songs.view") && (
        <Link className="home-entry" to="/spinner">
          <Icon name="dice" />
          <span className="home-entry-label">Random song</span>
          <Icon name="chevron-right" className="home-entry-chevron" />
        </Link>
      )}
    </>
  );
}
