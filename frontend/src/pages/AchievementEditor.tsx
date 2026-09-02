import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  setAchievementIconMutation,
  updateAchievementMutation,
} from "../api/@tanstack/react-query.gen";
import { achievementGlyph, conditionProblem } from "../achievements";
import { useAuth } from "../auth";
import AchievementBadge from "../components/AchievementBadge";
import ConditionBuilder from "../components/ConditionBuilder";
import ConfirmModal from "../components/ConfirmModal";
import { Icon, PICKER_ICON_NAMES } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { errorDetail, errorMessage } from "../errors";
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
    "Only jpeg, png and webp images work — and the file has to really be one.",
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
 * A built-in opens in the very same form: every field of one may be edited and
 * it may be switched off (achievements.md), so the only thing missing at the
 * foot is Delete.
 */
export default function AchievementEditor() {
  const { achievementId } = useParams();
  const creating = achievementId === undefined;
  const draftId = achievementId ?? "new";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("achievements.manage");

  const catalogue = useQuery({
    ...listAchievementsOptions(),
    enabled: allowed,
  });

  // There is no GET /achievements/{id}: the listing is the one request, and a
  // manager's copy of it carries every row's definition.
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  /** What an icon write answers with, taken **without** reseeding the form: the
   *  response is a whole achievement, and adopting it would wipe the name and
   *  the conditions somebody has typed and not yet saved. Only the picture
   *  moved, so only the picture is read off it. */
  const tookIcon = (achievement: AchievementRead) => {
    setIconError(null);
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
    if (JSON.stringify(conditions) !== base.definition)
      body.definition = conditions;
    return body;
  };

  // What the backend would refuse, said beside the box instead: Save is shut
  // while any block is wrong. An achievement with *no* conditions is not one of
  // those — the backend takes it — so it is a warning and Save stays open.
  const broken = conditions.some(
    (condition) => conditionProblem(condition) !== null,
  );
  const pending = creating || Object.keys(changes()).length > 0;

  const save = async () => {
    if (trimmed === "" || broken || !pending) return;
    setSaving(true);
    setError(null);
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
          listAchievementsQueryKey(),
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
        void navigate(`/user/achievements/${encodeURIComponent(made.id)}`, {
          replace: true,
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
      // A 422 from the condition models says which field of which condition it
      // refused; nothing this page could write would be more use than that.
      setError(
        errorDetail(cause) ??
          errorMessage(cause, "Could not save the achievement."),
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    // The same door `save` keeps: a save that would turn straight around again
    // is nothing to press.
    if (trimmed === "" || broken || !pending || saving) return;
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

                    <h2 id="achievement-colour">Colour</h2>
                    {hasImage ? (
                      <p className="tag-editor-hint">
                        A picture is drawn as it is, so there is no colour to
                        set. Go back to a glyph and the four colours come with
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
                        drawn anywhere — not on a singer's page, not on the host
                        screen. Switching it back on brings everybody's badges
                        up to date.
                      </p>
                    </div>

                    <h2>Conditions</h2>
                    <p className="section-note">
                      All of them have to hold before anybody earns it.
                    </p>

                    {conditions.length === 0 && (
                      <p className="tag-warning">
                        With no conditions at all, nobody can ever earn this.
                        Add one — it can be saved as it stands, and it will
                        simply sit on the list unearned.
                      </p>
                    )}

                    <ConditionBuilder
                      value={conditions}
                      onChange={(next) => {
                        setSaved(false);
                        setConditions(next);
                      }}
                    />

                    <div className="tag-editor-save">
                      <button
                        type="submit"
                        className="button button-primary"
                        disabled={
                          trimmed === "" || broken || !pending || saving
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

                  {!creating &&
                    (builtIn ? (
                      <p className="tag-editor-hint achievement-builtin-note">
                        This is one of the achievements Wingman brings with it.
                        Everything above can be changed and it can be switched
                        off, but it cannot be deleted — an instance always has
                        the set it ships with.
                      </p>
                    ) : (
                      <div className="tag-editor-delete">
                        <button
                          type="button"
                          className="button button-danger"
                          disabled={remove.isPending}
                          onClick={() => setDeleting(true)}
                        >
                          Delete achievement
                        </button>
                      </div>
                    ))}
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
    </div>
  );
}
