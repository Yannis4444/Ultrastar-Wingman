import type { GroupRead } from "./api";
import {
  accountGroups,
  addedRights,
  ADMIN,
  GUEST,
  groupWords,
  isAssignable,
  isBuiltIn,
  memberWords,
  TRUSTED_GROUP_ID,
  USER,
} from "./groups";

function group(overrides: Partial<GroupRead> & { id: string }): GroupRead {
  return {
    name: overrides.id,
    built_in: isBuiltIn(overrides.id),
    member_count: 0,
    capabilities: null,
    right_count: 0,
    can_assign: false,
    ...overrides,
  };
}

const GUEST_REF = { id: GUEST, name: "Guest" };
const USER_REF = { id: USER, name: "User" };
const TRUSTED_REF = { id: TRUSTED_GROUP_ID, name: "Trusted" };
const DJS_REF = { id: "d".repeat(32), name: "DJs" };
const ADMIN_REF = { id: ADMIN, name: "Admin" };

test("the line says Admin for an administrator, whatever else they are in", () => {
  expect(groupWords([USER_REF, TRUSTED_REF, ADMIN_REF], true)).toBe("Admin");
  // The host screen: Admin without an account.
  expect(groupWords([ADMIN_REF], true)).toBe("Admin");
});

test("otherwise the groups beyond User, in the order they came, or User", () => {
  expect(groupWords([USER_REF, TRUSTED_REF, DJS_REF], false)).toBe(
    "Trusted · DJs",
  );
  expect(groupWords([USER_REF], false)).toBe("User");
  // A phone without an account is Guest, and says so.
  expect(groupWords([GUEST_REF], false)).toBe("Guest");
  // Nothing known yet: nothing to say.
  expect(groupWords([], false)).toBe("");
});

test("an account's ids become named refs, User first, a gone id dropped", () => {
  const listing = [
    group({ id: GUEST, name: "Guest" }),
    group({ id: USER, name: "User" }),
    group({ id: DJS_REF.id, name: "DJs" }),
    group({ id: TRUSTED_GROUP_ID, name: "Trusted" }),
    group({ id: ADMIN, name: "Admin" }),
  ];

  expect(accountGroups([TRUSTED_GROUP_ID, "gone"], listing)).toEqual([
    USER_REF,
    TRUSTED_REF,
  ]);
  // The listing's order wins over the order the ids were stored in.
  expect(
    groupWords(accountGroups([TRUSTED_GROUP_ID, DJS_REF.id], listing), false),
  ).toBe("DJs · Trusted");
  expect(accountGroups([], listing)).toEqual([USER_REF]);
});

test("what a group gives reads its right count, never its capabilities", () => {
  expect(addedRights(group({ id: GUEST, right_count: 8 }))).toBe("8 rights");
  expect(addedRights(group({ id: USER, right_count: 13 }))).toBe("13 rights");
  expect(addedRights(group({ id: TRUSTED_GROUP_ID, right_count: 11 }))).toBe(
    "adds 11 rights",
  );
  expect(addedRights(group({ id: DJS_REF.id, right_count: 1 }))).toBe(
    "adds 1 right",
  );
  expect(addedRights(group({ id: DJS_REF.id, right_count: 0 }))).toBe(
    "adds 0 rights",
  );
  expect(addedRights(group({ id: ADMIN, right_count: null }))).toBe(
    "every right",
  );
});

test("who is in a group, per kind", () => {
  expect(memberWords(group({ id: GUEST, member_count: null }))).toBe(
    "Everybody without an account",
  );
  expect(memberWords(group({ id: USER, member_count: 9 }))).toBe(
    "Every account",
  );
  expect(memberWords(group({ id: TRUSTED_GROUP_ID, member_count: 1 }))).toBe(
    "1 member",
  );
  expect(memberWords(group({ id: ADMIN, member_count: 2 }))).toBe("2 members");
});

test("nobody is put in Guest or User, and only the three are built in", () => {
  expect(isAssignable(GUEST)).toBe(false);
  expect(isAssignable(USER)).toBe(false);
  expect(isAssignable(ADMIN)).toBe(true);
  expect(isAssignable(TRUSTED_GROUP_ID)).toBe(true);
  expect(isBuiltIn(ADMIN)).toBe(true);
  expect(isBuiltIn(TRUSTED_GROUP_ID)).toBe(false);
});
