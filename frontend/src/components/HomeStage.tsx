import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MusicSettings, SongRead } from "../api";
import {
  getCurrentSingOptions,
  getCurrentSingQueryKey,
  stopSingingMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { formatDuration } from "../duration";
import { useFavorites } from "../hooks/useFavorites";
import { useMusic } from "../hooks/useMusic";
import { useNow } from "../hooks/useNow";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { useWishlist } from "../hooks/useWishlist";
import { musicPosition, playerMode, progressPercent } from "../music";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import MusicSettingsPanel from "./MusicSettingsPanel";
import PlayerSelection from "./PlayerSelection";
import SongCover from "./SongCover";
// The control row mirrors the song modal's, down to the stylesheet.
import "./SongControls.css";
import SongDetails from "./SongDetails";
import { LogoTile } from "./SongReel";
import "./HomeStage.css";
import { useMutation } from "@tanstack/react-query";
import type { CurrentSing } from "../api";

interface KaraokeStarted extends WingmanEvent {
  sing: CurrentSing;
}

/** What each mode puts on the two text lines. */
const IDLE_TITLE = "Nothing is playing";
const IDLE_HINT = "Pick a song and press play.";
/** A reader without `music.view` cannot know whether music is playing, so the
 *  tile must not claim it is not. The brand says the same nothing honestly. */
const BLIND_TITLE = "Ultrastar Wingman";

/**
 * The player at the top of Home: one block, three modes, one height.
 *
 * A song being sung, the background song between them, and the brand while
 * neither. Every row is a fixed grid track and every reserved line has a
 * declared `line-height`, so a two-line title, a missing control row and an
 * empty progress line all leave the tile exactly as tall — nothing on the page
 * below it ever moves.
 *
 * The controls that were already here work on whatever is playing: hearting or
 * wishing the *background* song is the row the stage has had all along, and the
 * one large control keeps its meaning — pink Stop for a sing, blue Sing for the
 * background song (the song modal's own path, never a second one), nothing at
 * all when the room is quiet.
 */
export default function HomeStage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const current = useQuery(getCurrentSingOptions());
  const music = useMusic();
  const favorites = useFavorites();
  const wishlist = useWishlist();

  const [details, setDetails] = useState<SongRead | null>(null);
  const [askStop, setAskStop] = useState(false);
  const [singing, setSinging] = useState<SongRead | null>(null);
  const [options, setOptions] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);

  const stop = useMutation({
    ...stopSingingMutation(),
    onSuccess: () =>
      queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  });

  // The events carry the whole payload, so no refetch is needed.
  useWingmanEvent<KaraokeStarted>("karaoke.started", (message) =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: message.sing }),
  );
  useWingmanEvent("karaoke.ended", () =>
    queryClient.setQueryData(getCurrentSingQueryKey(), { sing: null }),
  );

  const sing = current.data?.sing ?? null;
  const state = music.state;
  const canView = auth.loaded && auth.can("music.view");
  const mode = playerMode(sing, state, canView);

  // A sing that ends takes its Stop confirmation with it: the flag would
  // otherwise survive the idle gap and put the dialog back over the *next*
  // song, one stray tap away from stopping it.
  useEffect(() => {
    if (sing === null) setAskStop(false);
  }, [sing]);

  // Only the music mode counts seconds, and only while this tab is in front.
  const now = useNow(mode === "music");

  const song =
    mode === "singing" ? (sing?.song ?? null) : (state?.track?.song ?? null);
  const eyebrow =
    mode === "singing"
      ? "Now playing"
      : mode === "music"
        ? "Background music"
        : "Ultrastar Wingman";

  const canStop = auth.can("karaoke.stop");
  const canSing = auth.can("karaoke.sing");
  const canWish = auth.can("wishlist.add");
  const canControl = auth.loaded && auth.can("music.control");
  const canManage = auth.loaded && auth.can("music.manage");
  const favorite = song !== null && favorites.ids.has(song.id);
  const wished = song !== null && wishlist.mine(song.id);

  // Rendered outside the block as well as instead of it, so the end of a sing
  // closes the block and leaves an open modal standing.
  const modals = (
    <>
      {details !== null && (
        <SongDetails song={details} onClose={() => setDetails(null)} />
      )}
      {singing !== null && (
        <PlayerSelection song={singing} onClose={() => setSinging(null)} />
      )}
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
      {options && music.settings !== undefined && (
        <MusicSettingsPanel
          settings={music.settings}
          savedField={savedField}
          busy={music.isBusy}
          onChange={(patch: Partial<MusicSettings>) => {
            setSavedField(Object.keys(patch)[0] ?? null);
            music.patchSettings(patch);
          }}
          onClose={() => setOptions(false)}
        />
      )}
    </>
  );

  return (
    <>
      <section className="home-stage" aria-labelledby="home-stage-heading">
        {/* Keyed on the mode so the crossfade plays when the block changes what
            it is — and not when the background music simply moves to the next
            song, which swaps two lines of text in place. */}
        <div className="home-stage-body" key={mode}>
          <div className="home-stage-head">
            {song === null ? (
              <LogoTile className="home-stage-cover" />
            ) : (
              <button
                type="button"
                className="home-stage-cover-button"
                aria-label={`Details for ${song.title}`}
                onClick={() => setDetails(song)}
              >
                <SongCover song={song} className="home-stage-cover" />
              </button>
            )}

            <h1 className="home-stage-eyebrow" id="home-stage-heading">
              {eyebrow}
            </h1>

            <p className="home-stage-title" title={song?.title}>
              {song !== null ? song.title : canView ? IDLE_TITLE : BLIND_TITLE}
            </p>
            <p className="home-stage-artist">
              {song !== null ? song.artist : IDLE_HINT}
            </p>

            <div className="home-stage-progress">
              {mode === "music" && state !== undefined && (
                <Progress music={state} now={now} />
              )}
            </div>
          </div>

          {/* The song modal's own row: two 48px marks either side of one large
              unfilled control. */}
          <div className="home-stage-controls">
            {song !== null && favorites.available && (
              <button
                type="button"
                className={
                  favorite
                    ? "song-control song-control-favorite song-control-favorite-on"
                    : "song-control song-control-favorite"
                }
                aria-pressed={favorite}
                aria-label={
                  favorite ? "Remove from favorites" : "Add to favorites"
                }
                onClick={() => favorites.toggle(song.id)}
              >
                <Icon name="heart" />
              </button>
            )}

            {mode === "singing" && canStop && (
              <button
                type="button"
                className="song-control song-control-lead song-control-stop"
                aria-label="Stop"
                title="Stop"
                disabled={stop.isPending}
                onClick={() => setAskStop(true)}
              >
                <Icon name="stop" />
              </button>
            )}
            {mode === "music" && song !== null && canSing && (
              <button
                type="button"
                className="song-control song-control-lead song-control-sing"
                aria-label="Sing"
                title="Sing this song"
                onClick={() => setSinging(song)}
              >
                <Icon name="play" />
              </button>
            )}

            {song !== null && canWish && (
              <button
                type="button"
                className={
                  wished
                    ? "song-control song-control-wish song-control-wish-on"
                    : "song-control song-control-wish"
                }
                aria-pressed={wished}
                aria-label={wished ? "Remove wish" : "Wish"}
                onClick={() => {
                  if (wished) wishlist.unwish(song.id);
                  else wishlist.wish(song.id);
                }}
              >
                <Icon name={wished ? "playlist-check" : "playlist-plus"} />
              </button>
            )}
          </div>

          {/* Its own line, so the two different plays are never in the same
              row. The gear is here in every mode: a host who switched the music
              off must have a way back in. */}
          <div className="home-stage-transport">
            {canManage && (
              <button
                type="button"
                className="icon-button"
                aria-label="Background music settings"
                title="Background music"
                onClick={() => setOptions(true)}
              >
                <Icon name="gear" />
              </button>
            )}
            {mode === "music" && canControl && state !== undefined && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={state.status === "paused" ? "Play" : "Pause"}
                  title={state.status === "paused" ? "Play" : "Pause"}
                  disabled={music.isBusy}
                  onClick={() =>
                    state.status === "paused" ? music.play() : music.pause()
                  }
                >
                  <Icon name={state.status === "paused" ? "play" : "pause"} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Skip"
                  title="Skip"
                  disabled={music.isBusy}
                  onClick={() => music.skip()}
                >
                  <Icon name="skip" />
                </button>
                <Volume
                  value={state.volume.music}
                  onChange={(value) => music.setVolume({ music: value })}
                />
              </>
            )}
          </div>
        </div>
      </section>

      {modals}
    </>
  );
}

