import type { Auth } from "./auth";
import type { IconName } from "./components/icons";

export interface ManageEntry {
  /** Holding any one of these is enough for the entry to appear. */
  capabilities: string[];
  label: string;
  to: string;
  icon: IconName;
}

/**
 * The management surfaces, one navigation row each — never inline on the page
 * that lists them. The phone lists them under "Manage" on the user page, the
 * host screen on a view of its own; the pages behind them are the same.
 *
 * The people page gathers four rights, any one of which is something to do
 * there: the players, their pictures, reading the accounts and managing them.
 * Merely *seeing* the players is not among them — every party guest holds
 * `players.view` (the singer picker needs it), and a "Manage" heading over the
 * login form would promise a stranger something to do.
 */
export const MANAGE_ENTRIES: ManageEntry[] = [
  {
    capabilities: ["settings.view"],
    label: "Settings",
    to: "/settings",
    icon: "gear",
  },
  {
    capabilities: [
      "players.manage",
      "players.avatar",
      "users.view",
      "users.manage",
    ],
    label: "Players & accounts",
    to: "/user/accounts",
    icon: "users",
  },
  {
    capabilities: ["permissions.manage"],
    label: "Permissions",
    to: "/user/permissions",
    icon: "shield",
  },
];

/**
 * The entries this browser may open. `loaded` is part of the gate: `can` says
 * yes until /auth/me answered, and a guest must not see the management rows (or
 * their requests) at all.
 */
export function manageEntries(auth: Auth): ManageEntry[] {
  return auth.loaded
    ? MANAGE_ENTRIES.filter((entry) =>
        entry.capabilities.some((name) => auth.can(name)),
      )
    : [];
}
