# Tags

A tag is a label the whole party shares. Wishes and favorites belong to one
person; a tag belongs to the song. Put **broken** on the file that never plays,
**duet** on the ones that need two microphones, **archive** on the ones nobody
should stumble over — and decide, per tag, who is allowed to know it exists.

Setting tags up needs the right to manage tags, which **trusted** and **admin**
hold by default. Everybody else only ever sees the result.

## The tag you already have

Wingman starts with one, and it is an ordinary tag: rename it, recolour it, or
delete it.

| Tag | What it does |
|---|---|
| **broken** | For a song that does not work — the audio is missing, the timing is wrong. Only **trusted** and **admin** can see it, and a song marked broken is invisible to everybody else. |

Everything else is yours to invent. A good second one is an **archive**: a tag
everybody can see, with *Hide songs by default* on, for the songs that should
not clutter the list without leaving the library. *Create a tag*, further down,
makes exactly that.

## Who sees what

Every tag carries three separate rights. They are the whole point of tags, so
they are worth reading slowly.

| Right | What it means |
|---|---|
| **See tag** | The tag exists for that person. They can filter on it, and they see it on a song. |
| **See songs** | They may see the songs carrying the tag **at all**. |
| **Tag songs** | They may put the tag on a song and take it off again. |

**See songs** is the one with teeth. Take it away, and every song wearing that
tag disappears for that person — out of the song list, out of the search, out of
the random reel. That is how **broken** works: nobody granted *See songs* on it
ever meets a broken song.

The other two are quieter. *See tag* only decides whether the tag is offered as
something to look at. *Tag songs* is the right to change what is tagged, and it
only works alongside *See tag* — you cannot set a label you are not allowed to
know about.

!!! note
    Administrators are never in the table. They see every tag and every song, so
    no combination of ticks can hide anything from the host.

Taking *See tag* away from yourself is safe: **User → Tags** lists every tag to
everybody who may manage tags, whether they may see it or not, so you can always
tick it back on. What you do lose is the tag itself — it leaves your song list,
your song details and your filter, and you can no longer put it on a song.

## Create a tag

1. Open **User → Tags**. The page lists every tag, with how many songs carry it.
2. Press **+** in the top right.
3. Give it a **name** (up to 32 characters) and, if you like, an **icon** — the
   picker offers the ones that say something about a song — and one of the four
   **colours**. The icon and the colour are how the tag is recognised at a
   glance, so pick something that is not already in use.
4. Decide the two options below (next section).
5. Tick who it is for, in the table of **guest**, **user** and **trusted** — and,
   under **Specific people**, search for an account to give one person more than
   their role has.
6. **Save**.

A brand-new tag starts out open: everybody can see it and its songs, and
**trusted** accounts may set it. That is the archive above, one tick away — turn
*Hide songs by default* on and you have it. Change the ticks before you save if
the tag is meant to be private instead.

Two sentences may appear under the table while you are ticking. They are
warnings, not refusals — Wingman will save either way:

- **Tag songs without See songs.** That person would tag a song and watch it
  vanish, with no way to undo it. Tick *See songs* as well.
- **See tag without See songs.** The tag is offered but none of its songs are, so
  its filter is always empty.

## The two options

**Show in song list** puts the tag's icon on every song that carries it, in the
song list, beside the favorite heart. Use it for something worth spotting while
scrolling — leave it off for a tag half the library would end up with, or the
rows fill with icons.

**Hide songs by default** keeps those songs out of the song list and out of the
random reel's *All songs* until somebody asks for them in the filter — a wished
song can still win the reel. It is a default, not a lock: everybody who may see
the tag can still bring the songs back. To really hide songs from somebody,
take *See songs* away from them instead.

## Change or delete a tag

Tap a tag on **User → Tags** to open it again. Everything is editable, the
permissions included; **Save** sends only what you changed.

**Delete tag** at the foot removes the tag from every song that carries it and
from everybody it was granted to. The songs themselves stay in the library —
only the label goes.

## Built-in marks and facets

Eight rows were there before you made a single tag. Under **Built-in**, at the
foot of **User → Tags**, they sit in rows that look exactly like a tag's — and
they are not tags. Nobody puts them on a song: two of them say something about
*you*, and the other six are what the song file already says about itself. Tap
one to open it, the same as a tag.

| Built-in | What it is | What you can change |
|---|---|---|
| **Favorites** (heart) | The songs you favorited — yours alone. | Colour · Show in song list |
| **Sung** (microphone) | The songs you have sung — yours alone. | Colour · Show in song list |
| **Duet** (two people) | The file is written for two singers. | Colour · Show in song list · Show in filter |
| **Video** (film camera) | The song folder has a video beside the audio. | Colour · Show in song list · Show in filter |
| **Genre** (note) | The `#GENRE` line of the file. | Show in filter |
| **Language** (flag) | The `#LANGUAGE` line. | Show in filter |
| **Edition** (disc) | The `#EDITION` line — which SingStar or karaoke set it came from. | Show in filter |
| **Decade** (calendar) | The `#YEAR` line, rounded down: 1985 is the **1980s**. | Show in filter |

