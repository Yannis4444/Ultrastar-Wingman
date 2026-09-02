# Achievements

An achievement is something to reach for: sing your first song, break 9,000,
get through five songs in one night. Wingman works them out from the scores
Ultrastar Deluxe wrote and hands out the badge — on the singer's own page, and
on the host screen the moment it happens.

Badges belong to **players**, not to accounts. A guest who sang tonight earns
them exactly like anybody else; a logged-in account sees them through the player
it sings as. A score Ultrastar Deluxe recorded under a name that matched no
player earns nothing — Wingman has no idea who that was.

Everybody sees badges, and nobody needs a right for that. Making them, switching
them off and carrying them between parties needs **create and edit
achievements**, which only an **admin** holds unless the host hands it out.

## Your own badges

Open the **User** tab. Under your scores stands **Achievements** with a count —
*7 of 17* — and the badges you already hold beside it. Tap the line to fold out
the whole list.

| A row | What it means |
|---|---|
| In colour | Earned. The day it happened stands under the description. |
| Greyed out | Not yet. The description says what to do, and where there is something to count towards, a bar and a number — *7 / 10* — say how far along you are. |
| A padlock, "Hidden achievement" | One the host is keeping back. What it is for is the surprise; earn it and the row fills in. |

Not every unearned row has a bar. An achievement asking for a score *below*
something, or for exactly a number, has nothing to fill up — a bar would only
fill as you got worse. A hidden one never shows a bar before it is earned,
because the bar would give away what it is for.

The list holds every achievement that is switched on, so it doubles as the list
of what is left to reach for. Two things make it disappear: the host switching
achievements off, and not being logged in — badges hang on a player, and Wingman
is only sure which player you are once you have an account. Your badges still
show up on the host screen either way.

!!! note
    Badges are worked out again from your scores every time, never counted up as
    you go. So if the host moves a score to the right singer or deletes one, the
    badges follow — including losing one that was earned on a score that was not
    yours. Earn it again and it is stamped with the new day.

## What the party already has

Wingman ships with seventeen. The host can rename them, give them another icon
or colour, hide one until it is earned and switch any of them off. Two things
about them are not the party's to change: **what they ask for**, so that
*Golden Voice* means the same thing at every party — and they cannot be deleted.
Anything you have changed can be put back with **Reset** (below).

| Achievement | What it takes |
|---|---|
| **First Time on the Mic** | Sing your first song. |
| **Warmed Up** | Score 6,000 or more in a song. |
| **In Tune** | Score 8,000 or more in a song. |
| **Golden Voice** | Score 9,000 or more in a song. |
| **Untouchable** | Score 9,500 or more in a song. |
| **A Good Evening** | Collect 50,000 points in one party. |
| **Big Night** | Collect 100,000 points in one party. |
| **Marathon** | Collect 250,000 points in one party. |
| **Regular** | Sing 10 songs. |
| **Resident** | Sing 50 songs. |
| **Living Legend** | Sing 100 songs. |
| **Five in a Night** | Sing 5 songs in one party. |
| **Iron Lungs** | Sing 10 songs in one party. |
| **Hat-trick** | Score 9,000 or more three times in one party. |
| **Better Together** | Sing a duet. |
| **Well Travelled** | Sing songs by 10 different artists. |

The seventeenth is hidden, so singers meet it as a padlock until somebody earns
it — which is the whole joke, and why it is not written down here. The host
sees it like any other on **User → Achievements**, and can switch it off there
if the party would not find it funny — but *only* there. On the host's own
badge list, and on the host screen, it is the same padlock everybody else gets:
being able to edit a surprise is no reason to have it spoiled.

"One party" means one evening — one run of Wingman, the same party the
[Scores](statistics.md) tab lists.

## On the host screen

When a song is over, the host screen holds the scoreboard back for a moment and
throws the new badges up first: one singer at a time, their picture and name, and
their badges flying in — at most four to a row, with the name and the one-line
description beside each. Then the next singer, then the results as usual.

