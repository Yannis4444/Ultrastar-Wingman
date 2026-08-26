import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingRead } from "../api";
import {
  getJoinInfoOptions,
  getJoinInfoQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import SettingField from "./SettingField";

interface SettingChanged extends WingmanEvent {
  key: string;
}

interface Props {
  setting: SettingRead;
  /** Holds `settings.view` but not `settings.manage`: everything read-only. */
  readOnly: boolean;
}

/**
 * `host.join_url`, with the address it actually produces appended to the
 * registry's own description.
 *
 * The field itself is the ordinary one — this only answers the question the
 * setting raises and cannot answer on its own: an empty box means "guess it",
 * and the host has no way to see what the guess came out as short of walking
 * over to the TV. `/join` is where that answer lives, for the QR code and for
 * this line alike, so the two can never disagree.
 */
export default function JoinUrlField({ setting, readOnly }: Props) {
  const queryClient = useQueryClient();
  const join = useQuery(getJoinInfoOptions());

  // Saving the setting is what changes the answer, and the broadcast reaches
  // this browser too — including when another one saved it.
  useWingmanEvent<SettingChanged>("setting.changed", ({ key }) => {
    if (key === setting.key) {
      void queryClient.invalidateQueries({ queryKey: getJoinInfoQueryKey() });
    }
  });

  const url = join.data?.url;
  const described =
    url === undefined
      ? setting
      : {
          ...setting,
          description: `${setting.description} Guests open ${url}.`,
        };

  return <SettingField setting={described} readOnly={readOnly} />;
}
