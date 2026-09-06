import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Transport } from "esptool-js";
import type { DeviceRead, FirmwareBuild } from "../api";
import { getFirmwareImage } from "../api/sdk.gen";
import {
  createDeviceMutation,
  getFirmwareManifestOptions,
  getJoinInfoOptions,
  listDevicesOptions,
  listDevicesQueryKey,
  listKaraokeSlotsOptions,
  rotateDeviceTokenMutation,
  updateDeviceMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import PlayerAvatar from "../components/PlayerAvatar";
import RoleSelect from "../components/RoleSelect";
import {
  buildCommand,
  CONSOLE_BAUD_RATE,
  errorSentence,
  HELLO_INTERVAL_MS,
  type HelloMessage,
  HelloHandshake,
  LineFramer,
  type Network,
  parseLine,
  statusSentence,
} from "../deviceSerial";
import { BUTTON_ACTIONS, mappingRefusal } from "../devices";
import {
  discoveredOrder,
  foundLabel,
  localhostSetupUrl,
  type Mapping,
  pressBaseline,
  pressedOrder,
  proposeActions,
  proposeRoles,
  SERVER_ADDRESS_NOTE,
  serverAddress,
  serverAddressProblem,
} from "../deviceSetup";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import "./Devices.css";
import "./Device.css";
import "./DeviceSetup.css";

/** The six screens, in order. The labels are what the step list says. */
const STEPS = ["Build", "Flash", "Configure", "Connect", "Discover", "Map"];

const BUILD = 0;
const FLASH = 1;
const CONFIGURE = 2;
const CONNECT = 3;
const DISCOVER = 4;
const MAP = 5;

/** How long the device is given to reach Wingman before the wizard offers the
 *  troubleshooting list. A board joins a 2.4 GHz network in a few seconds; a
 *  minute is long enough that the list is a real answer and not an alarm. */
const CONNECT_TIMEOUT_MS = 60000;

/** The whole image goes to one address: `merge_bin.py` builds a single file
 *  that already carries the bootloader and the partition table. */
const FLASH_ADDRESS = 0;

/** What the flasher runs at once the stub is up. The ROM loader's own rate is
 *  esptool-js's business, and 0.6.1 fixes it at 115200. */
const FLASH_BAUD_RATE = 460800;

/** Room for a boot-loader burst without dropping any of it. */
const SERIAL_BUFFER_SIZE = 8192;

/** esptool-js writes its progress into a terminal. This page draws a bar
 *  instead, so the terminal takes the lines and drops them. */
const SILENT_TERMINAL = {
  clean: () => {},
  write: () => {},
  writeLine: () => {},
};

/** The board and the parts a v1 build is made of (player-selector.md §2). */
const PARTS = [
  "An ESP32 DevKitC board, WROOM-32, 30 or 38 pins",
  "One to six RC522 reader boards",
  "One MIFARE card or fob per singer",
  "Up to four push buttons",
  "A USB cable, and a 5 V supply of 1 A or more",
];

/** The fixed pin map. One firmware image fits every build because of it, so
 *  it is the wiring and not a suggestion. */
const PINS: { signal: string; gpio: string; note: string }[] = [
  {
    signal: "SCK, MISO, MOSI (every reader)",
    gpio: "18, 19, 23",
    note: "The VSPI defaults. All readers share these three.",
  },
  {
    signal: "Reader 1 to 6 SDA (chip select)",
    gpio: "5, 17, 16, 4, 21, 22",
    note: "One pin per reader, in that order. Start at reader 1.",
  },
  {
    signal: "Reader RST (every reader)",
    gpio: "3.3 V",
    note: "The firmware resets each reader in software.",
  },
  {
    signal: "Reader IRQ",
    gpio: "not connected",
    note: "The device polls, which is how it sees a card leave.",
  },
  {
    signal: "Button 1 to 4",
    gpio: "32, 33, 25, 26",
    note: "To GND. The pins pull themselves up.",
  },
  {
    signal: "Power",
    gpio: "5 V on VIN",
    note: "Six readers plus Wi-Fi peak at about 400 mA.",
  },
];

/** What a reader answering garbage means, in one sentence. */
const FAULT_NOTE =
  "Answers with garbage. Check the wiring, or read the build guide about MISO on cheap clones.";

/** Why the flash step is dark on a phone. */
const NEEDS_LOCALHOST =
  "Flashing a board needs a USB cable and a browser page Wingman serves from this computer.";

/**
 * Setting up a player selector, in six screens (player-selector.md §7).
 *
 * The wizard owns one `SerialPort` from the moment a board is flashed or a
 * cable is picked until the page goes away: the flasher borrows it, the
 * configuration is written over it, and the status lines the device prints
 * come back on it. One reader loop, held in a ref, feeds `deviceSerial.ts`'s
 * framer. Two loops on one port would each get half the lines.
 *
 * `?device=<id>&step=flash|configure` re-enters on a device that already
 * exists, which is what the two buttons on the device page do. Then step 3
 * mints a new token instead of a new device, and does not ask for a name.
 */
export default function DeviceSetup() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const allowed = auth.loaded && auth.can("devices.manage");

  // The entry point, read once: the step list is walked with Back and Next
  // after that, and a re-render must not throw the reader back to step 2.
  const [reenteredId] = useState(() => params.get("device"));
  const [step, setStep] = useState(() => {
    const entry = params.get("step");
    if (entry === "flash") return FLASH;
    if (entry === "configure") return CONFIGURE;
    return BUILD;
  });
  const [deviceId, setDeviceId] = useState<string | null>(reenteredId);

  /* ------------------------------------------------------------ the queries */

  const devices = useQuery({ ...listDevicesOptions(), enabled: allowed });
  const slots = useQuery({ ...listKaraokeSlotsOptions(), enabled: allowed });
  const join = useQuery({ ...getJoinInfoOptions(), enabled: allowed });
  // A checkout that never built a firmware answers 404 `no_firmware`, which is
  // an answer and not a failure: no retries, and the step says so in words.
  const firmware = useQuery({
    ...getFirmwareManifestOptions(),
    enabled: allowed,
    retry: false,
  });

  useWingmanEvent("devices.changed", () => {
    void queryClient.invalidateQueries({ queryKey: listDevicesQueryKey() });
  });

  const device: DeviceRead | null =
    devices.data?.devices.find((row) => row.id === deviceId) ?? null;
  // Held, because the Map step's proposal reads it from an effect: a fresh
  // empty array every render would be a fresh dependency every render.
  const palette = useMemo(() => slots.data?.slots ?? [], [slots.data]);
  const manifest = firmware.data ?? null;
  const build: FirmwareBuild | null = manifest?.builds[0] ?? null;

  /* ------------------------------------------------------------- the cable */

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(
    null,
  );
  const framerRef = useRef(new LineFramer());
  const handshakeRef = useRef(new HelloHandshake());
  const tokenRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<HelloMessage | null>(null);
  const [networks, setNetworks] = useState<Network[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [cableError, setCableError] = useState<string | null>(null);

  // Web Serial lives in a secure context only, and `http://192.168.0.5:8080`
  // is not one. Read on every render, so a test can put a fake in place.
  const canFlash =
    typeof navigator !== "undefined" &&
    "serial" in navigator &&
    window.isSecureContext;

  const say = (sentence: string): void => setLines((old) => [...old, sentence]);

  const handleLine = (line: string): void => {
    handshakeRef.current.receive(line);
    const message = parseLine(line);
    if (message === null) return;
    switch (message.type) {
      case "hello":
        setHello(message);
        break;
      case "networks":
        setNetworks(message.networks);
        setScanning(false);
        break;
      case "ok":
        setAccepted(true);
        break;
      case "status":
        say(statusSentence(message));
        break;
      case "error":
        say(errorSentence(message));
        break;
    }
  };

  const readLoop = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        if (chunk.value === undefined) continue;
        for (const line of framerRef.current.push(chunk.value))
          handleLine(line);
      }
    } catch {
      // The cable was pulled, or the port was closed under the loop. Both are
      // said by the state the page is already in.
    }
  };

  /** Open the console on a port that is not open, and start the one loop.
   *  Never on a port a `Transport` still holds: it runs a loop of its own. */
  const openConsole = async (port: SerialPort): Promise<void> => {
    framerRef.current = new LineFramer();
    handshakeRef.current = new HelloHandshake();
    setHello(null);
    await port.open({
      baudRate: CONSOLE_BAUD_RATE,
      bufferSize: SERIAL_BUFFER_SIZE,
    });
    portRef.current = port;
    if (port.writable !== null) writerRef.current = port.writable.getWriter();
    if (port.readable !== null) {
      const reader = port.readable.getReader();
      readerRef.current = reader;
      void readLoop(reader);
    }
    setConnected(true);
  };

  /** Let the cable go. The reader and the writer hold locks that make
   *  `close()` wait forever, so both are released first. Called before a
   *  second port is picked as well: two consoles on one page would each get
   *  half the lines, and a `Transport` opening a port this page still holds
   *  fails on a board that is perfectly fine. */
  const closeCable = useCallback(async (): Promise<void> => {
    const reader = readerRef.current;
    readerRef.current = null;
    const writer = writerRef.current;
    writerRef.current = null;
    const port = portRef.current;
    portRef.current = null;
    setConnected(false);
    if (port === null) return;
    try {
      await reader?.cancel();
      reader?.releaseLock();
      writer?.releaseLock();
      await port.close();
    } catch {
      // The cable is already out. What the page says about it is the answer.
    }
  }, []);

  /** One line down the cable. `false` when it did not go: the caller has to
   *  know, because a `configure` that was never written is a device holding a
   *  token that no longer works, and waiting for it is waiting for nothing. */
  const write = useCallback(
    async (text: string): Promise<boolean> => {
      const writer = writerRef.current;
      if (writer === null) return false;
      try {
        await writer.write(new TextEncoder().encode(text));
        return true;
      } catch {
        setCableError("The device stopped answering over USB.");
        // The cable is gone with it, so the page stops pretending to hold one:
        // connecting again is the way back, and it needs its button.
        void closeCable();
        return false;
      }
    },
    [closeCable],
  );

  /** Pick a cable and open the console on it. `false` when the browser's port
   *  picker was closed without picking one, which is not a failure. */
  const connectCable = async (): Promise<boolean> => {
    setCableError(null);
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      return false;
    }
    // Whatever was open goes first, this very port included: the browser hands
    // out the same port object twice, and opening it again would fail.
    await closeCable();
    try {
      await openConsole(port);
      return true;
    } catch (cause) {
      setCableError(
        `Could not open that port. ${errorMessage(cause, "Close anything else that is using it, then try again.")}`,
      );
      return false;
    }
  };

  // The port is this page's for as long as the page is here, and no longer.
  useEffect(() => {
    return () => {
      void closeCable();
    };
  }, [closeCable]);

  // One `hello` a second until the device answers, for ten seconds. Opening
  // the port asserts DTR and RTS on Windows, so the board may be rebooting
  // while the first ones go out. The poll is faster than the asking so the
  // giving up lands on time; the handshake itself holds the rate.
  useEffect(() => {
    if (!connected || hello !== null) return;
    const handshake = handshakeRef.current;
    // The interval's own id, in a box: `ask` both reads it and is what sets
    // it, the giving up having to stop the asking.
    const poll: { id?: ReturnType<typeof setInterval> } = {};
    const ask = (): void => {
      const now = Date.now();
      if (handshake.tick(now)) void write(buildCommand("hello"));
      if (handshake.timedOut(now)) {
        setCableError(
          "The device did not answer over USB. Unplug it, plug it back in, and connect again.",
        );
        if (poll.id !== undefined) clearInterval(poll.id);
        // The port goes with it, or the sentence above asks for something the
        // page does not offer: connecting again is what puts the button back.
        void closeCable();
      }
    };
    ask();
    poll.id = setInterval(ask, HELLO_INTERVAL_MS / 4);
    return () => {
      if (poll.id !== undefined) clearInterval(poll.id);
    };
  }, [connected, hello, closeCable, write]);

  /* -------------------------------------------------------------- the flash */

  const [flashed, setFlashed] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [flashNote, setFlashNote] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [written, setWritten] = useState(0);

  /** The bundled image as bytes. */
  const firmwareImage = async (file: string): Promise<Uint8Array> => {
    const answer = await getFirmwareImage({
      path: { file },
      parseAs: "arrayBuffer",
    });
    const data: unknown = answer.data;
    if (!(data instanceof ArrayBuffer))
      throw new Error("Wingman did not hand over the firmware image.");
    return new Uint8Array(data);
  };

  const flash = async (): Promise<void> => {
    if (build === null || flashing) return;
    setFlashError(null);
    setWritten(0);
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      // The picker was closed without picking a port. Nothing happened.
      return;
    }
    // The console this page may already hold is let go first. A `Transport`
    // opens the port itself, and the browser hands out the same port object
    // for the same board, so an open console would fail the flash instead.
    await closeCable();

    setFlashing(true);
    setFlashNote("Connecting to the board…");
    let transport: Transport | null = null;
    let talking = false;
    try {
      // Loaded here and nowhere else, so a phone that only reads the build
      // step never downloads the ESP flashing protocol. The type above is an
      // `import type`, which is erased and pulls nothing in.
      const esptool = await import("esptool-js");
      transport = new esptool.Transport(port);
      const loader = new esptool.ESPLoader({
        transport,
        baudrate: FLASH_BAUD_RATE,
        terminal: SILENT_TERMINAL,
      });
      await loader.main();
      talking = true;

      // The family, not the exact silicon: the manifest says "ESP32" and an
      // S3 or a C3 takes a different image at different offsets.
      const chip = loader.chip.CHIP_NAME;
      if (chip !== build.chip) {
        setFlashError(
          `This board reports ${chip}. The bundled firmware is for ${build.chip} boards, so Wingman is not writing it.`,
        );
        return;
      }

      setFlashNote("Downloading the firmware…");
      const image = await firmwareImage(build.file);
      setFlashNote("Writing the firmware…");
      await loader.writeFlash({
        fileArray: [{ data: image, address: FLASH_ADDRESS }],
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (_file, done, total) =>
          setWritten(total === 0 ? 0 : done / total),
      });
      setFlashNote("Restarting the board…");
      await loader.after("hard_reset");
      await transport.disconnect();
      transport = null;

      // The same cable, at the console's own rate. No second permission
      // prompt: it is the port this browser was already given.
      setFlashNote("Opening the console…");
      await openConsole(port);
      setFlashed(true);
      setFlashNote(null);
    } catch (cause) {
      setFlashError(
        talking
          ? `The firmware was not written. ${errorMessage(cause, "Unplug the board, plug it back in, and try again.")}`
          : "Could not talk to the board. Hold the BOOT button on the board while connecting, then let go.",
      );
    } finally {
      if (transport !== null) {
        try {
          await transport.disconnect();
        } catch {
          // The board is already gone; the sentence above is the answer.
        }
      }
      setFlashing(false);
    }
  };

  const skipFlashing = async (): Promise<void> => {
    if (await connectCable()) setFlashed(true);
  };

  /* ---------------------------------------------------------- the settings */

  const [name, setName] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  // `null` until it is typed in, so a join URL that arrives late still fills
  // the field and a host who cleared it keeps it clear.
  const [address, setAddress] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const suggested = serverAddress(join.data?.url);
  const serverUrl = address ?? suggested;

  const create = useMutation(createDeviceMutation());
  const rotate = useMutation(rotateDeviceTokenMutation());
  const sending = create.isPending || rotate.isPending;

  const configureLine = (token: string): string =>
    buildCommand("configure", {
      ssid: ssid.trim(),
      password,
      server_url: serverUrl.trim(),
      token,
    });

  const send = async (): Promise<void> => {
    if (sending) return;
    setSendError(null);
    setAccepted(false);
    // The lines from the last attempt go: the troubleshooting list points at
    // what the device said, and that has to be about this attempt.
    setLines([]);
    try {
      // A device that exists keeps its name and its mapping and takes a new
      // token; a new one is minted here, which is the only time a token is
      // readable at all. It is held in a ref and never drawn.
      const answer =
        deviceId === null
          ? await create.mutateAsync({ body: { name: name.trim() } })
          : await rotate.mutateAsync({ path: { device_id: deviceId } });
      tokenRef.current = answer.token;
      setDeviceId(answer.device.id);
      void queryClient.invalidateQueries({ queryKey: listDevicesQueryKey() });
      // Only a line that went out starts the waiting. A token is minted before
      // it is written, so a write that failed leaves a device holding one that
      // no longer works, and a minute spent blaming the Wi-Fi for that is a
      // minute wasted: `write` has already said what happened.
      if (await write(configureLine(answer.token))) setSentAt(Date.now());
    } catch (cause) {
      setSendError(errorMessage(cause, "Could not set up the device."));
    }
  };

  /** The same line again, with the token that was already minted: a second
   *  rotation would leave the device holding one that no longer works. */
  const resend = async (): Promise<void> => {
    const token = tokenRef.current;
    if (token === null) return;
    setAccepted(false);
    setLines([]);
    if (await write(configureLine(token))) setSentAt(Date.now());
  };

  const scan = (): void => {
    setNetworks(null);
    setScanning(true);
    void write(buildCommand("scan"));
  };

  /* ----------------------------------------------------------- the waiting */

  const online = device?.online === true;
  const [givenUp, setGivenUp] = useState(false);

  useEffect(() => {
    setGivenUp(false);
    if (sentAt === null || online) return;
    const timer = setTimeout(() => setGivenUp(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [sentAt, online]);

  /* --------------------------------------------------------- the discovery */

  const [readerOrder, setReaderOrder] = useState<number[]>([]);
  const [buttonOrder, setButtonOrder] = useState<number[]>([]);
  const baselineRef = useRef<Record<string, number>>({});
  const beforeRef = useRef<DeviceRead["readers"]>([]);
  const discoveringRef = useRef(false);

  // Opening the step is where a discovery starts: what is already lying on the
  // readers counts, and every button counts from the number it stands at now.
  useEffect(() => {
    if (step !== DISCOVER) {
      discoveringRef.current = false;
      return;
    }
    if (discoveringRef.current) return;
    discoveringRef.current = true;
    baselineRef.current = pressBaseline(device?.buttons ?? []);
    beforeRef.current = [];
    setReaderOrder([]);
    setButtonOrder([]);
  }, [step, device]);

  useEffect(() => {
    if (step !== DISCOVER || device === null) return;
    // Read out before the update is queued: a functional updater runs at the
    // next render, by which time the ref would already hold this report.
    const before = beforeRef.current;
    beforeRef.current = device.readers;
    setReaderOrder((order) => discoveredOrder(order, before, device.readers));
    setButtonOrder((order) =>
      pressedOrder(order, baselineRef.current, device.buttons),
    );
  }, [step, device]);

  /* --------------------------------------------------------- the mapping */

  const [roles, setRoles] = useState<Mapping>({});
  const [actions, setActions] = useState<Mapping>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const proposedRef = useRef(false);

  useEffect(() => {
    if (step !== MAP || proposedRef.current) return;
    proposedRef.current = true;
    setRoles(
      proposeRoles(
        readerOrder,
        palette.map((slot) => slot.name),
      ),
    );
    setActions(proposeActions(buttonOrder));
  }, [step, readerOrder, buttonOrder, palette]);

  // Leaving the Map step throws its proposal away. Going back is how a
  // discovery that came out in the wrong order is redone, and a proposal made
  // once would sit there over the new order — with a refusal about a mapping
  // nobody is looking at any more still on the screen.
  useEffect(() => {
    if (step !== MAP) return;
    return () => {
      proposedRef.current = false;
      setRefusal(null);
    };
  }, [step]);

  const readers = device?.readers ?? [];
  const buttons = device?.buttons ?? [];
  const roleOf = (index: number, stored: string): string =>
    roles[String(index)] ?? stored;

  const save = useMutation({
    ...updateDeviceMutation(),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: listDevicesQueryKey() });
      void navigate(`/user/devices/${encodeURIComponent(updated.id)}`);
    },
    onError: (cause) =>
      setRefusal(
        mappingRefusal(cause, readers, (reader) =>
          roleOf(reader.index, reader.role),
        ),
      ),
  });

  const saveMapping = (): void => {
    if (device === null || save.isPending) return;
    setRefusal(null);
    save.mutate({
      path: { device_id: device.id },
      body: {
        // The whole mapping, because the backend replaces the stored one with
        // what it is given: a body holding one row would clear the rest.
        reader_roles: Object.fromEntries(
          readers.map((reader) => [
            String(reader.index),
            roleOf(reader.index, reader.role),
          ]),
        ),
        button_actions: Object.fromEntries(
          buttons.map((button) => [
            String(button.index),
            actions[String(button.index)] ?? button.action,
          ]),
        ),
      },
    });
  };

  /* ------------------------------------------------------------ the walking */

  const named = reenteredId !== null || name.trim() !== "";
  const addressProblem = serverAddressProblem(serverUrl);
  const canSend =
    connected &&
    named &&
    ssid.trim() !== "" &&
    serverUrl.trim() !== "" &&
    addressProblem === null;

  const canGoOn =
    step === BUILD ||
    (step === FLASH && flashed) ||
    (step === CONFIGURE && accepted) ||
    (step === CONNECT && online) ||
    (step === DISCOVER && readerOrder.length > 0);

  const waitingNote =
    // Nothing on the flash step without a cable: the step is already one
    // sentence about opening the page somewhere else, and "flash the board"
    // under it would be an instruction the screen cannot carry out.
    step === FLASH && canFlash && !flashed
      ? "Flash the board, or skip it if it already runs the firmware."
      : step === CONFIGURE && !accepted
        ? "Send the settings to the device to go on."
        : step === CONNECT && !online
          ? "Waiting for the device to reach Wingman."
          : step === DISCOVER && readerOrder.length === 0
            ? "Put a card on a reader to go on."
            : null;

  /* ------------------------------------------------------------- the screen */

  const percent = Math.round(written * 100);
  const helloLine =
    hello === null
      ? null
      : [
          `Firmware ${hello.firmware}`,
          `protocol ${hello.protocol}`,
          hello.chip,
          hello.build === undefined ? null : `build ${hello.build}`,
        ]
          .filter((part) => part !== null)
          .join(" · ");

  return (
    <div className="devices-page">
      <PageHeader title="Set up a device" back="/user/devices" />

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && !allowed && (
        <p className="settings-notice">
          The player selector is set up by the host. Ask the host for access.
        </p>
      )}

      {allowed && (
        <>
          <ol className="setup-steps">
            {STEPS.map((label, index) => (
              <li
                key={label}
                className={
                  index === step ? "setup-step setup-step-here" : "setup-step"
                }
                aria-current={index === step ? "step" : undefined}
              >
                {label}
              </li>
            ))}
          </ol>

          {step === BUILD && (
            <>
              <h2>Build the box</h2>
              <p className="section-note">
                One ESP32 and up to six readers. The pins are fixed, so one
                firmware fits every build.
              </p>
              <ul className="setup-list">
                {PARTS.map((part) => (
                  <li key={part}>{part}</li>
                ))}
              </ul>

              <h2>Wiring</h2>
              <div className="setup-table-scroll">
                <table className="setup-table">
                  <thead>
                    <tr>
                      <th scope="col">Signal</th>
                      <th scope="col">Pin</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PINS.map((pin) => (
                      <tr key={pin.signal}>
                        <th scope="row">{pin.signal}</th>
                        <td className="setup-pins">{pin.gpio}</td>
                        <td>{pin.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* No link: the app knows no address for its own documentation
                  (`links.ts`), so the page names where the guide lives. */}
              <p className="section-note">
                The full build guide, with the parts and the traps, is in the
                Wingman documentation under Host, Player selector.
              </p>
            </>
          )}

          {step === FLASH && (
            <>
              <h2>Flash the firmware</h2>

              {!canFlash && (
                <p className="section-note">
                  {NEEDS_LOCALHOST} Open{" "}
                  <span className="setup-address">
                    {localhostSetupUrl(window.location.port)}
                  </span>{" "}
                  on the computer Wingman runs on, and come back to this step.
                </p>
              )}

              {canFlash && (
                <>
                  {firmware.isPending && <Loading />}

                  {firmware.isError && (
                    <p className="section-note">
                      This Wingman carries no firmware image. Install a build of
                      Wingman that has one, then come back. A board that already
                      runs the firmware can skip this step.
                    </p>
                  )}

                  {build !== null && manifest !== null && (
                    <>
                      <p className="section-note">
                        Firmware {manifest.version} for {build.chip} boards.
                        Plug the board in with a USB cable, then pick its port.
                      </p>

                      {flashError !== null && (
                        <p className="error-notice devices-notice" role="alert">
                          {flashError}
                        </p>
                      )}

                      <div className="setup-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={flashing}
                          onClick={() => void flash()}
                        >
                          Connect and flash
                        </button>
                      </div>

                      {flashing && (
                        <div className="setup-progress">
                          <p className="section-note" role="status">
                            {flashNote}
                          </p>
                          <div className="setup-bar">
                            <span
                              className="setup-bar-track"
                              aria-hidden="true"
                            >
                              <span style={{ width: `${percent}%` }} />
                            </span>
                            <span className="setup-bar-label">{percent}%</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Outside the manifest: a board that already runs the
                      firmware skips this step whether Wingman carries an
                      image or not. */}
                  {!flashing && (
                    <p className="setup-skip">
                      <button
                        type="button"
                        className="setup-quiet"
                        onClick={() => void skipFlashing()}
                      >
                        Skip flashing
                      </button>{" "}
                      if this board already runs the firmware.
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {step === CONFIGURE && (
            <>
              <h2>Wi-Fi and Wingman</h2>

              {!canFlash && <p className="section-note">{NEEDS_LOCALHOST}</p>}

              {canFlash && !connected && (
                <>
                  <p className="section-note">
                    Plug the board in with a USB cable, then pick its port.
                  </p>
                  <div className="setup-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => void connectCable()}
                    >
                      Connect the device
                    </button>
                  </div>
                </>
              )}

              {connected && (
                <>
                  {reenteredId === null && (
                    <label className="device-field">
                      <span>Name</span>
                      <input
                        className="text-input text-input-quiet"
                        value={name}
                        maxLength={64}
                        placeholder="The box by the TV"
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                  )}

                  <label className="device-field">
                    <span>Network</span>
                    <input
                      className="text-input text-input-quiet"
                      value={ssid}
                      maxLength={32}
                      onChange={(event) => setSsid(event.target.value)}
                    />
                  </label>

                  <div className="device-field">
                    <label htmlFor="setup-networks">
                      <span>Networks the device can see</span>
                    </label>
                    <div className="setup-scan">
                      <select
                        className="text-input text-input-quiet setup-networks"
                        id="setup-networks"
                        value=""
                        disabled={networks === null || networks.length === 0}
                        onChange={(event) => setSsid(event.target.value)}
                      >
                        <option value="">
                          {networks === null
                            ? "Not scanned yet"
                            : networks.length === 0
                              ? "Nothing found"
                              : "Pick a network"}
                        </option>
                        {[...(networks ?? [])]
                          .sort((left, right) => right.rssi - left.rssi)
                          .map((network) => (
                            <option key={network.ssid} value={network.ssid}>
                              {network.ssid}
                              {network.secure ? " (secured)" : " (open)"}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="button"
                        disabled={scanning}
                        onClick={scan}
                      >
                        {scanning ? "Scanning…" : "Scan"}
                      </button>
                    </div>
                  </div>

                  <label className="device-field">
                    <span>Password</span>
                    <input
                      className="text-input text-input-quiet"
                      type="password"
                      value={password}
                      maxLength={63}
                      autoComplete="off"
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <p className="section-note">
                    Leave the password empty for an open network. The ESP32
                    joins 2.4 GHz networks only.
                  </p>

                  <label className="device-field">
                    <span>Wingman address</span>
                    <input
                      className="text-input text-input-quiet"
                      value={serverUrl}
                      // The firmware keeps the whole report URL in 192 bytes,
                      // the route's own path included; a longer address would be
                      // cut short on the device and never reach Wingman.
                      maxLength={160}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                  </label>
                  {addressProblem !== null ? (
                    <p className="section-note">{addressProblem}</p>
                  ) : (
                    suggested === "" && (
                      <p className="section-note">{SERVER_ADDRESS_NOTE}</p>
                    )
                  )}

                  {sendError !== null && (
                    <p className="error-notice devices-notice" role="alert">
                      {sendError}
                    </p>
                  )}

                  <div className="setup-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={!canSend || sending}
                      onClick={() => void send()}
                    >
                      Send to the device
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {step === CONNECT && (
            <>
              <h2>The first report</h2>
              {online ? (
                <p className="section-note">The device reached Wingman.</p>
              ) : (
                <p className="section-note">
                  The device is joining the network and saying hello. This takes
                  a few seconds.
                </p>
              )}

              {givenUp && !online && (
                <>
                  <p className="section-note">
                    Nothing has arrived for a minute. Check these:
                  </p>
                  <ul className="setup-list">
                    <li>The Wi-Fi password, spelled exactly.</li>
                    <li>
                      A 2.4 GHz network. The ESP32 does not see 5 GHz networks.
                    </li>
                    <li>
                      The Wingman address, reachable from the network the phones
                      are on.
                    </li>
                    <li>
                      The firewall on this computer, on the port Wingman uses.
                    </li>
                    <li>The lines the device printed above.</li>
                  </ul>
                  <div className="setup-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={tokenRef.current === null}
                      onClick={() => void resend()}
                    >
                      Try again
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {step === DISCOVER && (
            <>
              <h2>Find the readers</h2>
              <p className="section-note">
                Put a card on each reader, in the order of your slots.
              </p>

              {readers.length === 0 ? (
                <p className="section-note devices-empty">
                  This device has not said what it is wired to yet.
                </p>
              ) : (
                <ul className="device-rows">
                  {readers.map((reader) => {
                    const place = readerOrder.indexOf(reader.index);
                    return (
                      <li key={reader.index}>
                        <div className="device-row">
                          <span className="device-position">
                            Reader {reader.index + 1}
                          </span>
                          <span className="device-state">
                            {reader.state === "fault" ? (
                              <span className="device-fault">{FAULT_NOTE}</span>
                            ) : reader.state === "none" ? (
                              <span className="device-off">not wired</span>
                            ) : place >= 0 ? (
                              <>
                                {reader.player !== undefined &&
                                  reader.player !== null && (
                                    <PlayerAvatar player={reader.player} />
                                  )}
                                <span className="setup-found">
                                  {foundLabel(place)}
                                </span>
                              </>
                            ) : (
                              <span className="device-off">
                                waiting for a card
                              </span>
                            )}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <h2>Find the buttons</h2>
              <p className="section-note">Press every button once.</p>

              {buttons.length === 0 ? (
                <p className="section-note devices-empty">
                  This device has no button wired.
                </p>
              ) : (
                <ul className="device-rows">
                  {buttons.map((button) => (
                    <li key={button.index}>
                      <div className="device-row">
                        <span className="device-position">
                          Button {button.index + 1}
                        </span>
                        <span className="device-state">
                          {buttonOrder.includes(button.index) ? (
                            <span className="setup-found">
                              {foundLabel(buttonOrder.indexOf(button.index))}
                            </span>
                          ) : (
                            <span className="device-off">not pressed yet</span>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {step === MAP && (
            <>
              <h2>What everything does</h2>
              <p className="section-note">
                This is what the discovery found. Change anything that is not
                right.
              </p>

              {refusal !== null && (
                <p className="error-notice devices-notice" role="alert">
                  {refusal}
                </p>
              )}

              <ul className="device-rows">
                {readers.map((reader) => (
                  <li key={reader.index}>
                    <div className="device-row">
                      <span className="device-position">
                        Reader {reader.index + 1}
                      </span>
                      <span className="device-state">
                        {reader.state === "wired" ? (
                          readerOrder.includes(reader.index) ? (
                            <span className="setup-found">
                              {foundLabel(readerOrder.indexOf(reader.index))}
                            </span>
                          ) : (
                            <span className="device-off">no card seen</span>
                          )
                        ) : (
                          <span className="device-off">not wired</span>
                        )}
                      </span>
                      <RoleSelect
                        className="text-input text-input-quiet device-select"
                        label={`Reader ${reader.index + 1} role`}
                        slots={palette}
                        value={roleOf(reader.index, reader.role)}
                        disabled={reader.state !== "wired" || save.isPending}
                        onChange={(role) => {
                          setRefusal(null);
                          setRoles((old) => ({
                            ...old,
                            [String(reader.index)]: role,
                          }));
                        }}
                      />
                    </div>
                  </li>
                ))}
                {buttons.map((button) => (
                  <li key={`button-${button.index}`}>
                    <div className="device-row">
                      <span className="device-position">
                        Button {button.index + 1}
                      </span>
                      <span className="device-state" />
                      <select
                        className="text-input text-input-quiet device-select"
                        aria-label={`Button ${button.index + 1} action`}
                        value={actions[String(button.index)] ?? button.action}
                        disabled={save.isPending}
                        onChange={(event) => {
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

              <div className="setup-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={device === null || save.isPending}
                  onClick={saveMapping}
                >
                  Save
                </button>
              </div>
            </>
          )}

          {/* The cable, under whatever step is on screen: what the device is
              and what it is saying, from the moment there is a console. */}
          {(connected || lines.length > 0 || cableError !== null) && (
            <div className="setup-cable">
              {helloLine !== null && (
                <p className="section-note">{helloLine}</p>
              )}
              {cableError !== null && (
                <p className="error-notice devices-notice" role="alert">
                  {cableError}
                </p>
              )}
              {lines.length > 0 && (
                <ul className="setup-lines" aria-live="polite">
                  {lines.map((line, index) => (
                    <li key={`${String(index)}-${line}`}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* The last step has Save as its one primary, so it keeps Back alone:
              the discovery is one step behind it and a reader found in the
              wrong order is fixed there, not by starting over. */}
          <div className="setup-walk">
            {waitingNote !== null && (
              <p className="section-note" role="status">
                {waitingNote}
              </p>
            )}
            <div className="setup-actions">
              <button
                type="button"
                className="button"
                disabled={step === BUILD}
                onClick={() => setStep((old) => Math.max(BUILD, old - 1))}
              >
                Back
              </button>
              {step !== MAP && (
                <button
                  type="button"
                  className={
                    step === FLASH || step === CONFIGURE
                      ? "button"
                      : "button button-primary"
                  }
                  disabled={!canGoOn}
                  onClick={() => setStep((old) => Math.min(MAP, old + 1))}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
