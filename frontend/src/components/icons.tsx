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
  calendar:
    "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14Zm0-12H5V6h14Z",
  disc: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  user: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z",
  database:
    "M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4Zm-8 6.5V12c0 2.21 3.58 4 8 4s8-1.79 8-4V9.5c-1.7 1.5-4.7 2.5-8 2.5s-6.3-1-8-2.5Zm0 4.5V17c0 2.21 3.58 4 8 4s8-1.79 8-4v-2.99c-1.7 1.5-4.7 2.49-8 2.49s-6.3-.99-8-2.5Z",
  video:
    "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z",
  music: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v2h-2V7Zm0 4h2v6h-2v-6Z",
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
} as const;

export type IconName = keyof typeof ICON_PATHS;

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
