import { useQuery } from "@tanstack/react-query";
import type { UserRead } from "./api";
import { getMeOptions } from "./api/@tanstack/react-query.gen";

export interface Auth {
  /** The logged-in account, or `null` for a guest (and for the host session). */
  user: UserRead | null;
  /** `guest` for anonymous callers — the backend never 401s `/auth/me`. */
  role: string | null;
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

  return {
    user: me?.user ?? null,
    role: me?.role ?? null,
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
