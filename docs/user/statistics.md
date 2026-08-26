# Statistics

Every finished song leaves its scores behind. The **Scores** tab shows them, one
party at a time.

## One page per party

Wingman groups sings into parties by itself. Everything sung within six hours of
the last song belongs to the same party; a longer break starts a new one. There is
nothing to open or close.

The dropdown at the top picks the party. The newest one is selected when you open
the tab, and unnamed parties are listed by their date.

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

Four numbers first, each behind its own symbol. On a computer, resting the
pointer on one spells out the word; a screen reader reads it out too:

| | |
|---|---|
| **Sings** | How many performances were scored |
| **Songs** | How many different songs |
| **Singers** | How many different people sang |
| **Top score** | The evening's best score |

The top score is the number alone. Who got it, and on what, is the first row of
the list further down — that list is what the page is for.

If more songs were started than were scored, the **Sings** symbol says so: its
word becomes "Sings — 2 scored of 4 started". A song that was stopped early is a
sing without a score.

Below the numbers come two dropdowns, then a chart of the score spread, then
the list itself.

**Group** rearranges both the chart and the list:

- **group by player** — one row per singer. Who was on form.
- **group by song** — one row per song. Which song the room actually nails.
- **don't group** — one row per single score, nothing merged.

**Sort** decides the order: *alphabetically*, or by *average score*, *best
score* or *worst score*. The number printed at the right of each row is always
the one being sorted on, so the ranking can never disagree with itself.

The chart is a box plot: the box is where most of that singer's (or song's) scores
sit, the line in it is the median, and the whiskers are the outliers. A singer
with one lucky hit looks very different from a consistently good one.

## All your own scores

The **Scores** tab is one party at a time. Your own record is not: open the
**User** tab and tap **All my scores** under your totals.

That page is the same list, with one singer in it and every party at once. It is
always grouped by song — one row per song you ever sang, with how often, your
best, your worst and your average behind it — so the only control is **Sort**.
Open a row for the spread of that one song and every single run behind it, or
tap a cover to open the song itself.

The row only appears once you have been scored at least once, and only for a
logged-in account that is linked to a player: scores belong to a player, and
that is the one Wingman can total up for you.

## One song's best runs

Open a song from the **Songs** tab and tap **Best scores** to see its ten best
runs of all time: how often it was sung, the best, worst and average score over
its whole history, and then the ranking itself — the singer's picture, how hard
they sang it and when, and what they got.

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
