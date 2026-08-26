import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import HomeStage from "../components/HomeStage";
import { Icon } from "../components/icons";
import UsdxSetupBanner from "../components/UsdxSetupBanner";
import WishlistTile from "../components/WishlistTile";
import "./Home.css";

export default function Home() {
  const auth = useAuth();

  return (
    <>
      {/* Identity while nothing plays, the running song while something does —
          one tile of a fixed height, so nothing below it moves on the switch. */}
      <HomeStage />
      <UsdxSetupBanner />
      {/* The slot machine has a page of its own; Home only points at it. */}
      {auth.can("songs.view") && (
        <Link className="home-random" to="/spinner">
          <Icon name="dice" />
          Random song
        </Link>
      )}
      <WishlistTile />
    </>
  );
}