A song where nobody earned anything skips straight to the results.

How long a row stays is up to the host, on the **Achievements** page:

- **How long a row of badges stays on the host screen** — the base, four seconds
  by default.
- **Added for each badge in the row** — two more seconds per badge, so a row of
  three stands for ten.

Both take whole seconds, 0 to 60.

## Make an achievement

1. Open **User → Achievements**. The page lists what your party has made, then
   **Included** — the seventeen above.
2. Press **+** in the top right.
3. Give it a **name** and a **description**. The description is the line a singer
   reads under the badge, so say what they have to do, not how it is measured.
4. Pick an **icon** and one of the four **colours** — or upload a **picture**,
   which replaces the icon entirely. A picture needs an achievement that already
   exists, so save once first.
5. Decide **Hidden until earned** and **Enabled** (both below).
6. Add the **conditions** — what it actually takes.
7. **Save**.

Tap a row to open it again; everything about an achievement your party made is
editable. **Delete achievement** at the foot removes it and everybody's badge
for it.

One of the seventeen **included** ones opens in the same editor with two
differences. Its conditions are shown as the sentences they mean rather than as
boxes — what Wingman's own achievements ask for is the same everywhere, so there
is nothing to fill in there. And in place of Delete it has **Reset
achievement**:

- **Reset** puts the name, description, icon, colour, conditions and whether it
  is *hidden until earned* back the way Wingman ships them, and removes an
  uploaded picture. (So the one included achievement that ships hidden becomes a
  surprise again, even if you had revealed it.)
- Whether it is **switched on** is left exactly as you set it. Switching one off
  is meant to stick, so a reset never turns it back on.
- Everybody's badges are worked out again afterwards. If you had made an
  achievement easier than Wingman ships it, resetting it can take that badge
  away again.

It asks before it does any of that, because it throws your changes away.

!!! note
    Every change re-checks everybody in the background. An achievement that is
    already true of what somebody sang months ago is earned the moment you save
    it.

### What a condition means

An achievement is a list of conditions, and **all of them** have to hold. Each
one is one sentence, and the editor writes that sentence out under the block
while you build it — *"In one party, at least 3 scores of 9000 or more, on songs
where the genre is Rock."* If the sentence says what you meant, the condition
does too.

**All time / One party.** Whether the condition looks at everything the singer
ever did, or has to come true inside one evening. It is the difference between
"sing 10 songs" and "sing 10 songs tonight". If several conditions say *One
party*, they all have to come true in the same one.

**What is measured**, over the scores that are left after the two filters below:

| Measure | What it counts |
|---|---|
| **Any score** | One single score. With *at least* or *more than* that is the singer's best; with *at most* or *less than*, their worst. |
| **Sum of scores** | Every score added up. |
| **Number of sings** | How many songs were sung. A duet scored twice is one. |
| **Number of scores** | How many scores there are. |
| **Different songs** | How many different songs. |
| **Different artists** | How many different artists. |
| **Average score** | The mean, rounded down. Somebody with no scores has none, so they never satisfy it. |

**Has to be** and the number: *at least*, *more than*, *exactly*, *at most*,
*less than*.

**Only count scores** — **At least** and **At most** — throw scores outside that
range away *before* the measure is worked out. That is how "ten scores above
9,000" is built: *Number of scores*, *at least*, *10*, with *Only count scores →
At least 9000*. Leave both empty and every score counts.

**Which songs** narrows it further:

- **All songs** — no restriction.
- **Chosen songs** — search the library and pick them one by one.
- **Songs matching** — rules over what the song files say: title, artist, genre,
  language, edition, year, duet, video. *All of them* or *Any of them* have to
  match. A song whose file says nothing about a field never matches a rule about
  it.

!!! note
    A song that has since left the library still counts for a condition that
    takes all songs — it was a score somebody got. It counts for nothing in a
    condition that picks songs, because the file that said what it was is gone.

