import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  PlayerRead,
  TagList,
  TagPermissionInput,
  TagRead,
  TagRuleInput,
  TagRuleKindRead,
  TagUpdate,
} from "../api";
import {
  createTagMutation,
  deleteTagMutation,
  listTagRulesOptions,
  listTagsOptions,
  listTagsQueryKey,
  replaceTagPermissionsMutation,
  updateBuiltInTagMutation,
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
import {
  type BuiltInTagId,
  BUILT_IN_TAG_IDS,
  BUILT_IN_TAGS,
  builtInTags,
  DEFAULT_BUILT_IN_TAGS,
  TAG_COLORS,
  tagColorClass,
  tagGlyph,
  type TagColor,
} from "../tags";
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

/** The longest value a rule may compare against — `MAX_RULE_VALUE_LENGTH` in
 *  the backend's `tags/model.py`, the way the name field mirrors its own. */
const MAX_RULE_VALUE_LENGTH = 100;

/** What the select says for a tag people set themselves, and the value the
 *  draft holds while it is chosen. A kind is never the empty string. */
const NOT_AUTOMATIC = "";

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
  /** The rule's kind, or `NOT_AUTOMATIC` for a tag people set themselves. */
  ruleKind: string;
  /** What a value kind compares against; empty for the flag kinds and for a
   *  tag with no rule at all, so the field is one string either way. */
  ruleValue: string;
}

