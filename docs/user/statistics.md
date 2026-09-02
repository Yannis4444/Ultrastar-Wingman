# Statistics

Every finished song leaves its scores behind. The **Scores** tab shows them, one
party at a time.

## One page per party

Wingman groups sings into parties by itself. Everything sung within six hours of
the last song belongs to the same party; a longer break starts a new one. There is
nothing to open or close.

The wide button at the top names the party you are looking at. Press it and a
panel opens with one row per party: its name — or its date, when nobody has
named it — over a line saying when it was, how many people sang and how many
scores it holds, so you can tell two evenings apart before opening either. The
row you are on is highlighted. The newest party is the one the tab opens on.

Which parties are in that panel depends on who you are:

- Everybody sees the party that is going on right now — that is what the
  scoreboard at a party is for.
- Logged in, you also see every party you sang at yourself. Your own evenings
  are yours, whatever the host has done with the history right. A party is
  yours once one of its scores is under your name as a player — a phone without
  an account has no name to go by and gets tonight alone.
- Every other party needs the right to see the history, which **user** and up
  hold by default.

The panel holds exactly the parties you may open, so it never names one only
to refuse it.

## Every party at once

Above the parties stands one more row that adds them all up: **All sessions**
with the history right, **All my scores** without it — the same list, over every
party you may open rather than one evening. Its line says how many parties that
is and how many scores they hold together. It appears as soon as there is more
than one party to add up, and it is the whole page: the chart, the grouping and
the ranking all read the wider list. It has no date and no name of its own, so
the row of figures at the top and the rename button stay away.

