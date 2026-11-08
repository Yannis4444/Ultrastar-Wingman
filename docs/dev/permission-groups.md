# Permission groups

*Design, 2026-11-08. Branch `feat/groups-reel-sfx`. Two bundles build from it: **08** the
backend (tables, migration, API, the auth dependencies, the regenerated client) and **09** the
frontend and the user documentation (§15 lists every file of each). Every question in it is
answered here, with the reason, and §14 lists again the answers the user may want to veto.
Where this document and the code disagree after the round, the code is right and this document
is updated.*

Today an account holds exactly one **role** — `guest`, `user`, `trusted` or `admin` — and a
role is a bundle of capabilities stored in `role_permissions`. Four bundles, fixed names, one
per account. This round replaces roles with **groups**: the host makes as many as the party
needs, names them, says what each may do, and puts accounts in them. Capabilities, and every
check in `auth/deps.py`, stay exactly what they are (architecture.md, *Permissions*): a group is
still a bundle, and nothing in Wingman asks which group somebody is in.

## 1. Decisions

The user asked (2026-11-08), in their words:

> I would like to have a more comprehensive permission system. I want configurable groups
> that permissions can be assigned to. By default, the Guest and User should be always
> available - they are always there. Admin is always available as well as an inbuilt group.
> I would also add trusted as a pre-defined group, that is added by default. It should be
> handled like a custom group the user created. Give the user an option to create new groups
> that then can be used to assign users and permissions to. How about allowing to get groups
> from the OIDC provider? Is that a good idea?

Taken from those words: three built-in groups (Guest, User, Admin), Trusted as an ordinary
group the update creates, groups the host creates, renames and deletes, and both people and
capabilities assigned to a group. The OIDC question is answered in §11 and built by nobody.

Made here, open to a veto (§14 has the full list):

1. **Several groups per account**, their capabilities added up (§3.1). An account is in
   **User** without a row, and in any number of other groups by a row each.
