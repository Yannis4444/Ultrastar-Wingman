import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AchievementRead, AchievementSettings } from "../api";
import {
  listAchievementsOptions,
  listAchievementsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useWingmanEvent } from "./useWingmanEvents";

/**
 * What the party's three knobs are before the listing has answered, and what a
 * build older than its backend falls back to. Mirrors `DEFINITIONS` in the
 * backend's `achievements/settings.py`.
 *
 * `enabled` starts true on purpose: the alternative is every badge surface
 * blinking out of existence for the length of one request on a party that has
 * them on, which is the far commoner case.
 */
export const DEFAULT_ACHIEVEMENT_SETTINGS: AchievementSettings = {
  enabled: true,
  host_seconds_base: 4,
  host_seconds_per_badge: 2,
};

export interface Achievements {
  /**
   * The catalogue in the order the API returns it — `sort_order`, the host's
   * own arrangement, and `created_at` where two rows are sorted the same.
   * A `hidden` one this reader has not earned arrives masked — no name, no
   * sentence, no glyph — so every surface drawing a row has to ask `isMasked`.
   * Masked for *whoever* is reading, an administrator on their own user page
   * and the host screen included: unmasking is `?manage=true`, which only the
   * two management pages ask for (`achievements.MANAGE_CATALOGUE`).
   */
  achievements: AchievementRead[];
  /** The three knobs, never null: the defaults stand in until the answer. */
  settings: AchievementSettings;
  /** The one that decides whether anything is drawn at all. */
  enabled: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

const NO_ACHIEVEMENTS: AchievementRead[] = [];

/**
 * The catalogue and its settings — one request shared by every surface that
 * draws a badge: the user page, the song modal's neighbours, the host screen.
 *
 * Behind no capability and behind no `auth.loaded`, unlike `useTags`: reading
 * the catalogue needs nothing at all (a guest phone and the TV both draw badges)
 * and the masking is done per caller by the API, on the credentials the request
 * already carries. Logging in invalidates every query, so the mask is redrawn
 * for whoever the browser has become.
 *
 * The admin page does **not** use this: it is gated on `achievements.manage`,
 * has to make no request at all for somebody who has not got it (exactly the way
 * `Tags.tsx` keeps its own gated query rather than calling `useTags`) — and it
 * asks `?manage=true`, which is a second cache entry and the only unmasked one.
 */
export function useAchievements(): Achievements {
  const queryClient = useQueryClient();
  const achievements = useQuery(listAchievementsOptions());

  // No payload to read: what a listener may see of the catalogue is masked per
  // caller, so everybody refetches and the API masks for whoever asks.
  useWingmanEvent("achievements.changed", () => {
    void queryClient.invalidateQueries({
      queryKey: listAchievementsQueryKey(),
    });
  });

  const rows = achievements.data?.achievements;
  const settings = achievements.data?.settings;
  const { isPending, isError, isSuccess } = achievements;

  return useMemo(() => {
    const values = settings ?? DEFAULT_ACHIEVEMENT_SETTINGS;
    return {
      achievements: rows ?? NO_ACHIEVEMENTS,
      settings: values,
      enabled: values.enabled,
      isPending,
      isError,
      isSuccess,
    };
  }, [rows, settings, isPending, isError, isSuccess]);
}
