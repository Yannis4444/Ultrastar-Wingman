# Tags

A tag is a label the whole party shares. Wishes and favorites belong to one
person; a tag belongs to the song. Put **broken** on the file that never plays,
**archive** on the ones nobody should stumble over, **duet** on the ones that
need two microphones — and decide, per tag, who is allowed to know it exists.

Setting tags up needs the right to manage tags, which **trusted** and **admin**
hold by default. Everybody else only ever sees the result.

## The two tags you already have

Wingman starts with two, and both are ordinary tags: rename them, recolour
them, or delete them.

| Tag | What it does |
|---|---|
| **broken** | For a song that does not work — the audio is missing, the timing is wrong. Only **trusted** and **admin** can see it, and a song marked broken is invisible to everybody else. |
| **archive** | For songs that should not clutter the list. Everybody can see it, but its songs are folded away until somebody asks for them. |

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

## Create a tag

1. Open **User → Tags**. The page lists every tag, with how many songs carry it.
2. Press **+** in the top right.
3. Give it a **name** (up to 32 characters) and, if you like, an **icon** and one
   of the four **colours**. The icon and the colour are how the tag is
   recognised at a glance, so pick something that is not already in use.
4. Decide the two options below (next section).
5. Tick who it is for, in the table of **guest**, **user** and **trusted** — and,
   under **Specific people**, search for an account to give one person more than
   their role has.
6. **Save**.

A brand-new tag starts out like **archive**: everybody can see it and its songs,
and **trusted** accounts may set it. Change that before you save if the tag is
meant to be private.

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
random reel until somebody asks for them in the filter. It is a default, not a
lock: everybody who may see the tag can still bring the songs back. To really
hide songs from somebody, take *See songs* away from them instead.

## Change or delete a tag

Tap a tag on **User → Tags** to open it again. Everything is editable, the
permissions included; **Save** sends only what you changed.

**Delete tag** at the foot removes the tag from every song that carries it and
from everybody it was granted to. The songs themselves stay in the library —
only the label goes.

## Putting a tag on a song

This page is where tags are set up, not where they are used. Tagging happens on
the song itself — open a song and use its **Tags** row — and the **Songs** page
filters the list by tag. Both are described where they live.

## See also

- [Accounts and permissions](accounts-and-permissions.md) — the roles this
  table is built from, and who holds the right to manage tags.
