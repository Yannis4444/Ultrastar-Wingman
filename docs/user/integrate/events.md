# Live events

Wingman pushes what happens at the party to every connected client over one
WebSocket. An overlay listens instead of polling.

## The socket

```text
ws://localhost:8080/api/v1/ws
```

The socket is open to anonymous clients, because a guest phone has to stay live
too. It takes no capability and needs no cookie. Nothing secret goes over it. A
secret setting arrives with its value as `null`.

The first message after the socket opens is `server.ready`, and only your own
client gets it. Everything after that is a broadcast.

Traffic goes one way, from the server to the client. Whatever a client sends is
dropped, and there is no reply to it.

Nothing is replayed. A client that reconnects has missed whatever went past
while it was away, so fetch the lists it draws again once `server.ready`
arrives.

## The message

Every message is one JSON object. The `event` field names the event, and the
other fields are its payload.

```json
{"event": "wishlist.updated", "song_id": "local:10ffd97ea6024b4caf6af5c907cd42c1", "count": 2, "latest": "2026-09-03T03:00:25.724880Z"}
```

Where a payload field carries a whole object, that object is the one the REST
API answers with. The OpenAPI document at
`http://localhost:8080/api/v1/openapi.json` spells out every field of it.

## Every event

| Event | When it fires | Payload |
|---|---|---|
| `server.ready` | Your own socket opened | `version`, the version of the running app |
| `setting.changed` | A setting was changed or reset | `key`, and `value` as text, a number, or true or false. `null` for a secret |
| `songs.scan_started` | A library scan started | None |
| `songs.scan_finished` | The scan ended, and also when it failed | `added`, `removed`, `updated`, `total`, all whole numbers |
| `songs.deleted` | A song was deleted, its folder included | `song_id` |
| `songs.updated` | A song's metadata was corrected | `song`, the whole song as `GET /songs` returns one |
| `download.updated` | A download changed state, and while it runs, its progress | `download`, the whole download as `GET /downloads` returns one |
| `selection.changed` | Somebody started picking singers for a song, moved one, spun the reel on the host screen again or showed its result early, moved on from the reel to the singers, or finished picking | `selection`, the song with its colored slots and who stands on them, plus `spin` when the reel on the host screen picked the song: its number, when it started, what it picked from, `origin` (`phone` or `device`, who spun it), and `revealed` (true once a press showed the result before the reel landed). `null` when nobody is picking |
| `karaoke.started` | A song started playing | `sing`: its id, the song, the time it started, and the singers in their microphone slots |
| `karaoke.ended` | The running song stopped | `sing_id`, `song_id` |
| `scores.recorded` | Right after `karaoke.ended`, and only when Ultrastar Deluxe scored something | `sing_id`, and `scores`, one entry per singer with the number and the player |
| `music.changed` | The background music moved to another song, was paused or played again, lost or gained the screen that makes the sound, was blocked by Ultrastar Deluxe, or had one of its options changed. Also when the song being picked starts or stops playing on the host screen: a new selection, a respin, or the result shown early, but never a singer moved | `music`, the whole state as `GET /music` returns it. A plain progress report from the playing screen is never broadcast |
| `scores.changed` | A recorded score was put on another player, or taken off the record | `sing_id` |
| `sessions.changed` | A party was named, taken off the list on the Scores tab, or put back | None. Fetch `GET /stats/sessions` again |
| `players.changed` | A player was added, hidden or put back, deleted, or given a new picture, or an account that sings as one was created or deleted | None. Fetch `GET /players` again |
| `achievements.earned` | A finished sing earned somebody a badge | `sing_id`, and `players`, one entry per player with the badges they earned |
| `achievements.changed` | The catalog of achievements itself changed | None. Fetch `GET /achievements` again |
| `wishlist.updated` | A song's wish count changed | `song_id`, `count`, and `latest`, the time of the newest wish or `null` |
| `playlists.changed` | A playlist was created, changed, shared, followed, copied, or deleted | `playlist_id`, or `null` when several changed at once |
| `tags.changed` | A tag was created, edited, deleted, or had its permissions replaced | None. Fetch `GET /tags` again |
| `song_tags.changed` | A tag was put on a song, or taken off one | `song_id`, `tag_id` |
| `comments.changed` | Somebody commented on a song, took a comment back, or a moderator removed one | `song_id`, `count` |
| `devices.changed` | A player selector was added, mapped, or forgotten, a card was given to somebody, a selector option changed, or a device came online, went quiet, or moved a card | None. Fetch `GET /devices` again |

An event with no payload, and one that carries ids only, is deliberate. What a
client may see of the tags, the playlists, and the achievements depends on who
that client is, and the socket does not know. Fetch the list again and Wingman
answers for whoever asks.

!!! example "A bot that posts every new wish"
    A few lines in a browser are enough to follow the party live.

    ```javascript
    const socket = new WebSocket("ws://localhost:8080/api/v1/ws");

    socket.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.event === "wishlist.updated") {
        console.log(`${event.song_id} now has ${event.count} wishes`);
      }
    };
    ```

    The song id is all the event carries. Ask `GET /api/v1/songs/{song_id}` for
    the title and the artist to put in the message.
