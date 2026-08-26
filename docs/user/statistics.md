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
**Recently played** chip on the [Songs tab](singing.md#what-has-already-been-sung)
lists what it has played so far, including the songs nobody got a score for.

## Name a party

Press **Rename session**, type something like "Yannis' birthday", and save. The
name replaces the date everywhere the party is listed. Clearing the field brings
the date back.

Renaming needs the right to manage statistics — **trusted** and **admin** have it
by default.

## What a party page shows

Four numbers first:

| | |
|---|---|
| **Sings** | How many songs were started |
| **Songs** | How many different songs |
| **Singers** | How many different people sang |
| **Top score** | The best score, with who sang it on what |

Below that, a chart of the score spread, and the score list itself. **Group by**
switches both between:

- **player** — one row per singer, best median first. Who was on form.
- **song** — one row per song. Which song the room actually nails.

The chart is a box plot: the box is where most of that singer's (or song's) scores
sit, the line in it is the median, and the whiskers are the outliers. A singer
with one lucky hit looks very different from a consistently good one.

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
