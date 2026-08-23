import CurrentlyPlaying from "../components/CurrentlyPlaying";
import Spinner from "../components/Spinner";
import WishlistTile from "../components/WishlistTile";

export default function Home() {
  return (
    <>
      <h1>Ultrastar Wingman</h1>
      <CurrentlyPlaying />
      <Spinner />
      <WishlistTile />
    </>
  );
}