The progress bar a singer sees comes out of the conditions on its own: it can
only be drawn for one that counts *upwards* — *at least* or *more than* — and an
achievement's bar shows its least complete condition, since all of them have to
hold.

### Hidden achievements

Tick **Hidden until earned** and nobody sees what it is. Until they earn it, a
singer gets a padlock where the badge would be, no name, no description, no
picture and no bar. Earning it announces it to the whole party — that is rather
the point of hiding it.

### Switch one off

Untick **Enabled** and the achievement is not worked out and not drawn anywhere:
not on a singer's page, not on the host screen. Nobody's badges are thrown away.
Tick it again and everybody is brought up to date.

To switch the **whole feature** off, use **Enabled** at the top of the
**Achievements** page. Nothing is earned and no badge is drawn anywhere in the
app while it is off; switching it back on recomputes everybody.

!!! note
    Those three settings — **Enabled** and the two host-screen timings — live at
    the top of **User → Achievements**, not on the **Settings** page. They belong
    to whoever looks after achievements rather than to whoever configures
    Wingman.

## Carry achievements to another party

At the foot of **User → Achievements** stands **Import and export**. An archive
is a single `.tar.gz` file holding one folder per achievement, with everything
about it in `achievement.json` and its picture beside it — so a set you invented
on one machine can be handed to another, published, or edited in a text editor
and read back in.

**To export:** press **Export…**, tick the achievements you want — the seventeen
included ones can go in too — and press **Export · N**. The file lands in your
downloads under a name with today's date.

**To import:** press **Import archive…** and pick the file. Wingman tells you in
words what happened — *"Added Golden Voice and updated 14 achievements."*

Import matches **by id**, which is the folder name inside the archive:

- An achievement this Wingman already has is **updated** — name, description,
  colour, conditions and all — exactly as if you had edited it.
- One of the **seventeen included** ones is updated too, but its conditions are
  left alone, exactly as in the editor: what Wingman's own achievements ask for
  is not something an archive may change. Everything else in the file takes.
- One it does not have is **added**.
- Importing the same archive twice is therefore not a way to get two copies. It
  is a way to put things back the way the archive has them.

!!! warning
    An entry with no picture in it **clears** the picture of the achievement it
    updates. The archive is the whole description of what it names, so importing
    the same file twice always leaves the same result.

Nothing is written until the whole archive has been read and every picture
checked, so a broken file changes nothing at all. If something is wrong, Wingman
says which achievement and what about it — *"'builtin-duet/achievement.json'
names an unknown key 'colour'"* — which is usually one keystroke from a fix in
the file. An archive may not be larger than 32 MB.

Exporting needs the same right as making an achievement, although it only reads:
an archive carries what every achievement asks for and the real names of the
hidden ones, and a file anybody could ask for would spoil every surprise in the
list.

### Editing an archive by hand

Unpack it, open one `achievement.json` and you get the whole achievement:

```json
{
  "id": "builtin-score-9000",
  "name": "Golden Voice",
  "description": "Score 9,000 or more in a song.",
  "icon": "trophy",
  "color": "gold",
  "hidden": false,
  "enabled": true,
  "sort_order": 3,
  "definition": [
    { "scope": "global", "metric": "any_score", "comparator": ">=", "value": 9000 }
  ]
}
```

Two rules are worth knowing before you change anything. The folder's name has to
be the same as the `id` in the file — that is what says which achievement it is.
And a key Wingman does not know is refused rather than ignored: a `"colour"` that
was quietly dropped is exactly the mistake a hand-edited file invites, so it is
named instead. Pack the folders back into a `.tar.gz` and import it.

The example above is one of the included seventeen — you can tell by the
`builtin-` in front of its id — so `definition` is the one thing in it an import
will ignore. Everything else in that file takes. Editing conditions by hand is
for the achievements your party made itself.

## See also

- [Statistics](statistics.md) — where the scores behind all of this are read.
- [Sing a song](singing.md) — what happens on the host screen around a song.
- [Accounts and permissions](accounts-and-permissions.md) — who may create and
  edit achievements.