const NEW_DRAFT: Draft = {
  name: "",
  icon: null,
  color: "neutral",
  showInList: false,
  hideByDefault: false,
  ruleKind: NOT_AUTOMATIC,
  ruleValue: "",
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
 * The tag editor, at `/user/tags/new`, `/user/tags/:tagId` — and, on the two
 * reserved ids, on a built-in mark.
 *
 * The built-in half is its own component rather than a dozen `builtIn &&`
 * branches threaded through the 500 lines below: of that form it keeps two
 * controls, and everything else (the name, the icon picker, the second flag,
 * *Automatic*, the matrix, the people rows, Delete, the duplicate-name error,
 * the draft measured against a base) exists for a `tags` row it does not have.
 * The pieces they do share are the shared classes and `tagColorClass`, so the
 * fork costs no duplicated logic. The dispatch happens before either one's
 * hooks, so neither renders a form it then has to unpick.
 */
export default function TagEditor() {
  const { tagId } = useParams();
  if (tagId === "favorites" || tagId === "sung")
    return <BuiltInTagEditor builtInId={tagId} />;
  return <RealTagEditor />;
}

/**
 * One tag: what it is called, what it looks like, and who it is for. Serves
 * both `/user/tags/new` and `/user/tags/:tagId` — the sections are the same
 * either way, only the way out differs (create and go to the tag, or save and
 * stay). A §6 sub-page gated on `tags.manage`.
 */
function RealTagEditor() {
  const { tagId } = useParams();
  const creating = tagId === undefined;
  const draftId = tagId ?? "new";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("tags.manage");

  const tags = useQuery({ ...listTagsOptions(), enabled: allowed });
  // The rules a tag may follow, for the select and its suggestions. Its own
  // request, cached beside the listing and shared with the admin rows and the
  // song modal, both of which name a rule too.
  const ruleKinds = useQuery({ ...listTagRulesOptions(), enabled: allowed });

  // There is no GET /tags/{id}: the listing is the one request, and it is the
  // one the admin list already made.
  const found = tags.data?.tags.find((tag) => tag.id === tagId);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<TagColor>("neutral");
  const [showInList, setShowInList] = useState(false);
  const [hideByDefault, setHideByDefault] = useState(false);
  const [ruleKind, setRuleKind] = useState(NOT_AUTOMATIC);
  const [ruleValue, setRuleValue] = useState("");
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
  // A rule change that costs the tag its songs is confirmed before it is sent.
  const [confirmingRule, setConfirmingRule] = useState(false);

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
    setRuleKind(tag.rule?.kind ?? NOT_AUTOMATIC);
    setRuleValue(tag.rule?.value ?? "");
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
      ruleKind: tag.rule?.kind ?? NOT_AUTOMATIC,
      ruleValue: tag.rule?.value ?? "",
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
      setRuleKind(NOT_AUTOMATIC);
      setRuleValue("");
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

  // --- the rule ------------------------------------------------------------
  const kinds: TagRuleKindRead[] = ruleKinds.data?.rules ?? [];
  const chosen = kinds.find((kind) => kind.kind === ruleKind);
  const automatic = ruleKind !== NOT_AUTOMATIC;
  /** Whether the chosen kind compares against something the reader types. For
   *  a kind this build does not know — only ever the stored one — the answer
   *  is what the tag already carries: a value it has is a value it needs. */
  const needsValue =
    chosen !== undefined
      ? chosen.needs_value
      : automatic && base.ruleValue !== "";
  const value = ruleValue.trim();
  /** The stored kind, when the registry does not offer it: a build older than
   *  the backend that wrote the tag. It is added to the select as a disabled
   *  option, so Save does not quietly hand the tag back to the people — and
   *  while the listing is still in flight it stands in for its own label,
   *  which reads better than an empty select. */
  const missingKind =
    base.ruleKind !== NOT_AUTOMATIC &&
    !kinds.some((kind) => kind.kind === base.ruleKind);
  /** The chosen kind is one the registry does not offer — the stored one, on a
   *  build older than the backend that wrote it, or a listing still in flight.
   *  Its value is shown but not editable: `GET /tags/rules` comes from the very
   *  backend the save would go to, so a kind it does not list is a kind that
   *  save would refuse. Only the value is frozen; the select still lets the
   *  reader pick a rule this build does know. */
  const unknownKind = automatic && chosen === undefined;

  /** What the tag should follow, as the API takes it. A flag kind is sent
   *  without a value whatever is left in the input behind it — `{"kind":
   *  "duet", "value": "English"}` is a 422, and the input is only hidden. */
  const rule: TagRuleInput | null = automatic
    ? { kind: ruleKind, value: needsValue ? value : null }
    : null;
  const ruleChanged =
    ruleKind !== base.ruleKind || (needsValue && value !== base.ruleValue);

  const changeRule = (kind: string) => {
    setSaved(false);
    setRuleKind(kind);
  };

  /** The cells of the icon picker: the allowlist, and after it the tag's own
   *  glyph when that is one the picker does not offer — a tag made before the
   *  list changed keeps its icon choosable rather than losing it on the next
   *  save. Keyed to the *saved* icon, not the live choice: trying another glyph
   *  must not make the cell the reader came in on vanish from the grid. */
  const pickerIcons: readonly string[] = useMemo(
    () =>
      base.icon !== null &&
      !(PICKER_ICON_NAMES as readonly string[]).includes(base.icon)
        ? [...PICKER_ICON_NAMES, base.icon]
        : PICKER_ICON_NAMES,
    [base.icon],
  );

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
    // An explicit `rule: null` is what takes a rule off, so the field is only
    // named when it actually moved — a PATCH that mentions it re-derives.
    if (ruleChanged) body.rule = rule;
    return body;
  };

  const permissionRows = (): TagPermissionInput[] => [
    ...[...grants].map(grantRow),
    ...extras,
  ];

  const fieldsChanged = Object.keys(changes()).length > 0;
  const grantsChanged = !sameGrants(grants, baseGrants);
  const pending = creating || fieldsChanged || grantsChanged;
  /** A value kind with nothing to compare against. Saving it is a guaranteed
   *  422, so the button waits — the same guard the empty name gets. */
  const incomplete = needsValue && value === "";

  const save = async () => {
    if (trimmed === "" || incomplete || !pending) return;
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
            rule,
          },
        });
        // Into the cache before the route changes, so the editor at the new URL
        // has its tag whether or not React kept this component mounted — and
        // whether or not the refetch below brings it back (a manager who did
        // not grant themselves "See tag" is not shown their own tag).
        queryClient.setQueryData<TagList>(listTagsQueryKey(), (old) =>
          old === undefined
            ? // The built-ins are the listing's other half; without an answer to
              // seed them from, their defaults are what the app draws anyway.
              {
                tags: [made],
                built_ins: BUILT_IN_TAG_IDS.map(
                  (id) => DEFAULT_BUILT_IN_TAGS[id],
                ),
              }
            : {
                ...old,
                tags: [...old.tags.filter((tag) => tag.id !== made.id), made],
              },
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
  // Nobody tags an automatic tag, so under a rule the warning describes
  // something that cannot happen — the line under the matrix says why instead.
  const lockedOut = automatic
    ? []
    : subjects.filter(
        (subject) =>
          has("assign", subject.kind, subject.id) &&
          !has("view_songs", subject.kind, subject.id),
      );
  const emptyFilter = subjects.filter(
    (subject) =>
      has("view", subject.kind, subject.id) &&
      !has("view_songs", subject.kind, subject.id) &&
      // A ticked Tag songs is what sends somebody to the warning above — and
      // under a rule that tick does nothing, so this one speaks for them too.
      (automatic || !has("assign", subject.kind, subject.id)),
  );

  const named = new Set(people.map((person) => person.id));
  const matches = (suggestions.data?.users ?? []).filter(
    (user) => !named.has(user.id),
  );
  // Every song carrying the tag, the ones this manager may not see included:
  // what a delete takes the tag off is not what the assignments listing shows.
  const songs = found?.song_count ?? 0;
  const count = songs === 1 ? "one song" : `${songs} songs`;
  const is = songs === 1 ? "is" : "are";

  /**
   * What this save is about to do to the songs under the tag, or null when it
   * does nothing to them. The backend rewrites every row of a tag whose rule
   * moves — the ones the new rule would have picked as well, because they were
   * somebody else's answer — so the reader is told before it happens.
   *
   * Only for a tag that has something to lose: a new tag has no songs, and
   * neither has one nobody has used yet.
   */
  const ruleCost: string | null =
    creating || !ruleChanged || songs === 0
      ? null
      : base.ruleKind === NOT_AUTOMATIC
        ? `Make "${base.name}" automatic? The ${count} carrying it ${songs === 1 ? "loses its" : "lose their"} hand-set tag — from now on the rule decides, and nobody puts this tag on a song by hand.`
        : automatic
          ? `Change the rule of "${base.name}"? Its ${count} ${is} re-derived: the new rule picks the songs from scratch.`
          : `Hand "${base.name}" back to the people? Its ${count} ${is} the rule's, so the tag comes off ${songs === 1 ? "it" : "them all"} and starts empty.`;

  const submit = () => {
    // The same door `save` keeps: a confirmation for a save that would turn
    // straight around again would be a question about nothing.
    if (trimmed === "" || incomplete || !pending || saving) return;
    if (ruleCost !== null) setConfirmingRule(true);
    else void save();
  };
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
                      submit();
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
                      {pickerIcons.map((glyph) => (
                        <button
                          key={glyph}
                          type="button"
                          className="icon-button"
                          aria-label={glyph}
                          aria-pressed={icon === glyph}
                          onClick={() => {
                            setSaved(false);
                            setIcon(glyph);
                          }}
                        >
                          {/* The colour rides on the glyph, not on the cell:
                              the cell's hover repaints `color`, and a chosen
                              cell must keep the tag's colour under the
                              pointer. */}
                          <Icon
                            name={tagGlyph(glyph)}
                            className={
                              icon === glyph ? tagColorClass(color) : undefined
                            }
                          />
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

                    {/* Between the flags and the matrix (§7): how a tag reaches
                        a song, before who may put it there. */}
                    <h2 id="tag-automatic">Automatic</h2>
                    <p className="tag-editor-hint">
                      A rule reads what is in the song files and puts the tag on
                      every song that matches. Wingman keeps it up to date on
                      every scan, and nobody sets an automatic tag by hand.
                    </p>

                    {ruleKinds.isError && (
                      <p className="error-notice tags-notice" role="alert">
                        Could not load the rules a tag can follow.
                      </p>
                    )}

                    <label className="tag-editor-field">
                      <span>Rule</span>
                      <select
                        className="text-input text-input-quiet"
                        value={ruleKind}
                        onChange={(event) => changeRule(event.target.value)}
                      >
                        <option value={NOT_AUTOMATIC}>Not automatic</option>
                        {kinds.map((kind) => (
                          <option key={kind.kind} value={kind.kind}>
                            {kind.label}
                          </option>
                        ))}
                        {/* A rule this build does not know, by its bare name:
                            offered so the select can show what the tag follows,
                            disabled so it cannot be chosen for another tag. */}
                        {missingKind && (
                          <option value={base.ruleKind} disabled>
                            {base.ruleKind}
                          </option>
                        )}
                      </select>
                    </label>

                    {needsValue && (
                      <label className="tag-editor-field">
                        <span>Value</span>
                        <input
                          className="text-input text-input-quiet"
                          list="tag-rule-values"
                          value={ruleValue}
                          maxLength={MAX_RULE_VALUE_LENGTH}
                          disabled={unknownKind}
                          aria-describedby={
                            incomplete ? "tag-rule-value-hint" : undefined
                          }
                          onChange={(event) => {
                            setSaved(false);
                            setRuleValue(event.target.value);
                          }}
                        />
                        {/* What the library holds for that field — an offer and
                            not a list to pick from: a value nothing carries yet
                            is a tag that fills itself on the next download. */}
                        <datalist id="tag-rule-values">
                          {(chosen?.suggestions ?? []).map((suggestion) => (
                            <option key={suggestion} value={suggestion} />
                          ))}
                        </datalist>
                      </label>
                    )}

                    {/* Why Save is off. Blocking the save is not enough on its
                        own — the reader is owed the reason here rather than a
                        422 from the backend after they find a way to send it. */}
                    {incomplete && (
                      <p className="tag-editor-hint" id="tag-rule-value-hint">
                        Save waits for this: a rule with nothing to compare
                        against would take no song at all.
                      </p>
                    )}

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
                                  // The rule owns the songs of an automatic
                                  // tag: the ticks stay, so taking the rule
                                  // off gives the tag back to the same people.
                                  disabled={automatic && action === "assign"}
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

                    {/* One line for both tables of ticks, where the guideline
                        puts it: under the matrix, above the people rows. */}
                    {automatic && (
                      <p className="tag-editor-hint">
                        The rule decides which songs carry this tag, so Tag
                        songs is nobody&apos;s while it is automatic. The ticks
                        stay as they are and count again the moment the rule
                        goes.
                      </p>
                    )}

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
                                      disabled={
                                        automatic && action === "assign"
                                      }
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
                        disabled={
                          trimmed === "" || incomplete || !pending || saving
                        }
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

      {/* The songs under the tag are rewritten by the save itself, so the
          question comes before it goes (§5: a replace is a danger). */}
      {confirmingRule && ruleCost !== null && (
        <ConfirmModal
          title={automatic ? "Change what this tag follows" : "Remove the rule"}
          message={ruleCost}
          confirmLabel="Save"
          danger
          onConfirm={() => {
            setConfirmingRule(false);
            void save();
          }}
          onCancel={() => setConfirmingRule(false)}
        />
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

/**
 * What a built-in mark is, in one line — the reason the page below it is two
 * controls and not the tag editor's dozen.
 */
const BUILT_IN_WHY: Record<BuiltInTagId, string> = {
  favorites:
    "Favorites are one person's own: everybody sees a heart on the songs they favorited and on nobody else's. So there is nothing to name, no icon to pick, nobody to grant it to and nothing to delete — only what the mark looks like, and whether it belongs on a song row at all.",
  sung: "Sung is one person's own: everybody sees a microphone on the songs they have sung and on nobody else's. So there is nothing to name, no icon to pick, nobody to grant it to and nothing to delete — only what the mark looks like, and whether it belongs on a song row at all.",
};

/**
 * A built-in mark — Favorites or Sung — at `/user/tags/favorites` and
 * `/user/tags/sung`. A tag id is 32 hex characters, so neither word can ever be
 * one, and the two share the tag rows' idiom without being tags.
 */
function BuiltInTagEditor({ builtInId }: { builtInId: BuiltInTagId }) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("tags.manage");

  // The same listing the admin page made: there is no GET for one built-in
  // either, and both come down with the tags.
  const tags = useQuery({ ...listTagsOptions(), enabled: allowed });
  const stored = builtInTags(tags.data?.built_ins)[builtInId];

  const [color, setColor] = useState<TagColor>("neutral");
  const [showInList, setShowInList] = useState(true);
  // What the server last said, to measure the two fields against — so a save
  // somebody else made does not come back as "you have unsaved changes".
  const [base, setBase] = useState<{ color: TagColor; showInList: boolean }>({
    color: "neutral",
    showInList: true,
  });
  const [seeded, setSeeded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seeded once, and re-seeded when the page is reused for the other mark. A
  // `tags.changed` refetch while somebody is choosing must not move the pills
  // under their hand, so the draft is tagged with the mark it came from.
  if (tags.isSuccess && seeded !== builtInId) {
    setSeeded(builtInId);
    setColor(stored.color as TagColor);
    setShowInList(stored.show_in_list);
    setBase({
      color: stored.color as TagColor,
      showInList: stored.show_in_list,
    });
    setError(null);
    setSaved(false);
  }

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listTagsQueryKey() });
  useWingmanEvent("tags.changed", refresh);

  const update = useMutation(updateBuiltInTagMutation());

  const pending = color !== base.color || showInList !== base.showInList;

  const save = async () => {
    if (!pending) return;
    setError(null);
    try {
      const latest = await update.mutateAsync({
        path: { built_in_id: builtInId },
        body: { color, show_in_list: showInList },
      });
      setColor(latest.color as TagColor);
      setShowInList(latest.show_in_list);
      setBase({
        color: latest.color as TagColor,
        showInList: latest.show_in_list,
      });
      setSaved(true);
      refresh();
    } catch (cause) {
      setSaved(false);
      setError(errorMessage(cause, "Could not save the mark."));
    }
  };

  const glyph = BUILT_IN_TAGS[builtInId].icon;

  return (
    <div className="tags-page tag-editor">
      <PageHeader title={BUILT_IN_TAGS[builtInId].name} back="/user/tags" />

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

              {seeded === builtInId && (
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
                    <p className="tag-editor-hint">{BUILT_IN_WHY[builtInId]}</p>

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
                            <Icon name={glyph} />
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
                        Everybody wears the mark on their own songs in the song
                        list, next to the tags. Off, the mark is gone from the
                        rows — the filter and the chip above them stay.
                      </p>
                    </div>

                    <div className="tag-editor-save">
                      <button
                        type="submit"
                        className="button button-primary"
                        disabled={!pending || update.isPending}
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
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
