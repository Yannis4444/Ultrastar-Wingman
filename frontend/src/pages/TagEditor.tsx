import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  PlayerRead,
  TagList,
  TagPermissionInput,
  TagRead,
  TagUpdate,
} from "../api";
import {
  createTagMutation,
  deleteTagMutation,
  listTagsOptions,
  listTagsQueryKey,
  replaceTagPermissionsMutation,
  updateTagMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import { Icon, PICKER_ICON_NAMES } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import PlayerAvatar from "../components/PlayerAvatar";
import { errorDetail, errorMessage } from "../errors";
import { useUserLookup } from "../hooks/useUserLookup";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { TAG_COLORS, tagColorClass, tagGlyph, type TagColor } from "../tags";
// The permission matrix is `RolePermissions`' grid, class for class (§4), so
// the two tables of checkboxes in the app line up on the same metrics.
import "../components/RolePermissions.css";
import "./Tags.css";
import "./TagEditor.css";

type Action = TagPermissionInput["action"];

/**
 * The three rights, in the order §7 puts them, with the sentence that says what
 * denying one does to somebody else. The wording matters more here than
 * anywhere else on the page: `view_songs` is the only one that hides content.
 */
const ACTIONS: { action: Action; label: string; description: string }[] = [
  {
    action: "view",
    label: "See tag",
    description:
      "The tag exists for them: it can be filtered on, and it shows on a song.",
  },
  {
    action: "view_songs",
    label: "See songs",
    description:
      "They may see the songs carrying it at all. Untick it and those songs are gone from the list, the search and the reel.",
  },
  {
    action: "assign",
    label: "Tag songs",
    description:
      "They may put the tag on a song and take it off again. Needs See tag as well.",
  },
];

/** The roles the matrix has a column for. Admin is not one: it holds every
 *  right in every table, which is what keeps the host from locking themselves
 *  out. A role the backend grows later is carried through untouched. */
const ROLE_COLUMNS = ["guest", "user", "trusted"];

const COLOR_LABELS: Record<TagColor, string> = {
  neutral: "Neutral",
  blue: "Blue",
  pink: "Pink",
  gold: "Gold",
};

/**
 * What a fresh tag is for before anybody says otherwise, written out here and
 * copied from no existing tag: everybody knows it and sees its songs, trusted
 * accounts may set it. Starting from "nobody" would be worse than useless: a
 * `tags.manage` holder who is not an administrator would not be granted `view`
 * on the tag they just made, and it would disappear from their own list.
 */
const NEW_TAG_GRANTS: [Action, string][] = [
  ["view", "guest"],
  ["view", "user"],
  ["view", "trusted"],
  ["view_songs", "guest"],
  ["view_songs", "user"],
  ["view_songs", "trusted"],
  ["assign", "trusted"],
];

/** One grant, as a string so a draft is a plain `Set`. */
function grantKey(action: Action, kind: "role" | "user", id: string): string {
  return `${action}|${kind}|${id}`;
}

/** A grant key back into the row the API wants. */
function grantRow(entry: string): TagPermissionInput {
  const [action, kind, ...rest] = entry.split("|");
  const id = rest.join("|");
  return kind === "role"
    ? { action: action as Action, role: id }
    : { action: action as Action, user_id: id };
}

function sameGrants(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size && [...left].every((entry) => right.has(entry))
  );
}

/** One account named on the tag. `username` is null when the account is gone —
 *  the row stays so the grant can be taken away on purpose rather than by
 *  accident. */
interface Person {
  id: string;
  username: string | null;
  playerId: string | null;
  avatarVersion: number | null;
}

/** What the tag looked like when the draft was seeded, to measure a PATCH
 *  against. Not the latest answer from the server: somebody else recolouring
 *  the tag must not be undone by a reader who only touched the name. */
interface Draft {
  name: string;
  icon: string | null;
  color: TagColor;
  showInList: boolean;
  hideByDefault: boolean;
}

