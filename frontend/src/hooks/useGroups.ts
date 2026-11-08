import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GroupList } from "../api";
import {
  listGroupsOptions,
  listGroupsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "./useWingmanEvents";

/** Any one of these opens `GET /groups` (`deps.require_any` on the backend). */
const READERS = [
  "users.view",
  "users.manage",
  "permissions.manage",
  "tags.manage",
];

export interface Groups {
  /** The listing, `undefined` until it answered or while it may not be asked. */
  data: GroupList | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

/**
 * The permission groups, one `GET /groups` shared by every surface that draws
 * them: the Groups page and its editor, the accounts page's panel and the tag
 * editor. Asked only once `/auth/me` answered and the reader holds one of the
 * four capabilities that open it — `can` says yes while it is in flight, and a
 * guest phone must not fire a request that is refused.
 *
 * `groups.changed` is handled once for the whole app (`App.tsx`); here only
 * `players.changed`, which is what registering or deleting an account sends
 * and which moves the member counts this listing carries.
 */
export function useGroups(enabled = true): Groups {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed =
    enabled && auth.loaded && READERS.some((name) => auth.can(name));
  const groups = useQuery({ ...listGroupsOptions(), enabled: allowed });

  useWingmanEvent("players.changed", () => {
    if (!allowed) return;
    void queryClient.invalidateQueries({ queryKey: listGroupsQueryKey() });
  });

  return {
    data: groups.data,
    isPending: groups.isPending,
    isError: groups.isError,
    isSuccess: groups.isSuccess,
  };
}
