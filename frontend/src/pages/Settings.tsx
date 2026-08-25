import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, type ComponentType } from "react";
import type { SettingRead } from "../api";
import {
  listSettingsOptions,
  listSettingsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { Icon, type IconName } from "../components/icons";
import KaraokeSlotsField from "../components/KaraokeSlotsField";
import PageHeader from "../components/PageHeader";
import RunUsdxRow from "../components/RunUsdxRow";
import SettingField from "../components/SettingField";
import VideoQualityField from "../components/VideoQualityField";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import "./Settings.css";

interface SettingChanged extends WingmanEvent {
  key: string;
  value: SettingRead["value"];
}

/** Task-first page order; unknown groups land at the end in registry order. */
const GROUP_ORDER = ["Karaoke", "Songs", "USDX", "USDB", "Downloads", "Auth"];

/** One glyph per section, so a group is found by shape before it is read. */
const GROUP_ICONS: Record<string, IconName> = {
  Karaoke: "users",
  Songs: "music",
  USDX: "mic",
  USDB: "globe",
  Downloads: "download",
  Auth: "shield",
};

/**
 * Settings whose stored form is not what a person should be typing. Everything
 * else is rendered from its value type alone.
 */
const CUSTOM_FIELDS: Record<
  string,
  ComponentType<{ setting: SettingRead; readOnly: boolean }> | undefined
> = {
  "karaoke.player_colors": KaraokeSlotsField,
  "downloads.video_format": VideoQualityField,
};

/**
 * Rows a section opens with that are not settings at all. They belong to the
 * area they act on, not to a page of their own.
 */
const GROUP_ACTIONS: Record<
  string,
  ComponentType<{ readOnly: boolean }> | undefined
> = {
  USDX: RunUsdxRow,
};

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const mayView = auth.can("settings.view");
  const mayManage = auth.can("settings.manage");

  // `auth.loaded`: `can` says yes while /auth/me is in flight, and a guest
  // would fire the request only to flash a 403.
  const settings = useQuery({
    ...listSettingsOptions(),
    enabled: auth.loaded && mayView,
  });

  useWingmanEvent<SettingChanged>("setting.changed", ({ key, value }) => {
    // A secret arrives masked as null: refetch instead of writing that mask
    // (and a guessed `is_set`) into the cache.
    if (value === null) {
      void queryClient.invalidateQueries({ queryKey: listSettingsQueryKey() });
      return;
    }
    queryClient.setQueryData<SettingRead[]>(listSettingsQueryKey(), (old) =>
      old?.map((row) => (row.key === key ? { ...row, value } : row)),
    );
  });

  // A group's settings stay in the order the backend declares them; only the
  // groups themselves are sorted.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingRead[]>();
    for (const setting of settings.data ?? []) {
      const rows = byGroup.get(setting.group);
      if (rows) rows.push(setting);
      else byGroup.set(setting.group, [setting]);
    }
    return [...byGroup].sort(([a], [b]) => groupRank(a) - groupRank(b));
  }, [settings.data]);

  if (auth.loaded && !mayView) {
    return (
      <>
        <PageHeader title="Settings" back="/user" />
        <p className="settings-notice">
          Wingman's settings are for the host. Log in on the User tab, or ask
          the host to give your account the rights.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" back="/user" />

      {mayView && !mayManage && (
        <p className="settings-notice">
          You can see the settings but not change them.
        </p>
      )}

      {settings.isError && (
        <p className="error-notice settings-notice" role="alert">
          Could not load the settings.
        </p>
      )}

      {groups.map(([group, rows]) => {
        const Action = GROUP_ACTIONS[group];
        return (
          // Open by default: the host collapses what they do not care about,
          // and nothing is hidden from a first-time visit.
          <details key={group} className="settings-group" open>
            <summary>
              <Icon
                name={GROUP_ICONS[group] ?? "gear"}
                className="settings-group-icon"
              />
              {/* No count: a group renders as many rows as its settings need,
                  and "1" above four slot rows was simply wrong. */}
              <span className="settings-group-name">{group}</span>
            </summary>
            {Action && <Action readOnly={!mayManage} />}
            {rows.map((setting) => {
              const Field = CUSTOM_FIELDS[setting.key] ?? SettingField;
              return (
                <Field
                  key={setting.key}
                  setting={setting}
                  readOnly={!mayManage}
                />
              );
            })}
          </details>
        );
      })}
    </>
  );
}
