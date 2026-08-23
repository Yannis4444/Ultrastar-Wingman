import type { MeRead, UserRead } from "../api";

/**
 * What a mocked `getMe` resolves with. Anonymous by default — pass a `user` (and
 * the capabilities its role holds) for a logged-in browser.
 */
export function meResponse(
  capabilities: string[],
  overrides: Partial<MeRead> = {},
): { data: MeRead } {
  return {
    data: {
      user: null,
      role: "guest",
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
    role: "user",
    player_id: "aaa",
    ...overrides,
  };
}
