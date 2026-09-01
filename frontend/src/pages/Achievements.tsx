import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AchievementList,
  AchievementRead,
  AchievementSettings,
  AchievementSettingsUpdate,
} from "../api";
import {
  listAchievementsOptions,
  listAchievementsQueryKey,
  updateAchievementSettingsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AchievementBadge from "../components/AchievementBadge";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { SettingSaved } from "../components/SettingField";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Achievements.css";

/** The bound `achievements/settings.py` refuses a second count outside. */
const MAX_HOST_SECONDS = 60;

/**
 * What a row says under the name. The number of conditions always — it is the
 * one thing every achievement has and the only measure of how much there is to
 * read inside — then only what is unusual: `hidden` before it is earned, and
 * `off` for one that is not being evaluated at all (§7's rule for a tag row).
 *
 * A row with no `definition` is a backend that did not send one; "0 conditions"
 * would be a claim about the achievement rather than about the answer, so the
 * count is simply left out.
 */
function meta(achievement: AchievementRead): string {
  const parts: string[] = [];
  const conditions = achievement.definition;
  if (conditions !== null && conditions !== undefined)
    parts.push(
      conditions.length === 1
        ? "1 condition"
        : `${conditions.length} conditions`,
    );
  if (achievement.hidden) parts.push("hidden");
  if (!achievement.enabled) parts.push("off");
  return parts.join(" · ");
}

interface RowsProps {
  achievements: AchievementRead[];
}

/** One list of achievements, whoever made them: the medallion, the name over
 *  its meta line, a chevron, the whole row leading into the editor. */
function AchievementRows({ achievements }: RowsProps) {
  return (
    <ul className="achievements-list">
      {achievements.map((achievement) => (
        <li key={achievement.id}>
          <Link
            className="achievements-open"
            to={`/user/achievements/${encodeURIComponent(achievement.id)}`}
          >
            <AchievementBadge achievement={achievement} />
            <span className="achievements-text">
              <span className="achievements-name">{achievement.name}</span>
              <span className="achievements-meta">{meta(achievement)}</span>
            </span>
            <Icon name="chevron-right" className="achievements-chevron" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

interface FieldProps {
  id: string;
  label: string;
  description: string;
  saved: boolean;
  /** The control itself, which owns its own disabled state and its own saving. */
  children: (inputId: string, describedBy: string) => ReactNode;
  /** Set on the label's line for a checkbox, which has no second line. */
  inline?: boolean;
}

/**
 * One settings row in §7's *Settings* shape: the label with its acknowledgement
 * on the first line, the quiet box alone on the second, the 0.85em description
 * under both. `SettingField` itself is written against the settings registry —
 * a `SettingRead` with a key, a value type and a default — and these three are
 * not registered settings (`achievements/settings.py` keeps them private, behind
 * `achievements.manage` rather than `settings.manage`), so the row is rebuilt
 * here on the same classes rather than the component being bent around them.
 */
function AchievementSettingRow({
  id,
  label,
  description,
  saved,
  children,
  inline = false,
}: FieldProps) {
  const inputId = `achievement-setting-${id}`;
  const describedBy = `${inputId}-description`;

  return (
    <div className="setting-field">
      <div className="setting-row">
        <label className="setting-label" htmlFor={inputId}>
          {label}
        </label>
        <SettingSaved shown={saved} />
        {inline && children(inputId, describedBy)}
      </div>

      {!inline && (
        <div className="setting-control">{children(inputId, describedBy)}</div>
      )}

      <p className="setting-description" id={describedBy}>
        {description}
      </p>
    </div>
  );
}

interface SecondsProps {
  id: "host_seconds_base" | "host_seconds_per_badge";
  label: string;
  description: string;
  value: number;
  saved: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
}

/** A whole number of seconds: the quiet box, saved on blur or Enter, exactly the
 *  discipline `SettingField` uses so the two pages feel like one. */
function SecondsField({
  id,
  label,
  description,
  value,
  saved,
  disabled,
  onCommit,
}: SecondsProps) {
  // Non-null only while it is being typed in, so a `achievements.changed` from
  // another browser still reaches a field nobody is editing.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);

  const commit = (): void => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    // A non-numeric or empty draft is dropped; a number outside the bounds goes
    // to the backend and comes back as the 422 shown under the group.
    if (draft.trim() === "" || Number.isNaN(parsed) || parsed === value) return;
    onCommit(parsed);
  };

  return (
    <AchievementSettingRow
      id={id}
      label={label}
      description={description}
      saved={saved}
    >
      {(inputId, describedBy) => (
        <input
          className="text-input text-input-quiet setting-input"
          id={inputId}
          aria-describedby={describedBy}
          type="number"
          min={0}
          max={MAX_HOST_SECONDS}
          value={text}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      )}
    </AchievementSettingRow>
  );
}

/** A 422 carries the backend's own complaint — worth showing verbatim. */
function saveError(error: unknown): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, "Could not save the setting.");
}

/**
 * The achievements of the party, behind the `achievements.manage` entry of the
 * manage menu: the three options the feature has, then the ones somebody here
 * made, then the seventeen Wingman brings with it. A row leads into the editor;
 * the header's `+` starts a new one.
 *
 * Both lists come from the one `GET /achievements` every badge surface makes, so
 * the page costs nothing new — and a manager's copy of it carries each row's
 * `definition`, which is what the meta line counts.
 */
export default function Achievements() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = auth.loaded && auth.can("achievements.manage");

  const catalogue = useQuery({
    ...listAchievementsOptions(),
    enabled: allowed,
  });

  useWingmanEvent("achievements.changed", () => {
    void queryClient.invalidateQueries({
      queryKey: listAchievementsQueryKey(),
    });
  });

  const save = useMutation({
    ...updateAchievementSettingsMutation(),
    onSuccess: (settings) => {
      queryClient.setQueryData<AchievementList>(
        listAchievementsQueryKey(),
        (old) => (old === undefined ? old : { ...old, settings }),
      );
    },
  });

  // "Saved" is an acknowledgement, not a state — it fades after a moment.
  const { isSuccess: justSaved, reset } = save;
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(reset, 2000);
    return () => clearTimeout(timer);
  }, [justSaved, reset]);

  // Which of the three rows the acknowledgement belongs to: the one that was
  // patched, so saving the toggle does not light the word beside a number.
  const savedField = justSaved
    ? (Object.keys(save.variables?.body ?? {})[0] ?? null)
    : null;

  const patch = (body: AchievementSettingsUpdate): void => {
    save.reset();
    save.mutate({ body });
  };

  const settings: AchievementSettings | undefined = catalogue.data?.settings;
  const rows = catalogue.data?.achievements ?? [];
  const own = rows.filter((achievement) => !achievement.built_in);
  const included = rows.filter((achievement) => achievement.built_in);

  return (
    <div className="achievements-page">
      <PageHeader title="Achievements" back="/user">
        {allowed && (
          <Link
            className="icon-button"
            to="/user/achievements/new"
            aria-label="New achievement"
            title="New achievement"
          >
            <Icon name="plus" />
          </Link>
        )}
      </PageHeader>

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

              {settings !== undefined && (
                <>
                  <AchievementSettingRow
                    id="enabled"
                    label="Enabled"
                    description="Off for the whole instance: nothing is earned and no badge is drawn anywhere."
                    saved={savedField === "enabled"}
                    inline
                  >
                    {(inputId, describedBy) => (
                      <input
                        type="checkbox"
                        className="setting-toggle"
                        id={inputId}
                        aria-describedby={describedBy}
                        checked={settings.enabled}
                        disabled={save.isPending}
                        onChange={(event) =>
                          patch({ enabled: event.target.checked })
                        }
                      />
                    )}
                  </AchievementSettingRow>

                  <SecondsField
                    id="host_seconds_base"
                    label="How long a row of badges stays on the host screen"
                    description={`Seconds, 0 to ${MAX_HOST_SECONDS}.`}
                    value={settings.host_seconds_base}
                    saved={savedField === "host_seconds_base"}
                    disabled={save.isPending}
                    onCommit={(value) => patch({ host_seconds_base: value })}
                  />

                  <SecondsField
                    id="host_seconds_per_badge"
                    label="Added for each badge in the row"
                    description="Seconds added to that for every badge the row holds."
                    value={settings.host_seconds_per_badge}
                    saved={savedField === "host_seconds_per_badge"}
                    disabled={save.isPending}
                    onCommit={(value) =>
                      patch({ host_seconds_per_badge: value })
                    }
                  />

                  {save.isError && (
                    <p
                      className="error-notice achievements-notice"
                      role="alert"
                    >
                      {saveError(save.error)}
                    </p>
                  )}
                </>
              )}

              {catalogue.isSuccess && (
                <>
                  {/* No heading over these, exactly as the Tags page leads
                      with its own rows: on a page called Achievements, "Your
                      achievements" would read as the badges the reader has
                      earned rather than the ones made here. */}
                  {own.length === 0 ? (
                    <EmptyState icon="trophy" title="No achievements yet">
                      An achievement is something to reach for — a score, a
                      number of songs, a duet — and it lands on the singer's
                      page the moment they get there.
                    </EmptyState>
                  ) : (
                    <AchievementRows achievements={own} />
                  )}

                  {/* The ones Wingman brings with it, after the rows `+` and
                      Delete govern: a built-in can be edited and switched off,
                      but never deleted, so nothing here removes one. */}
                  <h2>Included</h2>
                  <AchievementRows achievements={included} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
