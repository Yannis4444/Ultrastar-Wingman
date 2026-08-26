import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import HomeStage from "../components/HomeStage";
import { Icon } from "../components/icons";
import { randomDiceFace } from "../dice";
import UsdxSetupBanner from "../components/UsdxSetupBanner";
import WishlistTile from "../components/WishlistTile";
import "./Home.css";

export default function Home() {
  const auth = useAuth();
  // Rolled once per mount, so every visit to Home shows another face.
  const [face] = useState(randomDiceFace);

  return (
    <>
      {/* Identity while nothing plays, the running song while something does —
          one tile, cut to the running song's height. */}
      <HomeStage />
      <UsdxSetupBanner />
      {/* The slot machine has a page of its own; Home only points at it. */}
      {auth.can("songs.view") && (
        <Link className="home-random" to="/spinner">
          <Icon name={face} />
          Random song
        </Link>
      )}
      <WishlistTile />
    </>
  );
}
