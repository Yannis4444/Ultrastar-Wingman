import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ButtonRead, DeviceList, DeviceRead, ReaderRead } from "../api";
import {
  deleteDeviceMutation,
  getFirmwareManifestOptions,
  listDevicesOptions,
  listDevicesQueryKey,
  listKaraokeSlotsOptions,
  updateDeviceMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import EditorActions from "../components/EditorActions";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import PlayerAvatar from "../components/PlayerAvatar";
import RoleSelect from "../components/RoleSelect";
import {
  BUTTON_ACTIONS,
  firmwareLine,
  mappingRefusal,
  signalLabel,
  statusLine,
  UNUSED,
  updateLine,
} from "../devices";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Devices.css";
import "./Device.css";

/** A mapping is keyed by the position as a string, both ways. */
type Mapping = Record<string, string>;

/** Whether an overlay says anything the device does not say already. */
function changed<T extends { index: number }>(
  rows: T[],
  overlay: Mapping,
  stored: (row: T) => string,
): boolean {
  return rows.some((row) => {
    const drawn = overlay[String(row.index)];
    return drawn !== undefined && drawn !== stored(row);
  });
}

/** The whole mapping as it is drawn, which is what a PATCH carries: the
 *  backend replaces the stored one with what it is given, so a body holding
 *  only the row that moved would take every other role away with it. */
function mappingOf<T extends { index: number }>(
  rows: T[],
  overlay: Mapping,
  stored: (row: T) => string,
): Mapping {
  return Object.fromEntries(
    rows.map((row) => [
      String(row.index),
      overlay[String(row.index)] ?? stored(row),
    ]),
  );
}

/**
 * One player selector: what it is saying, what its readers and buttons are
 * mapped to, and the way to be rid of it (§7).
 *
 * There is no `GET /devices/{id}`: the listing carries every device's live
 * state, so this page reads the same query the admin page does and picks its
 * row out of it. `devices.changed` therefore lands on both at once.
 *
 * What is edited is held as an **overlay** and never as a copy of the device.
 * A report arrives every five seconds and every press of a button changes a
 * number in it, so a draft holding whole rows would either freeze those numbers
 * or be thrown away under the reader's hands. The row draws `draft ?? device`,
 * and Save sends the mapping exactly as it is drawn.
 */
export default function Device() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { deviceId } = useParams();
  const allowed = auth.loaded && auth.can("devices.manage");

  const devices = useQuery({ ...listDevicesOptions(), enabled: allowed });
  // The configured singing slots, for the role select: which colours exist and
  // what they look like is the host's setting, never a list hardcoded here.
  const slots = useQuery({ ...listKaraokeSlotsOptions(), enabled: allowed });
  // A checkout that never built a firmware answers 404 `no_firmware`, which is
  // an answer and not a failure: no retries, and no line about an update.
  const firmwareQuery = useQuery({
    ...getFirmwareManifestOptions(),
    enabled: allowed,
    retry: false,
  });

  useWingmanEvent("devices.changed", () => {
    void queryClient.invalidateQueries({ queryKey: listDevicesQueryKey() });
  });

  const device: DeviceRead | undefined = devices.data?.devices.find(
    (row) => row.id === deviceId,
  );

  // A device that was here and is gone was deleted somewhere else, and this
  // page is about nothing. An id that was never in a listing is a 404, which
  // is a sentence and not a redirect: a typed URL must not bounce.
  const seen = useRef(false);
  if (device !== undefined) seen.current = true;
  const vanished = seen.current && device === undefined;
  useEffect(() => {
    if (vanished) void navigate("/user/devices", { replace: true });
  }, [vanished, navigate]);

  /* -------------------------------------------------------- what is edited */

  const [name, setName] = useState<string | null>(null);
  const [roles, setRoles] = useState<Mapping>({});
  const [actions, setActions] = useState<Mapping>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const readers = device?.readers ?? [];
  const buttons = device?.buttons ?? [];
  const roleOf = (reader: ReaderRead): string =>
    roles[String(reader.index)] ?? reader.role;
  const actionOf = (button: ButtonRead): string =>
    actions[String(button.index)] ?? button.action;
  const drawnName = name ?? device?.name ?? "";

  const touched =
    (name !== null && name.trim() !== device?.name) ||
    changed(readers, roles, (reader) => reader.role) ||
    changed(buttons, actions, (button) => button.action);

  const save = useMutation({
    ...updateDeviceMutation(),
    onSuccess: (updated) => {
      setName(null);
      setRoles({});
      setActions({});
      setRefusal(null);
      setSaved(true);
      // The answer is the device as it now stands, so the row this page draws
      // is held without a second request — and held even when the socket is
      // down, which is the other half of why the PATCH answers with it.
      queryClient.setQueryData<DeviceList>(listDevicesQueryKey(), (old) =>
        old === undefined
          ? old
          : {
              ...old,
              devices: old.devices.map((row) =>
                row.id === updated.id ? updated : row,
              ),
            },
      );
    },
    onError: (cause) => setRefusal(mappingRefusal(cause, readers, roleOf)),
  });

  const remove = useMutation({
    ...deleteDeviceMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listDevicesQueryKey() });
      void navigate("/user/devices");
    },
    onError: (cause) => {
      setDeleting(false);
      setRefusal(errorMessage(cause, "Could not delete that device."));
    },
  });

  const submit = (): void => {
    if (device === undefined || !touched || save.isPending) return;
    setRefusal(null);
    setSaved(false);
    save.mutate({
      path: { device_id: device.id },
      body: {
        name: drawnName.trim(),
        reader_roles: mappingOf(readers, roles, (reader) => reader.role),
        button_actions: mappingOf(buttons, actions, (button) => button.action),
      },
    });
  };

  const saveNote = save.isPending
    ? "Saving…"
    : drawnName.trim() === ""
      ? "It needs a name before it can be saved."
      : refusal !== null
        ? refusal
        : // A save that landed leaves nothing pending, and the row says
          // *Saved* in the same slot: "nothing has changed" would be true and
          // beside the point.
          !touched && !saved
          ? "Nothing has changed yet."
          : null;

  const palette = slots.data?.slots ?? [];
  const signal = signalLabel(device?.rssi);
  const update =
    device === undefined
      ? null
      : updateLine(device, firmwareQuery.data ?? null);
  const firmware = device === undefined ? null : firmwareLine(device);

  /** The role select of one reader. A reader that never answered the boot
   *  probe cannot carry a role, so its select is disabled — unless it still
   *  carries one from a wiring that has since come apart, which has to stay
   *  clearable. What is stored decides that, never what is drawn: picking
   *  *Not used* on a loose reader would otherwise disable the select under
   *  the hand that picked it, before the change was ever saved. */
  const roleSelect = (reader: ReaderRead) => (
    <RoleSelect
      className="text-input text-input-quiet device-select"
      id={`device-reader-${reader.index}`}
      label={`Reader ${reader.index + 1} role`}
      slots={palette}
      value={roleOf(reader)}
      disabled={
        (reader.state !== "wired" && reader.role === UNUSED) || save.isPending
      }
      onChange={(role) => {
        setSaved(false);
        setRefusal(null);
        setRoles((old) => ({ ...old, [String(reader.index)]: role }));
      }}
    />
  );

  return (
    <div className="devices-page">
      <PageHeader title={device?.name ?? "Device"} back="/user/devices" />

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {!allowed && (
            <p className="settings-notice">
              The player selector is set up by the host. Ask the host for
              access.
            </p>
          )}

          {allowed && (
            <>
              {devices.isPending && <Loading />}

              {devices.isError && (
                <p className="error-notice devices-notice" role="alert">
                  Could not load the device.
                </p>
              )}

              {devices.isSuccess && device === undefined && !vanished && (
                <p className="settings-notice">
                  There is no such device. It may have been deleted.
                </p>
              )}

              {device !== undefined && (
                <form
                  className="device-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  {/* Name, status, readers, buttons, Save (§7): the editors'
                      own order, where what the thing is called comes first. */}
                  <label className="device-field">
                    <span>Name</span>
                    <input
                      className="text-input text-input-quiet"
                      value={drawnName}
                      maxLength={64}
                      onChange={(event) => {
                        setSaved(false);
                        setRefusal(null);
                        setName(event.target.value);
                      }}
                    />
                  </label>

                  {/* The status, flat: three or four quiet lines, no tile. */}
                  <div className="device-status">
                    <p className="section-note">{statusLine(device)}</p>
                    {firmware !== null && (
                      <p className="section-note">{firmware}</p>
                    )}
                    {update !== null && (
                      <p className="section-note">{update}</p>
                    )}
                    {signal !== null && (
                      <p className="section-note">Signal: {signal}</p>
                    )}
                  </div>

                  {/* Back into the wizard, at the step that does the job: both
                      are the same six screens on a device that already exists,
                      so neither names it again and neither mints a device. */}
                  <div className="device-links">
                    <Link
                      className="button"
                      to={`/user/devices/new?device=${encodeURIComponent(device.id)}&step=flash`}
                    >
                      Update firmware
                    </Link>
                    <Link
                      className="button"
                      to={`/user/devices/new?device=${encodeURIComponent(device.id)}&step=configure`}
                    >
                      Change Wi-Fi or server
                    </Link>
                  </div>

                  <h2>Readers</h2>
                  <p className="section-note">
                    Reader numbers follow the wiring. Give each reader a slot
                    color, or let everybody scan in turn on one reader.
                  </p>

                  {readers.length === 0 ? (
                    <p className="section-note devices-empty">
                      This device has not said what it is wired to yet.
                    </p>
                  ) : (
                    <ul className="device-rows">
                      {readers.map((reader) => (
                        <li key={reader.index}>
                          <div className="device-row">
                            <span className="device-position">
                              Reader {reader.index + 1}
                            </span>
                            <span className="device-state">
                              {reader.state === "none" && (
                                <span className="device-off">not wired</span>
                              )}
                              {reader.state === "fault" && (
                                // The byte it answered with is the one thing
                                // that tells a good clone from a loose wire,
                                // and `schema.py` carries it for this line.
                                <span className="device-fault">
                                  Answers with garbage
                                  {reader.version === undefined ||
                                  reader.version === null
                                    ? ""
                                    : ` (0x${reader.version})`}
                                  . Check the wiring or see the build guide.
                                </span>
                              )}
                              {reader.state === "wired" &&
                                reader.player !== undefined &&
                                reader.player !== null && (
                                  <>
                                    <PlayerAvatar player={reader.player} />
                                    <span className="device-lying">
                                      {reader.player.name}
                                    </span>
                                  </>
                                )}
                              {reader.state === "wired" &&
                                (reader.player === undefined ||
                                  reader.player === null) &&
                                reader.uid !== undefined &&
                                reader.uid !== null && (
                                  <span className="device-lying">
                                    Unknown card{" "}
                                    <span className="devices-uid">
                                      {reader.uid}
                                    </span>
                                  </span>
                                )}
                              {/* Only while the device is here: a report is
                                  what says a reader is empty, and one that is
                                  offline is sending none. */}
                              {reader.state === "wired" &&
                                device.online &&
                                (reader.uid === undefined ||
                                  reader.uid === null) && (
                                  <span className="device-off">empty</span>
                                )}
                            </span>
                            {roleSelect(reader)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <h2>Buttons</h2>

                  {buttons.length === 0 ? (
                    <p className="section-note devices-empty">
                      This device has no button mapped yet.
                    </p>
                  ) : (
                    <ul className="device-rows">
                      {buttons.map((button) => (
                        <li key={button.index}>
                          <div className="device-row">
                            <span className="device-position">
                              Button {button.index + 1}
                            </span>
                            {/* The count is what proves the wiring: it moves
                                while somebody stands at the box pressing. */}
                            <span className="device-state device-presses">
                              {button.presses === 1
                                ? "1 press"
                                : `${button.presses} presses`}
                            </span>
                            <select
                              className="text-input text-input-quiet device-select"
                              aria-label={`Button ${button.index + 1} action`}
                              value={actionOf(button)}
                              disabled={save.isPending}
                              onChange={(event) => {
                                setSaved(false);
                                setRefusal(null);
                                setActions((old) => ({
                                  ...old,
                                  [String(button.index)]: event.target.value,
                                }));
                              }}
                            >
                              {BUTTON_ACTIONS.map((action) => (
                                <option key={action.value} value={action.value}>
                                  {action.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Save and Delete on one line at the bottom of the screen,
                      the shared row of every full-page editor. Inside the
                      form: Save is its submit button. */}
                  <EditorActions
                    note={saveNote}
                    saved={saved}
                    saveDisabled={
                      !touched || save.isPending || drawnName.trim() === ""
                    }
                  >
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={remove.isPending}
                      onClick={() => setDeleting(true)}
                    >
                      Delete device
                    </button>
                  </EditorActions>
                </form>
              )}
            </>
          )}
        </>
      )}

      {deleting && device !== undefined && (
        <ConfirmModal
          title="Delete this device?"
          message={`Delete ${device.name}? The cards stay.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove.mutate({ path: { device_id: device.id } })}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
