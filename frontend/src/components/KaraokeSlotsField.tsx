import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SettingRead } from "../api";
import {
  listKaraokeColorsOptions,
  listKaraokeSlotsOptions,
  listKaraokeSlotsQueryKey,
  listSettingsQueryKey,
  updateSettingMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { parseSlots, recolored, resized } from "../karaokeSlots";
import { Icon } from "./icons";
import "./SettingField.css";
import "./KaraokeSlotsField.css";

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
    : errorMessage(error, "Could not save the player slots.");
}

/**
 * The one setting that is a list: `karaoke.player_colors`. Shown as what it
 * means — how many people sing at once, and which color each of them gets —
 * instead of the comma-separated string it is stored as.
 */
export default function KaraokeSlotsField({ setting, readOnly }: Props) {
  const queryClient = useQueryClient();
  // The whole palette to choose from, and the counts USDX accepts. Both come
  // from the backend: no color and no count is ever hardcoded here.
  const colors = useQuery(listKaraokeColorsOptions());
  const slotConfig = useQuery(listKaraokeSlotsOptions());

  const save = useMutation({
    ...updateSettingMutation(),
    onSuccess: (data) => {
      queryClient.setQueryData<SettingRead[]>(listSettingsQueryKey(), (old) =>
        old?.map((row) => (row.key === data.key ? data : row)),
      );
      // The player selection reads the same slots — it must not keep offering
      // a color that is no longer one.
      void queryClient.invalidateQueries({
        queryKey: listKaraokeSlotsQueryKey(),
      });
    },
  });

  // "Saved" is an acknowledgement, not a state — it fades after a moment.
  const { isSuccess, reset } = save;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, 2000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  const palette = colors.data?.colors ?? [];
  const hexOf = (name: string): string =>
    palette.find((color) => color.name === name)?.hex ?? "transparent";
  const counts = slotConfig.data?.player_counts ?? [];

  const slots = parseSlots(setting.value);
  const disabled = readOnly || save.isPending;
  const resettable = setting.value !== setting.default;

  const store = (next: string[]): void =>
    save.mutate({
      path: { key: setting.key },
      body: { value: next.join(",") },
    });

  const countId = `setting-${setting.key}-count`;
  const describedBy = `setting-${setting.key}-description`;

  return (
    <div className="karaoke-slots">
      <div className="setting-field">
        <div className="setting-row setting-row-stacked">
          <label className="setting-label" htmlFor={countId}>
            Players
          </label>
          <select
            className="text-input setting-input"
            id={countId}
            aria-describedby={describedBy}
            value={slots.length}
            // Without the palette there are no colors to grow into, and raising
            // the count would quietly save fewer slots than it shows.
            disabled={disabled || counts.length === 0 || palette.length === 0}
            onChange={(event) =>
              store(
                resized(
                  slots,
                  Number(event.target.value),
                  palette.map((color) => color.name),
                ),
              )
            }
          >
            {/* A stored count the backend no longer offers still has to show. */}
            {(counts.includes(slots.length)
              ? counts
              : [...counts, slots.length].sort((a, b) => a - b)
            ).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>

          {!readOnly && resettable && (
            <button
              type="button"
              className="icon-button icon-button-bordered karaoke-slots-reset"
              aria-label="Reset the player slots"
              title={`Reset to ${String(setting.default)}`}
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  path: { key: setting.key },
                  body: { value: null },
                })
              }
            >
              <Icon name="refresh" />
            </button>
          )}

          {save.isSuccess && (
            <span className="setting-saved" role="status">
              Saved
            </span>
          )}
        </div>

        <p className="setting-description" id={describedBy}>
          {setting.description}
        </p>
      </div>

      {slots.map((name, index) => {
        const slotId = `setting-${setting.key}-${index}`;
        return (
          <div className="setting-field" key={slotId}>
            <div className="setting-row setting-row-stacked">
              <label className="setting-label" htmlFor={slotId}>
                Slot {index + 1}
              </label>
              <span
                className="karaoke-slot-swatch"
                style={{ backgroundColor: hexOf(name) }}
                aria-hidden="true"
              />
              <select
                className="text-input setting-input"
                id={slotId}
                value={name}
                disabled={disabled || palette.length === 0}
                onChange={(event) =>
                  store(recolored(slots, index, event.target.value))
                }
              >
                {/* Until the palette arrives, the slot's own color is the only
                    option there can be — a select whose value is not among its
                    options would show up blank. */}
                {(palette.length === 0 ? [{ name, hex: "" }] : palette).map(
                  (color) => (
                    <option key={color.name} value={color.name}>
                      {color.name.replace("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
        );
      })}

      {save.isError && (
        <p
          className="error-notice setting-error karaoke-slots-error"
          role="alert"
        >
          {saveError(save.error)}
        </p>
      )}
    </div>
  );
}
