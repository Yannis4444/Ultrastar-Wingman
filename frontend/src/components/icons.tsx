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
  // The background music's transport, beside `play` and `stop` because they are
  // the same family of control. Two upright bars at `play`'s own height, and
  // `play` again with the bar it runs into. Neither is pickable: a tag is about
  // a song, and pausing is not something a song is.
  pause: "M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z",
  skip: "M7 5v14l9-7-9-7Zm10 0h2.5v14H17V5Z",
  // A speaker cone under two arcs. The Sound settings group and the music
  // permissions wear it as a label, which is a job rather than a meaning (`tv`
  // labels the Host group the same way), and the volume slider is named by it.
  volume:
    "M4 9.5h3.2L12 5v14L7.2 14.5H4v-5Zm11.6-1.2a5 5 0 0 1 0 7.4l-1.4-1.4a3 3 0 0 0 0-4.6l1.4-1.4Zm2.5-2.5a8.5 8.5 0 0 1 0 12.4l-1.4-1.4a6.5 6.5 0 0 0 0-9.6l1.4-1.4Z",
  heart:
    "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
  "chevron-down": "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z",
  "chevron-right": "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z",
  "chevron-left": "M15.41 7.41 10.83 12l4.58 4.59L14 18l-6-6 6-6 1.41 1.41Z",
  // Long, thin arrows — a score summary's "best" and "worst" markers. Slimmer
  // than the chevrons so a run of five stats stays readable at 0.85em.
  "arrow-up": "M12 3l6 7h-4v11h-4V10H6l6-7Z",
  "arrow-down": "M12 21l-6-7h4V3h4v11h4l-6 7Z",
  download:
    "M11 3h2v8.2l3.1-3.1 1.4 1.4L12 15 6.5 9.5 7.9 8.1 11 11.2V3Zm-6 15h14v2H5v-2Z",
  // `download` mirrored: the same shaft, arrowhead and tray bar, the arrow
  // coming up out of the bar instead of down into it. The pair is what makes
  // "in" and "out" readable at a glance on the two archive buttons.
  upload:
    "M11 21h2v-8.2l3.1 3.1 1.4-1.4L12 9l-5.5 5.5 1.4 1.4L11 12.8V21Zm-6-15h14V4H5v2Z",
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
  // A player who is shown, in the people admin. The almond is two quadratics out
  // and two back; the second one is counter-wound, so the white of the eye stays
  // open under the nonzero fill and only the rim and the pupil are drawn.
  eye: "M1 12Q12 1 23 12Q12 23 1 12ZM19.5 12Q12 4 4.5 12Q12 20 19.5 12ZM12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2Z",
  // The same almond behind `bookmark-off`'s diagonal bar, cut along it with the
  // same gap either side — the two subpaths are the rim's upper-left and
  // lower-right halves, their cut ends meeting the bar's line at 21 and 27. The
  // pupil goes with the cut: the bar crosses exactly where it sits, and what the
  // gap would leave of it is two slivers nobody can read at 1em.
  "eye-off":
    "M5.45 15.55Q3.23 14.23 1 12Q7.63 5.37 14.27 6.73L12.94 8.06Q8.72 7.5 4.5 12Q5.69 13.26 6.87 14.13L5.45 15.55ZM18.55 8.45Q20.77 9.77 23 12Q16.37 18.63 9.73 17.27L11.06 15.94Q15.28 16.5 19.5 12Q18.31 10.74 17.13 9.87L18.55 8.45ZM5.28 20.28 3.72 18.72 18.72 3.72 20.28 5.28Z",
  chart: "M4 20h16v2H4v-2Zm1-8h3v7H5v-7Zm5.5-7h3v14h-3V5ZM16 9h3v10h-3V9Z",
  // "everything at once" — the session picker's head row. Three stacked
  // lozenges seen at an angle: the top one solid, the two under it only the
  // thin V of their front edge, which is all a layer below the top one shows.
  layers:
    "M12 2 20.5 7 12 12 3.5 7ZM3.5 10.4 12 15.4 20.5 10.4 20.5 12.2 12 17.2 3.5 12.2ZM3.5 14.4 12 19.4 20.5 14.4 20.5 16.2 12 21.2 3.5 16.2Z",
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
  // The host screen's full-screen control: four corner brackets at the edges
  // of the square, their corners pointing out, and the same four drawn the
  // other way round — corners in towards the middle — to leave it. Square
  // ends, two units thick like `music`'s stem. Neither is pickable: a control,
  // not a thing a song is about.
  fullscreen:
    "M4 4h6v2H6v4H4V4ZM14 4h6v6h-2V6h-4V4ZM20 20h-6v-2h4v-4h2v6ZM4 20v-6h2v4h4v2H4Z",
  "fullscreen-exit":
    "M8 4h2v6H4V8h4V4ZM14 4h2v4h4v2h-6V4ZM14 14h6v2h-4v4h-2v-6ZM4 14h6v6H8v-4H4v-2Z",
  // The octocat silhouette, one closed outline — the ears, the arms and the
  // tail are all the same subpath, so no fill rule is involved. Drawn on the
  // 18px grid `info` and `clock` use (3…21) rather than edge to edge, or the
  // solid mark would outweigh the small text beside it in the About footer.
  github:
    "M12 3C7.0275 3 3 7.0275 3 12c0 3.9825 2.5763 7.3463 6.1537 8.5388.45.0788.6188-.1912.6188-.4275 0-.2137-.0112-.9225-.0112-1.6762-2.2612.4163-2.8462-.5512-3.0262-1.0575-.1012-.2588-.54-1.0575-.9225-1.2712-.315-.1687-.765-.585-.0112-.5963.7088-.0112 1.215.6525 1.3838.9225.81 1.3613 2.1038.9788 2.6213.7425.0788-.585.315-.9787.5738-1.2038-2.0025-.225-4.095-1.0012-4.095-4.4438 0-.9787.3488-1.7887.9225-2.4187-.09-.225-.405-1.1475.09-2.385 0 0 .7538-.2362 2.475.9225.72-.2025 1.485-.3037 2.25-.3037s1.53.1012 2.25.3038c1.7213-1.17 2.475-.9225 2.475-.9225.495 1.2375.18 2.16.09 2.385.5738.63.9225 1.4288.9225 2.4187 0 3.4538-2.1038 4.2188-4.1062 4.4438.3263.2813.6075.8213.6075 1.665 0 1.2038-.0112 2.1713-.0112 2.475 0 .2363.1687.5175.6188.4275A9.0135 9.0135 0 0 0 21 12c0-4.9725-4.0275-9-9-9Z",
  // ------------------------------------------------------------ tag glyphs
  // The thirty-four that exist only so a tag can say something about a *song*
  // (ui-guidelines §3), from party and ballad through the seasons, the genres
  // and the occasions to the gym set. Every one is read twice — 40px in the
  // editor's picker and 0.8em (~11px) as a song-row mark — so they
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
  // Summer: a disc under eight rays that stand clear of it by 1.8. Rays rooted
  // *inside* the disc were drawn twice and starred both times — eight roots
  // eat so much of the rim that what is left of it reads as the notches of a
  // star, not as a circle. Detached, nothing overlaps and no winding has to
  // agree with any other: nine subpaths, nothing cut out. Each ray is 2.8 wide
  // at the root and 2 at the tip, `music`'s stem, so it stays a wedge at 12px
  // where a ray tapering to a point would be a hair.
  sun: "M12 7a5 5 0 1 1 0 10 5 5 0 1 1 0-10ZM18.8 13.4 18.8 10.6 22.8 11 22.8 13ZM15.8 17.8 17.8 15.8 20.3 18.9 18.9 20.3ZM10.6 18.8 13.4 18.8 13 22.8 11 22.8ZM6.2 15.8 8.2 17.8 5.1 20.3 3.7 18.9ZM5.2 10.6 5.2 13.4 1.2 13 1.2 11ZM8.2 6.2 6.2 8.2 3.7 5.1 5.1 3.7ZM13.4 5.2 10.6 5.2 11 1.2 13 1.2ZM17.8 8.2 15.8 6.2 18.9 3.7 20.3 5.1Z",
  // Rainy songs: a scalloped half-disc canopy over a stem that hooks left at
  // the foot. The four scallops are part of the canopy's own outline — arcs
  // bulging *down* on the way back along the hem — so the canopy is one
  // contour and no fill rule is involved. The hook is the piece that tells the
  // glyph from a mushroom: without it the stem is a stalk.
  umbrella:
    "M2 12A10 10 0 0 1 22 12a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0ZM10.9 11h2.2v7h-2.2ZM13.1 17.6v0.8a3.1 3.1 0 0 1-6.2 0h2.2a0.9 0.9 0 0 0 1.8 0v-0.8Z",
  // Drinking songs: a tankard under a three-lobe foam cap, the handle a loop
  // off the right side whose inner arc runs back the way the outer one came,
  // so the nonzero fill leaves the grip hole open. The foam is a bar with
  // three discs riding on it rather than a scalloped outline — at row size the
  // lobes have to overlap the bar by a couple of units or the cap breaks up.
  beer: "M4 9h11v12H4ZM4 6.4h11v3H4ZM6.6 3.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2ZM9.6 2.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2ZM12.7 3.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2ZM15 9.5a4.5 4.5 0 0 1 0 9v-2.3a2.2 2.2 0 0 0 0-4.4Z",
  // Road songs: a cabin stepped onto a body over two wheel discs, the two
  // windows counter-wound so the nonzero fill punches them out of the cabin.
  // The wheels sit half under the body and half below it — a car drawn with
  // the wheels clear of the body reads as a trolley at 0.8em.
  car: "M2 12h20v5H2ZM6.5 6h9.5l2.5 6H4ZM7.6 7.4 6 10.8 11.2 10.8 11.2 7.4ZM12.4 7.4 12.4 10.8 16.8 10.8 15.4 7.4ZM7 14.7a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 1 1 0-5.6ZM17 14.7a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 1 1 0-5.6Z",
  // Holidays: one outline — fuselage, swept wings and tailplane — climbing to
  // the top right at 45°, which is what stops it reading as the `send` plane
  // lying flat. Everything is mirrored about that diagonal, so the two wings
  // and the two tailplanes are the same shape and the glyph stays symmetric
  // however small it is drawn. The fuselage is 2.6 units across at its
  // narrowest, `music`'s stem, so the body survives where the tips do not.
  plane:
    "M19.8 4.2 14.6 11.4 14.1 18.4 12.6 19.4 11.9 13.9 8.3 17.6 8.5 20.3 7.6 20.9 5.9 19.8 4.7 19.4 4.2 18.1 3.1 16.4 3.7 15.5 6.4 15.8 10.1 12.1 4.7 11.4 5.6 9.9 12.6 9.5Z",
  // The loud fast ones: a single zigzag contour. Both limbs are cut on the
  // same slant and the top bar is 2.5 units wide, so the bolt keeps its weight
  // where the two halves cross — a bolt drawn from thin strokes loses its
  // middle first and then reads as two unrelated wedges.
  bolt: "M14 2 4 13.5h6.2L9 22 20 10.5h-6.4L16.5 2Z",
  // New year: a dome on a flared rim, with the clapper a separate disc under
  // it. Dome and rim are one contour — the flare is two short slants at the
  // foot rather than a bar of its own, so the bell does not read as a tent
  // with a lid.
  bell: "M12 2.5a6 6 0 0 1 6 6v4.5l2 3.2H4l2-3.2V8.5a6 6 0 0 1 6-6ZM12 17.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 1 1 0-3.4Z",
  // Halloween: a dome over a three-lobe hem, the two eyes counter-wound out of
  // it. The hem's three points hang *below* where the sides end, so the lobes
  // read as cloth and not as a scalloped foot; the eyes are a full 3 units
  // across, since a ghost that loses its eyes is a bell.
  ghost:
    "M12 2.5a7.5 7.5 0 0 1 7.5 7.5v8.6L17 21l-2.5-2.4L12 21l-2.5-2.4L7 21l-2.5-2.4V10a7.5 7.5 0 0 1 7.5-7.5ZM9 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z",
  // Weddings: two concentric circles, the inner one counter-wound so the band
  // is a band and not a disc, with a gem lozenge sitting on top of the rim.
  // The band is 3.4 units thick — as heavy as `archive`'s lid — because a ring
  // drawn as a hairline circle is the one shape that vanishes completely at
  // 12px.
  ring: "M12 8a7 7 0 1 1 0 14 7 7 0 1 1 0-14ZM12 11.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 1 0 0-7.2ZM12 1.6 15 5.2 12 8.8 9 5.2Z",
  // School and graduation: a rhombus board on a trapezoid cap, with the tassel
  // a cord and a knob hanging off the board's right tip. The board is drawn
  // flat rather than in perspective — a foreshortened board and the cap under
  // it merge into one lump before the picker's 40px.
  "graduation-cap":
    "M12 3 22.5 8 12 13 1.5 8ZM6.6 10.3 12 12.9 17.4 10.3 16.4 18H7.6ZM20.9 7.6h2v5.8h-2ZM21.9 13.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2Z",
  // Songs to play rather than sing: a headband arc whose inner edge runs back
  // the way the outer one came — the nonzero fill leaves the head-shaped gap —
  // and two capsule earcups overlapping its ends. The band is 2.4 units thick
  // and the cups 5.6 across, more than twice that: cups no wider than the band
  // leave a horseshoe, which is what the first cut of this glyph drew.
  headphones:
    "M3.4 14.2a8.6 8.6 0 0 1 17.2 0h-2.4a6.2 6.2 0 0 0-12.4 0ZM1.8 15.4a2.8 2.8 0 0 1 5.6 0v2.8a2.8 2.8 0 0 1-5.6 0ZM16.6 15.4a2.8 2.8 0 0 1 5.6 0v2.8a2.8 2.8 0 0 1-5.6 0Z",
  // The drum-driven ones: a cylinder between two rim bars, with one zigzag
  // band of three V's counter-wound out of the shell. The zigzag runs at 45°
  // and is offset 2.6 downwards, which is 1.8 measured across it — steeper V's
  // would need an offset half the shell deep to keep that width, which is why
  // the first cut drew three fat chevrons and read as a saw. It sits in the
  // middle, 3.6 of solid shell above it and 2.6 below, and the rims overhang
  // the shell by 2 on each side: a rim flush with the shell is not a rim.
  drum: "M4 6.4h16v11.2H4ZM2 4.6h20v2.2H2ZM2 17.2h20v2.2H2ZM19.2 10 16.8 12.4 14.4 10 12 12.4 9.6 10 7.2 12.4 4.8 10 4.8 12.6 7.2 15 9.6 12.6 12 15 14.4 12.6 16.8 15 19.2 12.6Z",
  // Songs at the keys: a keybed bar over the keys, with the four black ones
  // counter-wound out of the block — each cut carrying on below as a thin slot
  // so the five white keys are told apart by the same shape that draws the
  // black one. Cutting the slots out of one block rather than drawing five
  // separate white keys is what keeps the gaps empty: a black key laid across
  // a gap between two bars would wind to -1 there and fill it in.
  piano:
    "M3 4h18v3H3ZM3 7h18v13H3ZM5.6 7 5.6 14 6.3 14 6.3 20.2 6.9 20.2 6.9 14 7.6 14 7.6 7ZM9.2 7 9.2 14 9.9 14 9.9 20.2 10.5 20.2 10.5 14 11.2 14 11.2 7ZM12.8 7 12.8 14 13.5 14 13.5 20.2 14.1 20.2 14.1 14 14.8 14 14.8 7ZM16.4 7 16.4 14 17.1 14 17.1 20.2 17.7 20.2 17.7 14 18.4 14 18.4 7Z",
  // The night's openers: a pointed body between two fins over a flame, the
  // porthole counter-wound out of the body. The flame keeps half a unit of air
  // under the body — touching it would read as a fifth fin — and the fins are
  // triangles off the body's sides rather than swept curves, which at 12px are
  // the first thing to close up.
  rocket:
    "M12 1.4 15.6 6.4 15.6 16.4H8.4V6.4ZM12 6.9a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4ZM8.4 10.6 8.4 16.4 5 19v-4ZM15.6 10.6 19 15v4l-3.4-2.6ZM9.6 17h4.8L12 22.4Z",
  // Sea shanties: a ring over a shank crossed by a stock, above one curved
  // fluke bar, the ring's hole counter-wound. The fluke is a single 2.6-unit
  // crescent — outer arc one way, inner the other — rather than two hooks, so
  // there is nothing at the bottom thin enough to break.
  anchor:
    "M12 1.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 1 1 0-5.2ZM12 2.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 1 0 0-2.4ZM10.8 6h2.4v14.6h-2.4ZM6.4 8.4h11.2v2.2H6.4ZM2.6 13.4h2.6a6.8 6.8 0 0 0 13.6 0h2.6a9.4 9.4 0 0 1-18.8 0Z",
  // Folk: three stacked triangles on a short trunk. Each triangle's apex sits
  // well inside the one above it, so the three read as one crown rather than
  // as a stack of separate roofs, and the trunk is 2.8 units wide — the same
  // bar `cake`'s candles are made of.
  tree: "M12 2 16.6 9.2H7.4ZM12 6.4 18.6 14.6H5.4ZM12 11 20.6 20H3.4ZM10.6 19.4h2.8v3h-2.8Z",
  // Animal songs: a pad disc under four toe discs, five subpaths, nothing cut
  // out. The toes are set on an arc and the outer pair sits lower than the
  // inner pair — four toes in a straight line read as a caterpillar. Toe
  // radius 2.2 against the pad's 4.4: at half the pad they stay separate dots
  // at row size instead of fusing into a rosette.
  paw: "M12 12a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 1 1 0-8.8ZM5.4 8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4ZM9.6 4.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4ZM14.4 4.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4ZM18.6 8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4Z",
  // The funny ones: a disc with two eyes and a crescent mouth counter-wound
  // out of it. The mouth is the `moon` construction upside down — a deep arc
  // out and a shallow one back — because a mouth drawn as a stroked arc is not
  // available here, and one drawn as a half-disc turns the face into a bowl.
  smile:
    "M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20ZM8.6 7.9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Zm6.8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3ZM6.6 13a5.6 5.6 0 0 0 10.8 0 9 9 0 0 1-10.8 0Z",
  // The crowd-pleasers: a fist block with the thumb up, over a separate cuff
  // bar. The cuff stands clear of the fist by a unit — run together they are
  // one paddle — and the thumb is a wedge 4.2 units across at its base, so it
  // is still a thumb and not a spike when the glyph is 11px tall.
  "thumbs-up":
    "M13 2.2 15.4 5.6 14.8 9.4H21.6L20.2 21H7.6V8.8h3ZM2 10h4.4v11H2Z",
  // The long ones: two triangles meeting at the waist between two cap bars.
  // The bulbs touch at a single point rather than through a neck: a waist with
  // width in it turns the glyph into a bow tie between two shelves, and the
  // caps are what say "hourglass" anyway.
  hourglass:
    "M4 2.6h16v2.6H4ZM4 18.8h16v2.6H4ZM5.6 5.2h12.8L12 12ZM12 12 18.4 18.8H5.6Z",
  // Carnival: a teardrop bulb over a short zigzag string. The neck is a
  // triangle overlapping the bulb rather than a separate tag, so the balloon
  // is one shape, and the string is a closed band about a unit thick — a
  // hairline string would simply not be there at 12px.
  balloon:
    "M12 2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 1 1 0-13.6ZM10.7 14.2h2.6L12 17.4ZM12.2 16.2 15.6 20.4 12 23 11.4 22.2 13.9 20.1 11.3 16.7Z",
  // The gym set: a bar between two pairs of stacked plates. The inner plates
  // are the tall pair and the outer ones the short pair, which is what gives
  // the glyph a direction to read along; the bar overlaps both inner plates,
  // and the outer pair stands off by 0.8 so the stack reads as plates.
  dumbbell:
    "M7.6 10.6h8.8v2.8H7.6ZM4.8 6.4h3v11.2h-3ZM16.2 6.4h3v11.2h-3ZM1.4 8.4h2.6v7.2H1.4ZM20 8.4h2.6v7.2H20Z",
  // The player selector: a card lying on its side, its chip counter-wound out
  // of the upper left. 20 by 12 rather than `tv`'s squarer case, and a corner
  // radius of 2 against that one's 1, so the two never read as the same
  // rounded box; the chip is what a reader looks for and it sits off centre,
  // where a bank card carries one.
  card: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM5 8v4h5V8Z",
  // *Shuffle again* beside the Songs sort while it is *Random*: two arrows
  // running left to right and crossing once, heads at the right. Each shaft is
  // a two-unit band, level, then 45 degrees, then level again, its corners
  // mitred; all four subpaths are wound the same way, so the crossing fills
  // solid. Not pickable, and never the dice, which are the reel's.
  shuffle:
    "M3 16h2.586l10-10H18v2h-1.586l-10 10H3v-2ZM17 4l4 3-4 3V4ZM3 6h3.414l10 10H18v2h-2.414l-10-10H3V6ZM17 14l4 3-4 3v-6Z",
  // A link that leaves Wingman: the song modal's *Open in a streaming service*
  // row and every service behind it. A square outline open at its upper-right
  // corner — one two-unit band from the top edge's end round to the right
  // edge's, rounded outside and square inside — and an arrow leaving through
  // the gap to the top right, its head an L bar with the shaft mitred into it.
  // Two subpaths that never touch, so the winding does not matter. Not
  // pickable: a link is not a thing a song is about.
  "external-link":
    "M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5h-2v5H6V6h5V4ZM14 2h8v8h-2V5.41l-8.59 8.59L10 12.59 18.59 4H14V2Z",
  // A picture of scores to send: the Scores page's party button, an open score
  // group's *Share a score*, the share panel's Share. Three discs of radius 3,
  // one at the left middle and two at the right top and bottom, joined by two
  // bars two units thick. All five subpaths are wound clockwise, so where a
  // bar runs into a disc the fill stays solid. Never `upload`'s arrow out of a
  // tray, which is the achievements archive; not pickable.
  share:
    "M3 12a3 3 0 1 1 6 0 3 3 0 1 1-6 0ZM15 5a3 3 0 1 1 6 0 3 3 0 1 1-6 0ZM15 19a3 3 0 1 1 6 0 3 3 0 1 1-6 0ZM6.5 12.86l-1-1.72 12-7 1 1.72-12 7ZM5.5 12.86l1-1.72 12 7-1 1.72-12-7Z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * The icons a tag may be given, in the order the picker offers them
 * (ui-guidelines §3): the glyphs that say something about a *song*. It is an
 * allowlist rather than "everything minus the controls", because most of
 * `ICON_PATHS` has a job elsewhere in the app — `clock` is Recent, `star` the
 * winner accent, `tag` the tags feature itself — and a tag wearing one of those
 * would be saying the wrong thing. The eight general ones come first, then the
 * thirty-four drawn for tags, and last `tv`, which was drawn for the host
 * screen: labelling a settings group is a job, not a meaning a tag could
 * contradict.
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
  "sun",
  "umbrella",
  "beer",
  "car",
  "plane",
  "bolt",
  "bell",
  "ghost",
  "ring",
  "graduation-cap",
  "headphones",
  "drum",
  "piano",
  "rocket",
  "anchor",
  "tree",
  "paw",
  "smile",
  "thumbs-up",
  "hourglass",
  "balloon",
  "dumbbell",
  "tv",
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