The party that is going on right now also has a shortcut of its own: the
**Recent** chip on the [Songs tab](singing.md#what-has-already-been-sung)
lists what it has played so far, including the songs nobody got a score for.

## Name a party

Press the pencil beside the party's name, type something like "Yannis'
birthday", and save. The name replaces the date everywhere the party is listed.
Clearing the field brings the date back.

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

Below the numbers comes the party's own picture, then two dropdowns, then a
chart of the score spread, then the list itself.

## The whole party in one picture

The first chart shows **every score of the party at once**, each as one dot on
a scale from 0 to 10000. Two scores that came out nearly the same stack beside
each other instead of hiding one another, so a busy evening reads as a cloud
with a shape: where the room usually lands, and how far the outliers strayed.
The dashed line is the party's median — half the scores above, half below —
and the gold dot is the evening's best, with the number and the singer written
beside it.

The two buttons at the top of that card switch what it shows:

- **All scores** — the cloud just described.
- **The evening** — the same scores spread over the clock: every dot at the
  time it was sung, so you can see the warm-up, the run somebody went on, and
  the record that fell at half past midnight. The five singers with the best
  scores each get their own colour (the legend above names them); everybody
  else shares grey. A duet's dots stand on the same minute, because that is
  when it happened.

Resting the pointer on any dot — or tapping it on a phone — names the singer,
the song, the score and the time. Tapping the same dot again, or anywhere
beside the dots, puts the label away.

On the **All sessions** / **All my scores** page there is no evening to draw,
so the card shows the cloud alone, and its labels carry the date as well as
the time.

## Grouping and sorting

Under the party picture come the two dropdowns, and below them the score
spread and the list they both rearrange.

**Group** rearranges both the spread chart and the list:

- **group by player** — one row per singer. Who was on form, with how many
  scores they have under their name.
- **group by song** — one row per song, title over artist as in the song list.
  Which song the room actually nails.
- **don't group** — one row per single score, nothing merged; the line under
  the title names the artist and whoever sang it. Nothing to open here, so the
  row goes straight to the song. There is no spread chart in this mode — the
  party picture above already shows every single score.

**Sort** decides the order: *alphabetically*, by *average score*, *best score*
or *worst score*, or *chronological* — the evening read forwards, from the song
that was sung first. Grouped by player, *chronological* is not offered: a singer
is not a moment in the evening. Picking it and then grouping by player puts the
order back to *best score*. Sorting only reorders the rows — the evening as a
picture is the **The evening** view of the card at the top.

The number printed at the right of each row is the one being sorted on, so a
ranking can never disagree with itself; *alphabetically* and *chronological*
rank by nothing a row could print, and those two show the best score.

Tap a row to open it, and it unfolds into a card. At the top, what that group
adds up to: how many scores, the best, the worst and the average — under a song
with the name of whoever managed the best and the worst — plus the shape of
those scores once there are at least four of them. Under that, every single
score behind the row: the songs that singer sang, or the singers of that song.

The spread chart gives each of the first eight rows of the list a full-width
line of its own, in the same order, with the row's score count and best score
at its ends — nothing scrolls sideways, and a song keeps its whole name,
artist and all.

What a line shows depends on what it stands for:

- **A singer** with a real pile of scores gets a box plot: the box is where the
  middle half of their scores sit, the line in it is the median, the whiskers
  reach to their ordinary best and worst — and a score far outside all of that,
  a bombed song or a freak hit, stands alone as a dot past the whisker instead
  of stretching the picture. Every single score is also there as a small grey
  dot, so a consistently good singer and one lucky hit look nothing alike.
  A singer with only a handful of scores gets the dots alone: four scores are
  four scores, not a distribution.
- **A song** is usually one performance — a few people on the microphones at
  the same time — so its line shows exactly who: one round mark per score,
  wearing the singer's initial, near-ties stepping aside so both stay visible.
  A duet reads as the head-to-head it was. Once a song has more scores than
  initials can carry (sung again and again, or seen across all sessions), the
  initials give way to plain dots on the same line.

Everything answers the pointer, or a tap: a dot or an initial with its singer,
song, score and time; a box with the numbers behind it.

## Fix a wrong singer

Ultrastar Deluxe files a score under whoever was on that microphone slot, and
sometimes that was the wrong person — the phone picked Jörg, Anna sang. A score
row then carries two buttons for whoever may moderate the statistics:

- the **pencil** opens the list of players. Pick the one who really sang it and
  confirm; the score keeps its number, its song and its place in the party, and
  only the name on it changes.
- the **trash** deletes the score after a confirmation. The performance itself
  stays in what was played — the song *was* sung, it simply has no score any
  more.

The number and the song are never editable: those are what Ultrastar Deluxe
reported, and a wrongly picked singer is the mistake this fixes.

Both need the right to moderate the statistics, which **admin** alone holds by
default — it rewrites the party's own record, where renaming a party only
changes a label. Everybody looking at the Scores page sees the correction
straight away.

Rows that stand for several scores — a singer, or a song, while the list is
grouped — carry no buttons: there is no single score behind them to move. Open
the row, or set **Group** to *don't group*, and every row is one score again.

## All your own scores

The **Scores** tab is one party at a time. Your own record is not: open the
**User** tab and tap **All my scores** under your totals.

That page is the same list, with one singer in it and every party at once. Your
own scores are yours: they show up whatever the host has done with the history
right — it is somebody *else's* record that needs it. It is
always grouped by song — one row per song you ever sang — so the only control
is **Sort**, with four of the orders the Scores page has: *alphabetically*,
*average score*, *best score* and *worst score*. *Chronological* is not among
them — a row here is a song rather than a moment in one evening. The chart is
the same picture the **Scores** tab leads with, over your whole record: every
score you ever got as one dot on the 0 to 10000 scale, your best in gold, your
median the dashed line with half your scores on either side. Its labels carry
the day rather than the time, because this record spans parties: two runs of
one song can be months apart. Open a row for
how often you sang it, your best, worst and average and the spread behind them,
and under those every single run with the day and time it happened. A cover
opens the song itself.

The row only appears once you have been scored at least once, and only for a
logged-in account that is linked to a player: scores belong to a player, and
that is the one Wingman can total up for you.

## What those scores earned

On the same **User** tab, under your totals, stands **Achievements** with a count
— *7 of 17* — and the badges you hold beside it. Tap the line and it folds out
into every achievement the party has: the ones you have earned with the day you
got them, the ones you have not with how far along you are, and a padlock for the
ones the host is keeping back.

They are worked out from exactly the scores this page shows, so a correction here
moves them too. [Achievements](achievements.md) has the whole story, including
how the host makes one.

## One song's best runs

Open a song from the **Songs** tab and tap the **trophy** at the bottom of it —
the number under it is the best anybody ever got — to see its ten best runs of
all time: how often it was sung, the best, worst and average score over its
whole history, and then the ranking itself — the singer's picture, how hard they
sang it and when, and what they got.

Above the ranking the whole history is drawn as the same all-scores picture the
**Scores** tab uses: one dot for every score the song ever got, the record in
gold with the singer rank 1 names, the middle of the field as a dashed line, and
a label on every dot that also says which day it was.

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