2. **Guest is not inherited.** Guest is what a caller without an account holds; an account
   holds User's bundle and its groups', never Guest's (§3.2). That is today's rule ("bundles,
   not a ladder"), and it is what lets the migration keep every account's rights exactly.
3. **Admin is a rule, not rows.** Its members hold every capability, its capability set
   cannot be written, and only an administrator puts somebody in it or takes them out (§5).
4. **Nobody but an administrator hands out a right they do not hold** (§5.1). One rule closes
   both escalation paths: giving a group a capability, and putting somebody in a group.
5. **Trusted keeps a fixed id** (`TRUSTED_GROUP_ID`, the `BROKEN_TAG_ID` precedent) so the
   migration, the tag defaults and the tests can name it, and is otherwise an ordinary row:
   renamed, emptied or deleted like any group the host made (§2.3).
6. **Memberships are read on every request, never cached**, and only the group → capabilities
   map is (§4). A change reaches a logged-in session on its next request with nothing to
   invalidate, and a payload-free `groups.changed` tells the open pages to read `/auth/me`
   again.
7. **The Permissions page becomes Groups**: a list of the groups and one editor per group, not
   a matrix with a column per group (§9.1). A column cannot hold a name somebody typed, and a
   phone cannot hold five columns.
8. **Membership is written on the account**, `PUT /users/{id}/groups`, from the accounts page
   alone (§6). One write path, one place to check the rules.
9. **One migration** moves roles into groups and drops `role_permissions`, `users.role` and
   `tag_permissions.role` (§8). It never takes a right away from an account the API could have
   made, and it can run again after a failure halfway, which on this SQLite stack is not
   rolled back whole (§8.1, measured).

## 2. The model

### 2.1 A group

A group is a row in `groups` — an id and a display name — and its capabilities are rows in
`group_capabilities`, exactly as a role's were rows in `role_permissions`. Every check stays a
capability check; the set a caller holds is the union of the bundles their groups carry (§3.2).

No foreign keys, `auth/model.py`'s rule: SQLite enforces them only under `PRAGMA foreign_keys`,
which Wingman does not set. So every reader treats a `group_capabilities`, `user_groups` or
`tag_permissions` row naming a group that is gone as giving nothing (§3.2), and the writes that
delete a group or an account delete their rows themselves (§3.3).

### 2.2 The three built-ins

| Id | Name | Who is in it | Its capabilities |
|---|---|---|---|
| `guest` | Guest | Every caller without an account, and nobody else | Rows, editable, as today |
| `user` | User | Every account, without a row | Rows, editable, as today |
| `admin` | Admin | The accounts with a row in it, and the host screen without one | Every capability, by rule |

Built-ins have word ids, are rows in `groups` (so their names reserve themselves in the name
index, §2.4), and can be neither renamed nor deleted. Whether a group is built in is read off
its id (`permissions.BUILT_IN_GROUPS`), never stored as a column that could disagree with it.

Admin holds `ALL_CAPABILITIES` the way `all_role_capabilities` hands it out today: in code,
whatever the table says, so a damaged table can never lock the administrators out. It has no
rows in `group_capabilities`, and a write to them is refused (§5).

### 2.3 Trusted

The migration creates **Trusted** with the fixed id `TRUSTED_GROUP_ID =
"7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5"` and copies today's `trusted` rows into it (§8), so a
party that already has trusted helpers keeps them, rights and all. After that it is an
ordinary group: the host may rename it, change what it may do, or delete it, and its members
then lose what it gave them and nothing else. A group the host makes later and calls
"Trusted" gets a new id like any other.

The fixed id is the `tags.model.BROKEN_TAG_ID` precedent: a seeded row "with this exact id so
tests and documentation can name it", which is otherwise an ordinary row. A 32-hex id cannot
collide with the built-ins' words, and a fresh database gets the same id, so the tag editor's
default for a new tag (§7) and every future seed migration (§8.4) can name it.

### 2.4 Custom groups and their names

A group the host makes gets a `uuid4().hex` id. Its name is:

- trimmed, then **1 to 32 characters** (the tag name's bounds, `tags.model.MAX_NAME_LENGTH`);
- **unique case-insensitively**, under a `lower(name)` unique index exactly like tags,
  usernames and player names (the same ASCII-only fold). Because the built-ins are rows named
  *Guest*, *User* and *Admin*, that index alone refuses `admin`, `ADMIN` or ` Admin `: the
  three names and their case variants are reserved without a list of reserved words.

A clash is 409 `duplicate_group_name`, checked before the write and caught again as an
`IntegrityError` at the flush, the `tags._check_name` shape. The id never changes on a rename,
so a rename moves nothing: memberships, tag rows and the editor's URL all follow.

### 2.5 One order

Everywhere a list of groups is drawn or answered — the groups page, `GET /groups`, the
accounts page's panel, the tag editor, `MeRead`, `UserRead` — it runs **Guest, User, the other
groups by `lower(name)` then id, Admin**. Admin goes last because it is the one that is not
edited. No `sort_order` column: nobody asked to arrange groups, and a name order is the one a
reader predicts.

## 3. Membership

### 3.1 Several groups, not one

The user's words are that groups are "used to assign users and permissions to", and that
Trusted is "handled like a custom group". Under **one group per account** — today's shape,
`users.role` renamed — a custom group is only useful if it repeats everything Trusted holds:
an account cannot be a trusted helper *and* in "DJs", so "DJs" has to be Trusted plus the music,
and a third need is a fourth group. The number of groups would grow with the combinations, and
every one of them would have to be kept in step by hand.

Under **several groups** a group is one job: Trusted is the helpers, DJs is the music,
Moderators is the comments and the scores, and Fry can be two of them. The cost is small and
already paid elsewhere: a membership table (`user_groups`), one indexed query per request
(§4), and the tag rows' `role = :role` becoming `group_id IN (:groups)` — `tags.allowed`
already loops over rows. So: **several groups, their capabilities added up.**

### 3.2 What a caller holds

| Caller | Groups (`Principal.groups`) | Capabilities |
|---|---|---|
| No account | `{guest}` | Guest's |
| An account | `{user}` and every group it has a row in | User's, and every one of those groups' |
| An account in Admin | as above, `admin` among them | every capability |
| The host screen | `{admin}` | every capability |

Guest's capabilities are **not** part of an account's. Today a `user` account holds the `user`
bundle and nothing of `guest`'s; Wingman's defaults simply put every guest right into User as
well. Keeping that means the migration reproduces every plain account exactly (§8.3), and a
host who takes a right from phones without an account does not take it from accounts by
accident. The cost is that a right meant for everybody is ticked twice, under Guest and under
User, as it is today.

A group, on the other hand, **adds** to User: a new group starts empty and still leaves its
members with everything User holds. So the editor of a group draws what User already gives as
ticked and locked (§9.1), rather than leaving the reader to wonder why an empty group's
members can sing.

A stored group id that no longer names a group — a hand-edited row — gives nothing, never a
500, the `capabilities_for` rule of today. It is not listed either: `UserRead.groups`,
`MeRead.groups` and the member counts read `user_groups` joined to `groups`, so the next
`PUT /users/{id}/groups` the accounts page sends (the whole set, as listed) drops the row. A tag
row naming a gone group is listed by `GET /tags/{id}` as stored, and the tag editor leaves it
out of what it sends back (§9.4), so it can never block a save with 422 `unknown_group`.

### 3.3 The fixed points

- **User is implicit.** No account has a `user` row, and `PUT /users/{id}/groups` refuses
  `user` and `guest` (422 `not_assignable`): User is every account, Guest is nobody with one.
- **Admin is explicit**: a `user_groups` row like any other, so an administrator can also be in
  Trusted, which changes nothing while they are an administrator and keeps them a helper the
  day they step down.
- **The host screen is admin without a row.** `current_principal` gives a host session
  `{admin}`; it owns nothing and is in no member count.
- **The first account ever is the administrator**, as today (`_role_for_new_user` becomes
  `_groups_for_new_user`): the first registration, local or single sign-on, gets an `admin`
  row; every later one gets none.
- **An account single sign-on creates lands in User alone.** `upsert_oidc_user` writes no
  membership (bar the first-account rule); nothing in the ID token is read for groups (§11).
- **The last administrator stays.** Today `set_user_role` and `delete_user` refuse, 409
  `last_admin`, to demote or delete the only `admin` account (`service._admin_count`, tested by
  `test_auth_api.test_the_last_admin_cannot_be_demoted_or_deleted`). It becomes: no write may
  leave the `admin` group without a member — taking its last member out through
  `PUT /users/{id}/groups`, or deleting that account — and the slug stays `last_admin`, which
  `PeopleAdmin.accountMessage` already words. The count is over `user_groups` rows whose account
  exists. The host screen does not count: it is one browser, and its token works once per start.
- **Deleting a group** deletes its `group_capabilities`, its `user_groups` and its
  `tag_permissions` rows, in one transaction. Its members lose the group and nothing else:
  their accounts, players, wishes, playlists and the rights other groups give them stay.
- **Deleting an account** deletes its `user_groups` rows in the transaction that already deletes
  its sessions (`service.delete_user`).

## 4. Where a caller's capabilities come from

`auth/permissions.py` keeps the module cache, keyed by **group id** now:
`_cache: dict[str, frozenset[str]] | None`, every group in the table with its capabilities
(unknown capability names dropped as today) and `admin` set to `ALL_CAPABILITIES` in code. It is
loaded by one query and invalidated by every write that changes it: creating a group, setting
its capabilities, deleting it. A rename changes no capability and leaves it alone.

**Memberships are not cached.** `current_principal` already reads the session row and the
`User` row on every request; it reads `select(UserGroup.group_id).where(user_id == …)` beside
them — one query on the primary key's leading column — and builds:

```python
@dataclass(frozen=True)
class Principal:
    user: User | None
    is_host: bool
    groups: frozenset[str]        # §3.2: {guest}, {user, …}, {admin}
    is_admin: bool                # the host, or `admin` in `groups`
    capabilities: frozenset[str]  # permissions.capabilities_for_groups(session, groups)
```

`role` goes. `capabilities_for_groups` is the union over the cache, `ALL_CAPABILITIES` the
moment `admin` is among them, and a stale id contributes nothing.

So a membership change has nothing to invalidate: **the next request of that account reads the
new set.** No session is ended, no cookie changes. That is today's behaviour for a role change,
and `test_a_permission_change_takes_effect_without_a_restart` keeps proving it for capabilities.

**The open page learns it from an event.** `events.GroupsChanged` (`groups.changed`, no
payload, the `tags.changed` precedent, because what a reader may know about groups depends on
who they are) goes out after every write to a group or a membership: a group created, renamed,
its capabilities set, deleted; a membership written. Not on an account registered or deleted:
that moves only a member count, which is a manager's number, and `players.changed` already goes
out for both — the Groups page refetches `GET /groups` on it, so no phone in the room reads
`/auth/me` again because somebody signed up. The frontend invalidates `/auth/me`, the groups
list and the accounts list on `groups.changed` (§15.4), so a helper put in Trusted sees the download
button appear without a reload, and one taken out sees it go instead of meeting a 403. Today a
role change reaches nobody's page until a reload; this closes that.

## 5. Who may change what

`permissions.manage` holds the groups and their capabilities; `users.manage` holds the
memberships and the accounts, as it held roles. Both start with Admin alone. On top of the
capability each route requires, two rules — checked in the service, which is handed the
`Principal`'s `capabilities` and `is_admin` and never imports FastAPI:

1. **Admin is an administrator's.** Putting somebody in Admin, taking somebody out of it, and
   deleting an account that is in it need an administrator (`is_admin`), whatever else the
   caller holds: 403 `admin_required`.
2. **Nobody but an administrator hands out a right they do not hold.** A non-administrator
   setting a group's capabilities may add only capabilities they hold themselves (taking away
   is free); putting somebody in a group needs every capability that group carries (taking
   somebody out is free). The refusal names the first missing capability in catalogue order:
   403 `missing_permission:<capability>`, the slug every 403 already uses, so `errorMessage`
   words it with no new code.

**Both rules bind on the change, never on the body.** `PATCH /groups/{id}` and
`PUT /users/{id}/groups` carry the whole set, so the service compares it with what is stored
and checks only the difference: rule 2 looks at the capabilities and the groups being *added*,
rule 1 only at whether the `admin` row is being added or removed. A body that still contains
`admin` for an account that is already in it is no change to Admin, so a helper holding
`users.manage` may put an administrator in Moderators without being refused for the Admin row
the body carries along; and a group's capabilities the helper lacks but the group already has
stay where they are.

Rule 2 is what makes `permissions.manage` and `users.manage` safe to hand to a helper: whatever
such a helper writes, nobody — themselves included — ends up holding a capability the helper
did not already hold. Together the two rules leave exactly one way to grow beyond your own
rights: being given them by somebody who holds them.

"Hold" is the caller's own set on that request (`Principal.capabilities`), whatever group it
came from — a helper who holds `music.manage` only through DJs may tick it under User. "Carries"
is the group's own `group_capabilities` rows; User's rights are not counted, because the
account being put in the group holds them already. The host screen and every member of Admin
pass both rules (`is_admin`).

Neither rule restrains **taking away**: a non-administrator holding `permissions.manage` may
untick anything from any group but Admin (Guest and User included), or delete a group; one
holding `users.manage` may take anybody out of any group but Admin and delete any account that
is not in Admin. That is a loss for others and never a gain for anybody, it is what both
capabilities already allow today, and Admin — the way back from any of it — is out of reach.

### 5.1 The threats the review of 08 checks

| Attempt | Answer |
|---|---|
| A `users.manage` holder puts themselves in Admin | 403 `admin_required` (rule 1) |
| A `users.manage` holder deletes an administrator's account | 403 `admin_required` (rule 1); for an administrator caller, 409 `last_admin` if it is the last one |
| A `permissions.manage` holder gives their own group every capability | Each capability they do not hold is 403 `missing_permission:<it>` (rule 2); the ones they hold go through and change nothing for them |
| A `permissions.manage` holder makes a group with every capability, then a `users.manage` holder puts themselves in it | The first write is refused as above unless an administrator makes it; if one did, the second is 403 `missing_permission:<it>`, because whoever puts an account in a group must hold everything it carries (rule 2), themselves as the account included |
| A helper holding both `permissions.manage` and `users.manage` makes a group of what they hold and joins it | Allowed: it gives them nothing they did not hold |
| Anybody edits Admin's capabilities | 409 `admin_not_editable` (`PATCH /groups/admin` with `capabilities`) |
| Anybody renames or deletes Guest, User or Admin | 409 `built_in_group` |
| The last administrator is taken out of Admin, or deleted | 409 `last_admin`; Admin can never be emptied |
| A group named `admin`, `Admin`, ` ADMIN ` | 409 `duplicate_group_name`: the built-in row holds the name (§2.4) |
| An account is put in `user` or `guest` | 422 `not_assignable` (§3.3) |
| A body names a group that does not exist | 422 `unknown_group`, for memberships and tag rows alike, before anything is written |
| A stored row names a group that no longer exists | No capability, no tag right, not listed; never a 500 (§3.2) |
| A tag row is written for Admin | 422 `not_assignable`, the membership slug: Admin exists but is no subject, it sees every tag by rule, so a row for it would mean nothing |
| A `permissions.manage` holder renames their group to `Admin` | 409 `duplicate_group_name`; and a name is never what makes a group Admin — the id `admin` is (§2.2) |
| A `permissions.manage` holder ticks `users.manage` or `permissions.manage` under **Guest** or **User** | Allowed, as today (rule 2 binds: only a holder can tick it): every phone without an account, or every account, would then manage the people or this page. **Accepted**: it is the host's own table, both start with neither, rule 2 still binds whoever receives it, Admin stays out of their reach, and the user guide warns. Refusing it would make Guest and User the groups with rules of their own |
| A non-administrator unticks everything from Guest and User, or deletes Trusted | Allowed: taking away is free (§5). A loss for others, never a gain, as a `permissions.manage` holder can do today; an administrator puts it back |
| A `users.manage` holder deletes an account in a group carrying rights they lack | Allowed unless the account is in Admin: deleting takes away, as today |
| An account single sign-on creates | User alone (bar the first account); the token's claims never reach a group (§3.3, §11) |
| Two administrators take each other out of Admin at the same moment | The count and the write share one session, and SQLite takes one writer at a time — the same window `set_user_role` has today. Accepted |
| A session outlives the change | It does not matter: the capabilities are read per request (§4) |

## 6. The API

All under `/api/v1`, in `auth/api.py`.

| Route | Requires | Answers | Refusals |
|---|---|---|---|
| `GET /groups` | any of `users.view`, `users.manage`, `permissions.manage`, `tags.manage` | `GroupList` | 403 `missing_permission:users.view` (the first of the four) |
| `POST /groups` | `permissions.manage` | 201 `GroupRead` | 409 `duplicate_group_name`, 422 (name, unknown capability), 403 (rule 2) |
| `PATCH /groups/{group_id}` | `permissions.manage` | `GroupRead` | 404, 409 `built_in_group` (a name for a built-in), 409 `admin_not_editable`, 409 `duplicate_group_name`, 422, 403 (rule 2) |
| `DELETE /groups/{group_id}` | `permissions.manage` | 204 | 404, 409 `built_in_group` |
| `PUT /users/{user_id}/groups` | `users.manage` | `UserRead` | 404, 422 `unknown_group` / `not_assignable`, 403 `admin_required` / `missing_permission:…`, 409 `last_admin` |
| `DELETE /users/{user_id}` | `users.manage` (unchanged) | 204 | + 403 `admin_required` (rule 1) |

Gone: `GET /permissions`, `PUT /permissions/{role}` and `PATCH /users/{user_id}`, whose only
field was `role`.

```python
class GroupRead(BaseModel):
    id: str
    name: str
    built_in: bool
    # Accounts in it. `None` for Guest, which is about callers without one; every account for
    # User; the rows whose account exists for the rest. The host screen is never counted.
    member_count: int | None
    # Only for a `permissions.manage` caller, `None` otherwise (the `TagRead.permissions`
    # precedent). Admin's is the whole catalogue, by rule.
    capabilities: list[str] | None
    # How many rights it gives, for every reader, because the accounts page's panel is drawn
    # for `users.manage` and never sees `capabilities`: Guest's and User's own count, for any
    # other group the ones it holds beyond User's (*adds 11 rights*), `None` for Admin
    # (*every right*).
    right_count: int | None
    # Whether this caller may put somebody in it (§5): an administrator always; anybody else
    # never for Admin, and for another group only while they hold all it carries. Always
    # `False` for Guest and User, which nobody is put in.
    can_assign: bool

class GroupList(BaseModel):
    groups: list[GroupRead]            # §2.5's order
    capabilities: list[str] | None     # the catalogue, for a `permissions.manage` caller

class GroupCreate(BaseModel):          # in api.py, like every request model
    name: GroupName                    # trimmed, 1..32
    capabilities: list[str] = []

class GroupUpdate(BaseModel):          # a PATCH touches what it names
    name: GroupName | None = None
    capabilities: list[str] | None = None

class UserGroupsUpdate(BaseModel):
    groups: list[str]                  # the explicit memberships, whole; never `user`

class GroupRef(BaseModel):
    id: str
    name: str
```

**One read for every drawer.** The groups page, the accounts page's panel and the tag editor
all draw groups, and they are gated by three different capabilities, so `GET /groups` takes any
of the four and fills the capabilities only for `permissions.manage` — the way `GET /tags` fills
`permissions` only for `tags.manage`. `users.view` is the fourth because `GET /users` hands it
`UserRead.groups`, ids, exactly as it hands it `role` today, and an id a reader cannot name is
no answer. `deps.py` gains `require_any(*capabilities)`, the one new dependency, which keeps
"the only place a permission is checked" true; it refuses with the first capability it was
given, so `errorMessage` words the 403 as it words every other. The capability catalogue
is now an explicit field: today `RolePermissions.tsx` reads `roles["admin"]` as the catalogue,
and Admin has no rows any more.

**One write each.** Creating a group takes its name and its capabilities in one call and the
editor's Save is one `PATCH`, so a new group never exists half made. Membership has exactly one
write path, on the account, carrying the account's whole set (the `PATCH /devices/{id}` mapping
precedent), so the last-admin count and rule 2 live in one function, `set_user_groups`.

