import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { importSummary, MANAGE_CATALOGUE } from "../achievements";
import type {
  AchievementImportResult,
  AchievementList,
  AchievementRead,
  AchievementSettings,
  AchievementSettingsUpdate,
} from "../api";
import { exportAchievements } from "../api";
import {
  importAchievementsMutation,
  listAchievementsOptions,
  listAchievementsQueryKey,
  updateAchievementSettingsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import AchievementBadge from "../components/AchievementBadge";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import PageHeader from "../components/PageHeader";
import PickerRow from "../components/PickerRow";
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

/**
 * A 4xx carries the backend's own complaint — worth showing verbatim. A refused
 * archive is the case this matters most for: the message names *which*
 * achievement was wrong and *what* about it (achievements.md), which is the
 * difference between a fixable file and "invalid archive".
 *
 * A permission denial is the exception: it explains itself, and its slug is not
 * a sentence.
 */
function complaint(error: unknown, fallback: string): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, fallback);
}

/** The cap `archive.MAX_ARCHIVE_BYTES` puts on an upload. Checked here as well,
 *  so an archive that could never be read is not sent at all — the same
 *  courtesy the editor does an oversized picture. */
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** What the backend called the archive it just made. Same-origin, so the header
 *  it set is readable; a proxy that dropped it leaves the shape it uses. */
function archiveName(response: Response): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const quoted = /filename="?([^";\r\n]+)"?/i.exec(disposition)?.[1]?.trim();
  // The last segment only: what goes on a download is a name, never a path.
  const name = quoted?.split(/[\\/]/).pop();
  return name !== undefined && name !== ""
    ? name
    : `achievements-${new Date().toISOString().slice(0, 10)}.tar.gz`;
}

/**
 * Hand the archive to the browser. The bytes come back from a POST, which
 * cannot be a link, so they become an object URL that a synthetic anchor clicks.
 *
 * The anchor goes into the document because a click on a detached one does
 * nothing in some browsers, and the URL is released on the next tick: an object
 * URL pins its blob in memory until it is revoked, and revoking it before the
 * click would cancel the download rather than start it.
 */
