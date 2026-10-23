import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  listPlaylistsOptions,
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
import {
  PrivateSettingRow,
  SecondsInput,
} from "../components/PrivateSettingRow";
import "../components/PickerRow.css";
import "../components/SettingField.css";
import {
  CANCEL_WITHOUT_SELECTION,
  deviceMeta,
  RANDOM_SCOPES,
  START_WITHOUT_SELECTION,
} from "../devices";
import { errorDetail, errorMessage, missingPermission } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Devices.css";

/** The bound `devices/settings.py` puts on the countdown. */
const MAX_DELAY_SECONDS = 30;

/** The bounds it puts on how long an untouched selection is kept. */
const MIN_IDLE_SECONDS = 30;
const MAX_IDLE_SECONDS = 900;

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
 * (§7): the options the feature has (five, plus the two a random start button
 * needs), the devices as rows into their own
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
  // The playlists are only wanted while a start press picks its random song
  // from one, which is the one row that offers them: most hosts never do, and
  // the page does not ask for a list it will not draw.
  const picksFromPlaylist =
    settings.data?.start_without_selection === "random" &&
    settings.data?.random_scope === "playlist";
  const playlists = useQuery({
    ...listPlaylistsOptions(),
    enabled: allowed && auth.can("playlists.view") && picksFromPlaylist,
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

  // Which of the rows the acknowledgement belongs to: the one that was
  // patched, so saving the toggle does not light the word beside a number.
  const savedField = justSaved
    ? (Object.keys(save.variables?.body ?? {})[0] ?? null)
    : null;

  const patch = (body: DeviceSettingsUpdate): void => {
    save.reset();
    save.mutate({ body });
  };

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
  const lists = playlists.data?.playlists ?? [];

  // The saved playlist is drawn only when the list carries it. Gone from the
  // list *after the list answered* is a playlist somebody deleted, which the
  // row says; a list still loading or one that failed is not evidence of that.
  const savedPlaylist = options?.random_playlist ?? "";
  const playlistFound = lists.some((list) => list.id === savedPlaylist);
  const playlistGone =
    playlists.isSuccess && savedPlaylist !== "" && !playlistFound;

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
                  <PrivateSettingRow
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
                  </PrivateSettingRow>

                  <PrivateSettingRow
                    id="auto_start_delay_s"
                    label="Delay before the song starts"
                    description="Time to take a wrong card away. Seconds, 0 to 30."
                    saved={savedField === "auto_start_delay_s"}
                  >
                    {(inputId, describedBy) => (
                      <SecondsInput
                        inputId={inputId}
                        describedBy={describedBy}
                        value={options.auto_start_delay_s}
                        min={0}
                        max={MAX_DELAY_SECONDS}
                        disabled={save.isPending}
                        onCommit={(seconds) =>
                          patch({ auto_start_delay_s: seconds })
                        }
                      />
                    )}
                  </PrivateSettingRow>

                  <PrivateSettingRow
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
                  </PrivateSettingRow>

                  <PrivateSettingRow
                    id="selection_idle_s"
                    label="Time before an idle selection closes"
                    description="A phone that stopped picking gives the room back after this long. Seconds, 30 to 900."
                    saved={savedField === "selection_idle_s"}
                  >
                    {(inputId, describedBy) => (
                      <SecondsInput
                        inputId={inputId}
                        describedBy={describedBy}
                        value={options.selection_idle_s}
                        min={MIN_IDLE_SECONDS}
                        max={MAX_IDLE_SECONDS}
                        disabled={save.isPending}
                        onCommit={(seconds) =>
                          patch({ selection_idle_s: seconds })
                        }
                      />
                    )}
                  </PrivateSettingRow>

                  <PrivateSettingRow
                    id="start_without_selection"
                    label="When the start button is pressed with nothing open"
                    description="The most wished song needs a card on a reader and starts at once. A random song spins the reel on the host screen first."
                    saved={savedField === "start_without_selection"}
                  >
                    {(inputId, describedBy) => (
                      <select
                        className="text-input text-input-quiet setting-input"
                        id={inputId}
                        aria-describedby={describedBy}
                        value={options.start_without_selection}
                        disabled={save.isPending}
                        onChange={(event) =>
                          patch({ start_without_selection: event.target.value })
                        }
                      >
                        {START_WITHOUT_SELECTION.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </PrivateSettingRow>

                  {/* The two rows a random start needs, drawn only while it is
                      the answer above: what the reel spins over, and which
                      playlist when it is one. Same row, same select, one PATCH
                      each. */}
                  {options.start_without_selection === "random" && (
                    <PrivateSettingRow
                      id="random_scope"
                      label="Pick the random song from"
                      description="The reel spins even with no card down. The next press starts the song if somebody stands on a slot, and spins again if nobody does."
                      saved={savedField === "random_scope"}
                    >
                      {(inputId, describedBy) => (
                        <select
                          className="text-input text-input-quiet setting-input"
                          id={inputId}
                          aria-describedby={describedBy}
                          value={options.random_scope}
                          disabled={save.isPending}
                          onChange={(event) =>
                            patch({ random_scope: event.target.value })
                          }
                        >
                          {RANDOM_SCOPES.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </PrivateSettingRow>
                  )}

                  {picksFromPlaylist && (
                    <PrivateSettingRow
                      id="random_playlist"
                      label="Playlist to pick from"
                      description={
                        playlistGone
                          ? "The saved playlist no longer exists, so the reel spins over all songs. Choose another one."
                          : "A playlist that no longer exists falls back to all songs."
                      }
                      saved={savedField === "random_playlist"}
                    >
                      {(inputId, describedBy) => (
                        <select
                          className="text-input text-input-quiet setting-input"
                          id={inputId}
                          aria-describedby={describedBy}
                          value={playlistFound ? savedPlaylist : ""}
                          disabled={save.isPending}
                          onChange={(event) =>
                            patch({ random_playlist: event.target.value })
                          }
                        >
                          <option value="">Choose a playlist</option>
                          {lists.map((list) => (
                            <option key={list.id} value={list.id}>
                              {list.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </PrivateSettingRow>
                  )}

                  {/* After the start button's rows, not between them and the
                      two they bring along: the cancel button's answer to a
                      quiet room is its own question. */}
                  <PrivateSettingRow
                    id="cancel_without_selection"
                    label="When the cancel button is pressed with nothing open"
                    description="Paused music stays paused. Nothing happens while it is off, or during or just after a sing."
                    saved={savedField === "cancel_without_selection"}
                  >
                    {(inputId, describedBy) => (
                      <select
                        className="text-input text-input-quiet setting-input"
                        id={inputId}
                        aria-describedby={describedBy}
                        value={options.cancel_without_selection}
                        disabled={save.isPending}
                        onChange={(event) =>
                          patch({
                            cancel_without_selection: event.target.value,
                          })
                        }
                      >
                        {CANCEL_WITHOUT_SELECTION.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </PrivateSettingRow>

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