**`/auth/me` and the account.** `MeRead.role` becomes `groups: list[GroupRef]` — the caller's
groups in §2.5's order, `[Guest]` without an account, `[User, …]` with one, `[Admin]` for the
host — and `is_admin: bool`. `UserRead.role` becomes `groups: list[str]`, the explicit
memberships only (never `user`), in that order. `POST /auth/host` answers `groups=[Admin]`,
`is_admin=True`. `UserLookupRead` carries no group, as it carries no role today.

**Tags.** `TagPermissionInput` and `TagPermissionRead` swap `role` for `group_id`; exactly one
of `group_id` and `user_id`, as today. `TagPermissionRead` carries no group name: the tag editor
has `GET /groups` for that.

**Log lines** (`console.py`'s rule: names, never ids): *Group 'DJs' created*, *Group 'DJs' is
now called 'Music crew'*, *The rights of the group DJs changed*, *Group 'DJs' deleted*, *'Fry'
is in Trusted and DJs now* / *'Fry' is in no group now*. Registering keeps its line without the
`(role …)` tail, which becomes *(administrator)* for the first account and nothing otherwise.

## 7. Every reader of a role

| Where | Today | After |
|---|---|---|
| `auth/permissions.py` | `ROLES`, `ASSIGNABLE_ROLES`, `DEFAULT_ROLE`, `DEFAULT_ROLE_CAPABILITIES`, the role cache, `set_role_capabilities` | `GUEST`, `USER`, `ADMIN`, `BUILT_IN_GROUPS`, `TRUSTED_GROUP_ID`, `DEFAULT_GROUP_CAPABILITIES` (guest, user, trusted; no admin), the group cache, `capabilities_for_groups`, `invalidate_cache`. `ASSIGNABLE_ROLES` goes: any group but User and Guest is assignable |
| `auth/model.py` | `User.role`, `RolePermission` | `Group`, `GroupCapability`, `UserGroup`; `User.role` and `RolePermission` gone |
| `auth/deps.py` | `Principal.role`, the host as `ADMIN`, `tag_viewer` passing `role` | §4's `Principal`, `require_any`, `tag_viewer` passing `groups` and `is_admin` |
| `auth/service.py` | `_role_for_new_user`, `set_user_role`, `_admin_count` over `users.role`, `delete_user` | `_groups_for_new_user`, `set_user_groups` (rules 1 and 2, last admin), `_admin_count` over `user_groups`, `delete_user` (rule 1, its rows) |
| `auth/schema.py` | `UserRead.role`, `MeRead.role`, `PermissionsRead` | §6 |
| `tags/service.py` | `Viewer(role, user_id)`, `allowed` (`viewer.role == ADMIN`, `row.role == viewer.role`), `hidden_song_ids` (`viewer.role == ADMIN` → nothing hidden), `_subject`, `_check_subjects` (`ROLES`, which let an `admin` row through), `_rows_for`, `GUEST_VIEWER`, `PermissionSpec.role` | `Viewer(groups, user_id, is_admin)`, still frozen and hashable (`groups` a `frozenset`); `allowed` and `hidden_song_ids` short-circuit on `is_admin`; otherwise a row counts whose `group_id` is in `viewer.groups` or whose `user_id` is the viewer's; `_subject` `group_id IN (:groups)`; `_check_subjects` against the `groups` table — Admin 422 `not_assignable`, an id that is no group 422 `unknown_group`; `_rows_for` keyed on `group_id`; `GUEST_VIEWER = Viewer(groups=frozenset({GUEST}), user_id=None, is_admin=False)`; `PermissionSpec.group_id` |
| `tags/model.py`, `tags/schema.py`, `tags/api.py` | `TagPermission.role`, `uq_tag_permissions_role`, `TagPermissionInput.role` and its `_exactly_one_subject` validator, the 422 descriptions ("Unknown role or account") | `group_id` String(32), `uq_tag_permissions_group`, the check over `group_id`, the validator over `group_id` / `user_id`, "Unknown group or account" |
| `karaoke/api.py`, `tags/api.py` | `tag_viewer(principal)` | unchanged calls |
| `karaoke/selection.py`, `karaoke/reel.py`, `music/service.py` | carry a `tags.Viewer`; the selection stores the opener's for every respin, `_GUEST` and the music use `GUEST_VIEWER` | unchanged. A membership change while a selection stands is seen from its next opening, not its next respin — the same as a role change today, for a lock that idles out in two minutes. Accepted |
| `auth/oidc.py` | no role of its own: it calls `service.upsert_oidc_user`, which picks the role | unchanged; the first-account rule moves with `upsert_oidc_user` (§3.3) |
| User-facing copy that says "role": `errors.ts` (*Your role may not do this (…)*), `components/SongDetails.tsx` (*Your role may not change these values.*, *Your role may not comment.*), `pages/Playlist.tsx` (*Playlists are not open to your role.*) | "role" | the same sentences without the word — *You may not do this (…). Ask the host for access.*, *You may not change these values…*, *You may not comment…*, *Playlists are not open to you. Log in or ask the host for access.* — a caller holds rights through several groups now, so no one group is "yours" |
| `frontend/src/auth.ts` | `role` | `groups: GroupRef[]`, `isAdmin` |
| `pages/User.tsx` | the tile's role word | §9.3 |
| `components/PeopleAdmin.tsx` | `ASSIGNABLE_ROLES`, the role `<select>` | §9.2 |
| `components/RolePermissions.tsx`, `pages/UserPermissions.tsx` | the role matrix | §9.1 |
| `pages/TagEditor.tsx` | `ROLE_COLUMNS`, `NEW_TAG_GRANTS`, the role matrix | §9.4 |
| `manage.ts` | *Permissions* → `/user/permissions` | *Groups* → `/user/groups` |
| `docs/screenshots/seed.py`, `scenario.py` | `body["role"]` kept per account and printed (`entry['role']`) in the cookie list, `view_roles` / `assign_roles` | `body["groups"]` kept and printed joined (`admin` for the first account, `user` where the list is empty), `view_groups` / `assign_groups` with the Trusted id |

Not readers of a role, and untouched: the player selector's **reader roles** (`devices`,
`reader_roles`, `RoleSelect.tsx` — what a reader does, not who a person is); a playlist
member's **access** (`read` / `write` / `admin`, per list); the "identity, not a capability"
rules of the stats, achievements, comments, favorites and own pictures, which read
`principal.user` and never a role; and every `require("devices.manage")`-style gate, which stays
a capability that starts with Admin.

