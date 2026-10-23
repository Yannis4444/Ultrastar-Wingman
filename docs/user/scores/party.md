# A party's scores

The **Scores** tab shows one party at a time: what the room sang, how it went,
and who came out on top. Anybody at the party can read it.

![The Scores tab with the party button, the figures under it, the All scores chart with its median line, and the ranked score rows](../assets/screenshots/scores/scores-party.png){ width="320" loading=lazy }
/// caption
Bender's 8,662 is the evening's best, so the chart draws it in gold.
///

## Pick a party

The wide button at the top names the party you are on, and the tab opens on the
newest one. Tap it and a panel opens with one row per party. A row says the
party's name, or its date when nobody has named it. Under that stands the date,
how many people sang, and how many scores it holds.

With two parties or more, one extra row sits at the head of the panel and adds
them all up. It is called **All parties** for a reader who may open past
parties, and **All my scores** for everybody else. Its line says how many
parties that is and how many scores they hold together, the ones taken off the
list included, because picking it reads them too. Pick it and the whole page
reads that wider list. It is no single evening, so the figures below and the
rename button stay away. The panel holds exactly the parties you may open. See
[Scores](index.md#which-parties-you-can-open).

### Name a party

Naming a party takes the right to manage statistics, which Trusted and Admin
hold by default.

1. Pick the party you want to name.
2. Tap :wingman-pencil: **Rename party** beside the button.
3. Type a name, such as `Yannis' birthday`.
4. Tap :wingman-check: **Save**.

The name replaces the date everywhere the party is listed. To bring the date
back, empty the box and save again. :wingman-close: **Cancel** leaves the name
as it was.

### Take a party off the list

After a year of karaoke the panel is long. Taking a party off it takes the
right to hide parties, which Admin alone holds by default.

1. Open the panel.
2. Tap :wingman-eye-off: **Show every party** in the panel's header. The list
   now holds every party you may open, and each one carries an eye.
3. Tap :wingman-eye: beside a party to take it off the list. It turns into
   :wingman-eye-off: and the party's name goes quiet.
4. Tap it again to put the party back.

:wingman-eye: **Show every party** is the way out of that view: tap it and the
list is the short one again.

**Only that list changes.** The party keeps every score it has. It is still in
**All parties**, in each singer's own record, in a song's best scores, in every
total, and in what the achievements are worked out from. Nobody loses a badge
and nobody's best score moves.

The party going on right now can never be taken off the list. Tonight's
scoreboard is what the tab is for, and a phone at the party would be left with
an empty page.

Everybody in the room sees the change at once.

## The figures at the top

A row of numbers heads the party, each behind its own glyph. Rest the pointer
on one to read the word it stands for.

| Glyph | What it says |
|---|---|
| :wingman-calendar: **Started** | The day the party was. Only for a party that is not today's |
| :wingman-hash: **Sings** | How many performances were scored. Only when that differs from the number of songs |
| :wingman-music: **Songs** | How many different songs |
| :wingman-users: **Singers** | How many different people sang |
| :wingman-trophy: **Top score** | The evening's best score |

If more songs were started than were scored, the **Sings** word says so. It
reads "Sings: 2 scored of 4 started". A song that was stopped early is a sing
with no score.

## Group and sort

Two quiet selects sit under the figures and rearrange everything below them:
the charts and the list.

**Group** decides what a row stands for.

- **group by player** is one row per singer, with how many scores they have.
- **group by song** is one row per song, title over artist.
- **don't group** is one row per single score. The line under the title names
  the artist and whoever sang it.

**Sort** decides the order: **alphabetically**, **average score**,
**best score**, **chronological**, or **worst score**. Grouped by player,
**chronological** is not offered, because a singer is not a moment in the
evening. The number at the right of a row is the one being sorted on. Under
**alphabetically** and **chronological** the rows show the best score.

## The charts

Under the selects stands one chart, with up to three views to switch between.
Two scores are enough to draw it. Tap a view's name to switch. The view you
pick stays picked when you open another party.

- **All scores** puts every score of the party on one scale from 0 to 10000,
  one gray dot each. Two dots that came out nearly the same step aside instead
  of hiding each other. The dashed line is the party's median, and the gold dot
  is the best score. The line above the chart gives both numbers and names the
  singer of the best one.
- **The evening** spreads the same scores over the clock, so a warm-up and a
  late run are both visible. The five singers with the best scores get a color
  each, named in the legend above. Everybody else shares gray and is counted
  as "N more".
- **Spread** draws the first eight rows of the list, in the order the list has.
  Each line starts with the singer or the song, and ends with that row's best
  score. It is there only while the list is grouped and has two rows or more.
  Ungrouped, **All scores** already shows every score.

![The Spread view grouped by player, with a box for Bender and for Fry, plain dots for Amy, Leela, and Zoidberg, and each singer's best at the right](../assets/screenshots/scores/scores-spread.png){ width="320" loading=lazy }
/// caption
Bender's nine scores earn a box, and Leela's two get plain dots instead.
///

In **Spread**:

- A singer with five scores or more gets a box plot. The box holds the middle
  half of their scores, the line in it is the median, and the whiskers reach
  their ordinary best and worst. A score far outside all of that stands alone
  past the whisker, and every single score is a small gray dot on top.
- A singer with fewer scores gets the dots alone. Four scores are four scores,
  not a distribution.
- A song is usually one performance, so its line shows one mark per score,
  wearing the singer's initial. From eight scores on, the initials give way to
  plain dots.
- The party's best score is gold here too.

Rest the pointer on a mark to read the singer, the song, the score, and the
time. On a phone, tap near a mark instead. Tap it again, or anywhere beside the
marks, to put the label away.

**All parties** and **All my scores** are no single evening, so they offer no
**The evening**. Their labels carry the date as well as the time.

## The ranking

The list under the charts is the page itself, and its rows are numbered from
the top. Under **best score** and **average score** the first three numbers
stand out, because the order really is a ranking. Tap a grouped row and it
unfolds into a card.

A row with more than one score behind it is headed by the same figures the
**User** tab prints over your own record: :wingman-hash: **Sings**,
:wingman-music: **Songs**, :wingman-arrow-up: **Best**,
:wingman-average: **Average**, and :wingman-arrow-down: **Worst**.

- **Sings** counts performances, not scores. A duet two people sang together
  is one sing and two rows in the list below it.
- **Songs** stands under a singer only. Under a song it would read **1** on
  every row, so it is left out there.
- Under a song, **Best** and **Worst** name the singer who managed them. Under
  a singer they name nobody: the row above is already their name.

From four scores on, a bar chart shows where they land. Under all of it stands
every single score behind the row: the songs that singer sang, or the singers
of that song.

Grouped by song, the cover on a row opens the song. Grouped by player, the rows
inside the card do. Ungrouped, the whole row does.

## Share a party or a score

Wingman draws a picture of a party or of one score for you to send to friends.
Your browser draws it, and you save or share it from there. Whoever may read a
party's scores may share them.

- To share the party, tap :wingman-share: **Share this party** at the end of
  the party button's row. **All parties** and **All my scores** have none,
  because a card is one evening.
- To share one score, open a grouped row and tap :wingman-share:
  **Share a score** at the foot of its card. If the row holds several scores,
  pick one from the list first. :wingman-close: **Close** takes you back to
  that list.

![The Share this party panel with the picture of the party card, its podium of three singers, and the Format and Look choices under it](../assets/screenshots/scores/scores-share.png){ width="320" loading=lazy }
/// caption
The picture is the card exactly as it is sent.
///

Under the picture you choose how the card looks.

| Choice | What it does |
|---|---|
| **Format** | **Square** for a chat. **Story** for a story app, which draws its own controls over the top and the foot |
| **Look** | **Dark**. For a score, **Cover** blurs the song's cover behind it. For a party, **Mosaic** lays the party's covers behind the podium |
| **Focus** | A party only: the **Podium**, or the **Spread** of every singer's scores |
| **Under the podium** | A square, dark podium card only: the **Ranking** of the next singers, or the **Score strip** of every score |

A choice the card cannot draw stays in the list but cannot be picked. A line
under it says why: **Mosaic** needs four different covers, for example, and a
song without a cover has no **Cover** look.

Three checkboxes decide who and what is on the card.

- **Other singers' pictures**: cleared, everybody else is drawn as their
  initial. Your own picture is always yours.
- **Party name and date**: cleared, the card names no party and no day.
- **Only me and my place**: a party only. The card shows you alone, with your
  own figures and your place, such as "2nd of 5". It is there for somebody who
  sang at that party.

The panel remembers the format, the look, and the checkboxes on this device.

### What a card shows

A score card shows the song, the score with its rating word, your place, and
who sang it with you. A party card shows **Sings**, **Songs**, **Best**, and
**Average**, then the podium. No card ever shows the worst score: a card
leaves the room.

For a reader who may open past parties, a score that holds the song's record
says **New Highscore**. One that is the singer's own best on the song says
**Personal best**. Everybody else's cards carry neither.

### Save it or send it

The buttons under the choices are the ones your browser can carry out.

- **Share** hands the picture to your phone's share sheet.
- **Copy image** puts it on the clipboard, ready to paste into a chat.
- **Save image** downloads it. On an iPhone a download usually lands in
  **Files** rather than in your photos.

**Share** and **Copy image** need a secure connection, so a phone on the home
network usually has **Save image** alone. Press and hold the picture instead, and the
phone offers to save it to your photos or share it.

## Correct a score

Ultrastar Deluxe files a score under whoever was on that microphone slot, and
sometimes that was the wrong person. Correcting one takes the right to moderate
statistics, which Admin alone holds by default. Everybody looking at the page
sees the correction at once. A row that is one single score then carries
:wingman-pencil: **Correct the score**. Set **Group** to **don't group**, or
open a group, and every row is one score.

Tap it and **Correct this score** opens. The panel names the score and holds
both repairs.

- The list of players stands first. Tap the one who really sang it, then
  confirm with **Move**. The score keeps its number, its song, and its place in
  the party.
- **Delete score** at the foot takes it off the record after a confirmation.
  The song stays in what was played.

**Cancel** in either confirmation comes back to the panel, so a slip costs
nothing.

The number and the song are never editable. Those are what Ultrastar Deluxe
reported.

## When there is nothing to show

Before the first party of all, the tab says "Sing a song and the results land
here". A party where songs were started but nothing was scored says how many
were started. It also says that Ultrastar Deluxe reports a score only when a
song runs to the end.
