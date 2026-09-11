import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { SettingRead } from "../api";
import {
  listSettingsQueryKey,
  updateSettingMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { labelize } from "../settings";
import { Icon } from "./icons";
import { SettingSaved } from "./SettingField";
import "./SettingField.css";

interface Props {
  setting: SettingRead;
  readOnly: boolean;
}

/** How long after the finger comes off the slider the value is written. Long
 *  enough that a drag across the track is one request, short enough that a tap
 *  lands before the reader looks away. */
const SETTLE_MS = 200;

/**
 * One of the three volumes, as a slider.
 *
 * A registered setting whose stored form is a number a person should not have
 * to type — `CUSTOM_FIELDS`'s own stated purpose. A volume is the one value in
 * the registry that is set by ear against the room, and a number box makes
 * "try it a bit quieter" into typing, tabbing and typing again.
 *
 * The row is `SettingField`'s down to the class names: the label with its
 * acknowledgement and its reset, the control on its own line, the description
 * under both. Only the control differs.
 */
export default function VolumeField({ setting, readOnly }: Props) {
  const queryClient = useQueryClient();
  const stored = typeof setting.value === "number" ? setting.value : 0;
  // Non-null only while somebody is dragging, so another browser's change still
  // reaches a slider nobody is touching.
  const [draft, setDraft] = useState<number | null>(null);

  const save = useMutation({
    ...updateSettingMutation(),
    onSuccess: (data) => {
      setDraft(null);
      queryClient.setQueryData<SettingRead[]>(listSettingsQueryKey(), (old) =>
        old?.map((row) => (row.key === data.key ? data : row)),
      );
    },
  });

  const { isSuccess, reset } = save;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, 2000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  // A drag is a stream of values; one request per pixel would be absurd, and
  // one per release would leave the room waiting for the finger to come off.
  useEffect(() => {
    if (draft === null || draft === stored) return;
    const timer = setTimeout(
      () => save.mutate({ path: { key: setting.key }, body: { value: draft } }),
      SETTLE_MS,
    );
    return () => clearTimeout(timer);
    // `save` is a new object on every render; the mutation itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, stored, setting.key]);

  const label = labelize(setting.key);
  const inputId = `setting-${setting.key}`;
  const describedBy = `${inputId}-description`;
  const value = draft ?? stored;
  const disabled = readOnly || save.isPending;
  const resettable = setting.value !== setting.default;

  return (
    <div className="setting-field">
      <div className="setting-row">
        <label className="setting-label" htmlFor={inputId}>
          {label}
        </label>

        <SettingSaved shown={save.isSuccess && draft === null} />

        {/* The number the slider is at, so the row still says a value out
            loud: a bare track tells a reader nothing they can repeat. */}
        <span className="setting-volume-value">{value}%</span>

        {!readOnly && resettable && (
          <button
            type="button"
            className="icon-button icon-button-bordered"
            aria-label={`Reset ${label}`}
            title={`Reset to ${String(setting.default)}`}
            disabled={save.isPending}
            onClick={() => {
              setDraft(null);
              save.mutate({
                path: { key: setting.key },
                body: { value: null },
              });
            }}
          >
            <Icon name="refresh" />
          </button>
        )}
      </div>

      <div className="setting-control">
        <input
          className="range-input"
          id={inputId}
          aria-describedby={describedBy}
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled}
          aria-valuetext={`${value} percent`}
          onChange={(event) => setDraft(Number(event.target.value))}
        />
      </div>

      <p className="setting-description" id={describedBy}>
        {setting.description}
      </p>

      {save.isError && (
        <p className="error-notice setting-error" role="alert">
          {volumeError(save.error)}
        </p>
      )}
    </div>
  );
}

/** A 422 carries the registry's own complaint — worth showing verbatim. */
function volumeError(error: unknown): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, "Could not save the setting.");
}
