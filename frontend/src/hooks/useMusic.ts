import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MusicRead, MusicSettings } from "../api";
import {
  getMusicOptions,
  getMusicQueryKey,
  getMusicSettingsOptions,
  getMusicSettingsQueryKey,
  pauseMusicMutation,
  playMusicMutation,
  setMusicVolumeMutation,
  skipMusicMutation,
  updateMusicSettingsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail } from "../errors";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

interface MusicChanged extends WingmanEvent {
  music: MusicRead;
}

export interface Music {
  /** Undefined until the first answer, and for a reader without `music.view`. */
  state: MusicRead | undefined;
  /** The options behind the gear. Only asked for with `music.manage`. */
  settings: MusicSettings | undefined;
  isPending: boolean;
  /** True while a control is in flight, so a row can disable itself. */
  isBusy: boolean;
  /** The machine-readable refusal of the last control press, if it was refused —
   *  `music_disabled`, `music_blocked` or `empty_pool`. */
  refusal: string | null;
  play: () => void;
  pause: () => void;
  skip: () => void;
  /** `onSettled` runs once the write is answered either way, so a slider can
   *  let go of the value it was showing exactly when the stored one is back. */
  setVolume: (
    volume: {
      master?: number;
      music?: number;
      effects?: number;
    },
    onSettled?: () => void,
  ) => void;
  patchSettings: (settings: Partial<MusicSettings>) => void;
}

/**
 * What the background music is doing, shared by every surface that draws it:
 * the Home stage, the host screen's quiet line, and the sink that makes the
 * sound.
 *
 * One request. The `music.changed` event carries the whole state, so it is
 * written straight into the cache — a refetch per event would be a request per
 * phone per song, and the payload is already here.
 */
export function useMusic(): Music {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const mayView = auth.loaded && auth.can("music.view");
  const mayManage = auth.loaded && auth.can("music.manage");

  const state = useQuery({ ...getMusicOptions(), enabled: mayView });
  const settings = useQuery({
    ...getMusicSettingsOptions(),
    enabled: mayManage,
  });

  useWingmanEvent<MusicChanged>("music.changed", (message) => {
    queryClient.setQueryData(getMusicQueryKey(), message.music);
  });

  const write = <T>(options: T) => ({
    ...options,
    onSuccess: (music: MusicRead) => {
      queryClient.setQueryData(getMusicQueryKey(), music);
    },
  });

  const play = useMutation(write(playMusicMutation()));
  const pause = useMutation(write(pauseMusicMutation()));
  const skip = useMutation(write(skipMusicMutation()));
  const volume = useMutation(write(setMusicVolumeMutation()));
  const options = useMutation({
    ...updateMusicSettingsMutation(),
    onSuccess: (updated: MusicSettings) => {
      queryClient.setQueryData(getMusicSettingsQueryKey(), updated);
      // Switching the music on changes what `GET /music` answers, and the
      // backend broadcasts it — but the writer should not have to wait for its
      // own socket message to see the switch move.
      void queryClient.invalidateQueries({ queryKey: getMusicQueryKey() });
    },
  });

  const controls = [play, pause, skip, volume];
  // The one refusal a control row shows. Only the three controls can be
  // refused; a volume or a settings write answers 422, which is the panel's.
  const refused = [play, pause, skip].find((control) => control.isError);

  return {
    state: state.data,
    settings: settings.data,
    isPending: mayView && state.isPending,
    isBusy: controls.some((control) => control.isPending),
    refusal: refused === undefined ? null : errorDetail(refused.error),
    play: () => play.mutate({}),
    pause: () => pause.mutate({}),
    skip: () => skip.mutate({}),
    setVolume: (body, onSettled) => volume.mutate({ body }, { onSettled }),
    patchSettings: (body) => options.mutate({ body }),
  };
}
