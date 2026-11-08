import type { GroupRead, GroupRef } from "./api";

/**
 * The permission groups' vocabulary, said once (docs/dev/permission-groups.md).
 *
 * Three groups are built in and have word ids: Guest (every phone without an
 * account), User (every account, without a row) and Admin (every right, by
 * rule). Trusted is an ordinary group with a fixed id, so the tag editor's
 * default for a new tag can name it. Every list of groups the backend answers
 * already runs in the one order — Guest, User, the rest by name, Admin — so
 * nothing here sorts.
 */
export const GUEST = "guest";
export const USER = "user";
export const ADMIN = "admin";

/** The fixed id of Trusted (`auth.permissions.TRUSTED_GROUP_ID`). */
export const TRUSTED_GROUP_ID = "7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5";

/** Guest and User: their names are kept and they cannot be deleted. Admin is
 *  built in too, but it is never edited at all. */
export function isBuiltIn(id: string): boolean {
  return id === GUEST || id === USER || id === ADMIN;
}

/** Whether somebody can be put in the group: everyone but Guest (nobody with an
 *  account) and User (every account, without a row). */
export function isAssignable(id: string): boolean {
  return id !== GUEST && id !== USER;
}

/**
 * The one line saying which groups somebody is in (§9.3): *Admin* for an
 * administrator, otherwise the groups beyond User by name joined by ` · `
 * (*DJs · Trusted*), or *User* when there are none — *Guest* for a phone
 * without an account. Empty while there is nothing to say.
 */
export function groupWords(groups: GroupRef[], isAdmin: boolean): string {
  if (isAdmin) return "Admin";
  const own = groups.filter((group) => isAssignable(group.id));
  if (own.length > 0) return own.map((group) => group.name).join(" · ");
  if (groups.some((group) => group.id === USER)) return "User";
  return groups[0]?.name ?? "";
}

/**
 * An account's explicit memberships (`UserRead.groups`, ids) as the refs
 * `groupWords` reads, named out of `GET /groups` and always with User in front,
 * because every account is in it. An id the listing does not hold is left out:
 * a group deleted since the accounts were read is nobody's any more.
 */
export function accountGroups(ids: string[], groups: GroupRead[]): GroupRef[] {
  const named = groups.filter(
    (group) => isAssignable(group.id) && ids.includes(group.id),
  );
  return [
    { id: USER, name: "User" },
    ...named.map(({ id, name }) => ({ id, name })),
  ];
}

/** "1 right", "13 rights". */
function rights(count: number): string {
  return count === 1 ? "1 right" : `${count} rights`;
}

/**
 * What a group gives, out of `right_count` (never `capabilities`, which only a
 * `permissions.manage` reader is told): Guest's and User's own count, what any
 * other group adds beyond User's (*adds 11 rights*), and *every right* for
 * Admin, whose count is `null`.
 */
export function addedRights(group: GroupRead): string {
  if (group.id === ADMIN || group.right_count === null) return "every right";
  if (group.id === GUEST || group.id === USER) return rights(group.right_count);
  return `adds ${rights(group.right_count)}`;
}

/** Who is in a group, for the Groups page's meta line. */
export function memberWords(group: GroupRead): string {
  if (group.id === GUEST) return "Everybody without an account";
  if (group.id === USER) return "Every account";
  const count = group.member_count ?? 0;
  return count === 1 ? "1 member" : `${count} members`;
}
