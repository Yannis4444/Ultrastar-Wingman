"""The player selector devices: what stands in the room and says who is singing.

An ESP32 with RFID readers and buttons posts a snapshot of its state every few seconds
(`protocol.py`, `POST /devices/report`). This module keeps the rows, the card table and the
live state, and turns the difference between two reports into the calls
`karaoke.selection` understands. The design is `docs/dev/player-selector.md`.
"""
