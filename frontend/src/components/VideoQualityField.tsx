import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { SettingRead } from "../api";
import {
  listSettingsQueryKey,
  listVideoQualityPresetsOptions,
  updateSettingMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import CheckOption from "./CheckOption";
import { Icon } from "./icons";
import "./SettingField.css";
import "./VideoQualityField.css";

interface Props {
  setting: SettingRead;
  /** Holds `settings.view` but not `settings.manage`: everything read-only. */
  readOnly: boolean;
}

const CUSTOM = "custom";

/** A 422 carries the registry's own complaint — worth showing verbatim. */
function saveError(error: unknown): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, "Could not save the download quality.");
}

/**
 * `downloads.video_format` is a yt-dlp format string, which nobody should have
 * to write to pick "1080p". The presets come from the backend and each one is
 * simply a value for this setting, so what is stored stays readable — a preset
 * is recognised by its own format string coming back.
 */
export default function VideoQualityField({ setting, readOnly }: Props) {
  const queryClient = useQueryClient();
  const presets = useQuery(listVideoQualityPresetsOptions());
  // Sticky: picking "Custom" stores nothing until something is typed, so the
  // radio cannot be derived from the value alone.
  const [pickedCustom, setPickedCustom] = useState(false);
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

  // "Saved" is an acknowledgement, not a state — it fades after a moment.
  const { isSuccess, reset } = save;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, 2000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  const options = presets.data?.presets ?? [];
  const stored = setting.value === null ? "" : String(setting.value);
  // Until the presets arrive there is nothing to match against, so the raw
  // format string is the only honest control.
  const selected =
    options.find((preset) => preset.video_format === stored)?.key ??
    (options.length === 0 ? null : CUSTOM);
  const custom = pickedCustom || selected === CUSTOM || selected === null;

  const store = (value: string): void =>
    save.mutate({ path: { key: setting.key }, body: { value } });

  const labelId = `setting-${setting.key}-label`;
  const describedBy = `setting-${setting.key}-description`;
  const disabled = readOnly || save.isPending;

  const commit = (): void => {
    if (draft === null) return;
    if (draft.trim() === "" || draft === stored) {
      setDraft(null);
      return;
    }
    store(draft);
  };

  return (
    <div className="setting-field">
      <div className="setting-row">
        <span className="setting-label" id={labelId}>
          Video quality
        </span>

        {!readOnly && setting.value !== setting.default && (
          <button
            type="button"
            className="icon-button icon-button-bordered video-quality-reset"
            aria-label="Reset Video quality"
            title={`Reset to ${String(setting.default)}`}
            disabled={save.isPending}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setDraft(null);
              setPickedCustom(false);
              save.mutate({
                path: { key: setting.key },
                body: { value: null },
              });
            }}
          >
            <Icon name="refresh" />
          </button>
        )}

        {save.isSuccess && draft === null && (
          <span className="setting-saved" role="status">
            Saved
          </span>
        )}
      </div>

      <div
        className="video-quality-options"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
      >
        {options.map((preset) => (
          <div className="video-quality-option" key={preset.key}>
            <CheckOption
              name={`${setting.key}-preset`}
              value={preset.key}
              label={preset.label}
              checked={!custom && selected === preset.key}
              disabled={disabled}
              onChange={() => {
                setPickedCustom(false);
                setDraft(null);
                store(preset.video_format);
              }}
            />
            <p className="video-quality-hint">{preset.description}</p>
          </div>
        ))}

        {options.length > 0 && (
          <div className="video-quality-option">
            <CheckOption
              name={`${setting.key}-preset`}
              value={CUSTOM}
              label="Custom"
              checked={custom}
              disabled={disabled}
              onChange={() => setPickedCustom(true)}
            />
            <p className="video-quality-hint">
              Write a yt-dlp format string yourself.
            </p>
          </div>
        )}
      </div>

      {custom && (
        <div className="video-quality-custom">
          <input
            className="text-input video-quality-input"
            type="text"
            aria-label="yt-dlp format string"
            value={draft ?? stored}
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
          <p className="setting-description">
            For example <code>bestvideo[height&lt;=720]+bestaudio/best</code>.
          </p>
        </div>
      )}

      {/* What a preset stands for. Not while Custom is on: the box above is
          already the format string, spelled out and editable. */}
      {!custom && (
        <p className="video-quality-effective">
          yt-dlp format: <code>{stored}</code>
        </p>
      )}

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
