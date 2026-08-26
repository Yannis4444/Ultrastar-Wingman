import { useQuery } from "@tanstack/react-query";
import { getCurrentSingOptions } from "../api/@tanstack/react-query.gen";
import CurrentlyPlaying from "./CurrentlyPlaying";
import "./HomeStage.css";

/**
 * The one tile at the top of Home: the app's own identity while nothing plays,
 * the running song in its place while something does.
 *
 * Both states are always mounted in the same grid cell of a tile with a fixed
 * height, so the switch cannot move anything below it — the idle half only
 * fades out, and the running song fades in over it.
 */
export default function HomeStage() {
  // The very cache entry CurrentlyPlaying reads, so this costs no request: the
  // karaoke events it already listens for flip this component too.
  const current = useQuery(getCurrentSingOptions());
  const playing = current.data?.sing != null;

  return (
    <div className="home-stage">
      <div
        className={
          playing ? "home-stage-idle home-stage-hidden" : "home-stage-idle"
        }
        aria-hidden={playing}
      >
        <img className="home-logo" src="/logo.png" alt="Ultrastar Wingman" />
        <h1>Ultrastar Wingman</h1>
      </div>

      {/* A plain cell, deliberately without an opacity of its own: the song
          modal CurrentlyPlaying can open lives inside it, and an ancestor
          opacity would take the modal down with the sing that ends under it. */}
      <div className="home-stage-playing">
        <CurrentlyPlaying className="currently-playing-stage" />
      </div>
    </div>
  );
}
