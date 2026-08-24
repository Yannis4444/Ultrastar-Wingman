import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  usdxStatusOptions,
  usdxStatusQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import UsdxSetupGuide from "./UsdxSetupGuide";
import "./UsdxSetupBanner.css";

interface SettingChanged extends WingmanEvent {
  key: string;
}

/** The settings the backend's USDX check reads — a change to any other one
    cannot flip the verdict, so it must not cost a request. */
function affectsUsdx(key: string): boolean {
  return key.startsWith("usdx.") || key === "songs.directory";
}

/**
 * Says out loud that nobody can sing yet, instead of letting the party find out
 * on the first Play.
 */
export default function UsdxSetupBanner() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const [guideOpen, setGuideOpen] = useState(false);

  // `auth.loaded`: `can` says yes while /auth/me is in flight, and a caller
  // without songs.view would fire the request only to get a 403.
  const status = useQuery({
    ...usdxStatusOptions(),
    enabled: auth.loaded && auth.can("songs.view"),
  });

  useWingmanEvent<SettingChanged>("setting.changed", ({ key }) => {
    if (affectsUsdx(key)) {
      void queryClient.invalidateQueries({ queryKey: usdxStatusQueryKey() });
    }
  });

  // Undefined while it loads, and on an error: a banner that appears because
  // one request failed would be worse than no banner.
  if (status.data === undefined || status.data.configured) return null;

  return (
    <>
      <section className="usdx-setup-banner" role="status">
        <p>Ultrastar Deluxe is not set up yet, so no song can be started.</p>
        {auth.can("settings.manage") ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => setGuideOpen(true)}
          >
            Fix it
          </button>
        ) : (
          <p className="usdx-setup-banner-hint">
            Ask the host to finish setting Wingman up.
          </p>
        )}
      </section>

      {guideOpen && (
        <UsdxSetupGuide
          problems={status.data.problems}
          onClose={() => setGuideOpen(false)}
        />
      )}
    </>
  );
}
