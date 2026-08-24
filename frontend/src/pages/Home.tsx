import CurrentlyPlaying from "../components/CurrentlyPlaying";
import Spinner from "../components/Spinner";
import UsdxSetupBanner from "../components/UsdxSetupBanner";
import WishlistTile from "../components/WishlistTile";

export default function Home() {
  return (
    <>
      <h1>Ultrastar Wingman</h1>
      <UsdxSetupBanner />
      <CurrentlyPlaying />
      <Spinner />
      <WishlistTile />
    </>
  );
}
