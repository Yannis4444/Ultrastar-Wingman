# Filter the list

**All**, **Favorites**, and **Sung** are shortcuts. The **Filter** panel is the
long way round, and it is where the tags live.

![The Filter panel with tri-state rows for the marks and the two file facets, value selects with Decade on 1980s, and four tag rows](../assets/screenshots/songs/songs-filter.png){ width="320" loading=lazy }
/// caption
**Decade** is set to 1980s, so only the 80s songs are left behind the panel.
///

## Set a filter

1. Open the **Songs** tab and tap :wingman-filter: **Filter**.
2. Set the rows you care about. The list behind the panel follows every tap,
   the song count included.
3. Tap **Done** to close the panel.

**Reset** puts every row back to where it started. That is not the same as
putting everything on **Any**. A tag set to hide its songs starts on **No**, and
**Reset** puts it back there.

## What the rows are

The panel has one row per thing the list can be filtered on, always in this
order:

1. **Favorites** and **Sung**, the two marks.
2. **Duet** and **Video**, which the song file answers.
3. **Genre**, **Language**, **Edition**, and **Decade**.
4. Every tag you are allowed to see.

**Favorites** and **Sung** are yours alone, so they only appear once you are
logged in. Rows two and three are the built-in facets, and the party
decides which of them the panel offers at all. A facet you read about here may
be switched off. See [Tags](../tags/index.md).

## Yes, no, or any

Most rows end in three buttons.

| Choice | What the list keeps |
|---|---|
| **Any** | Everything. That row is not filtering |
| **Yes** | Only the songs that have it |
| **No** | Only the songs that do not |

Rows add up. Every row that is not on **Any** narrows the list further.

!!! example "Rock duets only"
    Put **Genre** on *Rock* and **Duet** on **Yes**. The list keeps the songs
    that are both, and the chip reads **Filter · 2**.

## Genre, language, edition, and decade

Those four rows end in a drop-down instead, because they have more than three
answers. It offers **Any** and then the values your own library holds: the
genres actually on the shelf, the decades in order.

Pick one and the list keeps the songs with that value. A song whose file names
no genre matches **Any** alone, and the same goes for a song with no year. A
file that writes the word `None` where the genre goes is saying it has none, so
those songs match **Any** alone too. *None* is never offered as a genre.

These four come out of the song files, so they are the same for everybody in the
room, account or not.

## The count on the chip

While something is filtering, :wingman-filter: **Filter** is the pressed chip
and reads **Filter · 2**. The number is how many rows are off **Any**. A facet
counts like a tag, and so does a tag that was already hiding songs before you
opened the panel.

Tapping **All**, **Favorites**, or **Sung** throws the whole filter away.
**Recent** does not. It is a different order of the same list, and the filter
keeps working inside it.
