import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  AchievementList,
  AchievementRead,
  AchievementUpdate,
  Condition,
} from "../api";
import {
  createAchievementMutation,
  deleteAchievementIconMutation,
  deleteAchievementMutation,
  listAchievementsOptions,
  listAchievementsQueryKey,
  resetAchievementMutation,
  setAchievementIconMutation,
  updateAchievementMutation,
} from "../api/@tanstack/react-query.gen";
import {
  achievementGlyph,
  conditionProblem,
  MANAGE_CATALOGUE,
} from "../achievements";
import { useAuth } from "../auth";
import AchievementBadge from "../components/AchievementBadge";
import ConditionBuilder from "../components/ConditionBuilder";
import ConfirmModal from "../components/ConfirmModal";
import EditorActions from "../components/EditorActions";
import { Icon, PICKER_ICON_NAMES } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { errorDetail, errorMessage, validationMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { tagColorClass, TAG_COLORS, type TagColor } from "../tags";
// The tag editor is the same page (§7): a name, the icon picker, the colour
// pills, checkboxes with their explaining lines, one Save and a danger Delete.
// Its stylesheet is those idioms, so the sections here wear its classes rather
// than a second set on the same metrics.
import "./Achievements.css";
import "./TagEditor.css";
import "./AchievementEditor.css";

/** Mirrors `images.MAX_IMAGE_BYTES`, so an oversized picture never leaves the
 *  browser. */
const MAX_ICON_BYTES = 5 * 1024 * 1024;

/** The three refusals `PUT /achievements/{id}/icon` names, in the singer's
 *  words. Same rules as a player's avatar — the same module does both. */
const ICON_MESSAGES: Record<string, string> = {
  icon_too_large: "That image is larger than 5 MB.",
  icon_too_many_pixels:
    "That picture has far too many pixels. Scale it down and try again.",
  unsupported_icon_type:
    "Only jpeg, png, and webp images work, and the file has to really be one.",
};

const COLOR_LABELS: Record<TagColor, string> = {
  neutral: "Neutral",
  blue: "Blue",
  pink: "Pink",
  gold: "Gold",
};

/** What the achievement looked like when the draft was seeded, to measure a
 *  PATCH against. Not the latest answer from the server: somebody else
 *  recolouring it must not be undone by a reader who only touched the name.
 *  The definition is held as its JSON, which is what makes "did the conditions
 *  move" one comparison rather than a deep walk. */
interface Draft {
  name: string;
  description: string;
  icon: string | null;
  color: TagColor;
  hidden: boolean;
  enabled: boolean;
  definition: string;
}

const NEW_DRAFT: Draft = {
  name: "",
  description: "",
  icon: null,
  color: "neutral",
  hidden: false,
  enabled: true,
  definition: "[]",
};

/**
 * One achievement: what it is called, what it looks like, and what somebody has
 * to do to get it. Serves both `/user/achievements/new` and
 * `/user/achievements/:achievementId` — the sections are the same either way,
 * only the way out differs (create and go to it, or save and stay). A §6
 * sub-page gated on `achievements.manage`.
 *
 * A built-in opens in the same form with two differences (achievements.md):
 * what it looks like is as editable as anybody else's and it may be switched
 * off, but its **conditions** are Wingman's own — so the builder is drawn
 * locked, the section note says why, and the foot carries a Reset that puts
 * everything but `enabled` back the way Wingman ships it, in the place where
 * another achievement's Delete stands.
 */
export default function AchievementEditor() {
  const { achievementId } = useParams();
  const creating = achievementId === undefined;
  const draftId = achievementId ?? "new";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("achievements.manage");

  // A create ends on the achievement it made, at a route of its own — so React
  // is free to remount this component and the fact that the press landed has to
  // travel with the navigation rather than in a `useState`. Without it the row
  // falls through to "Nothing has changed yet." on the achievement that press
  // has just made, which reads as a Save that did nothing.
  const justCreated =
    (useLocation().state as { created?: boolean } | null)?.created === true;

  const catalogue = useQuery({
    ...listAchievementsOptions(MANAGE_CATALOGUE),
    enabled: allowed,
  });

  // There is no GET /achievements/{id}: the listing is the one request, and the
  // managing copy of it carries every row's definition — and the name of a
  // hidden one, which this page has to be able to show.
  const found = catalogue.data?.achievements.find(
    (achievement) => achievement.id === achievementId,
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<TagColor>("neutral");
  const [hidden, setHidden] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<Condition[]>([]);
  // The picture is not part of the form: it is its own endpoint and lands the
  // moment it is picked, so it is state of its own rather than a field of the
  // draft. `iconVersion` is the stored file's own version, taken off whatever
  // the icon endpoint last answered with, and it is what gets the new bytes
  // past the browser's copy of the old ones (`achievementIconUrl`).
  const [hasImage, setHasImage] = useState(false);
  const [iconVersion, setIconVersion] = useState<number | null>(null);
  const [builtIn, setBuiltIn] = useState(false);
  const [base, setBase] = useState<Draft>(NEW_DRAFT);
  const [seeded, setSeeded] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** What the acknowledgement in the action row says when what landed was not a
   *  save. Only a reset sets it; every other write that lands puts it back to
   *  the ordinary word first — `save` before the request goes out, `tookIcon`
   *  when a picture lands — and it is read only while `acknowledged` holds. So
   *  it can never linger as a stale line over a form the reset no longer
   *  describes. */
  const [savedLabel, setSavedLabel] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);

  /** Take the draft from an achievement the server answered with. */
  const seedFrom = (achievement: AchievementRead) => {
    const definition = achievement.definition ?? [];
    setName(achievement.name);
    setDescription(achievement.description);
    setIcon(achievement.icon);
    setColor(achievement.color as TagColor);
    setHidden(achievement.hidden);
    setEnabled(achievement.enabled);
    setConditions(definition);
    setHasImage(achievement.has_image);
    setIconVersion(achievement.icon_version ?? null);
    setBuiltIn(achievement.built_in);
    setBase({
      name: achievement.name.trim(),
      description: achievement.description.trim(),
      icon: achievement.icon,
      color: achievement.color as TagColor,
      hidden: achievement.hidden,
      enabled: achievement.enabled,
      definition: JSON.stringify(definition),
    });
    setError(null);
    setIconError(null);
    setSaved(false);
  };

  // Seeded once, and re-seeded when the page is reused for another achievement.
  // An `achievements.changed` refetch while somebody is typing must not rewrite
  // the field under their cursor, so the draft is tagged with the id it came
  // from.
  if (seeded !== draftId) {
    if (creating) {
      setSeeded(draftId);
      setName("");
      setDescription("");
      setIcon(null);
      setColor("neutral");
      setHidden(false);
      setEnabled(true);
      setConditions([]);
      setHasImage(false);
      setIconVersion(null);
      setBuiltIn(false);
      setBase(NEW_DRAFT);
      setError(null);
      setIconError(null);
      setSaved(false);
    } else if (found !== undefined) {
      setSeeded(draftId);
      seedFrom(found);
    }
  }

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: listAchievementsQueryKey(),
    });

  useWingmanEvent("achievements.changed", refresh);

  const create = useMutation(createAchievementMutation());
  const update = useMutation(updateAchievementMutation());
  const remove = useMutation({
    ...deleteAchievementMutation(),
    onSuccess: () => {
      refresh();
      void navigate("/user/achievements");
    },
    onError: (cause) =>
      setError(errorMessage(cause, "Could not delete the achievement.")),
  });

  // The whole row comes back out of the answer, so the form is re-seeded from it
  // the way a save re-seeds it: a reset that left the draft standing would show
  // the discarded name over the restored achievement.
  const reset = useMutation({
    ...resetAchievementMutation(),
    onSuccess: (achievement) => {
      seedFrom(achievement);
      // After `seedFrom`, which clears the acknowledgement along with the rest
      // of the draft: a reset settles with nothing pending, and the row's
      // truthful default line — "Nothing has changed yet." — reads a second
      // after the confirmation as though the reset had done nothing.
      setSaved(true);
      setSavedLabel("Reset. The shipped achievement is back.");
      refresh();
    },
    onError: (cause) =>
      setError(errorMessage(cause, "Could not reset the achievement.")),
  });

  /** What an icon write answers with, taken **without** reseeding the form: the
   *  response is a whole achievement, and adopting it would wipe the name and
   *  the conditions somebody has typed and not yet saved. Only the picture
   *  moved, so only the picture is read off it. */
  const tookIcon = (achievement: AchievementRead) => {
    setIconError(null);
    // An icon write is a save of its own, and it is not the reset the row may
    // still be acknowledging: a reset drops the uploaded picture, so leaving
    // "the shipped achievement is back" standing over a picture that has just
    // been put on it would be a line saying the opposite of what happened.
    setSavedLabel(undefined);
    setHasImage(achievement.has_image);
    // The version of the file as it now stands — `null` once the picture is
    // gone, and a new number after a replacement, which is what makes the
    // browser fetch the bytes it has just been sent instead of the old ones.
    setIconVersion(achievement.icon_version ?? null);
    refresh();
  };

  const setIconImage = useMutation({
    ...setAchievementIconMutation(),
    onSuccess: (achievement) => tookIcon(achievement),
    onError: (cause) =>
      setIconError(
        ICON_MESSAGES[errorDetail(cause) ?? ""] ??
          errorMessage(cause, "Could not upload the picture."),
      ),
  });

  const dropIconImage = useMutation({
    ...deleteAchievementIconMutation(),
    onSuccess: (achievement) => tookIcon(achievement),
    onError: (cause) =>
      setIconError(errorMessage(cause, "Could not remove the picture.")),
  });

  const upload = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    // Cleared right away, so picking the very same file again after a rejection
    // is another change event and not a click that does nothing.
    input.value = "";
    if (!file || achievementId === undefined) return;
    if (file.size > MAX_ICON_BYTES) {
      setIconError(ICON_MESSAGES.icon_too_large);
      return;
    }
    setIconError(null);
    setIconImage.mutate({
      path: { achievement_id: achievementId },
      body: { file },
    });
  };

  const trimmed = name.trim();
  const trimmedDescription = description.trim();

  /** The cells of the icon picker: the allowlist, and after it the achievement's
   *  own glyph when that is one the picker does not offer. Keyed to the *saved*
   *  icon, not the live choice: trying another glyph must not make the cell the
   *  reader came in on vanish from the grid. */
  const pickerIcons: readonly string[] = useMemo(
    () =>
      base.icon !== null &&
      !(PICKER_ICON_NAMES as readonly string[]).includes(base.icon)
        ? [...PICKER_ICON_NAMES, base.icon]
        : PICKER_ICON_NAMES,
    [base.icon],
  );

  /** Only what the reader actually changed — a PATCH names nothing else, and an
   *  explicit `icon: null` is the only way to clear a glyph. */
  const changes = (): AchievementUpdate => {
    const body: AchievementUpdate = {};
    if (trimmed !== base.name) body.name = trimmed;
    if (trimmedDescription !== base.description)
      body.description = trimmedDescription;
    if (icon !== base.icon) body.icon = icon;
    if (color !== base.color) body.color = color;
    if (hidden !== base.hidden) body.hidden = hidden;
    if (enabled !== base.enabled) body.enabled = enabled;
    // Never for a built-in: its conditions are Wingman's, the builder is locked
    // and `PATCH` answers a definition on one with a 409.
    if (!builtIn && JSON.stringify(conditions) !== base.definition)
      body.definition = conditions;
    return body;
  };

  // What the backend would refuse, said beside the box instead: Save is shut
  // while any block is wrong. An achievement with *no* conditions is not one of
  // those — the backend takes it — so it is a warning and Save stays open.
  // Nothing a reader cannot touch may ever shut Save, so a built-in's locked
  // conditions are not weighed at all.
  const broken =
    !builtIn &&
    conditions.some((condition) => conditionProblem(condition) !== null);
  const pending = creating || Object.keys(changes()).length > 0;
  const blocked = trimmed === "" || broken || !pending || saving;
  /** A save that landed: this one, or the create this page was arrived at by. */
  const acknowledged = saved || (justCreated && !pending && !saving);

  /** Why Save is grey, said in the action row that is always on screen — a
   *  permanently visible disabled button that does not say why reads as a
   *  broken app. In the order the reader would fix them, and the
   *  acknowledgement the row says for itself — *Saved*, or what a reset just
   *  did — wins over the "nothing has changed" that is true of the same
   *  moment.
   *
   *  The refusal from the backend is in the row too, as a pointer and not as a
   *  copy: the `role="alert"` notice that carries the sentence itself is at the
   *  head of the form, and now that Save can be pressed from anywhere in a form
   *  this long, a press that goes nowhere with no word in the row is the same
   *  broken app the line exists to prevent. */
  const saveNote = reset.isPending
    ? // The modal is gone by now and a reset takes a round trip and a
      // background pass with it, so the row is the only place left to say that
      // something is happening.
      "Resetting…"
    : saving
      ? "Saving…"
      : trimmed === ""
        ? "It needs a name before it can be saved."
        : broken
          ? "A condition above needs putting right before this can be saved."
          : error !== null
            ? "It did not go through. The message at the top of the page says why."
            : !pending && !acknowledged
              ? "Nothing has changed yet."
              : null;

  const save = async () => {
    if (trimmed === "" || broken || !pending) return;
    setSaving(true);
    setError(null);
    // Whatever the row was acknowledging, it is about to acknowledge a save.
    setSavedLabel(undefined);
    try {
      if (creating) {
        const made = await create.mutateAsync({
          body: {
            name: trimmed,
            description: trimmedDescription,
            icon,
            color,
            hidden,
            enabled,
            definition: conditions,
          },
        });
        // Into the cache before the route changes, so the editor at the new URL
        // has its achievement whether or not React kept this component mounted
        // and whether or not the refetch below has landed.
        queryClient.setQueryData<AchievementList>(
          // The managing entry, the one this page reads: `setQueryData` matches
          // a key exactly, so the bare one would land in the masked listing.
          listAchievementsQueryKey(MANAGE_CATALOGUE),
          (old) =>
            old === undefined
              ? old
              : {
                  ...old,
                  achievements: [
                    ...old.achievements.filter((row) => row.id !== made.id),
                    made,
                  ],
                },
        );
        setSeeded(made.id);
        seedFrom(made);
        refresh();
        // `replace`, so Back from the achievement that now exists leads to the
        // list rather than to an empty `new` form that would seed itself again.
        // `created`, so the action row acknowledges the press on the other side
        // of the navigation (`justCreated`).
        void navigate(`/user/achievements/${encodeURIComponent(made.id)}`, {
          replace: true,
          state: { created: true },
        });
        return;
      }
      const body = changes();
      if (Object.keys(body).length > 0) {
        const latest = await update.mutateAsync({
          path: { achievement_id: achievementId },
          body,
        });
        seedFrom(latest);
      }
      setSaved(true);
      refresh();
    } catch (cause) {
      setSaved(false);
      // A 422 from the condition models says in words what it refused —
      // a regular expression Python cannot read above all, which is the one
      // refusal `conditionProblem` may not make for itself. Nothing this page
      // could write instead would be of more use than that sentence.
      setError(
        errorDetail(cause) ??
          validationMessage(cause) ??
          errorMessage(cause, "Could not save the achievement."),
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    // The same door `save` keeps: a save that would turn straight around again
    // is nothing to press.
    if (blocked) return;
    void save();
  };

  /** The medallion as it will be drawn, for the one case the form cannot show
   *  by itself: an uploaded picture. Never masked — `isMasked` reads an empty
   *  name, and a draft on its way to being named is not a secret. */
  const preview: AchievementRead = {
    id: achievementId ?? "new",
    name: trimmed === "" ? "New achievement" : trimmed,
    description: trimmedDescription,
    icon,
    has_image: hasImage,
    // The one field of the preview the draft cannot make up: the picture on
    // disk is whatever the last icon write left there.
    icon_version: iconVersion,
    color,
    hidden,
    enabled,
    built_in: builtIn,
    sort_order: 0,
    definition: null,
  };

  // Only once the listing has answered and still does not know this id: a draft
  // already seeded keeps its form.
  const gone =
    !creating &&
    catalogue.isSuccess &&
    found === undefined &&
    seeded !== draftId;

  return (
    <div className="achievements-page achievement-editor">
      <PageHeader
        title={creating ? "New achievement" : "Edit achievement"}
        back="/user/achievements"
      />

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {!allowed && (
            <p className="settings-notice">
              Achievements are looked after by the host. Ask the host for
              access.
            </p>
          )}

          {allowed && (
            <>
              {catalogue.isPending && <Loading />}

              {catalogue.isError && (
                <p className="error-notice achievements-notice" role="alert">
                  Could not load the achievements.
                </p>
              )}

              {gone && (
                <p className="error-notice achievements-notice" role="alert">
                  This achievement is gone.{" "}
                  <Link to="/user/achievements">Back to the achievements</Link>
                </p>
              )}

              {seeded === draftId && (
                <>
                  {error && (
                    <p
                      className="error-notice achievements-notice"
                      role="alert"
                    >
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
                        maxLength={64}
                        onChange={(event) => {
                          setSaved(false);
                          setName(event.target.value);
                        }}
                      />
                    </label>

                    <label className="tag-editor-field">
                      <span>Description</span>
                      <textarea
                        className="text-input text-input-quiet"
                        rows={3}
                        maxLength={280}
                        value={description}
                        onChange={(event) => {
                          setSaved(false);
                          setDescription(event.target.value);
                        }}
                      />
                    </label>
                    <p className="tag-editor-hint">
                      The line the singer reads under the badge on their own
                      page. Say what they have to do, not how it is measured.
                    </p>

                    <h2 id="achievement-icon">Icon</h2>

                    {hasImage ? (
                      <div className="achievement-picture">
                        <AchievementBadge
                          achievement={preview}
                          className="achievement-picture-badge"
                        />
                        <p className="tag-editor-hint achievement-picture-note">
                          A picture is drawn instead of a glyph, exactly as it
                          was uploaded.
                        </p>
                        <div className="achievement-picture-actions">
                          <label className="button achievement-upload">
                            <Icon name="image" />
                            <span>Replace picture</span>
                            <input
                              type="file"
                              className="visually-hidden"
                              accept="image/jpeg,image/png,image/webp"
                              aria-label="Replace picture"
                              disabled={setIconImage.isPending}
                              onChange={(event) => upload(event.target)}
                            />
                          </label>
                          <button
                            type="button"
                            className="button"
                            disabled={dropIconImage.isPending}
                            onClick={() => {
                              setIconError(null);
                              dropIconImage.mutate({
                                path: {
                                  achievement_id: achievementId ?? "",
                                },
                              });
                            }}
                          >
                            Use a glyph instead
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className="tag-icons"
                          role="group"
                          aria-labelledby="achievement-icon"
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
                              {/* The colour rides on the glyph, not on the
                                  cell: the cell's hover repaints `color`, and
                                  a chosen cell must keep its colour under the
                                  pointer. */}
                              <Icon
                                name={achievementGlyph(glyph)}
                                className={
                                  icon === glyph
                                    ? tagColorClass(color)
                                    : undefined
                                }
                              />
                            </button>
                          ))}
                        </div>

                        <div className="achievement-picture-actions">
                          <label
                            className={
                              creating
                                ? "button achievement-upload achievement-upload-off"
                                : "button achievement-upload"
                            }
                          >
                            <Icon name="image" />
                            <span>Use a picture instead</span>
                            <input
                              type="file"
                              className="visually-hidden"
                              accept="image/jpeg,image/png,image/webp"
                              aria-label="Use a picture instead"
                              disabled={creating || setIconImage.isPending}
                              onChange={(event) => upload(event.target)}
                            />
                          </label>
                        </div>
                        {creating && (
                          <p className="tag-editor-hint">
                            A picture needs an achievement to belong to. Save
                            this one first and the upload is here.
                          </p>
                        )}
                      </>
                    )}

                    {iconError !== null && (
                      <p
                        className="error-notice achievements-notice"
                        role="alert"
                      >
                        {iconError}
                      </p>
                    )}

                    <h2 id="achievement-colour">Color</h2>
                    {hasImage ? (
                      <p className="tag-editor-hint">
                        A picture is drawn as it is, so there is no color to
                        set. Go back to a glyph and the four colors come with
                        it.
                      </p>
                    ) : (
                      <div
                        className="tag-colours"
                        role="radiogroup"
                        aria-labelledby="achievement-colour"
                      >
                        {TAG_COLORS.map((option) => (
                          <label
                            key={option}
                            className={`tag-colour ${tagColorClass(option)}`}
                          >
                            <input
                              type="radio"
                              className="visually-hidden"
                              name="achievement-colour"
                              value={option}
                              checked={color === option}
                              onChange={() => {
                                setSaved(false);
                                setColor(option);
                              }}
                            />
                            <span className="tag-colour-text">
                              <Icon name={achievementGlyph(icon)} />
                              {COLOR_LABELS[option]}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="tag-flags">
                      <label className="tag-check">
                        <input
                          type="checkbox"
                          checked={hidden}
                          onChange={(event) => {
                            setSaved(false);
                            setHidden(event.target.checked);
                          }}
                        />
                        <span>Hidden until earned</span>
                      </label>
                      <p className="tag-flag-hint">
                        Everybody else sees a locked badge with no name and no
                        description until they earn it themselves. Earning one
                        announces it to the party.
                      </p>
                      <label className="tag-check">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => {
                            setSaved(false);
                            setEnabled(event.target.checked);
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                      <p className="tag-flag-hint">
                        An achievement that is off is not worked out and not
                        drawn anywhere: not on a singer's page, not on the host
                        screen. Switching it back on brings everybody's badges
                        up to date.
                      </p>
                    </div>

                    <h2>Conditions</h2>
                    <p className="section-note">
                      {builtIn
                        ? "All of them have to hold before anybody earns it. What one of Wingman's own achievements asks for cannot be changed. The same badge means the same thing at every party. Reset below puts everything else back too."
                        : "All of them have to hold before anybody earns it."}
                    </p>

                    {!builtIn && conditions.length === 0 && (
                      <p className="tag-warning">
                        With no conditions at all, nobody can ever earn this.
                        Add one. Wingman saves it either way, and without
                        conditions it sits on the list unearned.
                      </p>
                    )}

                    <ConditionBuilder
                      value={conditions}
                      readOnly={builtIn}
                      onChange={(next) => {
                        setSaved(false);
                        setConditions(next);
                      }}
                    />

                    {/* What a built-in is, and what the Reset in the row below
                        will do. It stays in the flow and ends the form: it is
                        reading matter rather than a control, and the press
                        itself asks again through a `ConfirmModal` that names
                        everything coming back. */}
                    {!creating && builtIn && (
                      <p className="tag-editor-hint achievement-builtin-note">
                        This is one of the achievements Wingman brings with it.
                        What it looks like is yours to change, and it can be
                        switched off. Its conditions are Wingman's own, and it
                        cannot be deleted. Every instance always has the set it
                        ships with. Reset puts the name, description, icon,
                        color, conditions, and whether it is hidden back the way
                        Wingman ships them. Whether it is switched on stays as
                        it is.
                      </p>
                    )}

                    {/* Save and the other way out, on one line at the bottom of
                        the screen: a form this long must never have to be
                        scrolled to be saved. Inside the form, because Save is
                        its submit button and because anything after it would
                        end up below the row. */}
                    <EditorActions
                      note={saveNote}
                      saved={acknowledged}
                      savedLabel={savedLabel}
                      saveDisabled={blocked}
                    >
                      {!creating &&
                        (builtIn ? (
                          <button
                            type="button"
                            className="button achievement-reset"
                            disabled={reset.isPending}
                            onClick={() => setResetting(true)}
                          >
                            <Icon name="refresh" />
                            <span>Reset achievement</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button button-danger"
                            disabled={remove.isPending}
                            onClick={() => setDeleting(true)}
                          >
                            Delete achievement
                          </button>
                        ))}
                    </EditorActions>
                  </form>
                </>
              )}
            </>
          )}
        </>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete achievement"
          message={`Delete "${base.name}"? Everybody who earned it loses it: the badge is gone from their page and the record of them having had it goes with it. Their scores stay exactly as they are.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(false);
            remove.mutate({
              path: { achievement_id: achievementId ?? "" },
            });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}

      {resetting && (
        <ConfirmModal
          title="Reset achievement"
          message={`Put "${base.name}" back the way Wingman ships it? Its name, description, icon, color, conditions, and whether it is hidden all return to the original. An uploaded picture is removed. Whether it is switched on stays as it is. Everybody's badges are worked out again afterwards, which can take one away.`}
          confirmLabel="Reset"
          danger
          onConfirm={() => {
            setResetting(false);
            reset.mutate({
              path: { achievement_id: achievementId ?? "" },
            });
          }}
          onCancel={() => setResetting(false)}
        />
      )}
    </div>
  );
}
