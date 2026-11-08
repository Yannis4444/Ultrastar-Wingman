import { useQuery } from "@tanstack/react-query";
import type { GroupRef, UserRead } from "./api";
import { getMeOptions } from "./api/@tanstack/react-query.gen";
import { groupWords } from "./groups";

export interface Auth {
  /** The logged-in account, or `null` for a guest (and for the host session). */
  user: UserRead | null;
  /**
   * The caller's permission groups in the backend's one order: Guest alone
   * without an account, User and the account's groups with one, Admin for the
   * host — the backend never 401s `/auth/me`.
   */
  groups: GroupRef[];
  /** The host screen, or an account in Admin. */
  isAdmin: boolean;
  /** The user tile's line, `groups.ts` `groupWords` over the two above. Empty
   *  until `/auth/me` answered. */
  groupWords: string;
  capabilities: string[];
  isHost: boolean;
  /** False until `/auth/me` answered, so no login form flashes on a reload. */
  loaded: boolean;
  can: (capability: string) => boolean;
}

/**
 * Who the browser is and what it may do. No context provider: the query cache
 * already shares one `/auth/me` result between every component that asks.
 */
export function useAuth(): Auth {
  const me = useQuery(getMeOptions()).data;
  const groups = me?.groups ?? [];
  const isAdmin = me?.is_admin ?? false;

  return {
    user: me?.user ?? null,
    groups,
    isAdmin,
    groupWords: groupWords(groups, isAdmin),
    capabilities: me?.capabilities ?? [],
    isHost: me?.is_host ?? false,
    loaded: me !== undefined,
    // Unknown permissions allow the action: the backend enforces every
    // capability itself, and a UI that hides everything while `/auth/me` is in
    // flight (or unreachable) is worse than a 403 notice on the click.
    can: (capability) =>
      me === undefined || me.capabilities.includes(capability),
  };
}
