import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SettingRead, SettingUpdate } from "../api";
import {
  listSettingsQueryKey,
  updateSettingMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { labelize } from "../settings";
import "./SettingField.css";

interface Props {
  setting: SettingRead;
  /** Holds `settings.view` but not `settings.manage`: everything read-only. */
  readOnly: boolean;
}

/** A 422 carries the registry's own complaint — worth showing verbatim. */
function saveError(error: unknown): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, "Could not save the setting.");
}

/** One typed setting row: input by value type, saved on blur or Enter. */
export default function SettingField({ setting, readOnly }: Props) {
  const queryClient = useQueryClient();
  // Non-null only while the user is editing, so a `setting.changed` broadcast
  // from another browser still reaches an untouched field.
  const [draft, setDraft] = useState<string | null>(null);

  const save = useMutation({
    ...updateSettingMutation(),
    onSuccess: (data) => {
      setDraft(null);
      queryClient.setQueryData<SettingRead[]>(listSettingsQueryKey(), (old) =>
        old?.map((row) => (row.key === data.key ? data : row)),
      );
    },
  });

  const patch = (value: SettingUpdate["value"]): void =>
    save.mutate({ path: { key: setting.key }, body: { value } });

  // A secret always reads back as null, which is exactly the empty box it needs.
  const stored = setting.value === null ? "" : String(setting.value);
  const text = draft ?? stored;

  const commit = (): void => {
    if (draft === null) return;
    // An empty secret box means "keep the stored one", never "clear it" —
    // that is what the Clear button is for.
    if (draft === stored || (setting.secret && draft === "")) {
      setDraft(null);
      return;
    }
    if (setting.value_type === "int" || setting.value_type === "float") {
      const parsed = Number(draft);
      // A non-numeric draft is dropped; a wrong numeric type (2.5 for an int)
      // goes to the backend and comes back as the 422 shown below.
      if (draft.trim() === "" || Number.isNaN(parsed)) setDraft(null);
      else patch(parsed);
      return;
    }
    patch(draft);
  };

  const label = labelize(setting.key);
  const inputId = `setting-${setting.key}`;
  const describedBy = `${inputId}-description`;
  // Multi-line settings are recognised by their description, not by a key list:
  // a new "one path per line" registry entry then needs no UI change.
  const multiline = setting.description.includes("per line");
  const disabled = readOnly || save.isPending;
  // A secret's value never comes back, so "is it configured" is the only
  // signal; everything else compares against its default.
  const resettable = setting.secret
    ? setting.is_set
    : setting.value !== setting.default;
  const defaultText =
    setting.default === "" ? "empty" : String(setting.default);

  return (
    <div className="setting-field">
      <div className="setting-row">
        <label className="setting-label" htmlFor={inputId}>
          {label}
        </label>

        {setting.value_type === "bool" ? (
          <input
            type="checkbox"
            className="setting-toggle"
            id={inputId}
            aria-describedby={describedBy}
            checked={setting.value === true}
            disabled={disabled}
            onChange={(event) => patch(event.target.checked)}
          />
        ) : multiline ? (
          // Blur only: Enter has to insert a line here.
          <textarea
            className="text-input setting-textarea"
            id={inputId}
            aria-describedby={describedBy}
            rows={4}
            value={text}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
          />
        ) : (
          <input
            className="text-input setting-input"
            id={inputId}
            aria-describedby={describedBy}
            type={
              setting.secret
                ? "password"
                : setting.value_type === "str"
                  ? "text"
                  : "number"
            }
            step={setting.value_type === "float" ? "any" : undefined}
            autoComplete={setting.secret ? "new-password" : undefined}
            placeholder={
              setting.secret && setting.is_set ? "(unchanged)" : undefined
            }
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

        {!readOnly && resettable && (
          <button
            type="button"
            className="button setting-reset"
            aria-label={`${setting.secret ? "Clear" : "Reset"} ${label}`}
            disabled={save.isPending}
            // Keeps the focus where it is, so a half-typed value (a secret!)
            // is not saved by the blur this click would otherwise trigger.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setDraft(null);
              patch(null);
            }}
          >
            {setting.secret ? "Clear" : `Reset to ${defaultText}`}
          </button>
        )}

        {save.isSuccess && draft === null && (
          <span className="setting-saved" role="status">
            Saved
          </span>
        )}
      </div>

      <p className="setting-description" id={describedBy}>
        {setting.description}
      </p>

      {save.isError && (
        <p className="error-notice setting-error" role="alert">
          {saveError(save.error)}
        </p>
      )}
    </div>
  );
}
