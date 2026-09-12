import { useQuery } from "@tanstack/react-query";
import type { MusicSettings } from "../api";
import { listPlaylistsOptions } from "../api/@tanstack/react-query.gen";
import { MUSIC_SCOPES } from "../music";
import Modal from "./Modal";
import { PrivateSettingRow, SecondsInput } from "./PrivateSettingRow";

/** What the backend's `MAX_RESUME_DELAY` allows. */
const MIN_DELAY = 0;
const MAX_DELAY = 120;

interface MusicSettingsPanelProps {
  settings: MusicSettings;
  /** The field of the last write, so *Saved* lights beside the right row. */
  savedField: string | null;
  busy: boolean;
  onChange: (patch: Partial<MusicSettings>) => void;
  onClose: () => void;
}

/**
 * The background music's options, behind the player's gear.
 *
 * A panel modal rather than a block on the tile: the player is one fixed height
 * in all three modes, so there is nowhere on it for four rows to appear, and
 * §7's "complex settings get their own surface" points the same way. Not a page
 * either — it is four fields, and the user asked for them on the player.
 */
export default function MusicSettingsPanel({
  settings,
  savedField,
  busy,
  onChange,
  onClose,
}: MusicSettingsPanelProps) {
  const picksFromPlaylist = settings.scope === "playlist";
  // Only while the row is on screen: a list of playlists is not something the
  // panel needs to know about until the reader asks for one.
  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: picksFromPlaylist,
  });
  const known = playlists.data?.playlists ?? [];
  // The saved id is not checked against the table when it is written, so a
  // playlist deleted since then is a thing this row has to be able to say.
  const missing =
    picksFromPlaylist &&
    settings.playlist !== "" &&
    playlists.isSuccess &&
    !known.some((playlist) => playlist.id === settings.playlist);

  return (
    <Modal title="Background music" onClose={onClose}>
      <PrivateSettingRow
        id="music-enabled"
        label="Background music"
        description="Play songs from the library while nobody is singing. The sound comes out of the host screen, so that page has to be open."
        saved={savedField === "enabled"}
        inline
      >
        {(inputId, describedBy) => (
          <input
            className="setting-toggle"
            id={inputId}
            aria-describedby={describedBy}
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
        )}
      </PrivateSettingRow>

      <PrivateSettingRow
        id="music-scope"
        label="Pick songs from"
        description="Every song, the wishlist (each song once, or as often as it was wished for), or one playlist."
        saved={savedField === "scope"}
      >
        {(inputId, describedBy) => (
          <select
            className="text-input text-input-quiet setting-input"
            id={inputId}
            aria-describedby={describedBy}
            value={settings.scope}
            disabled={busy}
            onChange={(event) => onChange({ scope: event.target.value })}
          >
            {MUSIC_SCOPES.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </select>
        )}
      </PrivateSettingRow>

      {picksFromPlaylist && (
        <PrivateSettingRow
          id="music-playlist"
          label="Playlist"
          description={
            missing
              ? "The saved playlist no longer exists, so the music has nothing to play. Choose another one."
              : "The playlist the music plays. A playlist that is deleted leaves the music with nothing to play."
          }
          saved={savedField === "playlist"}
        >
          {(inputId, describedBy) => (
            <select
              className="text-input text-input-quiet setting-input"
              id={inputId}
              aria-describedby={describedBy}
              value={missing ? "" : settings.playlist}
              disabled={busy || playlists.isPending}
              onChange={(event) => onChange({ playlist: event.target.value })}
            >
              <option value="">Choose a playlist</option>
              {known.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          )}
        </PrivateSettingRow>
      )}

      <PrivateSettingRow
        id="music-preview"
        label="Play the song the reel lands on"
        description="When the reel on the host screen lands, that song plays from where its singing starts until somebody presses Play or gives the pick up. The background music pauses for it. Works whether or not the background music is on."
        saved={savedField === "preview_on_spin"}
        inline
      >
        {(inputId, describedBy) => (
          <input
            className="setting-toggle"
            id={inputId}
            aria-describedby={describedBy}
            type="checkbox"
            checked={settings.preview_on_spin}
            disabled={busy}
            onChange={(event) =>
              onChange({ preview_on_spin: event.target.checked })
            }
          />
        )}
      </PrivateSettingRow>

      <PrivateSettingRow
        id="music-resume"
        label="Wait before the music comes back"
        description="How long the room stays quiet after a song. The scores and any new badges are read in that gap."
        saved={savedField === "resume_delay_s"}
      >
        {(inputId, describedBy) => (
          <SecondsInput
            inputId={inputId}
            describedBy={describedBy}
            value={settings.resume_delay_s}
            min={MIN_DELAY}
            max={MAX_DELAY}
            disabled={busy}
            onCommit={(seconds) => onChange({ resume_delay_s: seconds })}
          />
        )}
      </PrivateSettingRow>
    </Modal>
  );
}
