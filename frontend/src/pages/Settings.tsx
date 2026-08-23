import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SettingRead } from "../api";
import {
  listSettingsOptions,
  listSettingsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import SettingField from "../components/SettingField";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import "./Settings.css";

interface SettingChanged extends WingmanEvent {
  key: string;
  value: SettingRead["value"];
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

  // Registry order, so a group's settings stay in the order the backend
  // declares them.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingRead[]>();
    for (const setting of settings.data ?? []) {
      const rows = byGroup.get(setting.group);
      if (rows) rows.push(setting);
      else byGroup.set(setting.group, [setting]);
    }
    return [...byGroup];
  }, [settings.data]);

  if (auth.loaded && !mayView) {
    return (
      <>
        <h1>Settings</h1>
        <p className="settings-notice">
          Wingman's settings are for the host. Log in on the User tab, or ask
          the host to give your account the rights.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Settings</h1>

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

      {groups.map(([group, rows]) => (
        <section key={group}>
          <h2>{group}</h2>
          {rows.map((setting) => (
            <SettingField
              key={setting.key}
              setting={setting}
              readOnly={!mayManage}
            />
          ))}
        </section>
      ))}
    </>
  );
}