That is why their rows say "per person" or "from the file" where a tag's row
counts songs. A mark's count would be a different number for every reader, and a
facet's would be one number per value.

**The two marks** — Favorites and Sung — have the two options a tag has:

- **Colour** — one of the four a tag may wear. The heart starts pink and the
  microphone blue.
- **Show in song list** — whether the mark goes on the song rows at all. Turn it
  off and the rows lose it; the **Favorites** and **Sung** chips above the list
  and their rows in the **Filter** panel stay exactly where they were.

The colour follows the mark everywhere it is drawn: the song rows, the chip on
the **Songs** page and the row in the **Filter** panel. The heart and microphone
*buttons* — in the song's own view and on the home screen — keep their own
colours. Those are switches you press, not marks you read.

**Duet and Video** are the same two options plus one more, **Show in filter**.
They start **off** the song rows: half a library is a duet, and a mark most songs
would wear says nothing at a glance. Turn *Show in song list* on and every duet —
or every song with a video — wears the icon after the microphone and the heart,
in the colour you picked. Turn *Show in filter* off and the row leaves the
**Filter** panel; nobody can filter by it any more.

**Genre, Language, Edition and Decade** have **Show in filter** and nothing
else. There is no colour, because there is no mark: a value nearly every song
has belongs in the song's own **Details**, not on the row (that is where you
read it — the song's view lists language, genre, year and edition). Their values
are not something anybody types here either; they come out of the song files, so
the **Filter** panel offers exactly what your library holds. Add a Schlager song
and *Schlager* appears in the Genre list on its own.

A song whose file says nothing — no genre, no year — is in no value at all. It
shows up while the row is on *Any* and disappears the moment you pick one; there
is no "No genre" option to ask for, because a gap in the metadata is not a genre.

Nothing else about any of the eight can be changed, and it is the same reason
each time: there is no name (the app calls them what they are), no icon, no
hiding songs, nobody to grant them to (everybody sees the same facts), and no
**Delete tag** — a built-in is not a row you made. Whoever may manage tags may
change these settings, for everyone at once. If you want to hide songs without a
video, or give one genre its own rules, make a tag: that is what tags are for.

**Recent** is not on this page. It is not a mark at all: it is a way of *sorting*
the song list — what has been sung tonight, newest first — and there is nothing
about it to colour.

## Putting a tag on a song

Tags are set up here and used on the song itself. Open a song — from **Songs**,
from a playlist, from the random reel — and tap the **tag** icon at the bottom
of it, next to the speech bubble. The number under it is how many tags the song
already wears, **0** included: a song with no tag on it yet is exactly the one
you came to tag.

Inside, every tag you may see is one row:

- A tag you may **set** is a switch. Tap it to put the tag on the song, tap it
  again to take it off. Its icon is grey while the song does not wear the tag
  and takes the tag's colour once it does. Everybody in the room sees the change
  straight away.
- A tag you may only **see** carries a padlock and does nothing. Somebody
  holding *Tag songs* on it has to make that change.

If you may not see a single tag, the icon is not there at all. If none of the
tags is yours to set and none is on the song, the list is replaced by one
sentence — a screen full of padlocks would say the same thing more slowly.

A tag with **Show in song list** on also rides on the song's row everywhere it
is listed: its icon, in its colour, after the microphone and the heart, with its
name on hover.

## Filtering the song list by tag

Every tag you may see is also a filter. On the **Songs** page the funnel chip
opens **Filter**, a panel with one row per thing the list can be narrowed by, in
this order: your favorites, the songs you have sung, the built-in facets the
party left in the filter, then every tag. Each row is set to **Any**, **Yes** or
**No**: *Yes* keeps only the songs wearing the tag, *No* drops them, and several
rows narrow the list together. The list updates as you tap; **Reset** puts
everything back.

**Genre**, **Language**, **Edition** and **Decade** end in a drop-down instead of
the three buttons, because there are more than three answers. It offers **Any**
and then the values your library actually holds — the genres of the songs you can
see, sorted; the decades in order, *1970s*, *1980s*, *1990s*. Pick one and the
list keeps only the songs with that value. One value per row, and a row you left
on *Any* is not filtering at all.

**Duet** and **Video** are ordinary *Any / Yes / No* rows like a tag. Nothing
about facets depends on who you are: a guest phone filters by genre exactly the
way the host does. Only the show-and-hide options behind them need the right to
manage tags.

A tag with **Hide songs by default** simply starts its row on *No*. That is the
whole mechanism — anybody who may see the tag can move the row to *Any* and have
the songs back, which is why it is a default and not a lock. The funnel counts
those rows as well, so once you are filtering, the number on the chip includes
the tags that were already holding songs back.

The panel itself is described in [Sing a song](singing.md).

## See also

- [Accounts and permissions](accounts-and-permissions.md) — the roles this
  table is built from, and who holds the right to manage tags.
