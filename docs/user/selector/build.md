# Build the device

The player selector is an ESP32 board with an RFID reader under each slot. This
page is what to buy and how to wire it. Everything after the wiring happens in
the browser, on the karaoke PC.

## What you need

- An ESP32 DevKitC board, the ESP32-WROOM-32 kind with 30 or 38 pins. Two of the
  reader pins are missing on a WROVER board, so take a WROOM.
- Up to six RC522 reader modules, one per slot.
- Up to four push buttons.
- A 5 V power supply of at least 1 A.
- Jumper wires, and something to mount it all on.
- MIFARE Classic cards or fobs, one per singer. The card and the fob that come
  with an RC522 kit are the right kind.

## Wire it

The pin map is fixed, so one firmware fits every build. Wire as many readers and
buttons as you want, starting at reader 1. The board checks every position when
it starts, and the setup in the browser shows you what it found.

1. Connect SCK, MISO, and MOSI of every reader to GPIO 18, 19, and 23.
2. Connect each reader's SDA pin to its own pin from the table below. That pin
   is what gives the reader its number.
3. Connect every reader's RST pin to 3.3 V, and leave IRQ unconnected.
4. Wire each button between its own pin and GND.
5. Feed 5 V into VIN, and the supply's GND into GND.

| Signal | Board pin | Note |
|---|---|---|
| SCK, on every reader | GPIO 18 | All readers share these three lines |
| MISO, on every reader | GPIO 19 | |
| MOSI, on every reader | GPIO 23 | |
| SDA, reader 1 | GPIO 5 | The SDA pin is what gives a reader its number |
| SDA, reader 2 | GPIO 17 | |
| SDA, reader 3 | GPIO 16 | |
| SDA, reader 4 | GPIO 4 | |
| SDA, reader 5 | GPIO 21 | |
| SDA, reader 6 | GPIO 22 | |
| RST, on every reader | 3.3 V | The board resets the readers over SPI, so RST needs no pin of its own |
| IRQ, on every reader | Not connected | The board asks the readers itself, which is how it sees a card leave |
| 3.3 V and GND, on every reader | 3.3 V and GND | |
| Button 1 | GPIO 32 | The other leg of every button goes to GND |
| Button 2 | GPIO 33 | |
| Button 3 | GPIO 25 | |
| Button 4 | GPIO 26 | |
| Power | VIN and GND | 5 V from the supply |

!!! warning
    Putting 5 V on a reader's power pin destroys the module. An RC522 runs on
    3.3 V, so the 5 V from your supply goes to VIN on the board and nowhere
    else.

## Pick a layout

The readers can stand in the room two ways, and you choose which during setup.

**One reader per slot.** Each reader gets a microphone color. A card lying on
that reader is the singer on that slot. This is the layout the colored slots are
drawn for, and it wants one reader per microphone.

**One reader, everybody in turn.** A single reader takes every card, and each
scan fills the next free slot. One module is the cheapest build there is, and
the singers line up at it.

Either way, the numbers in the table are the numbers you map later. Reader 1 is
the module on GPIO 5, whatever it ends up standing under. Write the number on
the module before you close the case.

## Power

Six readers and the Wi-Fi radio together draw about 400 mA, and a USB port on a
laptop is not a reliable 1 A. Give the box its own supply on VIN. A board that
resets when a card lands on the sixth reader is a board that is short of power.

## Lights

A strip of lights is optional. The device works the same without one.

Use a WS2812 strip, sold as NeoPixel, with one light per reader in reader
order: light 1 sits beside reader 1. Its data pin goes to GPIO 13, and its 5 V
and ground go to the same supply and ground as the board.

| The light | Means |
|---|---|
| A slot color, dim | Nothing is on that slot's reader |
| A slot color, steady | A card Wingman knows is on it |
| A slot color, blinking | A card nobody has claimed is on it |
| Every slot color, pulsing | The song is about to start by itself |
| White, dim | The reader everybody scans in turn is waiting |
| White, pulsing | Singers are being picked. Scan now |
| Off | The reader is not mapped, or a song is playing |

## Known trouble

**Readers that work alone but fail together.** Cheap RC522 clones hold the
shared MISO line even while another reader is being read. A build that worked
with one reader answers with garbage once there are three. The board reads each
module's chip version twice when it starts and calls a disagreement a fault.
Setup then tells you which reader it is. Two things fix it. One is a 74HC125
buffer chip in each reader's MISO line. The other is modules whose chip answers
with version 0x91 or 0x92 (the `VersionReg` byte).

**Two cards on one reader.** Two cards in the same field answer over each other,
and the reader can read neither. The board treats that as something lying there
rather than as an empty slot, so the slot keeps whoever was on it. One card per
reader.

**Cards that share a number.** A card is identified by the number burned into
it, and cheap batches sometimes repeat one. Two cards with the same number are
one card to Wingman, so both put the same person on a slot.

**A phone is not a card.** A phone cannot pretend to be a card with a fixed
number, so a card is what a singer carries.