function saveArchive(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface ExportProps {
  /** Everything the archive could hold, in the order the page lists it. */
  achievements: AchievementRead[];
  pending: boolean;
  error: string | null;
  onExport: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Which achievements go into the archive: a panel modal of `PickerRow`s (§5).
 *
 * A picker rather than a selection mode over the page's own rows, which are
 * links into the editor and carry marks, not controls (§1.3/§1.4). "Is this
 * achievement in the archive I am building?" is exactly the question
 * `PickerRow` was written for, so the archive's contents are picked with the
 * same row, the same `aria-pressed` and the same `list`/`list-check` mark as a
 * playlist's are.
 *
 * The built-ins are in the list too: sharing one between instances is what the
 * format is for (achievements.md), so nothing here may hold them back.
 *
 * The selection lives here and goes with the panel — an archive is one act, and
 * a half-made choice is not something a page should keep.
 */
function ExportPanel({
  achievements,
  pending,
  error,
  onExport,
  onClose,
}: ExportProps) {
  const [chosen, setChosen] = useState<string[]>([]);
  const every =
    achievements.length > 0 && chosen.length === achievements.length;

  const toggle = (id: string): void =>
    setChosen((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
    );

  return (
    <Modal title="Export achievements" onClose={onClose}>
      <p className="section-note">
        The ones you pick go into one archive — a file per achievement with its
        settings, its conditions and its picture.
      </p>

      <ul className="picker-list achievements-export-list">
        {achievements.map((achievement) => (
          <PickerRow
            key={achievement.id}
            lead={<AchievementBadge achievement={achievement} />}
            title={achievement.name}
            meta={
              achievement.built_in
                ? `included · ${meta(achievement)}`
                : meta(achievement)
            }
            pressed={chosen.includes(achievement.id)}
            onClick={() => toggle(achievement.id)}
          />
        ))}
      </ul>

      {error !== null && (
        <p className="error-notice achievements-notice" role="alert">
          {error}
        </p>
      )}

      <div className="achievements-export-footer">
        <button
          type="button"
          className="button"
          onClick={() =>
            setChosen(every ? [] : achievements.map(({ id }) => id))
          }
        >
          {every ? "Select none" : "Select all"}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={chosen.length === 0 || pending}
          onClick={() => onExport(chosen)}
        >
          {pending
            ? "Exporting…"
            : chosen.length === 0
              ? "Export"
              : `Export · ${chosen.length}`}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The achievements of the party, behind the `achievements.manage` entry of the
 * manage menu: the three options the feature has, then the ones somebody here
 * made, then the seventeen Wingman brings with it. A row leads into the editor;
 * the header's `+` starts a new one.
 *
 * Both lists come from `GET /achievements?manage=true` — the managing answer,
 * every hidden achievement spelled out and every row's `definition`, which is
 * what the meta line counts. That is a request of its own, made only by this
 * page and its editor: the listing every badge surface shares is masked for
 * whoever asks, this one included, and is left exactly as it is.
 */
export default function Achievements() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = auth.loaded && auth.can("achievements.manage");

  // The managing copy: every hidden achievement spelled out and every row's
  // definition, which is what this page edits and exports. Its own cache entry,
  // so the masked listing every other surface reads is left alone.
  const catalogue = useQuery({
    ...listAchievementsOptions(MANAGE_CATALOGUE),
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
      // Both entries, because `setQueryData` matches a key exactly: this page
      // reads the managing one and every badge surface the masked one, and the
      // same three settings ride along in both. The `achievements.changed` this
      // PATCH broadcasts refetches them anyway — this is what keeps a browser
      // whose socket is down from drawing badges by yesterday's toggle.
      for (const key of [
        listAchievementsQueryKey(MANAGE_CATALOGUE),
        listAchievementsQueryKey(),
      ])
        queryClient.setQueryData<AchievementList>(key, (old) =>
          old === undefined ? old : { ...old, settings },
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

  /* ------------------------------------------------------ the archive */

  // Whether the export picker is open. What is picked in it lives inside it.
  const [picking, setPicking] = useState(false);
  // What the last import did, kept as the two lists the backend answered with
  // so the names are looked up once the refetch has landed.
  const [imported, setImported] = useState<AchievementImportResult | null>(
    null,
  );
  // Set from the backend's refusal and from the one refusal made here.
  const [importError, setImportError] = useState<string | null>(null);

  const bring = useMutation({
    ...importAchievementsMutation(),
    onSuccess: (result) => {
      setImportError(null);
      setImported(result);
      // The backend broadcasts `achievements.changed` as well; asking here does
      // not depend on a socket being up, and both land on the same query.
      void queryClient.invalidateQueries({
        queryKey: listAchievementsQueryKey(),
      });
    },
    onError: (cause) =>
      setImportError(complaint(cause, "Could not read that archive.")),
  });

  const send = useMutation({
    // The generated mutation option hands back the body alone, and the name the
    // archive should be saved under is a header on the response — so this one
    // calls the generated request itself rather than its options object.
    mutationFn: async (ids: string[]) => {
      const { data, response } = await exportAchievements({
        body: { ids },
        // `application/gzip` already parses as a blob; saying so keeps bytes
        // bytes whatever a proxy in between labels them.
        parseAs: "blob",
        throwOnError: true,
      });
      return { archive: data as Blob, filename: archiveName(response) };
    },
    onSuccess: ({ archive, filename }) => {
      saveArchive(archive, filename);
      setPicking(false);
    },
  });

  const bringIn = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    // Cleared right away, so picking the very same file again after a rejection
    // is another change event and not a click that does nothing.
    input.value = "";
    if (!file) return;
    setImported(null);
    setImportError(null);
    bring.reset();
    if (file.size > MAX_ARCHIVE_BYTES) {
      setImportError("That archive is larger than 32 MB.");
      return;
    }
    bring.mutate({ body: { file } });
  };

  const settings: AchievementSettings | undefined = catalogue.data?.settings;
  const rows = catalogue.data?.achievements ?? [];
  const own = rows.filter((achievement) => !achievement.built_in);
  const included = rows.filter((achievement) => achievement.built_in);

  /** What to call an achievement an import named. An id the catalogue has not
   *  got yet — a just-created one, before the refetch — stands for itself. */
  const nameOf = (id: string): string =>
    rows.find((achievement) => achievement.id === id)?.name ?? id;

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
                      {complaint(save.error, "Could not save the setting.")}
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

                  {/* Last on the page, the way a playlist's "Save a copy" is:
                      carrying achievements between parties is a thing a host
                      does now and then, not the errand they came for (§7). */}
                  <h2>Import and export</h2>
                  <p className="section-note">
                    An archive carries achievements from one Wingman to another
                    — a file per achievement, with its conditions and its
                    picture. Importing one adds what this party has not got and
                    updates what it has.
                  </p>

                  <div className="achievements-share">
                    <label className="button achievements-share-action">
                      <span>
                        {bring.isPending ? "Importing…" : "Import archive…"}
                      </span>
                      <input
                        type="file"
                        className="visually-hidden"
                        accept=".gz,.tgz,application/gzip"
                        aria-label="Import archive"
                        disabled={bring.isPending}
                        onChange={(event) => bringIn(event.target)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button achievements-share-action"
                      onClick={() => {
                        send.reset();
                        setPicking(true);
                      }}
                    >
                      Export…
                    </button>
                  </div>

                  {imported !== null && (
                    <p className="achievements-share-result" role="status">
                      {importSummary(imported, nameOf)}
                    </p>
                  )}

                  {importError !== null && (
                    <p
                      className="error-notice achievements-notice"
                      role="alert"
                    >
                      {importError}
                    </p>
                  )}

                  {picking && (
                    <ExportPanel
                      achievements={[...own, ...included]}
                      pending={send.isPending}
                      error={
                        send.isError
                          ? complaint(
                              send.error,
                              "Could not make that archive.",
                            )
                          : null
                      }
                      onExport={(ids) => send.mutate(ids)}
                      onClose={() => setPicking(false)}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
