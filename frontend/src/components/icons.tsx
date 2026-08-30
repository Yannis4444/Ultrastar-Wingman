import { useId } from "react";

/**
 * Shared inline 24x24 icons. One path per icon, `fill: currentColor` via the
 * `.icon` rule in index.css — a path is cheaper than an icon dependency.
 */
export const ICON_PATHS = {
  search:
    "M10 4a6 6 0 1 0 3.8 10.6l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
  refresh: "M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z",
  play: "M8 5v14l11-7Z",
  stop: "M6 6h12v12H6V6Z",
  heart:
    "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
  "chevron-down": "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z",
  "chevron-right": "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z",
  "chevron-left": "M15.41 7.41 10.83 12l4.58 4.59L14 18l-6-6 6-6 1.41 1.41Z",
  // Long, thin arrows — the score list's "best" and "worst" markers. Slimmer
  // than the chevrons so a caption run of four stats stays readable at 0.85em.
  "arrow-up": "M12 3l6 7h-4v11h-4V10H6l6-7Z",
  "arrow-down": "M12 21l-6-7h4V3h4v11h4l-6 7Z",
  download:
    "M11 3h2v8.2l3.1-3.1 1.4 1.4L12 15 6.5 9.5 7.9 8.1 11 11.2V3Zm-6 15h14v2H5v-2Z",
  clock:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm1 2v5.4l4 2.4-1 1.7-5-3V7h2Z",
  alert: "M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z",
  trash:
    "M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z",
  pencil:
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z",
  // Two offset rounded squares: the sheet being written is solid, the one behind
  // it shows only as the frame the front one does not cover.
  copy: "M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM10 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3v-2h3V5h-9v3H8V5a2 2 0 0 1 2-2Z",
  // The reorder grip: six dots in two columns of three, the same pip the dice
  // faces are made of so the two never look like different kinds of dot.
  "drag-handle":
    "M9 4.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM9 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM9 16.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  // Submit in the comment composer: one triangle with the fold cut out of its
  // left edge, so the plane reads as folded paper and not as a solid `play`
  // turned on its side. A single contour — the notch is part of the outline,
  // so no fill rule is involved.
  send: "M2 21l21-9L2 3v7l15 2-15 2v7Z",
  shield: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z",
  users:
    "M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05A4.22 4.22 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z",
  gear: "M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3H9l-.3 3a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.3-3a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5ZM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7Z",
  trophy:
    "M17 4V2H7v2H3v4a4 4 0 0 0 4 4h.35A6 6 0 0 0 11 15.91V18H8v3h8v-3h-3v-2.09A6 6 0 0 0 16.65 12H17a4 4 0 0 0 4-4V4h-4ZM5 8V6h2v4a2 2 0 0 1-2-2Zm14 0a2 2 0 0 1-2 2V6h2Z",
  mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z",
  globe:
    "M11.99 2A10 10 0 1 0 22 12 10 10 0 0 0 11.99 2Zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8ZM12 4.04A14.09 14.09 0 0 1 13.91 8h-3.82A14.09 14.09 0 0 1 12 4.04ZM4.26 14a8.12 8.12 0 0 1 0-4h3.38a16.51 16.51 0 0 0-.14 2 16.51 16.51 0 0 0 .14 2Zm.82 2h2.95a15.65 15.65 0 0 0 1.38 3.56A8.03 8.03 0 0 1 5.08 16Zm2.95-8H5.08a8.03 8.03 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8ZM12 19.96A14.09 14.09 0 0 1 10.09 16h3.82A14.09 14.09 0 0 1 12 19.96ZM14.34 14H9.66a14.59 14.59 0 0 1-.16-2 14.59 14.59 0 0 1 .16-2h4.68a14.59 14.59 0 0 1 .16 2 14.59 14.59 0 0 1-.16 2Zm.25 5.56A15.65 15.65 0 0 0 15.97 16h2.95a8.03 8.03 0 0 1-4.33 3.56ZM16.36 14a16.51 16.51 0 0 0 .14-2 16.51 16.51 0 0 0-.14-2h3.38a8.12 8.12 0 0 1 0 4Z",
  tag: "M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.84ZM5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7Z",
  // For a tag that puts songs away: a lid bar overhanging a box body, with one notch
  // cut out of the lid's top edge. The notch is part of the lid's own outline
  // rather than a punched-out shape, so no fill rule is involved.
  archive: "M2 4h8v2h4V4h8v4H2V4Zm2 5h16v12H4V9Z",
  // A tag row the reader may see but not set. The shackle is one contour whose
  // inner arc runs back the way the outer one came, so the default nonzero fill
  // leaves the hole open — the two halves must never wind the same way. It is
  // half the body's width and stands on straight legs: a wide shallow arch on a
  // box reads as a handbag once the glyph is drawn any bigger than a row mark.
  lock: "M8 11V7a4 4 0 0 1 8 0v4h-2V7a2 2 0 0 0-4 0v4H8Zm-4-1h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z",
  // The Songs filter: one solid funnel, a wide bar at the top tapering into a
  // short stem. Symmetric about x=12 (3/21 and 10/14), and the stem's slanted
  // foot is what keeps it from reading as a plain triangle at row size.
  filter: "M3 4h18l-7 8v7l-4 2v-9L3 4Z",
  calendar:
    "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14Zm0-12H5V6h14Z",
  disc: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  user: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z",
  // "add a person": the `user` bust shifted left to make room, with `plus`
  // beside its right shoulder at half the arm length. The three subpaths never
  // touch (head x5–13, bust x1–17 below y14, plus x15–23), so the nonzero fill
  // rule has nothing to punch out and the winding does not matter.
  "user-plus":
    "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Zm9-7h2v3h3v2h-3v3h-2v-3h-3v-2h3V7Z",
  database:
    "M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4Zm-8 6.5V12c0 2.21 3.58 4 8 4s8-1.79 8-4V9.5c-1.7 1.5-4.7 2.5-8 2.5s-6.3-1-8-2.5Zm0 4.5V17c0 2.21 3.58 4 8 4s8-1.79 8-4v-2.99c-1.7 1.5-4.7 2.49-8 2.49s-6.3-.99-8-2.5Z",
  video:
    "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z",
  music: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v2h-2V7Zm0 4h2v6h-2v-6Z",
  // Comments — the modal row, the sub-view and its empty state. One rounded
  // speech bubble whose tail replaces the bottom-left corner, so three corners
  // are rounded and the fourth is the tail. Drawn on the same 18-unit grid as
  // `info` and `clock` (3…21), one closed contour, no fill rule.
  comment: "M6 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2Z",
  // The three-bar stack is the wishlist family: +plus = wish for it, +check =
  // already wished. Keeping the bars identical makes them read as one family at
  // 1.1em. The bare `playlist` bars are the base both are built from; no
  // control uses them on their own any more.
  playlist: "M3 6h12v2H3V6Zm0 4h12v2H3v-2Zm0 4h8v2H3v-2Z",
  "playlist-check":
    "M3 6h12v2H3V6Zm0 4h12v2H3v-2Zm0 4h8v2H3v-2Zm17.1-1.9 1.4 1.4-6.1 6.1-3.2-3.2 1.4-1.4 1.8 1.8 4.7-4.7Z",
  "playlist-plus":
    "M3 6h12v2H3V6Zm0 4h12v2H3v-2Zm0 4h8v2H3v-2Zm13 0v-3h2v3h3v2h-3v3h-2v-3h-3v-2h3Z",
  // The bulleted rows are the playlists family, so a playlist never gets
  // confused with the three-bar wishlist glyph next to it. `list-plus` and
  // `list-check` shorten the lower two bars to x=14 to make room and then carry
  // the *same* plus and check `playlist-plus`/`playlist-check` carry, shifted
  // 2 to the right — that shared mark is what pairs the two families.
  list: "M5 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h10v2H10V6Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h10v2H10v-2Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h10v2H10v-2Z",
  "list-plus":
    "M5 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h10v2H10V6Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h4v2H10v-2Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h4v2H10v-2ZM18 14v-3h2v3h3v2h-3v3h-2v-3h-3v-2h3Z",
  // The check is `playlist-check`'s, re-anchored absolutely first: there it is
  // written as a relative `m` continuation of the bars, which would land it
  // somewhere else entirely once the bars underneath it change length.
  "list-check":
    "M5 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h10v2H10V6Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h4v2H10v-2Zm-5 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 .5h4v2H10v-2ZM22.1 12.1l1.4 1.4-6.1 6.1-3.2-3.2 1.4-1.4 1.8 1.8 4.7-4.7Z",
  // Following a playlist keeps it in your listing, so the ribbon is the mark.
  bookmark: "M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z",
  // The same ribbon behind the diagonal bar `average` uses, cut along it with a
  // gap of about a pixel either side: a bar merely laid over the ribbon would
  // merge into one blob at 1em, since both are drawn in the one colour.
  "bookmark-off":
    "M7 3h11L6 15V4a1 1 0 0 1 1-1ZM18 9v12l-6-4-6 4ZM5.28 20.28 3.72 18.72 18.72 3.72 20.28 5.28Z",
  chart: "M4 20h16v2H4v-2Zm1-8h3v7H5v-7Zm5.5-7h3v14h-3V5ZM16 9h3v10h-3V9Z",
  // The mean mark — the statistician's ⌀, which is what the old app's
  // `TbMathAvg` draws. Two things keep it off the "forbidden" sign: the ring is
  // a 2.4-unit hairline rather than a fat donut, and the slash *ascends* and
  // overhangs the ring by 2.6 units at both ends instead of being contained by
  // it. Winding, since `fill-rule` is not available: the outer circle runs
  // clockwise, the inner one counter-clockwise so the nonzero rule punches the
  // middle out, and the slash runs clockwise like the outer circle — wound the
  // other way it would cancel the ring wherever it crosses it.
  average:
    "M4 12A8 8 0 0 1 20 12 8 8 0 0 1 4 12ZM6.4 12A5.6 5.6 0 0 0 17.6 12 5.6 5.6 0 0 0 6.4 12ZM5.28 20.28 3.72 18.72 18.72 3.72 20.28 5.28Z",
  // "#" — the count marker (old app's `MdNumbers`). Upright rather than
  // italic: at caption size the slanted bars smear into each other.
  hash: "M7 3h2v18H7V3Zm8 0h2v18h-2V3ZM3 8h18v2H3V8Zm0 6h18v2H3v-2Z",
  // "change the picture": a solid frame with the mountain and the sun punched
  // out by the nonzero fill rule. Solid rather than outlined because this glyph
  // is worn as a 14px badge on the avatar, where hairlines disappear.
  image:
    "M3 5h18v14H3V5Zm2 12h11l-5.5-7.5ZM17 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4Z",
  // The power symbol: an almost-closed ring (outer arc one way, inner arc the other, so
  // the nonzero fill rule punches the middle out) with the gap at the top, plus the stem
  // through it. Arc endpoints sit at 55° and 125°, which is what leaves the gap.
  power:
    "M7.12 5.04A8.5 8.5 0 1 0 16.88 5.04L15.44 7.09A6 6 0 1 1 8.56 7.09ZM11 3h2v9.5h-2Z",
  // The die face is solid; the five pips are wound the other way round so the
  // nonzero fill rule punches them out (same trick as `info` and `clock`).
  dice: "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm2 3.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm8 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm-4 4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm-4 4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Zm8 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  // The other faces of the same die, for the spinner's roll (`dice` is the
  // five). Same frame, same punched-out pips.
  "dice-1":
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  "dice-2":
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  "dice-3":
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  "dice-4":
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM8 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  "dice-6":
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM8 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM8 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2ZM16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z",
  // The TV the host screen runs on: a rounded case with the screen wound the
  // other way round so the nonzero fill rule punches it out (as `dice` does),
  // plus the stand bar under it.
  tv: "M3 5h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8h16V7ZM8 20h8v2H8v-2Z",
  // The octocat silhouette, one closed outline — the ears, the arms and the
  // tail are all the same subpath, so no fill rule is involved. Drawn on the
  // 18px grid `info` and `clock` use (3…21) rather than edge to edge, or the
  // solid mark would outweigh the small text beside it in the About footer.
  github:
    "M12 3C7.0275 3 3 7.0275 3 12c0 3.9825 2.5763 7.3463 6.1537 8.5388.45.0788.6188-.1912.6188-.4275 0-.2137-.0112-.9225-.0112-1.6762-2.2612.4163-2.8462-.5512-3.0262-1.0575-.1012-.2588-.54-1.0575-.9225-1.2712-.315-.1687-.765-.585-.0112-.5963.7088-.0112 1.215.6525 1.3838.9225.81 1.3613 2.1038.9788 2.6213.7425.0788-.585.315-.9787.5738-1.2038-2.0025-.225-4.095-1.0012-4.095-4.4438 0-.9787.3488-1.7887.9225-2.4187-.09-.225-.405-1.1475.09-2.385 0 0 .7538-.2362 2.475.9225.72-.2025 1.485-.3037 2.25-.3037s1.53.1012 2.25.3038c1.7213-1.17 2.475-.9225 2.475-.9225.495 1.2375.18 2.16.09 2.385.5738.63.9225 1.4288.9225 2.4187 0 3.4538-2.1038 4.2188-4.1062 4.4438.3263.2813.6075.8213.6075 1.665 0 1.2038-.0112 2.1713-.0112 2.475 0 .2363.1687.5175.6188.4275A9.0135 9.0135 0 0 0 21 12c0-4.9725-4.0275-9-9-9Z",
  // ------------------------------------------------------------ tag glyphs
  // The twelve that exist only so a tag can say something about a *song*
  // (ui-guidelines §3): party, ballad, christmas, birthday, kids, rock, the
  // classics, film, game, country and hard-to-sing. Every one is read twice —
  // 40px in the editor's picker and 0.8em (~11px) as a song-row mark — so they
  // are few bold shapes, and what carries the reading is drawn at least as wide
  // as `music`'s two-unit stem, the thinnest thing the glyphs beside them in a
  // row are made of. Thinner than that is for detail the glyph survives losing:
  // `skull`'s bridge between the sockets, `film`'s margin outside the sprockets.

  // The party tag: one teardrop tongue, notched at the foot. The kink on the
  // left shoulder (out to x=6.6, back in to x=8.5) is what tells it from
  // `heart` turned upside down — without it a pointed teardrop reads as a leaf.
  // Drawn 14 units wide rather than 11.6: the narrower first cut sat visibly
  // smaller than `archive` and `alert` in the same row of marks.
  flame:
    "M12 2c.5 4.2 4.8 6.6 7 12.7a7 7 0 0 1-5.5 6.9L12 19.9l-1.5 1.7a7 7 0 0 1-5.5-6.9c0-1.7.6-3 1.6-4.1c.1 1.3.8 2.4 1.9 3C8.8 9.9 10.7 6.8 12 2Z",
  // Slow songs and ballads: a crescent, a disc cut out of a disc — but drawn
  // as *one* contour, the long way round the outer circle (r 9.6 about the
  // centre) and back along the cutting one (r 8.4, its centre pushed 6.1 up
  // and to the right). Two whole circles cannot do it: the cutting disc has to
  // reach past the outer rim to open a crescent rather than a hole, and
  // whatever of it lands outside is nonzero too, so it fills in as a second
  // crescent and the pair reads as a ring. Belly 7.3 units — the weight
  // `archive` and `video` carry — with 120° of sky between the horns.
  moon: "M9.53 2.72A9.6 9.6 0 1 0 21.28 14.47A8.4 8.4 0 0 1 9.53 2.72Z",
  // The winter half of christmas: three crossed bars — one upright, two at
  // ±60° — with a short fork at each of the six tips. One polygon per bar, so
  // the three are the same shape rotated and no tip is drawn twice. Three
  // units across the bar: at 2.6 the whole flake greyed out at row size.
  snowflake:
    "M13.5 2 13.5 4.6 15.8 2.8 16.9 4.2 13.5 6.8 13.5 17.2 16.9 19.8 15.8 21.2 13.5 19.4 13.5 22 10.5 22 10.5 19.4 8.2 21.2 7.1 19.8 10.5 17.2 10.5 6.8 7.1 4.2 8.2 2.8 10.5 4.6 10.5 2ZM21.4 8.3 19.2 9.6 21.9 10.7 21.2 12.3 17.3 10.7 8.2 15.9 7.7 20.1 5.9 19.9 6.3 17 4.1 18.3 2.6 15.7 4.8 14.4 2.1 13.3 2.8 11.7 6.7 13.3 15.8 8.1 16.3 3.9 18.1 4.1 17.7 7 19.9 5.7ZM4.1 5.7 6.3 7 5.9 4.1 7.7 3.9 8.2 8.1 17.3 13.3 21.2 11.7 21.9 13.3 19.2 14.4 21.4 15.7 19.9 18.3 17.7 17 18.1 19.9 16.3 20.1 15.8 15.9 6.7 10.7 2.8 12.3 2.1 10.7 4.8 9.6 2.6 8.3Z",
  // Presents: a box under a lid bar, with the ribbon band down the middle cut
  // out rather than drawn — in a one-colour glyph the ribbon can only be the
  // negative space between the two halves. The band is wound the other way
  // round from the box, which is what opens it, and it stops at the lid: run
  // through the lid as well it halves the whole glyph, and each half then
  // reads as a bag rather than the two of them as a box. The bow is two
  // petals, each a half-disc closed back to the knot on the ribbon's edge,
  // sharing its foot with the lid's top so nothing floats.
  gift: "M2 8.4h20v4H2Zm2 4h16V22H4Zm6.6 0v9.6h2.8v-9.6ZM10.6 8.4 7.6 8.4a2.6 2.6 0 0 1 0-5.2ZM13.4 8.4 16.4 3.2a2.6 2.6 0 0 1 0 5.2Z",
  // Birthdays: a slab on a plate, three candles. The candles stand *on* the
  // slab (they end where it starts) so the four subpaths read as one object;
  // the plate keeps a unit of air under the slab so it stays a separate bar.
  cake: "M2 20h20v2H2Zm2-9h16v8H4Zm1.3-7h2.2v7H5.3Zm5.6 0h2.2v7h-2.2Zm5.6 0h2.2v7h-2.2Z",
  // Songs for kids: a round head over a body, arms out and legs apart — never
  // `user`, which is the grown-up bust and means an account everywhere else.
  // Five subpaths all wound the same way (the head clockwise like the bars),
  // so the nonzero fill unions them where the torso crosses the arms and the
  // two legs cross each other. The head is eight units across — twice the
  // torso and more than half the arm bar — because a small head over a long
  // bar is a dagger, not a child: it is the ratio between those two, not the
  // head's own size, that carries the reading at 0.8em.
  child:
    "M12 1.4a4 4 0 1 1 0 8 4 4 0 1 1 0-8ZM4.6 11h14.8v3.2H4.6Zm5.4-2h4v8.2h-4ZM10.2 16.2h3.6l-3.6 6.2H6.6ZM10.2 16.2h3.6l3.6 6.2h-3.6Z",
  // Rock: two bouts with a waist between them, the sound hole cut out of the
  // upper one (wound the other way round), and the neck running out of it to
  // the top right, widening once into the head. The waist is what makes it a
  // guitar: one round body with a hole in the middle and a stick on it is a
  // magnifier, whichever way the stick points. The neck starts a unit and a
  // quarter clear of the hole — a bar that grazed it would fill the hole back
  // in wherever the two overlap.
  guitar:
    "M7.6 11a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4ZM12.2 7.7a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8ZM12.2 9.8a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 1 1 0-3.6ZM15.2 10.4 18.5 7.1 19 7.6 20.6 5.9 17.9 3.2 16.2 4.8 16.7 5.3 13.4 8.6Z",
  // The classics everybody knows: three points over a solid band. The band is
  // a separate bar under the crown rather than its foot, so the two read apart
  // at row size instead of merging into one lump.
  crown: "M3 6l4 4.5 5-7 5 7 4-4.5-1.4 10H4.4L3 6Zm1 11.5h16v3H4Z",
  // Movies and musicals: a strip with two rows of sprocket holes, `video`
  // staying the camera. Six square holes, counter-wound so they punch through,
  // and deliberately chunky — at 0.8em anything thinner closes up and the
  // glyph goes back to being a plain square.
  film: "M3 3h18v18H3ZM4.4 5.5v2.6h2.6V5.5Zm0 5.2v2.6h2.6v-2.6Zm0 5.2v2.6h2.6v-2.6Zm12.6-10.4v2.6h2.6V5.5Zm0 5.2v2.6h2.6v-2.6Zm0 5.2v2.6h2.6v-2.6Z",
  // Game music: a lozenge with the d-pad cross and two buttons cut out. The
  // cross is one twelve-point contour running the opposite way from the pill,
  // and the buttons are the `dice` pip trick — two half-arcs the other way
  // round. The two buttons keep a unit and a third of lozenge between them:
  // any closer and the pair fuses into one smear before the picker's 40px.
  gamepad:
    "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7ZM7.4 9v1.9H5.5v2.2h1.9V15h2.2v-1.9h1.9v-2.2H9.6V9ZM15.9 8.4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm2.9 3.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z",
  // A language or a country: a triangular pennant on a staff. The staff runs
  // the full height so the glyph has a baseline to sit on, which is what keeps
  // the pennant from floating when it sits between two other marks.
  flag: "M4 2h2v20H4ZM6 3l14 4.5L6 12Z",
  // Hard to sing: a cranium over a jaw, the eye sockets cut out (sweep 1
  // against the head's 0) and a triangular nose punched the same way. The jaw
  // is part of the head's own outline, not a second box, so nothing can drift.
  skull:
    "M12 2a8 8 0 0 0-8 8c0 2.6 1.3 4.9 3.2 6.3V19h9.6v-2.7c1.9-1.4 3.2-3.7 3.2-6.3a8 8 0 0 0-8-8ZM9 8.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4Zm6 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4ZM12 13.4l1.5 2.6h-3Z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * The icons a tag may be given, in the order the picker offers them
 * (ui-guidelines §3): the glyphs that say something about a *song*. It is an
 * allowlist rather than "everything minus the controls", because most of
 * `ICON_PATHS` has a job elsewhere in the app — `clock` is Recent, `star` the
 * winner accent, `tag` the tags feature itself — and a tag wearing one of those
 * would be saying the wrong thing. The eight general ones come first, then the
 * twelve drawn for tags, each group in its own line here.
 *
 * A tag may still carry a glyph this list leaves out: the picker keeps such a
 * one chosen and choosable for that tag, and it draws like any other.
 */
export const PICKER_ICON_NAMES: readonly IconName[] = [
  "users",
  "alert",
  "archive",
  "calendar",
  "disc",
  "user",
  "video",
  "music",
  "flame",
  "moon",
  "snowflake",
  "gift",
  "cake",
  "child",
  "guitar",
  "crown",
  "film",
  "gamepad",
  "flag",
  "skull",
  // `as const` like `ICON_PATHS` above: the annotation is what checks the
  // names, and a plain array literal exported from the file that also exports
  // `Icon` is what `react-refresh/only-export-components` warns about.
] as const;

export function Icon({
  name,
  className,
  gradient = false,
}: {
  name: IconName;
  className?: string;
  /**
   * Paint the glyph with a two-stop diagonal gradient instead of
   * `currentColor`. The stops carry no colour of their own — style them from
   * the caller's stylesheet with `stop-color`, as `.playlist-spin` does; a
   * `var()` in the SVG attribute would not resolve everywhere. The id is per
   * instance, so two gradient icons on a page never fight over it.
   */
  gradient?: boolean;
}) {
  const id = `icon-gradient-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {gradient && (
        <defs>
          {/* Corner to corner: the 135deg of the gradient button's sweep. */}
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" />
            <stop offset="1" />
          </linearGradient>
        </defs>
      )}
      {/* An attribute, not a class: it sits on the path itself and so outranks
          the `fill: currentColor` the `.icon` rule puts on the svg. */}
      <path d={ICON_PATHS[name]} fill={gradient ? `url(#${id})` : undefined} />
    </svg>
  );
}
