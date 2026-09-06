# Cards and players

A card stands for one singer. While it lies on the device, Wingman picks that
singer for the next song. **User** > **Player selector** is where you say which
card belongs to whom. The host reaches the same page from **Manage** on the host
screen.

The page opens for whoever may set the player selector up, which is Admin by
default. See [Roles and permissions](../people/roles.md).

## Give a card to a singer

The device has to be connected for this. **On the readers now** lists what is
lying on a box that is talking to Wingman, and nothing else.

1. Put the card on a reader.
2. Open **User** > **Player selector**.
3. Find the card under **On the readers now**. A card nobody has claimed reads
   **Unknown card**, with its number under the name.
4. Tap the row. The **Who holds this card?** picker opens.
5. Tap the singer. The picker closes and the card is theirs.

The page says the same thing over the list: *Tap a card to say whose it is. A
card belongs to one singer.*

Under **All cards** you get everything Wingman knows, one row per card. A singer
may have several cards, so a fob on a keyring and a card in a wallet both work
for the same person. Tap a card under **On the readers now** again to hand it to
somebody else.

## Take a card back

1. Find the card under **All cards**.
2. Tap :wingman-close: **Forget card**.
3. Confirm **Forget this card?** with **Forget**.

The dialog names the singer the card stops being, and adds: *Their scores and
their player stay exactly as they are.* Only the card goes.

## A card Wingman does not know

A card with no singer still fills a slot. During player selection the slot reads
*Unknown card*, on the phone and on the TV. Nobody is scored for it, so the song
does not start on its own while a slot reads that.

Give the card a name under **On the readers now**, then take it off the reader
and put it back. The slot fills with the singer.

## Start the song on its own

Turn on **Start the song on its own** to let the room start a song without
touching anything. Its line says: *When every slot holds a known singer, the
song starts after the delay below.*

**Delay before the song starts** is that delay, in seconds, from 0 to 30. Its
line says why it exists: *Time to take a wrong card away.* The countdown ends
the moment a card leaves a slot, and it runs again once the slots are full.

## Scanning a card again removes the singer

Turn on **Scanning a card again removes the singer** for a box where everybody
scans at one reader in turn. Its line says: *For a device with one reader that
everybody scans in turn.* A singer who is already on a slot leaves it when they
scan a second time.

With it off, a second scan does nothing at all. The setting has nothing to say
about a device that gives each slot its own reader.

!!! note
    Cheap batches of cards sometimes repeat a number, and two cards with the
    same number are one card to Wingman. A phone cannot stand in for a card
    either. Both are in [Build the device](build.md).
