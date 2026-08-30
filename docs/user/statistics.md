# Statistics

Every finished song leaves its scores behind. The **Scores** tab shows them, one
party at a time.

## One page per party

Wingman groups sings into parties by itself. Everything sung within six hours of
the last song belongs to the same party; a longer break starts a new one. There is
nothing to open or close.

The dropdown at the top picks the party. The newest one is selected when you open
the tab, and unnamed parties are listed by their date.

Which parties are in that dropdown depends on one right. Everybody sees the party
that is going on right now — that is what the scoreboard at a party is for. The
parties before it need the right to see the history, which **user** and up hold by
default; take it away from a role and their dropdown simply holds tonight alone.

The party that is going on right now also has a shortcut of its own: the
**Recent** chip on the [Songs tab](singing.md#what-has-already-been-sung)
lists what it has played so far, including the songs nobody got a score for.

## Name a party

Press **Rename session**, type something like "Yannis' birthday", and save. The
name replaces the date everywhere the party is listed. Clearing the field brings
the date back.

Renaming needs the right to manage statistics — **trusted** and **admin** have it
by default.

## What a party page shows

A handful of figures first, each behind its own symbol. On a computer, resting
the pointer on one spells out the word; a screen reader reads it out too:

| | |
|---|---|
| **Started** | The day the party was — only for a party that is not today's |
| **Sings** | How many performances were scored |
| **Songs** | How many different songs |
| **Singers** | How many different people sang |
| **Top score** | The evening's best score |

Tonight's party carries no date: you were at it. An older one does, because a
party you gave a name to ("Yannis' birthday") would otherwise say nowhere on
the page when it happened.

The top score is the number alone. Who got it, and on what, is the first row of
the list further down — that list is what the page is for.

If more songs were started than were scored, the **Sings** symbol says so: its
word becomes "Sings — 2 scored of 4 started". A song that was stopped early is a
sing without a score.

Below the numbers come two dropdowns, then a chart of the score spread, then
the list itself.

**Group** rearranges both the chart and the list:

- **group by player** — one row per singer. Who was on form, with how many
  scores they have under their name.
- **group by song** — one row per song, title over artist as in the song list.
  Which song the room actually nails.
- **don't group** — one row per single score, nothing merged; the line under
  the title names the artist and whoever sang it. Nothing to open here, so the
  row goes straight to the song.

**Sort** decides the order: *alphabetically*, or by *average score*, *best
score* or *worst score*. The number printed at the right of each row is always
the one being sorted on, so the ranking can never disagree with itself.

Tap a row to open it, and it unfolds into a card. At the top, what that group
adds up to: how many scores, the best, the worst and the average — under a song
with the name of whoever managed the best and the worst — plus the shape of
those scores once there are at least four of them. Under that, every single
score behind the row: the songs that singer sang, or the singers of that song.

The chart is a box plot: the box is where most of that singer's (or song's) scores
sit, the line in it is the median, and the whiskers are the outliers. A singer
with one lucky hit looks very different from a consistently good one.

## All your own scores

The **Scores** tab is one party at a time. Your own record is not: open the
**User** tab and tap **All my scores** under your totals.

That page is the same list, with one singer in it and every party at once. Your
own scores are yours: they show up whatever the host has done with the history
right — it is somebody *else's* record that needs it. It is
always grouped by song — one row per song you ever sang — so the only control
is **Sort**. Open a row for how often you sang it, your best, worst and average
and the spread behind them, and under those every single run with the day and
time it happened. A cover opens the song itself.

The row only appears once you have been scored at least once, and only for a
logged-in account that is linked to a player: scores belong to a player, and
that is the one Wingman can total up for you.

## One song's best runs

Open a song from the **Songs** tab and tap the **trophy** at the bottom of it —
the number under it is the best anybody ever got — to see its ten best runs of
all time: how often it was sung, the best, worst and average score over its
whole history, and then the ranking itself — the singer's picture, how hard they
sang it and when, and what they got.

It reaches back over every party, so it needs the same right as the parties
before tonight. A role without it does not get the trophy at all, and neither
does a song nobody has sung yet.

## Where the scores come from

Ultrastar Deluxe scores the singing and writes the result to its own database.
When it closes, Wingman reads what is new in there and files it under the players
it put on the microphone slots. Wingman only reads that file; it never changes it.

!!! note
    A name typed inside Ultrastar Deluxe rather than chosen in Wingman still gets
    its score recorded, but under the plain name — Wingman cannot tell which
    player that was.

!!! warning
    A song that was stopped before the end scores nothing. That is Ultrastar
    Deluxe's rule, not Wingman's.
