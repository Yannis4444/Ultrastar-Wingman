import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDeviceStatusOptions,
  getDeviceStatusQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useWingmanEvent } from "./useWingmanEvents";

export interface SelectorStatus {
  /** Whether a compatible player selector is reporting right now. */
  online: boolean;
  /** False until the answer is in. A surface that says something about a
   *  selector being gone has to wait for it: an unanswered request is not a
   *  device that went away. */
  isSuccess: boolean;
}

/**
 * Whether the room has a player selector in it — one request shared by every
 * surface that says so: the phone's picker while it is open, and the host rail.
 *
 * Behind no capability and behind no `auth.loaded`, the way `useAchievements`
 * is: `GET /devices/status` says one boolean about the room and nothing about
 * the devices themselves, and `can` answers yes while `/auth/me` is still in
 * flight, which would make the gate a coin toss on the first render.
 */
export function useSelectorStatus(): SelectorStatus {
  const queryClient = useQueryClient();
  const status = useQuery(getDeviceStatusOptions());

  // The watchdog broadcasts this on the online/offline transition, and the
  // report path on every state change: one refetch answers both.
  useWingmanEvent("devices.changed", () => {
    void queryClient.invalidateQueries({ queryKey: getDeviceStatusQueryKey() });
  });

  return { online: status.data?.online ?? false, isSuccess: status.isSuccess };
}