/** The bar and the time. Its own component so the second-by-second re-render
 *  stops here, rather than redrawing the covers and the controls with it. */
function Progress({
  music,
  now,
}: {
  music: Parameters<typeof musicPosition>[0];
  now: number;
}) {
  const percent = progressPercent(music, now);
  const elapsed = musicPosition(music, now);
  return (
    <>
      {percent === null ? (
        <span className="home-stage-bar" aria-hidden="true" />
      ) : (
        <span className="home-stage-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
      <span className="home-stage-time">
        {music.sink_online
          ? formatDuration(Math.floor(elapsed))
          : "No screen is playing the music"}
      </span>
    </>
  );
}

/** The music's own volume, inline. The speaker names the slider and is not a
 *  control of its own: there is no mute, only a volume. */
function Volume({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);

  // Non-null only while a finger is down, so another phone's change still
  // reaches a slider nobody is touching.
  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      onChange(draft);
      setDraft(null);
    }, 200);
    return () => clearTimeout(timer);
  }, [draft, onChange]);

  return (
    <>
      <Icon name="volume" className="icon home-stage-volume-glyph" />
      <label className="visually-hidden" htmlFor="home-stage-volume">
        Music volume
      </label>
      <input
        className="range-input home-stage-volume"
        id="home-stage-volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft ?? value}
        aria-valuetext={`${draft ?? value} percent`}
        onChange={(event) => setDraft(Number(event.target.value))}
      />
    </>
  );
}
