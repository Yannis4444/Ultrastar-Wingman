# Set up the device

Setup turns the box you built into a device Wingman talks to. A wizard walks you
through six screens: **Build**, **Flash**, **Configure**, **Connect**,
**Discover**, and **Map**. You go through it once per box, with a USB cable.

## Before you start

- The device from [Build the device](build.md), wired and switched on.
- A USB cable from the board to the karaoke PC.
- Chrome or Edge on that PC. Firefox 151 and later work as well. Safari hands a
  page no USB cable at all, so it cannot do this.
- The name and password of a 2.4 GHz Wi-Fi network, the one the phones are on.

Do all of it on the karaoke PC itself, at
`http://localhost:8080/user/devices/new`. A browser hands the USB cable only to
a page opened at `localhost`. The same page opened at your PC's network address
gets no cable, and the flash screen says so. A Wingman on another port keeps
that port in the address.

To find the wizard in the app, open **User** > **Player selector** and click
:wingman-plus: **Set up a device**. The host reaches the same page from
**Manage** on the host screen. Setting a device up is an administrator's right.

## Check the build

The first screen lists the parts and repeats the pin table from the build page.
Nothing here talks to the board.

1. Compare your wiring with the **Signal** and **Pin** columns.
2. Click **Next**.

## Flash the firmware

Wingman carries the firmware image, so nothing has to be installed on the board
beforehand.

1. Plug the board into the PC.
2. Click **Connect and flash**.
3. Pick the board's port in the browser's list.

The screen names each stage and draws a bar in percent: connecting,
downloading, writing, restarting. When the bar is full, Wingman restarts the
board and listens on the same cable. **Next** goes live.

For a board that already runs the firmware, click **Skip flashing** and pick its
port. That opens the same cable without writing anything.

Three things go wrong here, and each says so in one sentence.

- *Could not talk to the board.* Hold the BOOT button on the board while you
  click **Connect and flash**, then let go.
- *This board reports ...* The image fits one chip family, and Wingman refuses
  to write it to another. Take an ESP32-WROOM-32 board.
- *This Wingman carries no firmware image.* This build of Wingman ships without
  one. Flash the board yourself, then use **Skip flashing**.

## Give it the network and the address

If the wizard holds no cable yet, click **Connect the device** and pick the
board's port.

1. Type a **Name** for the box, such as the box by the TV.
2. Click **Scan**, then pick yours under **Networks the device can see**.
   Typing it into **Network** does the same.
3. Type the Wi-Fi **Password**. Leave it empty for an open network.
4. Check **Wingman address**. It has to be the address the phones use.
5. Click **Send to the device**.

**Wingman address** arrives prefilled from the address Wingman gives guests.
Where Wingman has not worked one out, the field is empty and asks you to type
one, such as `http://192.168.0.5:8080`. An address at `localhost` is refused
while you type it. That word is this PC's own name for itself, and the box
across the room reaches nothing at it.

The device answers over the cable, a line at a time: *Connecting to Wi-Fi*,
*Connected, address 192.168.0.42.*, *Reached Wingman.* Once it has taken the
settings, **Next** goes live.

## Wait for the first report

The screen says *The device is joining the network and saying hello. This takes
a few seconds.* It becomes *The device reached Wingman.* the moment the box
reports in, and **Next** goes live with it.

After a minute of silence, the screen lists what to check:

- The Wi-Fi password, spelled exactly.
- A 2.4 GHz network. The ESP32 does not see 5 GHz networks.
- The Wingman address, reachable from the network the phones are on.
- The firewall on this computer, on the port Wingman uses.
- The lines the device printed above.

**Try again** sends the same settings down the cable once more.

## Find the readers and the buttons

This screen watches the device while you touch it. The order you work in is the
order the last screen proposes, so go along your slots.

1. Put a card on each reader, in the order of your slots.
2. Press every button once.

A reader says *waiting for a card* until one lands on it, then *found first*,
*found second*, and so on. A reader with nothing on its pins says *not wired*.
A button says *not pressed yet* until you press it.

A reader that answers with garbage says so instead. That is the shared line the
build page warns about under known trouble. Fix the wiring, or set that reader
to **Not used** on the next screen.

## Say what everything does

The last screen proposes a mapping out of what you did.

- Where one reader saw a card, it gets **Everybody in turn**, the layout where
  the singers line up at one reader.
- Where several did, they take your slot colors in the order the cards landed.
  A reader past the last color gets **Not used**.
- The first three buttons get **Start the song**, **Clear the slots**, and
  **Cancel the selection**. A fourth gets **Nothing**.

1. Change any reader whose color is wrong.
2. Change any button whose action is wrong.
3. Click **Save**.

Wingman opens the device page, and the box is ready for the evening. Two readers
on one color are refused with *Two readers have the same color*. Change one of
them and save again.

A reader that landed in the wrong place is put right here, on its own select.
Going back a screen and scanning the cards again leaves the proposal as it
stands.

## Setting it up again later

Open **User** > **Player selector** and click the box. Its page carries two
buttons back into the wizard. Both want the USB cable and the `localhost` page
again.

- **Update firmware** starts at the flash screen. It asks for the network and
  the address again afterward, so have the Wi-Fi password ready.
- **Change Wi-Fi or server** starts at the network screen. The name, the cards,
  and the mapping stay as they are.

:wingman-plus: **Set up a device** is for a second box. It always adds one, so a
box that is already set up goes through its own page instead.