**A new tag's default** (`TagEditor.NEW_TAG_GRANTS`): *See tag* and *See songs* for Guest and
User — which now reaches every account, Trusted's members included — and *Tag songs* for
Trusted when the groups list holds `TRUSTED_GROUP_ID`, for nobody but the administrators when
the host deleted it. Today's default spelled the view rows out for `trusted` too; under §3.2
User's row already covers them. The comment above `NEW_TAG_GRANTS` — a `tags.manage` holder who
is not an administrator must keep seeing the tag they just made — still holds: every such
holder with an account is in User. A Guest holding `tags.manage` (§5.1's accepted case) sees it
through the Guest row.

## 8. The migration

One revision, **the next free one** when 08 runs its checks (0039 as this is written), in
`migrations/versions/NNNN_permission_groups.py`. Everything is written out literally, never
imported from `auth.permissions` (0006's rule): the Trusted id, the three built-in rows.

### 8.1 The order

**The revision is not atomic, and must survive being run twice.** Measured on this stack
(2026-11-08, SQLAlchemy over aiosqlite, Python 3.12, the per-revision transaction alembic opens
for SQLite because `SQLiteImpl.transactional_ddl` is `False`): the `sqlite3` module begins its
transaction at the first INSERT, UPDATE or DELETE, so a CREATE TABLE or CREATE INDEX issued
before it is committed on the spot, while everything from that first write on rolls back with
the revision. A failure anywhere therefore leaves the step-1 `groups` table (empty) behind,
`alembic_version` at the previous revision, and every old table — `users.role`,
`role_permissions`, `tag_permissions.role` — as it was, so the code before this revision still
runs. The next start runs the revision again from the top, which must work:

- every `CREATE TABLE` and `CREATE INDEX` of steps 1–3 is `IF NOT EXISTS` (`op.create_table` /
  `op.create_index` with `if_not_exists=True`, or `op.execute` of the literal statement);
- every insert of steps 1–3 is insert-if-missing (§8.4's shape);
- `test_permission_groups_migration.py` runs the upgrade on a database at the previous revision
  that already holds an empty `groups` table and its index, and expects the same result.

Additions first, rebuilds after, the drop last:

1. Create `groups` (`id` String(32) primary key, `name` Text, `created_at`), with the unique
   index `ix_groups_name_lower` on `lower(name)`. Insert `guest`/*Guest*, `user`/*User*,
   `admin`/*Admin* and `7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5`/*Trusted*.
2. Create `group_capabilities` (`group_id` String(32), `capability` String(64), both the
   primary key). Copy every `role_permissions` row of `guest`, `user` and `trusted` (the last
   under the Trusted id) **as it stands** — the host may have edited them, so the rows are
   copied, never the module's defaults. `admin`'s rows are not copied (admin is a rule), nor is
   a row of any role string outside the four (only a hand edit makes one).
3. Create `user_groups` (`user_id` String(32), `group_id` String(32), both the primary key, an
   index on `group_id` for the member counts). From `users.role`: `admin` → an `admin` row,
   `trusted` → a Trusted row, `user` and anything else → none.
4. Rebuild `tag_permissions` through `batch_alter_table` with an explicit `copy_from` (0009's
   and 0012's precedent: `env.py` sets no `render_as_batch`, and a reflected rebuild drops what
   reflection misses): add `group_id` String(32) nullable, fill it from `role` (`guest`, `user`
   as they are, `trusted` → the Trusted id), **delete every row whose `role` is set and is none
   of those three** — `admin` (Admin sees every tag by rule; today's `_check_subjects` let such a
   row in) and any other string (only a hand edit makes one; it matched no caller, and its
   `group_id` would stay NULL beside a NULL `user_id` and break the new check) — then drop
   `role`, `ck_tag_permissions_one_subject` and `uq_tag_permissions_role` and create
   `ck_tag_permissions_one_subject` over `(group_id IS NULL) <> (user_id IS NULL)` and
   `uq_tag_permissions_group` over `(tag_id, action, group_id)`. Recreate
   `ix_tag_permissions_tag_id` explicitly afterwards: `copy_from` reflects nothing.
5. Rebuild `users` the same way, without `role`, `copy_from` the table as 0009 left it, and
   recreate `ix_users_username_lower` (on `lower(username)`, unique) and `ix_users_oidc_subject`
   (unique) explicitly afterwards, exactly as 0009 does.
6. Drop `role_permissions`.

**`users.role` is dropped, not kept dead.** A column nothing writes reads as the truth to the
next person who opens the database, and the first account would keep saying `admin` after
leaving the group. The cost is the batch rebuild, which this codebase already does for `users`
(0009).

### 8.2 The downgrade

Best effort, and the docstring says what is lost: `role_permissions` comes back from the rows of
Guest, User and Trusted (if it still exists), with `admin` rows for every capability the module
listed when this revision was written (written out, like 0006's `_ALL`); `users.role` is `admin`
for an Admin member, `trusted` for a Trusted member, `user` otherwise; tag rows for Guest, User
and Trusted go back to their role, every other group's go. Custom groups and every membership in
them are lost, and the downgrade says so. It is a development tool, not a path a party takes, so
it is held to §8.1's re-run rule only as far as its own creates go (`IF NOT EXISTS` on
`role_permissions`).

### 8.3 What the migration keeps exactly

- Every caller without an account: Guest's rows are copied unchanged.
- Every `user` account: its set was User's rows, and is now User's rows.
- Every `admin` account: every capability, before and after.
- Every `trusted` account: its set was Trusted's rows and is now User's ∪ Trusted's. Equal
  whenever User's rows are a subset of Trusted's, which Wingman's defaults are; where a host
  had taken from Trusted something User still holds, that helper **gains** it. Never a loss.
- Tags: a Guest or User row keeps meaning what it meant (Guest's rows still apply to no
  account, §3.2); a Trusted member now also gets User's rows. Again only a gain. The rows the
  migration deletes (`admin` and unknown strings, §8.1 step 4) gave nobody anything.
- An account whose `role` is none of the four, or `guest` — neither is reachable through the
  API (`ASSIGNABLE_ROLES`); only a hand edit makes one — becomes a plain account in User. An
  unknown string held nothing and gains User's; `guest` held Guest's and now holds User's, a
  loss only where the host had given Guest something User lacks. The docstring names this.

So the rule the docstring states: **this migration never takes a right away from any account
the API could have made, nor from a caller without one; where the old bundles were not nested,
a helper may gain one.**

**The administrators survive.** Every `admin` account becomes an `admin` row in step 3, so the
last-admin invariant holds after the upgrade whenever it held before; and since the host screen
is an administrator without a row, a database that somehow has none still has a way in.

### 8.4 Seeding a capability from now on

Migrations 0011 to 0034 seeded a new capability into `role_permissions` per role. From this
revision on, a capability is seeded into `group_capabilities`, insert-if-missing for `guest` and
`user`, and for Trusted **insert only while the group exists**, because the host may have
deleted it:

```sql
INSERT INTO group_capabilities (group_id, capability)
SELECT :group_id, :capability
WHERE EXISTS (SELECT 1 FROM groups WHERE id = :group_id)
  AND NOT EXISTS (SELECT 1 FROM group_capabilities
                  WHERE group_id = :group_id AND capability = :capability)
```

Never a row for `admin`. `test_the_migration_seeds_the_module_defaults` compares
`group_capabilities` against `DEFAULT_GROUP_CAPABILITIES` (no admin entry); recipes.md step 4
says this (§15.3).

## 9. The UI

What follows is the decision; `docs/dev/ui-guidelines.md` §4 and §7 carry it as the binding
rule, in that file's words.

### 9.1 The Groups page and the group editor

The *Permissions* entry of the manage menu becomes **Groups** (`shield`, gated on
`permissions.manage` as before) and opens `/user/groups`, the shape of the tags admin: one row
per group in §2.5's order — the 40px square (`users` on `--input-bg`, `shield` for Admin), the
name, a meta line, a `chevron-right` — and the header's `+` opening `/user/groups/new`. The meta
line says who is in it and what it gives: *Everybody without an account · 8 rights* (Guest),
*Every account · 13 rights* (User), *3 members · adds 11 rights* (a group: the capabilities it
holds beyond User's), *2 members · every right* (Admin). Admin's row is not a link: there is
nothing to edit, and its line already says why. One `.section-note` over the rows: *Every
account is in User. A group adds its rights to User's. Admins hold every right, so nothing here
can lock the host out.* `/user/permissions` redirects there (`Navigate replace`), so an old
bookmark still lands.

`/user/groups/:groupId` (and `/new`) is the **group editor**; `/user/groups/admin`, which no
link leads to, replaces itself with `/user/groups`, and an id the list does not hold is the tag
editor's not-found state. It runs in the tag editor's order: the name
(quiet input; for Guest and User the `h1` alone and one line saying a built-in keeps its name),
then the capabilities exactly as `RolePermissions` draws them today — the area headings with
their glyphs, one row per capability with its verb and its sentence — but **one** checkbox
column, `--perm-roles: 1`, and no sticky head (one column needs no label). A box is disabled,
with its reason in `title` and a `visually-hidden` sentence, when:

- the group is not a built-in and User already holds the capability: drawn ticked, *Every
  account holds this through User.* (an own row of the group that User also holds stays a live
  tick: it is data, and unticking it must stay possible);
- it is Guest and the capability is `playlists.manage` (`GUEST_INERT`, as today);
- the reader is not an administrator, the box is off, and they do not hold the capability: *You
  can only hand out a right you hold yourself.* (rule 2).

**What Save sends is the group's own rows alone**: the stored ticks the reader left on and the
boxes they ticked. A box drawn ticked because User grants it is never in the body, so saving a
group never turns User's rights into rows of its own; a stored row that User also holds is a
live tick and goes along unless it was unticked.

Then, for a group with members, a `.section-note` naming the count and where they are changed:
*3 accounts are in this group. Put people in it on Players & accounts.* Then `EditorActions`:
Save (one `POST` or `PATCH`), and for a group that is not built in a danger **Delete** through a
`ConfirmModal` that says what happens: *Delete the group "DJs"? Its 3 members lose the rights it
gives them. Their accounts stay.* A new group's Save replaces `/new` with its id (REPLACE, §6 of
the guidelines).

**Why not a matrix with a column per group.** The matrix earns its place by comparison: one
capability read across every role. It holds three columns well. With groups the host names, it
breaks in two places at once. A 44px column head cannot hold a name somebody typed (*Karaoke
crew* at 0.75em is about 75px), so every head would be cut to a few letters; and a phone cannot
hold the columns — the label column is `358 − 48·n` px at 390px, 118px with five editable
groups, 70px with six, where every capability's sentence wraps to a word a line. An inner
horizontal scroll would honour §1.11, but `overflow-x` on the matrix makes it the sticky head's
scroll container, so the head stops following the page, and a sticky first column on top of
that is a second mechanism to keep working. The editor keeps the matrix's own row idiom (the
same areas, rows, sentences and cells), scales to any number of groups at 360px, and gives
renaming and deleting the home every other admin object already has (tags, achievements,
devices). What it gives up is reading one capability across groups on one screen; the list's
*adds N rights* is the summary that remains. §14 offers the matrix back.

Saving changes from "every tick saves at once" to the editors' one Save. A group is now an
object with a name and a membership, and its editor should behave like the tag editor beside
it; one `PATCH` is also what lets rule 2 refuse a whole change at once instead of tick by tick.

### 9.2 Membership on the accounts page

The role `<select>` on an account row becomes a **button in the same look** — today's
`.people-role-wrap`: `--highlight-blue-light` text, right-aligned, and its `chevron-down`, renamed
`.people-groups` — reading the account's groups the way the user tile does (§9.3) and named
*Groups of <name>* (`aria-label`). It is drawn for `users.manage`, as the select was. Unlike the
select it may shrink (`flex: 0 1 auto; min-width: 0; max-width: 35%` of the row, so the name, the eye and the trash
keep theirs), its words one line
ellipsed with the whole of them in `title`, so *Trusted · DJs · Moderators* never pushes the
name off a 360px row; its box stays 40px tall. It opens a **panel modal**, *Groups of Fry*,
holding one `PickerRow` per group but Guest and User, in §2.5's order: the group's 40px square as
the lead, the name, *adds 11 rights* or *every right* as the meta line, `list-check` when the
account is in it. A tap is one `PUT /users/{id}/groups` carrying the whole set with that row
flipped, the row disabled for its round trip. Over the rows one `.section-note`: *A group adds
its rights to what every account holds.*, and for a reader who is not an administrator a second
sentence, *Only an administrator puts somebody in Admin or takes them out.* A row the reader may
not change is disabled, and its meta line says why in place of the count, because a disabled
`PickerRow` has no other place for a reason: Admin for a reader who is not an administrator
(*Only an administrator can change this*), and a group **the account is not in** whose
`can_assign` is false (*Carries a right you do not hold*). Taking somebody out of a group is
never disabled but for Admin. A refusal is one `.error-notice` in the panel (*There has to be
one administrator left.* for `last_admin`). The trash beside the button is drawn on an Admin
member's row only for an administrator (rule 1).

Why a panel of `PickerRow`s and not checkboxes in the row: a row is 48px and already carries
the eye, the control and the trash; several checkboxes would not fit at 360px, and a membership
picker is exactly what `PickerRow` is for (the song in playlists, the player on a score). Why not
a `<select multiple>`: it is a different control on every phone and says nothing about what a
group gives.

A reader with `users.view` and no `users.manage` sees no groups on the rows, as they see no role
today — the row has no room for a second, read-only control — though `GET /users` answers them
the ids, as it answers the role today (§6). So `users.view`'s sentence in the editor stays true
to the API: *See who has an account and which groups they are in.*

### 9.3 The user tile

The 20px line under the name, `auth.role` today, reads **Admin** for an administrator and the
host screen, otherwise the account's groups by name in §2.5's order joined by ` · ` (*Trusted ·
DJs*), or **User** when it is in none. One line, ellipsed, `title` the whole of it; the tile's
28 + 20 + 40 rows do not change. Admin alone because every other group means nothing next to
it; User when nothing else because "no group" is not a thing a reader should have to decode.

### 9.4 The tag editor

The tag editor's matrix (rows *See tag* / *See songs* / *Tag songs*, columns Guest / User /
Trusted) is **turned on its side**: one row per group but Admin, in §2.5's order, with the three
actions as its columns — the *Specific people* grid (`.tag-people-head` / `.tag-people-row`,
`40px minmax(0, 1fr) repeat(3, 44px) 40px`) with the group's square in place of the avatar and
no trailing control. Three columns fit any width, so any number of groups does too, and groups
and people now read in one shape. In a row of a group that is not built in, an action User holds
on this tag is drawn ticked and disabled, *Every account holds this through User.*, and as in
the group editor such a box is never sent: the tag's `permissions` carry the rows somebody
ticked, nothing drawn on their behalf. The hint *Administrators are not in the table…* stays
over the rows. A stored row whose `group_id` is no group in `GET /groups` (a hand edit; deleting
a group deletes its rows) is drawn nowhere and left out of the body, where today's editor
carries an unknown role through — which today's backend then refuses, so such a tag could never
be saved. A row for Admin cannot exist after the migration (§8.1 step 4).

## 10. A worked example

Leela registered first, so she is the administrator. Fry and Bender were `trusted`, Amy `user`.

1. **The update.** Leela is in Admin; Fry and Bender in Trusted; Amy in nothing (User).
   Trusted holds exactly the rows it held as a role. The *broken* tag's three rows for
   `trusted` (migration 0013's seed: see it, see its songs, tag with it) now name the Trusted
   id. Nobody's rights changed.
2. **A group.** Leela makes **Moderators** with `comments.moderate` and `stats.moderate` and,
   on the accounts page, puts Amy and Fry in it. Amy holds User's rights and those two. Fry
   holds User's, Trusted's and those two — `comments.moderate` he had already, through Trusted.
   Amy's phone is open on a song: `groups.changed` reaches it, `/auth/me` is read again, and the
   trash under other people's comments appears.
3. **A helper who manages people.** Leela ticks `users.manage` for Moderators. Amy opens
   *Groups of Amy*: Admin is disabled (*Only an administrator can change this*), Trusted is
   disabled (*Carries a right you do not hold*: `downloads.manage`, `songs.rescan` and the rest of
   its rows) and Moderators is pressed. Had she sent the request by hand:
   `PUT /users/amy/groups {"groups": ["admin"]}` is 403 `admin_required`; with Trusted it is 403
   `missing_permission:songs.rescan`, the first of Trusted's rows she lacks in catalogue order.
4. **Trusted goes.** Leela deletes Trusted. Fry and Bender lose what it gave them and keep
   everything else: Fry is still a Moderator. The *broken* tag's Trusted rows go with the
   group, so the broken songs are now the administrators' alone, which the confirmation's
   "lose the rights it gives them" covers.
5. **The last administrator.** Leela takes herself out of Admin: 409 `last_admin`, *There has
   to be one administrator left.* She puts Bender in Admin first; then she may.

## 11. Groups from the OIDC provider — parked for the user

**Nothing in 08 or 09 builds this.** It is the answer to the user's question, for the user to
decide on.

**Is it a good idea?** Yes, for one kind of party, and only as an opt-in with an explicit
mapping. A host who already runs an identity provider with groups — Keycloak, the provider
architecture.md and `oidc.py` name, is one — maintains "who is family, who is a helper" there
already, and
keeping it twice is the kind of chore that drifts. For everybody else — a party that uses single
sign-on for the convenience of not having passwords — it is a setting they will never touch, so
it must cost them nothing.

What makes it work, and what a later bundle needs:

- **A claim name setting**, `auth.oidc_groups_claim` (text, empty = off, typically `groups`),
  beside the other `auth.oidc_*` settings. Many providers only send the claim when a scope asks
  for it (a `groups` scope on some, a client mapper in Keycloak), so the setting's description says to add
  it to `auth.oidc_scopes`. The claim is read out of the verified ID token, falling back to the
  userinfo answer under the token's own `sub`, the rule `oidc._picture` already follows.
- **An explicit mapping, never name matching.** A table `oidc_group_mappings (claim_value, group_id)`,
  edited on the group editor as one *Provider group* field. Matching by name would let anybody
  who can create a group at the provider called "Admin" make administrators here, and would
  collide with the local groups' names on every rename. A claim value with no mapping is
  ignored.
- **A `source` on memberships.** `user_groups` gains `source` (`manual` / `oidc`). At every
  login the account's `oidc` rows are replaced by the mapped set; `manual` rows are never
  touched, and a group the account is in both ways stays. So the host can still put a single
  sign-on account in a group by hand, and the provider can only take away what the provider
  gave.
- **Absent is not empty.** A token without the claim (a provider that does not send it, a scope
  forgotten) touches nothing; a claim with an empty list removes the `oidc` rows. Otherwise a
  misconfigured provider would strip every membership at the next login.
- **The last-admin rule still holds.** A login that would take the last administrator out of
  Admin keeps the row, logs one WARNING, and logs in. Mapping a provider group to Admin is
  allowed — it is the point for a household that runs its own provider — and the mapping field
  says, for Admin alone, that whoever controls that provider group controls Wingman.
- **The cost: it only changes at login.** Wingman keeps no refresh token, and a session lives 90
  days (`SESSION_TTL`). Somebody taken out of a provider group keeps the Wingman group until
  they log in again, or until the host takes them out by hand (a `manual` override of an `oidc`
  row is a removal the next login would undo, so the panel says so on a provider row). Storing
  refresh tokens to re-read the claim would be a second secret per account for a karaoke app;
  this document recommends against it.
- **First login.** The mapping applies after `upsert_oidc_user` creates the account at the end
  of the choose-a-name step (`Pending` carries the claim the way it carries the picture), and
  never before the name is in.

Recommendation: build it later, if the user wants it, exactly as above — one setting, one
mapping field, one column, one step in `_log_in` — and not before the groups of this round have
been used at a real party.

## 12. The user documentation

09 rewrites, in the documentation guidelines' voice:

- `docs/user/people/roles.md` → **`docs/user/people/groups.md`**, *Groups and permissions*:
  what a group is, the three built-ins and Trusted, what each starts with (the per-area
  paragraphs survive, *Trusted* still reading true for a fresh party), making, renaming and
  deleting a group, the group editor, the two rules of §5 in plain words, and the Guest warning
  (§5.1). The nav entry in `docs/zensical.toml` and every link to `roles.md` (fourteen pages
  today: `grep -rn "roles.md" docs/user`) follow.
- `docs/user/people/index.md` (the role sentence, the tile line, the host's *Admin*),
  `players.md` (*Roles* becomes *Groups*: the button and its panel), `single-sign-on.md` (an SSO
  account lands in User), `docs/user/integrate/authentication.md` (`PUT /users/{id}/groups`, the
  `groups` and `is_admin` of `/auth/me`, "your role" → "your groups"),
  `integrate/rest-api.md` (the `/groups` row), `tags/index.md` (the turned matrix),
  `help/index.md`, `host-screen/manage.md`, `index.md`, `start/join.md`, `settings/index.md`,
  `songs/fix-or-delete.md`, `songs/song.md`, `songs/index.md`: every "role" that means a group.
  "Trusted and Admin hold that by default" stays true and stays.

The summary every one of those pages can lean on:

> Rights are handed out in groups. Everybody without an account is a **Guest**, every account
> is a **User**, and the host decides what each of the two may do. On top of that the host makes
> groups of their own, says what each one adds, and puts accounts in as many as fit:
> **Trusted** for the helpers is there from the start. An account holds what User holds plus
> what its groups add. **Admin** is the host's own group: its members hold every right, always,
> and only an administrator can put somebody in it. A right you do not hold yourself, you cannot
> hand out.

## 13. What is not done

- **No denying.** A group only adds; nothing takes a right away from its members.
- **No group inside a group.** User is the one floor; groups do not contain groups.
- **No per-group tag defaults or settings**, no group on a playlist share (a playlist is shared
  with accounts, as today).
- **No ordering of groups** beyond §2.5.
- **No group for the host screen** other than Admin, and no way to make the host screen less
  than an administrator.
- **No OIDC groups** (§11).
- **No change to any capability or its default bundle.**

## 14. Decisions the user may veto

Each with what this document builds; the alternative in brackets.

1. **Several groups per account, added up** (§3.1). [One group per account: `users.role`
   becomes the group, no membership table, every combination its own group.]
2. **Accounts do not inherit Guest** (§3.2): a right for everybody is ticked under Guest *and*
   User, as today. [Guest as everybody's floor: one tick, but the migration's User column would
   change meaning and a host could no longer keep a right for phones without an account only.]
3. **Groups add to User**, and the editor draws User's rights as locked ticks in every group
   (§3.2, §9.1). [Groups as complete bundles that ignore User — today's role semantics — with
   every group repeating User's rows.]
4. **Trusted keeps a fixed 32-hex id** and is otherwise an ordinary row (§2.3). [The word
   `trusted` as its id, readable in the database, but a word id on a row that is not built in.]
5. **Nobody but an administrator hands out a right they do not hold**, for both capabilities and
   memberships (§5, rule 2). [Today's rule: a `permissions.manage` holder may give any group
   anything, a `users.manage` holder may put anybody anywhere but Admin.]
6. **Only an administrator changes Admin's membership or deletes an administrator's account**
   (§5, rule 1). [Today any `users.manage` holder may make an administrator.]
7. **Guest may be given `users.manage` or `permissions.manage`**, as today, with a warning in the
   guide (§5.1). [Refusing those two for Guest.]
8. **Memberships are read per request, uncached** (§4). [A cache keyed by account, invalidated
   on every membership write.]
9. **`groups.changed`**, payload-free, after every group or membership write, makes every open
   page read `/auth/me` again (§4); registering or deleting an account does not send it.
   [No event: a membership change shows at the next reload, as a role change does today.]
10. **The Permissions page becomes a list of groups and one editor per group**, Save instead of
    a tick that saves (§9.1). [The matrix with a column per group: comparison on one screen, but
    cut column heads and, past four editable groups, an unreadable phone.]
11. **The page and the manage entry are called *Groups*, at `/user/groups`**, with a redirect from
    `/user/permissions` (§9.1).
12. **Membership is a panel of `PickerRow`s behind a button that looks like today's select**
    (§9.2). [Checkboxes in the row, or a `<select multiple>`.]
13. **The tile says *Admin*, or the groups joined by ` · `, or *User*** (§9.3).
14. **The tag editor's matrix turns on its side**, a row per group (§9.4).
15. **A new tag lets Trusted tag songs** only while Trusted exists, and its view rows name Guest
    and User alone (§7).
16. **Names: 1 to 32 characters, unique case-insensitively**, the built-ins' names reserved by
    their own rows (§2.4).
17. **One order everywhere**: Guest, User, the rest by name, Admin last (§2.5).
18. **`users.role`, `role_permissions` and `tag_permissions.role` are dropped** (§8.1).
    [Keeping them dead for a downgrade.]
19. **A helper whose Trusted bundle lacked something User holds gains it** in the migration
    (§8.3). [Nothing: the old rows cannot be kept exactly under addition.]
20. **Deleting a group needs no more than a confirmation**, and its tag rows go with it (§3.3).
21. **OIDC groups: worth building later, opt-in, mapped explicitly, one-way per login** (§11).
    Not built now.
22. **A tag row for Admin is 422 `not_assignable`**, and the migration deletes the `admin` tag
    rows today's API allowed (§5.1, §8.1). [Accept and ignore them, as today.]
23. **`users.view` keeps reading the account's groups through the API** (ids, as it reads the
    role today) without the accounts page drawing them, and its sentence says so (§9.2).
    [`UserRead.groups` blanked below `users.manage`, the `TagRead.permissions` precedent.]
24. **Taking away stays free for a non-administrator** — unticking Guest's or User's rights,
    deleting a group, taking somebody out of a group but Admin (§5). [Rule 2 mirrored:
    nobody but an administrator takes away a right they do not hold.]
25. **A hand-edited role string** (`guest`, or none of the four) becomes a plain account in User
    (§8.3). [Refusing to migrate until it is fixed by hand.]

## 15. Implementation

08 first — backend, migration, client — then 09 on top of it. No new dependency.

### 15.1 08: backend

- `auth/permissions.py`: §7's vocabulary; `TRUSTED_GROUP_ID`; `DEFAULT_GROUP_CAPABILITIES`
  (`guest`, `user`, `TRUSTED_GROUP_ID`, written out of today's three frozensets, no admin); the
  long comment on who starts with what stays, worded for groups; the cache keyed by group id;
  `capabilities_for_groups`; `UnknownGroupError`, `UnknownCapabilityError`,
  `AdminNotEditableError`, `BuiltInGroupError`. `set_role_capabilities` moves into the groups
  service.
- `auth/model.py`: `Group`, `GroupCapability`, `UserGroup`; `User.role` and `RolePermission`
  gone; the module docstring names the new tables.
- `auth/groups.py` (new, FastAPI-free, the `oidc_picture.py` split): `list_groups` (§2.5's
  order, member counts in one `GROUP BY` joined to `users`), `create_group`, `update_group`,
  `delete_group`, `set_user_groups`, `groups_of`, the two rules of §5 and the name check, every
  write ending in `invalidate_cache()` where it changes capabilities and in
  `event_bus.broadcast(GroupsChanged())` after the commit.
- `auth/service.py`: `_groups_for_new_user` in `register_user` and `upsert_oidc_user` (one
  `admin` row for the first account), `delete_user(…, by_admin: bool)` (rule 1, last admin, its
  `user_groups` rows; `players.changed` as today, no `groups.changed`, §4), `_admin_count` over
  `user_groups` joined to `users`;
  `set_user_role` and `ASSIGNABLE_ROLES` gone.
- `auth/schema.py`: `GroupRead`, `GroupList`, `GroupRef`, `MeRead` (`groups`, `is_admin`),
  `UserRead.groups`, `read_user` taking the account's groups; `PermissionsRead` gone.
- `auth/deps.py`: §4's `Principal`; `current_principal` reading the memberships; `require_any`;
  `tag_viewer` passing `groups` and `is_admin`.
- `auth/api.py`: §6's routes and request models; `GET /permissions`, `PUT /permissions/{role}`,
  `PATCH /users/{user_id}` gone; `POST /auth/host` and `GET /auth/me` answering groups.
- `events.py`: `GroupsChanged`, `groups.changed`, no payload.
- `tags/model.py`, `tags/schema.py`, `tags/api.py`, `tags/service.py`: §7's row.
- `migrations/versions/NNNN_permission_groups.py`: §8, docstring included.
- `docs/screenshots/seed.py` and `scenario.py`: `body["groups"]` instead of `body["role"]`,
  `view_groups` / `assign_groups` with the Trusted id; ruff check and format as CLAUDE.md says.
- Regenerate the frontend client (recipes.md, the offline variant when no backend is on
  :8080) and commit `frontend/src/api/`. The frontend will not build against it until 09; 08
  says so in its report and leaves the TypeScript untouched.

### 15.2 08: backend tests

- `tests/conftest.py`: `add_user(…, groups: Sequence[str] = ())` writing `user_groups` rows in
  place of `role`; the `clients` fixture builds `user` (no group), `trusted` (the Trusted row)
  and `admin` (the `admin` row); `fresh_permission_cache` keeps resetting the cache. Every test
  that passes a role (`grep -rln "role" backend/tests`: `test_auth_api`, `test_auth_host`,
  `test_auth_oidc`, `test_devices_api`, `test_events`, `test_karaoke_selection`,
  `test_permissions`, `test_playlists_api`, `test_stats_api`, `test_tags_api`, the achievements
  and stats migration tests) moves to groups.
- `ROUTES` in `tests/test_permissions.py` is one capability per route, and its matrix test says
  every identity without that capability gets 403. `GET /groups` takes any of four, so it needs
  an any-of form there: the route listed with all four, an identity holding none of them 403,
  an identity holding any one of them 200 — one row per alternative would wrongly expect a 403
  from an identity that holds another.
- `tests/test_permissions.py`: `IDENTITY_CAPABILITIES` over `DEFAULT_GROUP_CAPABILITIES` (the
  trusted identity is User's ∪ Trusted's); `ROUTES` gains the five routes and loses the three;
  `test_the_migration_seeds_the_module_defaults` compares `group_capabilities`;
  `test_get_permissions_lists_every_role` becomes `GET /groups`; the "takes effect without a
  restart" test kept over a group, and a new one for a membership.
- `tests/test_groups_api.py` (new): every row of §5.1's table; the rules binding on the
  difference (§5) — a helper putting an administrator in another group with `admin` still in
  the body, and saving a group that keeps a capability the helper lacks; names (bounds, the reserved
  three in three cases, a duplicate after trimming, a rename keeping the id); Admin's
  capabilities and member count; `can_assign` for an administrator and for a helper; the
  capabilities left out of `GET /groups` without `permissions.manage`; deleting a group taking
  its capabilities, memberships and tag rows and nothing else; a stale group id giving nothing;
  the host's `/auth/me`; `groups.changed` after each write (`broadcast_events`); one log line
  per write naming the group and never its id.
- `tests/test_permission_groups_migration.py` (new, the `test_stats_migrations.py` shape): a
  database at the previous revision with edited `role_permissions`, accounts in all four roles
  and tag rows for each role (an `admin` one and a hand-edited unknown string among them),
  upgraded — §8.3's table row by row, Admin's rows not copied, a non-nested Trusted gaining and
  nobody losing, the deleted tag rows gone, the three rebuilt indexes present — the same
  upgrade again on a database that already holds the empty `groups` table a failed run leaves
  (§8.1), and downgraded.
- `tests/test_tags_api.py`: role rows become group rows; a Trusted member gets User's tag rows;
  a deleted group's rows gone; Admin as a subject 422 `not_assignable`, an unknown id 422
  `unknown_group`; `hidden_song_ids` empty for an Admin member and for the host.
- `tests/test_permissions.py`: `GET /groups`'s any-of row answers 403
  `missing_permission:users.view` to an identity holding none of the four.

### 15.3 08: developer docs

- `CLAUDE.md`: the `auth/` row (groups, `user_groups`, the two rules, `groups.py`, the link to
  this document) and the `tags/` row (`group_id`); `events.py` needs no row change.
- `docs/dev/architecture.md`, *Permissions*: "Roles are bundles of capabilities" becomes groups,
  the per-resource rights "per group or per account".
- `docs/dev/verifying.md` (line 53, "a `user` role"): an account in no group.
- `docs/dev/recipes.md` step 4: the capability goes into `DEFAULT_GROUP_CAPABILITIES` and is
  seeded by §8.4's statement, and the page that says who holds it is `people/groups.md`.
- The ADR (codebase-memory, `manage_adr`, project `D-git-Ultrastar-Wingman-new`): ADR-003's
  "role defaults" becomes groups, with one paragraph on §5's two rules and on Admin as a rule.
- This document: anything 08 had to decide differently, corrected here.

### 15.4 09: frontend

- `auth.ts`: `groups: GroupRef[]`, `isAdmin`; `role` gone. `test/auth.ts`'s `meResponse` and
  `userRead`, and every test literal carrying `role:` (`grep -rln 'role: "' src`, about thirty
  files), follow.
- `groups.ts` (new, + test): the ids `GUEST`, `USER`, `ADMIN`, `TRUSTED_GROUP_ID`;
  `groupWords(groups, isAdmin)` for the tile and the accounts button (§9.3);
  `addedRights(group, user)`.
- `hooks/useGroups.ts` (new): one `GET /groups`, enabled by the caller's capabilities, and
  refetched on `players.changed` too (the member counts, §4). `App.tsx` mounts one
  `groups.changed` listener invalidating `/auth/me`, `GET /groups` and `GET /users`. Every
  count on the Groups page and in the panel reads `right_count` and `member_count`, never
  `capabilities`.
- `components/RolePermissions.tsx` + `.css` + test → `components/GroupCapabilities.tsx`: the
  capability rows of §9.1 for one group, `DESCRIPTIONS` with the three sentences of
  `users.view`, `users.manage` and `permissions.manage` rewritten; its capability *sections*
  are renamed **areas** in the code (`AREA_ICONS`, `AREA_NAMES`), because "group" now means
  something else.
- `pages/UserPermissions.tsx` + test → `pages/Groups.tsx` (+ `.css`, test), the list;
  `pages/GroupEditor.tsx` (+ `.css`, test), the editor; `App.tsx` routes `/user/groups`,
  `/user/groups/new` before `/user/groups/:groupId`, the redirect from `/user/permissions`;
  `BottomNav.tsx` `COVERS`; `manage.ts` (*Groups*, `/user/groups`).
- `components/PeopleAdmin.tsx` + `.css` + `pages/UserAccounts.test.tsx`: the button and the
  panel of §9.2 (the panel its own component, `components/AccountGroups.tsx` + test), the trash
  rule for Admin members.
- `pages/User.tsx` + test: the tile line.
- `pages/TagEditor.tsx` + `.css` + test: the turned matrix, `NEW_TAG_GRANTS` over ids, the
  groups read.
- `errors.ts`: sentences for `admin_required`, `built_in_group`, `admin_not_editable`,
  `duplicate_group_name`, `unknown_group`, `not_assignable`; `last_admin` stays; the
  `missing_permission` sentence without "role" (§7), and the same for the copy in
  `components/SongDetails.tsx` and `pages/Playlist.tsx`, with their tests.

### 15.5 09: user docs and screenshots

- §12's pages; `docs/zensical.toml`'s nav entry.
- `docs/dev/documentation.md`: the terminology row `role | Guest, User, Trusted, or Admin |
  group, level` becomes `group | Guest, User, Admin, and the ones the host makes | role,
  level`, and its paragraph *A role keeps its own name* becomes the same for a group (*Admin*
  is the group, *administrator* the person); the structure table's `roles.md` row and the route
  table's `/user/permissions` row; the screenshot rows `permissions` (now the groups list) and
  `people-admin` (the button), and a new `group-editor` row.
- New captures through `docs/screenshots/capture.py` for those rows, per screenshots.md.
- `CLAUDE.md`: the frontend rows for the new pages, components and helpers, and the routes line.
