import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CardRead,
  DeviceRead,
  DeviceSettingsUpdate,
  PlayerRead,
  ReaderRead,
} from "../api";
import {
  assignCardMutation,
  forgetCardMutation,
  getDeviceSettingsOptions,
  getDeviceSettingsQueryKey,
  getFirmwareManifestOptions,
  listCardsOptions,
  listCardsQueryKey,
  listDevicesOptions,
  listDevicesQueryKey,
  listPlayersOptions,
  updateDeviceSettingsMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import ConfirmModal from "../components/ConfirmModal";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import PageHeader from "../components/PageHeader";
import PickerRow from "../components/PickerRow";
import PlayerAvatar from "../components/PlayerAvatar";
import { SettingSaved } from "../components/SettingField";
import "../components/PickerRow.css";
import "../components/SettingField.css";
import { deviceMeta } from "../devices";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Devices.css";

/** The bound `devices/settings.py` puts on the countdown. */
const MAX_DELAY_SECONDS = 30;

/** What a card nobody has claimed is called, on the reader row and in the
 *  panel that claims it. One phrase, so the panel says what was tapped. */
const UNKNOWN_CARD = "Unknown card";

/** A 4xx carries the backend's own complaint, which is worth showing. A
 *  permission denial is the exception: its slug is not a sentence. */
function complaint(error: unknown, fallback: string): string {
  const detail = errorDetail(error);
  return detail !== null && missingPermission(error) === null
    ? detail
    : errorMessage(error, fallback);
}

interface FieldProps {
  id: string;
  label: string;
  description: string;
  saved: boolean;
  children: (inputId: string, describedBy: string) => ReactNode;
  /** Set on the label's line for a checkbox, which has no second line. */
  inline?: boolean;
}

/**
 * One settings row in the Settings page's shape (§7): the label with its
 * acknowledgement on the first line, the quiet box alone on the second, the
 * 0.85em description under both. These three are not registered settings —
 * `devices/settings.py` keeps them private, behind `devices.manage` rather than
 * `settings.manage` — so the row is rebuilt on the same classes, exactly as the
 * achievements admin rebuilds its own.
 */
function DeviceSettingRow({
  id,
  label,
  description,
  saved,
  children,
  inline = false,
}: FieldProps) {
  const inputId = `device-setting-${id}`;
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

/** One card lying on a reader right now: which device and which reader, so a
 *  party with two boxes can tell two cards apart. */
interface Placed {
  device: DeviceRead;
  reader: ReaderRead;
  uid: string;
}

interface PickerProps {
  card: Placed;
  /** Every player, hidden ones included: somebody standing at the device is
   *  not being picked from a list, so hiding has nothing to say here. */
  players: PlayerRead[];
  /** Whose card it is now, or `null` while nobody has claimed it. */
  holder: string | null;
  /** Named when the device is not the only one. */
  where: string | null;
  pending: boolean;
  error: string | null;
  onPick: (playerId: string) => void;
  onClose: () => void;
}

/**
 * Who holds the card that was tapped: the correction panel's own shape (§5) —
 * the card's line, then one `PickerRow` per player with the current holder
 * pressed. A tap writes it and the panel goes, an assignment being one act.
 */
function CardPicker({
  card,
  players,
  holder,
  where,
  pending,
  error,
  onPick,
  onClose,
}: PickerProps) {
  return (
    <Modal title="Who holds this card?" onClose={onClose}>
      <p className="devices-card-note">
        Card {card.uid}
        {where === null ? "" : `, on ${where}`}.
      </p>

      {error !== null && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}

      {players.length === 0 ? (
        <p className="devices-card-note">There are no players to pick.</p>
      ) : (
        <ul className="picker-list">
          {players.map((player) => (
            <PickerRow
              key={player.id}
              lead={<PlayerAvatar player={player} />}
              title={player.name}
              meta={player.registered ? "Account" : "Guest player"}
              pressed={player.id === holder}
              disabled={pending}
              onClick={() => onPick(player.id)}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * The player selector, behind the `devices.manage` entry of the manage menu
 * (§7): the three options the feature has, the devices as rows into their own
 * pages, and the cards.
 *
 * The cards come in two lists because they answer two different questions. *On
 * the readers now* is what is lying on the box in front of you, which is how a
 * card gets a name: put it down, tap it, pick the singer. *All cards* is the
 * table itself, where one is taken back.
 */
export default function Devices() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = auth.loaded && auth.can("devices.manage");

  const devices = useQuery({ ...listDevicesOptions(), enabled: allowed });
  const cards = useQuery({ ...listCardsOptions(), enabled: allowed });
  const settings = useQuery({
    ...getDeviceSettingsOptions(),
    enabled: allowed,
  });
  // A checkout that never built a firmware answers 404 `no_firmware`, which is
  // an answer and not a failure: no retries, and nothing on the page about it.
  const firmware = useQuery({
    ...getFirmwareManifestOptions(),
    enabled: allowed,
    retry: false,
  });
  // Assigning a card needs the people to assign it to. Hidden players included:
  // the person standing at the device is not being picked from a list.
  const players = useQuery({
    ...listPlayersOptions(),
    enabled: allowed && auth.can("players.view"),
  });

  useWingmanEvent("devices.changed", () => {
    for (const key of [listDevicesQueryKey(), listCardsQueryKey()])
      void queryClient.invalidateQueries({ queryKey: key });
  });

  /* ------------------------------------------------------- the settings */

  const save = useMutation({
    ...updateDeviceSettingsMutation(),
    onSuccess: (updated) =>
      queryClient.setQueryData(getDeviceSettingsQueryKey(), updated),
  });

  // "Saved" is an acknowledgement, not a state: it fades after a moment.
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

  const patch = (body: DeviceSettingsUpdate): void => {
    save.reset();
    save.mutate({ body });
  };

  // Non-null only while the delay is being typed in, so a `devices.changed`
  // from another browser still reaches a field nobody is editing.
  const [delayDraft, setDelayDraft] = useState<string | null>(null);

  /* ---------------------------------------------------------- the cards */

  const [picking, setPicking] = useState<Placed | null>(null);
  const [forgetting, setForgetting] = useState<CardRead | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const refreshCards = (): void => {
    for (const key of [listDevicesQueryKey(), listCardsQueryKey()])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const assign = useMutation({
    ...assignCardMutation(),
    onSuccess: () => {
      setPicking(null);
      refreshCards();
    },
    // No page-level notice for this one: the picker is standing over the page
    // with its own, which is where the reader can act on it.
  });

  const forget = useMutation({
    ...forgetCardMutation(),
    onSuccess: () => {
      setForgetting(null);
      refreshCards();
    },
    onError: (cause) => {
      setForgetting(null);
      setCardError(complaint(cause, "Could not forget that card."));
    },
  });

  const rows = devices.data?.devices ?? [];
  const known = cards.data?.cards ?? [];
  const manifest = firmware.data ?? null;
  const roster = players.data?.players ?? [];
  const options = settings.data;

  // What is on a reader right now. A device that is offline reports no uid at
  // all (the backend drops it), so this is only ever the boxes in the room.
  const placed: Placed[] = rows.flatMap((device) =>
    device.online
      ? device.readers.flatMap((reader) =>
          reader.uid === undefined || reader.uid === null
            ? []
            : [{ device, reader, uid: reader.uid }],
        )
      : [],
  );

  /** Which device and reader a card lies on, named only when there is more
   *  than one device: with one box the answer is never in doubt. */
  const whereIs = (card: Placed): string | null =>
    rows.length > 1
      ? `${card.device.name}, reader ${card.reader.index + 1}`
      : null;

  return (
    <div className="devices-page">
      <PageHeader title="Player selector" back="/user">
        {allowed && (
          <Link
            className="icon-button"
            to="/user/devices/new"
            aria-label="Set up a device"
            title="Set up a device"
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
              The player selector is set up by the host. Ask the host for
              access.
            </p>
          )}

          {allowed && (
            <>
              {(devices.isPending || settings.isPending) && <Loading />}

              {/* One notice for the three, naming what did not answer: the
                  page is one surface, and three stacked notices would be
                  three ways of saying the network is down. */}
              {(devices.isError || cards.isError || settings.isError) && (
                <p className="error-notice devices-notice" role="alert">
                  Could not load the{" "}
                  {[
                    devices.isError ? "devices" : "",
                    settings.isError ? "settings" : "",
                    cards.isError ? "cards" : "",
                  ]
                    .filter((part) => part !== "")
                    .join(", ")}
                  .
                </p>
              )}

              {options !== undefined && (
                <>
                  <DeviceSettingRow
                    id="auto_start"
                    label="Start the song on its own"
                    description="When every slot holds a known singer, the song starts after the delay below."
                    saved={savedField === "auto_start"}
                    inline
                  >
                    {(inputId, describedBy) => (
                      <input
                        type="checkbox"
                        className="setting-toggle"
                        id={inputId}
                        aria-describedby={describedBy}
                        checked={options.auto_start}
                        disabled={save.isPending}
                        onChange={(event) =>
                          patch({ auto_start: event.target.checked })
                        }
                      />
                    )}
                  </DeviceSettingRow>

                  <DeviceSettingRow
                    id="auto_start_delay_s"
                    label="Delay before the song starts"
                    description="Time to take a wrong card away. Seconds, 0 to 30."
                    saved={savedField === "auto_start_delay_s"}
                  >
                    {(inputId, describedBy) => (
                      <input
                        className="text-input text-input-quiet setting-input"
                        id={inputId}
                        aria-describedby={describedBy}
                        type="number"
                        min={0}
                        max={MAX_DELAY_SECONDS}
                        value={delayDraft ?? String(options.auto_start_delay_s)}
                        disabled={save.isPending}
                        onChange={(event) => setDelayDraft(event.target.value)}
                        onBlur={() => {
                          const draft = delayDraft;
                          setDelayDraft(null);
                          if (draft === null || draft.trim() === "") return;
                          const parsed = Number(draft);
                          if (
                            Number.isNaN(parsed) ||
                            parsed === options.auto_start_delay_s
                          )
                            return;
                          patch({ auto_start_delay_s: parsed });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          event.currentTarget.blur();
                        }}
                      />
                    )}
                  </DeviceSettingRow>

                  <DeviceSettingRow
                    id="rescan_removes"
                    label="Scanning a card again removes the singer"
                    description="For a device with one reader that everybody scans in turn."
                    saved={savedField === "rescan_removes"}
                    inline
                  >
                    {(inputId, describedBy) => (
                      <input
                        type="checkbox"
                        className="setting-toggle"
                        id={inputId}
                        aria-describedby={describedBy}
                        checked={options.rescan_removes}
                        disabled={save.isPending}
                        onChange={(event) =>
                          patch({ rescan_removes: event.target.checked })
                        }
                      />
                    )}
                  </DeviceSettingRow>

                  {save.isError && (
                    <p className="error-notice devices-notice" role="alert">
                      {complaint(save.error, "Could not save the setting.")}
                    </p>
                  )}
                </>
              )}

              {devices.isSuccess && (
                <>
                  <h2>Devices</h2>

                  {rows.length === 0 ? (
                    <p className="section-note devices-empty">
                      No device yet. Set one up with the plus above.
                    </p>
                  ) : (
                    <ul className="devices-list">
                      {rows.map((device) => (
                        <li key={device.id}>
                          <Link
                            className="devices-open"
                            to={`/user/devices/${encodeURIComponent(device.id)}`}
                          >
                            <span className="devices-square" aria-hidden="true">
                              <Icon name="card" />
                            </span>
                            <span className="devices-text">
                              <span
                                className="devices-name"
                                title={device.name}
                              >
                                {device.name}
                              </span>
                              <span className="devices-meta">
                                {deviceMeta(device, manifest)}
                              </span>
                            </span>
                            <Icon
                              name="chevron-right"
                              className="devices-chevron"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  {cardError !== null && (
                    <p className="error-notice devices-notice" role="alert">
                      {cardError}
                    </p>
                  )}

                  {/* The cards are two sections and not one with sub-headings:
                      §2 knows `h1` and `h2`, and the two lists answer two
                      different questions. */}
                  <h2>On the readers now</h2>
                  <p className="section-note">
                    Tap a card to say whose it is. A card belongs to one singer.
                  </p>

                  {placed.length === 0 ? (
                    <p className="section-note devices-empty">
                      Nothing is lying on a reader.
                    </p>
                  ) : (
                    <ul className="devices-list">
                      {placed.map((card) => {
                        const player = card.reader.player ?? null;
                        const where = whereIs(card);
                        return (
                          <li key={`${card.device.id}:${card.reader.index}`}>
                            <button
                              type="button"
                              className="devices-card"
                              onClick={() => {
                                setCardError(null);
                                assign.reset();
                                setPicking(card);
                              }}
                            >
                              <PlayerAvatar player={player} />
                              <span className="devices-text">
                                <span
                                  className={
                                    player === null
                                      ? "devices-name devices-unknown"
                                      : "devices-name"
                                  }
                                >
                                  {player?.name ?? UNKNOWN_CARD}
                                </span>
                                <span className="devices-meta">
                                  <span className="devices-uid">
                                    {card.uid}
                                  </span>
                                  {where === null ? "" : ` · ${where}`}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <h2>All cards</h2>
                  <p className="section-note">
                    A singer may have several cards.
                  </p>

                  {/* Only once the table has actually been read: a failed
                      request must not claim there is nothing in it. */}
                  {cards.isSuccess && known.length === 0 ? (
                    <p className="section-note devices-empty">
                      No card has a singer yet. Put a card on a reader and tap
                      it to say whose it is.
                    </p>
                  ) : (
                    <ul className="devices-list">
                      {known.map((card) => (
                        <li key={card.uid}>
                          <span className="devices-row">
                            <PlayerAvatar player={card.player} />
                            <span className="devices-text">
                              <span className="devices-name">
                                {card.player.name}
                              </span>
                              <span className="devices-meta">
                                <span className="devices-uid">{card.uid}</span>
                              </span>
                            </span>
                            <button
                              type="button"
                              className="icon-button icon-button-danger"
                              aria-label="Forget card"
                              title="Forget card"
                              disabled={forget.isPending}
                              onClick={() => {
                                setCardError(null);
                                setForgetting(card);
                              }}
                            >
                              <Icon name="close" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {picking !== null && (
        <CardPicker
          card={picking}
          players={roster}
          holder={picking.reader.player?.id ?? null}
          where={whereIs(picking)}
          pending={assign.isPending}
          error={
            assign.isError
              ? complaint(assign.error, "Could not put that card on a player.")
              : null
          }
          onPick={(playerId) =>
            assign.mutate({
              path: { uid: picking.uid },
              body: { player_id: playerId },
            })
          }
          onClose={() => setPicking(null)}
        />
      )}

      {forgetting !== null && (
        <ConfirmModal
          title="Forget this card?"
          message={`Card ${forgetting.uid} stops being ${forgetting.player.name}. Their scores and their player stay exactly as they are.`}
          confirmLabel="Forget"
          danger
          onConfirm={() => forget.mutate({ path: { uid: forgetting.uid } })}
          onCancel={() => setForgetting(null)}
        />
      )}
    </div>
  );
}
