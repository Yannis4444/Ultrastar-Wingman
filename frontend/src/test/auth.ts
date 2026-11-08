import type { GroupRef, MeRead, UserRead } from "../api";
import { TRUSTED_GROUP_ID } from "../groups";

// Said once, in `groups.ts`; tests that build group rows import it from here.
export { TRUSTED_GROUP_ID };

const GUEST: GroupRef = { id: "guest", name: "Guest" };
const USER: GroupRef = { id: "user", name: "User" };
const TRUSTED: GroupRef = { id: TRUSTED_GROUP_ID, name: "Trusted" };
const ADMIN: GroupRef = { id: "admin", name: "Admin" };

/**
 * The groups part of a mocked `/auth/me`, per kind of caller: spread into a
 * `meResponse` override (`{ user: userRead(), ...AS.user }`).
 */
export const AS = {
  guest: { groups: [GUEST], is_admin: false },
  user: { groups: [USER], is_admin: false },
  trusted: { groups: [USER, TRUSTED], is_admin: false },
  admin: { groups: [USER, ADMIN], is_admin: true },
  host: { groups: [ADMIN], is_admin: true },
} satisfies Record<string, Pick<MeRead, "groups" | "is_admin">>;

/** The explicit memberships of an account (`UserRead.groups`), per kind. */
export const MEMBER_OF = {
  user: [] as string[],
  trusted: [TRUSTED_GROUP_ID],
  admin: ["admin"],
};

/**
 * What a mocked `getMe` resolves with. Anonymous by default — pass a `user` (and
 * the capabilities its groups hold) for a logged-in browser.
 */
export function meResponse(
  capabilities: string[],
  overrides: Partial<MeRead> = {},
): { data: MeRead } {
  return {
    data: {
      user: null,
      ...AS.guest,
      capabilities,
      is_host: false,
      ...overrides,
    },
  };
}

export function userRead(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: "user-1",
    username: "Alice",
    groups: [],
    player_id: "aaa",
    auth_provider: "local",
    ...overrides,
  };
}