const NEW_DRAFT: Draft = {
  name: "",
  icon: null,
  color: "neutral",
  showInList: false,
  hideByDefault: false,
};

/** `PlayerAvatar` wants a player; a person named on a tag is an account that
 *  may not have one. Without a player id there is no picture to ask for, so the
 *  initial letter is the whole avatar. */
function asPlayer(person: Person): PlayerRead {
  return {
    id: person.playerId ?? "",
    name: person.username ?? "?",
    registered: true,
    has_avatar: person.playerId !== null && person.avatarVersion !== null,
    avatar_version: person.avatarVersion,
  };
}

/**
 * One tag: what it is called, what it looks like, and who it is for. Serves
 * both `/user/tags/new` and `/user/tags/:tagId` — the sections are the same
 * either way, only the way out differs (create and go to the tag, or save and
 * stay). A §6 sub-page gated on `tags.manage`.
 */
export default function TagEditor() {
  const { tagId } = useParams();
  const creating = tagId === undefined;
  const draftId = tagId ?? "new";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("tags.manage");

  const tags = useQuery({ ...listTagsOptions(), enabled: allowed });

  // There is no GET /tags/{id}: the listing is the one request, and it is the
  // one the admin list already made.
  const found = tags.data?.tags.find((tag) => tag.id === tagId);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<TagColor>("neutral");
  const [showInList, setShowInList] = useState(false);
  const [hideByDefault, setHideByDefault] = useState(false);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Person[]>([]);
  // Permission rows this page has no column for — an `admin` row somebody wrote
  // by hand, a role the backend grew after this build. They are sent back
  // untouched, because a PUT replaces every row the tag has.
  const [extras, setExtras] = useState<TagPermissionInput[]>([]);
  const [base, setBase] = useState<Draft>(NEW_DRAFT);
  const [baseGrants, setBaseGrants] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Take the draft from a tag the server answered with. */
  const seedFrom = (tag: TagRead) => {
    const next = new Set<string>();
    const named: Person[] = [];
    const other: TagPermissionInput[] = [];
    for (const row of tag.permissions ?? []) {
      if (row.user_id !== null) {
        next.add(grantKey(row.action, "user", row.user_id));
        if (!named.some((person) => person.id === row.user_id))
          named.push({
            id: row.user_id,
            username: row.username,
            playerId: null,
            avatarVersion: null,
          });
      } else if (row.role !== null && ROLE_COLUMNS.includes(row.role)) {
        next.add(grantKey(row.action, "role", row.role));
      } else if (row.role !== null) {
        other.push({ action: row.action, role: row.role });
      }
      // A row naming neither a role nor an account is dropped rather than sent
      // back: the API refuses a subjectless row, and it would take every other
      // row of the PUT down with it.
    }
    setName(tag.name);
    setIcon(tag.icon);
    setColor(tag.color as TagColor);
    setShowInList(tag.show_in_list);
    setHideByDefault(tag.hide_by_default);
    setGrants(next);
    setBaseGrants(new Set(next));
    setPeople(named);
    setExtras(other);
    setBase({
      name: tag.name.trim(),
      icon: tag.icon,
      color: tag.color as TagColor,
      showInList: tag.show_in_list,
      hideByDefault: tag.hide_by_default,
    });
    setError(null);
    setSaved(false);
  };

  // Seeded once, and re-seeded when the page is reused for another tag. A
  // `tags.changed` refetch while somebody is typing must not rewrite the field
  // under their cursor, so the draft is tagged with the id it came from.
  if (seeded !== draftId) {
    if (creating) {
      setSeeded(draftId);
      const next = new Set(
        NEW_TAG_GRANTS.map(([action, role]) => grantKey(action, "role", role)),
      );
      setName("");
      setIcon(null);
      setColor("neutral");
      setShowInList(false);
      setHideByDefault(false);
      setGrants(next);
      setBaseGrants(new Set());
      setPeople([]);
      setExtras([]);
      setBase(NEW_DRAFT);
      setError(null);
      setSaved(false);
    } else if (found !== undefined) {
      setSeeded(draftId);
      seedFrom(found);
    }
  }

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listTagsQueryKey() });

  useWingmanEvent("tags.changed", refresh);
  // The count the delete confirmation names is on the listing too.
  useWingmanEvent("song_tags.changed", refresh);

  const { search, setSearch, searching, suggestions, clear } =
    useUserLookup(allowed);

  const create = useMutation(createTagMutation());
  const update = useMutation(updateTagMutation());
  const replace = useMutation(replaceTagPermissionsMutation());
  const remove = useMutation({
    ...deleteTagMutation(),
    onSuccess: () => {
      refresh();
      void navigate("/user/tags");
    },
    onError: (cause) =>
      setError(errorMessage(cause, "Could not delete the tag.")),
  });

  const trimmed = name.trim();
  const has = (action: Action, kind: "role" | "user", id: string) =>
    grants.has(grantKey(action, kind, id));

  const toggle = (
    action: Action,
    kind: "role" | "user",
    id: string,
    on: boolean,
  ) => {
    setSaved(false);
    setGrants((old) => {
      const next = new Set(old);
      if (on) next.add(grantKey(action, kind, id));
      else next.delete(grantKey(action, kind, id));
      return next;
    });
  };

  /** Only what the reader actually changed — a PATCH names nothing else, and an
   *  explicit `icon: null` is the only way to clear one. */
  const changes = (): TagUpdate => {
    const body: TagUpdate = {};
    if (trimmed !== base.name) body.name = trimmed;
    if (icon !== base.icon) body.icon = icon;
    if (color !== base.color) body.color = color;
    if (showInList !== base.showInList) body.show_in_list = showInList;
    if (hideByDefault !== base.hideByDefault)
      body.hide_by_default = hideByDefault;
    return body;
  };

  const permissionRows = (): TagPermissionInput[] => [
    ...[...grants].map(grantRow),
    ...extras,
  ];

  const fieldsChanged = Object.keys(changes()).length > 0;
  const grantsChanged = !sameGrants(grants, baseGrants);
  const pending = creating || fieldsChanged || grantsChanged;

  const save = async () => {
    if (trimmed === "" || !pending) return;
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const made = await create.mutateAsync({
          body: {
            name: trimmed,
            icon,
            color,
            show_in_list: showInList,
            hide_by_default: hideByDefault,
            permissions: permissionRows(),
          },
        });
        // Into the cache before the route changes, so the editor at the new URL
        // has its tag whether or not React kept this component mounted — and
        // whether or not the refetch below brings it back (a manager who did
        // not grant themselves "See tag" is not shown their own tag).
        queryClient.setQueryData<TagList>(listTagsQueryKey(), (old) =>
          old === undefined
            ? { tags: [made] }
            : { tags: [...old.tags.filter((tag) => tag.id !== made.id), made] },
        );
        setSeeded(made.id);
        seedFrom(made);
        refresh();
        void navigate(`/user/tags/${encodeURIComponent(made.id)}`, {
          replace: true,
        });
        return;
      }
      let latest = found;
      const body = changes();
      if (Object.keys(body).length > 0)
        latest = await update.mutateAsync({
          path: { tag_id: tagId },
          body,
        });
      if (grantsChanged)
        latest = await replace.mutateAsync({
          path: { tag_id: tagId },
          body: { permissions: permissionRows() },
        });
      if (latest !== undefined) seedFrom(latest);
      setSaved(true);
      refresh();
    } catch (cause) {
      setSaved(false);
      setError(
        errorDetail(cause) === "duplicate_tag_name"
          ? `A tag called "${trimmed}" already exists. Pick another name.`
          : errorMessage(cause, "Could not save the tag."),
      );
    } finally {
      setSaving(false);
    }
  };

  /** Everybody the matrix and the people rows speak for, by display name. */
  const subjects: { name: string; kind: "role" | "user"; id: string }[] = [
    ...ROLE_COLUMNS.map((role) => ({
      name: role[0].toUpperCase() + role.slice(1),
      kind: "role" as const,
      id: role,
    })),
    ...people.map((person) => ({
      name: person.username ?? "a deleted account",
      kind: "user" as const,
      id: person.id,
    })),
  ];

  // A tagger who may not see the songs they tag loses each one the moment they
  // tag it, and cannot untag it again. The weaker "the filter is always empty"
  // warning skips those: it would say the same thing about the same people.
  const lockedOut = subjects.filter(
    (subject) =>
      has("assign", subject.kind, subject.id) &&
      !has("view_songs", subject.kind, subject.id),
  );
  const emptyFilter = subjects.filter(
    (subject) =>
      has("view", subject.kind, subject.id) &&
      !has("view_songs", subject.kind, subject.id) &&
      !has("assign", subject.kind, subject.id),
  );

  const named = new Set(people.map((person) => person.id));
  const matches = (suggestions.data?.users ?? []).filter(
    (user) => !named.has(user.id),
  );
  // Every song carrying the tag, the ones this manager may not see included:
  // what a delete takes the tag off is not what the assignments listing shows.
  const songs = found?.song_count ?? 0;
  // Only once the listing has answered and still does not know this tag: a
  // draft already seeded keeps its form, including the tag a manager has just
  // hidden from themselves.
  const gone =
    !creating && tags.isSuccess && found === undefined && seeded !== draftId;

  return (
    <div className="tags-page tag-editor">
      <PageHeader title={creating ? "New tag" : "Edit tag"} back="/user/tags" />

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {!allowed && (
            <p className="settings-notice">
              Tags are set up by trusted accounts and the host. Ask the host for
              access.
            </p>
          )}

          {allowed && (
            <>
              {tags.isPending && <Loading />}

              {tags.isError && (
                <p className="error-notice tags-notice" role="alert">
                  Could not load the tags.
                </p>
              )}

              {gone && (
                <p className="error-notice tags-notice" role="alert">
                  This tag is gone.{" "}
                  <Link to="/user/tags">Back to the tags</Link>
                </p>
              )}

              {seeded === draftId && (
                <>
                  {error && (
                    <p className="error-notice tags-notice" role="alert">
                      {error}
                    </p>
                  )}

                  <form
                    className="tag-editor-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    <label className="tag-editor-field">
                      <span>Name</span>
                      <input
                        className="text-input text-input-quiet"
                        value={name}
                        maxLength={32}
                        onChange={(event) => {
                          setSaved(false);
                          setName(event.target.value);
                        }}
                      />
                    </label>

                    <h2 id="tag-icon">Icon</h2>
                    <div
                      className="tag-icons"
                      role="group"
                      aria-labelledby="tag-icon"
                    >
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="No icon"
                        aria-pressed={icon === null}
                        onClick={() => {
                          setSaved(false);
                          setIcon(null);
                        }}
                      >
                        <Icon name="close" />
                      </button>
                      {PICKER_ICON_NAMES.map((glyph) => (
                        <button
                          key={glyph}
                          type="button"
                          className={`icon-button ${tagColorClass(color)}`}
                          aria-label={glyph}
                          aria-pressed={icon === glyph}
                          onClick={() => {
                            setSaved(false);
                            setIcon(glyph);
                          }}
                        >
                          <Icon name={glyph} />
                        </button>
                      ))}
                    </div>

                    <h2 id="tag-colour">Colour</h2>
                    <div
                      className="tag-colours"
                      role="radiogroup"
                      aria-labelledby="tag-colour"
                    >
                      {TAG_COLORS.map((option) => (
                        <label
                          key={option}
                          className={`tag-colour ${tagColorClass(option)}`}
                        >
                          <input
                            type="radio"
                            className="visually-hidden"
                            name="tag-colour"
                            value={option}
                            checked={color === option}
                            onChange={() => {
                              setSaved(false);
                              setColor(option);
                            }}
                          />
                          <span className="tag-colour-text">
                            <Icon name={tagGlyph(icon)} />
                            {COLOR_LABELS[option]}
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="tag-flags">
                      <label className="tag-check">
                        <input
                          type="checkbox"
                          checked={showInList}
                          onChange={(event) => {
                            setSaved(false);
                            setShowInList(event.target.checked);
                          }}
                        />
                        <span>Show in song list</span>
                      </label>
                      <p className="tag-flag-hint">
                        Every song carrying the tag wears its icon on the song
                        list, beside the favorite heart. Leave it off for a tag
                        most songs would end up with.
                      </p>
                      <label className="tag-check">
                        <input
                          type="checkbox"
                          checked={hideByDefault}
                          onChange={(event) => {
                            setSaved(false);
                            setHideByDefault(event.target.checked);
                          }}
                        />
                        <span>Hide songs by default</span>
                      </label>
                      <p className="tag-flag-hint">
                        The songs stay out of the song list and the reel until
                        somebody asks for them in the filter. Everybody who may
                        see the tag can still find them.
                      </p>
                    </div>

                    <h2 id="tag-permissions">Permissions</h2>
                    <div
                      className="perm-matrix"
                      style={{ "--perm-roles": 3 } as CSSProperties}
                    >
                      <p className="perm-hint">
                        Administrators are not in the table: they see every tag
                        and may set every one, so nothing here can hide a song
                        from the host.
                      </p>
                      {/* Decoration: every checkbox names its own right and role. */}
                      <div className="perm-head" aria-hidden="true">
                        <span />
                        {ROLE_COLUMNS.map((role) => (
                          <span key={role} className="perm-head-role">
                            {role}
                          </span>
                        ))}
                      </div>
                      <ul className="perm-list">
                        {ACTIONS.map(({ action, label, description }) => (
                          <li key={action} className="perm-row">
                            <div className="perm-label">
                              <span className="perm-line">
                                <span className="perm-name">{label}</span>
                              </span>
                              <p
                                className="perm-description"
                                id={`tag-perm-${action}`}
                              >
                                {description}
                              </p>
                            </div>
                            {ROLE_COLUMNS.map((role) => (
                              // A label, so the tap target is the whole cell
                              // and not just the box in the middle of it.
                              <label className="perm-cell" key={role}>
                                <input
                                  type="checkbox"
                                  aria-label={`${label} for ${role}`}
                                  aria-describedby={`tag-perm-${action}`}
                                  checked={has(action, "role", role)}
                                  onChange={(event) =>
                                    toggle(
                                      action,
                                      "role",
                                      role,
                                      event.target.checked,
                                    )
                                  }
                                />
                              </label>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {lockedOut.length > 0 && (
                      <p className="tag-warning">
                        {lockedOut.map((subject) => subject.name).join(", ")}{" "}
                        may tag songs without seeing them: a song would vanish
                        the moment they tag it, and they could not undo it. Tick
                        See songs as well.
                      </p>
                    )}
                    {emptyFilter.length > 0 && (
                      <p className="tag-warning">
                        {emptyFilter.map((subject) => subject.name).join(", ")}{" "}
                        may see the tag but none of its songs, so the filter for
                        it is always empty.
                      </p>
                    )}

                    <h2 id="tag-people">Specific people</h2>
                    <p className="tag-editor-hint">
                      One account at a time, on top of what its role already
                      holds.
                    </p>

                    <label className="tag-editor-field">
                      <span>Add people</span>
                      <input
                        className="text-input text-input-quiet"
                        type="search"
                        placeholder="Search by username"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>

                    {searching && (
                      <>
                        {suggestions.isPending && <Loading />}
                        {suggestions.isError && (
                          <p className="error-notice tags-notice" role="alert">
                            Could not search for accounts.
                          </p>
                        )}
                        {suggestions.isSuccess && matches.length === 0 && (
                          <p className="tag-editor-hint">
                            {(suggestions.data?.users ?? []).length > 0
                              ? "Everybody matching that is already on the tag."
                              : "No account matches that."}
                          </p>
                        )}
                        {matches.length > 0 && (
                          <ul
                            className="tag-matches"
                            aria-label="Matching accounts"
                          >
                            {matches.map((user) => (
                              <li key={user.id}>
                                <div className="tag-match-row">
                                  <PlayerAvatar
                                    player={asPlayer({
                                      id: user.id,
                                      username: user.username,
                                      playerId: user.player_id,
                                      avatarVersion: user.avatar_version,
                                    })}
                                  />
                                  <span className="tag-person-name">
                                    {user.username}
                                  </span>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    aria-label={`Add ${user.username}`}
                                    onClick={() => {
                                      setSaved(false);
                                      setPeople((old) => [
                                        ...old,
                                        {
                                          id: user.id,
                                          username: user.username,
                                          playerId: user.player_id,
                                          avatarVersion: user.avatar_version,
                                        },
                                      ]);
                                      // A person is added to be given
                                      // something, and nothing is worth less
                                      // than a row of empty boxes.
                                      setGrants((old) =>
                                        new Set(old).add(
                                          grantKey("view", "user", user.id),
                                        ),
                                      );
                                      clear();
                                    }}
                                  >
                                    <Icon name="user-plus" />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {people.length === 0 ? (
                      <p className="tag-editor-hint">
                        Nobody is named on this tag on their own — the roles
                        above decide.
                      </p>
                    ) : (
                      <div className="tag-people">
                        <div className="tag-people-head" aria-hidden="true">
                          <span />
                          <span />
                          {ACTIONS.map(({ action, label }) => (
                            <span key={action} className="tag-people-head-cell">
                              {label}
                            </span>
                          ))}
                          <span />
                        </div>
                        <ul
                          className="tag-people-list"
                          aria-labelledby="tag-people"
                        >
                          {people.map((person) => {
                            const who = person.username ?? "a deleted account";
                            return (
                              <li key={person.id} className="tag-people-row">
                                <PlayerAvatar player={asPlayer(person)} />
                                <span className="tag-person-name">{who}</span>
                                {ACTIONS.map(({ action, label }) => (
                                  <label className="perm-cell" key={action}>
                                    <input
                                      type="checkbox"
                                      aria-label={`${label} for ${who}`}
                                      checked={has(action, "user", person.id)}
                                      onChange={(event) =>
                                        toggle(
                                          action,
                                          "user",
                                          person.id,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                  </label>
                                ))}
                                <button
                                  type="button"
                                  className="icon-button icon-button-danger"
                                  aria-label={`Remove ${who}`}
                                  onClick={() => {
                                    setSaved(false);
                                    setPeople((old) =>
                                      old.filter(
                                        (other) => other.id !== person.id,
                                      ),
                                    );
                                    setGrants((old) => {
                                      const next = new Set(old);
                                      for (const { action } of ACTIONS)
                                        next.delete(
                                          grantKey(action, "user", person.id),
                                        );
                                      return next;
                                    });
                                  }}
                                >
                                  <Icon name="close" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <div className="tag-editor-save">
                      <button
                        type="submit"
                        className="button button-primary"
                        disabled={trimmed === "" || !pending || saving}
                      >
                        Save
                      </button>
                      {/* An acknowledgement, not a state: the page stays where
                          it is, so something has to say the save landed. */}
                      {saved && (
                        <span className="tag-editor-saved" role="status">
                          Saved
                        </span>
                      )}
                    </div>
                  </form>

                  {!creating && (
                    <div className="tag-editor-delete">
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={remove.isPending}
                        onClick={() => setDeleting(true)}
                      >
                        Delete tag
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete tag"
          message={
            songs === 0
              ? `Delete "${base.name}"? No song carries it, so nothing but the tag itself goes — and everybody it was granted to loses it.`
              : `Delete "${base.name}"? It comes off the ${songs === 1 ? "one song" : `${songs} songs`} carrying it and everybody it was granted to loses it. The songs themselves stay in the library.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(false);
            remove.mutate({ path: { tag_id: tagId ?? "" } });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
