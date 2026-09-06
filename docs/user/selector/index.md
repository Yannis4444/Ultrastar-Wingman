---
icon: wingman/users
---

# Player selector

The player selector is a box that stands in the room, with a colored slot for
each microphone. A singer puts their card on a slot, and Wingman picks them for
the next song. You build it yourself out of an ESP32 board, up to six RFID
readers, and up to four buttons.

An evening with it runs like this: the cards go down, somebody picks a song, and
the TV shows the slots filling up. The song starts on a button at the device, or
on its own once every slot is filled.

## The pages in this section

- [Build the device](build.md): the parts, the wiring, the two reader layouts,
  and the hardware that gives trouble.
- Set up the device: flash the firmware, give it your Wi-Fi and the karaoke
  PC's address, then map its readers onto your slots.
- [Cards and players](cards.md): which card belongs to whom, several cards per
  person, and what happens with a card Wingman does not know.
