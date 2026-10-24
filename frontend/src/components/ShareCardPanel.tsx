import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  PlayerAchievementRead,
  PlayerRead,
  ScoreWithContext,
  SessionRead,
} from "../api";
import { listSongScoresOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import {
  achievementCard,
  cardImageUrls,
  partyCard,
  playerCard,
  scoreCard,
  type CardContent,
  type PartyCardContent,
} from "../shareCard/content";
import { LOGO_URL, renderCard, type CardRequest } from "../shareCard/draw";
import { scoreFlags } from "../shareCard/flags";
import { loadCardImages, type ImageCache } from "../shareCard/images";
import type { CardFormat } from "../shareCard/layout";
import {
  FORMATS,
  SHARE_TOGGLES,
  TOGGLES_REST,
  achievementCardDesigns,
  achievementSlideToggles,
  partyCardDesigns,
  partySlideToggles,
  playerCardDesigns,
  playerSlideToggles,
  resolveAchievementOptions,
  resolvePartyOptions,
  resolvePlayerOptions,
  resolveScoreOptions,
  scoreCardDesigns,
  scoreSlideToggles,
  toggleSentence,
  type AchievementDesign,
  type Choice,
  type PartyDesign,
  type PlayerDesign,
  type ScoreDesign,
  type ShareToggle,
  type ToggleReasons,
} from "../shareCard/possible";
import {
  REMEMBERED_PARTY_DESIGNS,
  readPrefs,
  writePrefs,
  type RememberedPartyDesign,
  type SharePrefs,
} from "../shareCard/prefs";
import { Icon } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import "./ShareCardPanel.css";

/** What the panel makes a card of: a whole party, one score, one singer's
 * scores at a party or over every party (share-cards §9), or one earned
 * achievement of the reader's own (share-cards §10). It takes one
 * card to draw and never a list to choose from (share-cards §6): choosing
 * the score is the surface's that opens it. */
export type ShareTarget =
  | {
      kind: "party";
      session: SessionRead;
      /** The party's scores, exactly as `/scores` showed them. */
      scores: ScoreWithContext[];
    }
  | {
      kind: "score";
      score: ScoreWithContext;
      /** The party the sing belongs to, as the sing view read it; `null` for
       * a sing from before parties were recorded, which names none. */
      session: SessionRead | null;
      /** Every score of the sing, out of the sing view's read: where the
       * "with <name>" of a duet is found (share-cards §7.7). */
      singScores: ScoreWithContext[];
    }
  | {
      kind: "player";
      /** One singer's scores, exactly as the surface showed them: an open
       * player group on `/scores`, or the reader's own record. */
      scores: ScoreWithContext[];
      /** The party they are of; `null` for every party at once, which the
       * card calls *All parties* (share-cards §9). */
      session: SessionRead | null;
    }
  | {
      kind: "achievement";
      /** The reader's own record row, earned and not masked: the only one
       * the achievement modal offers to share (share-cards §10). */
      row: PlayerAchievementRead;
      /** The sharer's player row, for the picture; `null` where the page
       * could not read it, which draws the initial. */
      player: PlayerRead | null;
      /** The sharer's name as the user page writes it. */
      name: string;
    };

interface ShareCardPanelProps {
  target: ShareTarget;
  /** Registered players by id, for the pictures. */
  players: Map<string, PlayerRead>;
  onClose: () => void;
}

type Design = ScoreDesign | PartyDesign | PlayerDesign | AchievementDesign;

const FORMAT_LABELS = { square: "Square", story: "Story" } as const;
const FORMAT_ICONS = {
  square: "format-square",
  story: "format-story",
} as const;
const DESIGN_LABELS: Record<Design, string> = {
  dark: "Dark",
  cover: "Cover",
  podium: "Podium",
  strip: "Strip",
  mosaic: "Mosaic",
  spread: "Spread",
  you: "You",
  histogram: "Histogram",
  songs: "Songs",
  badge: "Badge",
};
/** Each toggle's name — the option's, never the action (ui-guidelines §4). */
const TOGGLE_LABELS: Record<ShareToggle, string> = {
  pictures: "Other singers' pictures",
  date: "Party name and date",
  logo: "Wingman logo",
};
const NO_REASONS: ToggleReasons = { pictures: null, date: null, logo: null };

/** What the long press is for on a page that may not share or copy. */
export const LONG_PRESS_NOTE =
  "Press and hold the picture to save or share it.";

/** How long the carousel has to stand still before the slide it came to rest
 * on is the one in view — the snap ends in a run of scroll events, and a
 * quiet tenth of a second is a swipe that has settled. */
export const SETTLE_MS = 100;

/** "Bohemian Rhapsody" → "bohemian-rhapsody", for the file's name. */
function slug(text: string): string {
  const cut = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return cut === "" ? "card" : cut;
}

/** The file's name. A party's is its name or date even when the card leaves
 * them off (share-cards §2.2): the file stays on the sharer's phone. */
function fileName(content: CardContent): string {
  if (content.kind === "score")
    return `wingman-${slug(content.title)}-${content.score}.png`;
  // A player's names the scope too, even when the card leaves it off.
  if (content.kind === "player")
    return `wingman-${slug(content.person.name)}-${slug(content.scope)}.png`;
  if (content.kind === "achievement")
    return `wingman-${slug(content.name)}-${slug(content.sharer.name)}.png`;
  return `wingman-${slug(content.party)}.png`;
}

/** What the picture shows, for a reader who cannot see it. */
function altText(content: CardContent): string {
  if (content.kind === "score")
    return `Share card: ${content.singer.name} scored ${content.score} on ${content.title}`;
  if (content.kind === "player")
    return `Share card of ${content.person.name}'s scores, ${content.scope}`;
  if (content.kind === "achievement")
    return `Share card: ${content.sharer.name} earned ${content.name}`;
  if (content.onlyMe)
    return `Share card of ${content.party}: ${content.ranking[0].person.name}'s scores`;
  return `Share card of ${content.party}, ranked by best score`;
}

function errorName(failure: unknown): string {
  return typeof failure === "object" && failure !== null && "name" in failure
    ? String((failure as { name: unknown }).name)
    : "";
}

/** Whether this browser could hand the file to the system's share sheet. Asked
 * of the file itself: a browser may share links and still refuse a PNG. Plain
 * http has no `canShare` at all. */
function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.canShare === "function" &&
      typeof navigator.share === "function" &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

function mediaMatches(query: string): boolean {
  try {
    return window.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
}

/** A touch screen on a page that is not a secure context: no share, no copy,
 * and the long press on the picture is what is left besides the download. */
function longPressPage(): boolean {
  return !window.isSecureContext && mediaMatches("(pointer: coarse)");
}

/** One design of the card, as its slide in the carousel. */
interface Slide {
  design: Design;
  /** Whether it can be drawn, and the sentence of its dimmed slot. */
  choice: Choice<Design>;
  /** What is drawn on it; `null` for a dimmed slot, which is never drawn. */
  request: CardRequest | null;
  /** `request` as a value, the key a picture is cached under; "" when dimmed. */
  key: string;
  /** Which of the three toggles this slide cannot honour, and why. */
  toggles: ToggleReasons;
}

/** A drawn picture, and the request it was drawn from. */
interface Shot {
  file: File;
  url: string;
  key: string;
}

/** The slide nearest the carousel's own middle, read off the layout; `null`
 * where there is no layout to read (jsdom, a panel not yet laid out). */
function slideNearest(carousel: HTMLElement): number | null {
  const width = carousel.clientWidth;
  if (width === 0) return null;
  const middle = carousel.scrollLeft + width / 2;
  const slides = carousel.querySelectorAll<HTMLElement>(".share-slide");
  let best: number | null = null;
  let distance = Infinity;
  slides.forEach((slide, index) => {
    const away = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - middle);
    if (away < distance) {
      distance = away;
      best = index;
    }
  });
  return best;
}

/** Brings one slide to the carousel's middle: smoothly, or at once for a
 * reader who asked for less motion. */
function scrollToSlide(
  carousel: HTMLElement,
  index: number,
  behavior: ScrollBehavior,
): void {
  const slide = carousel.querySelectorAll<HTMLElement>(".share-slide")[index];
  if (slide === undefined) return;
  const left =
    slide.offsetLeft + slide.offsetWidth / 2 - carousel.clientWidth / 2;
  if (typeof carousel.scrollTo === "function")
    carousel.scrollTo({ left, behavior });
  else carousel.scrollLeft = left;
}

interface CarouselProps {
  /** The slides' shape: a story slide is as narrow as its picture. */
  format: CardFormat;
  slides: Slide[];
  /** The slide in view. */
  index: number;
  onMove: (index: number) => void;
  /** What one slide holds. */
  renderSlide: (slide: Slide, index: number) => ReactNode;
  /** What closes the dots row after its rule: the format pair. */
  trailing: ReactNode;
}

/**
 * The card's designs as one scroll-snapped row (ui-guidelines §7, *Share
 * cards*), with the arrows, the dots and the format pair under it. The slide
 * in view is read off the scroll position once a swipe has settled
 * (`SETTLE_MS`): one path in every browser, Safari's without `scrollend`
 * included, and exact where an `IntersectionObserver` would answer in
 * thresholds. An arrow or a key moves the choice at once and lets the row
 * follow; the reading the settled scroll then makes agrees with it, so
 * nothing flickers.
 */
function DesignCarousel({
  format,
  slides,
  index,
  onMove,
  renderSlide,
  trailing,
}: CarouselProps) {
  const carousel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const current = useRef(index);
  current.current = index;
  const last = slides.length - 1;

  // Opened on the remembered design: there before the first paint, so the row
  // never visibly runs to it.
  useLayoutEffect(() => {
    const row = carousel.current;
    if (row !== null) scrollToSlide(row, current.current, "instant");
    return () => window.clearTimeout(settle.current);
  }, []);

  // The other format changes every slide's width under the scroll position:
  // the slide in view is brought back to the middle before the paint.
  const shownFormat = useRef(format);
  useLayoutEffect(() => {
    if (shownFormat.current === format) return;
    shownFormat.current = format;
    const row = carousel.current;
    if (row !== null) scrollToSlide(row, current.current, "instant");
  }, [format]);

  /** The arrow the keyboard moves to once a move has been drawn. */
  const handOver = useRef<typeof previous | null>(null);
  useLayoutEffect(() => {
    handOver.current?.current?.focus();
    handOver.current = null;
  }, [index]);

  const go = (to: number, from: "previous" | "next" | null) => {
    if (to < 0 || to > last || to === index) return;
    onMove(to);
    const row = carousel.current;
    if (row !== null)
      scrollToSlide(
        row,
        to,
        mediaMatches("(prefers-reduced-motion: reduce)") ? "instant" : "smooth",
      );
    // An arrow that reached its end is disabled under the finger, and a
    // disabled button drops the keyboard on the page: it moves to the other,
    // once the move has been drawn — with two slides the other arrow is
    // itself still disabled at the moment of the press.
    if (from === "next" && to === last) handOver.current = previous;
    if (from === "previous" && to === 0) handOver.current = next;
  };

  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const row = carousel.current;
      if (row === null) return;
      const nearest = slideNearest(row);
      if (nearest !== null && nearest !== current.current) onMove(nearest);
    }, SETTLE_MS);
  };

  const label = (slide: Slide) => DESIGN_LABELS[slide.design];

  return (
    <>
      <div
        ref={carousel}
        className={`share-carousel share-carousel-${format}`}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Designs"
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          // The row would scroll a few pixels by itself and snap back.
          event.preventDefault();
          go(event.key === "ArrowLeft" ? index - 1 : index + 1, null);
        }}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.design}
            className="share-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${label(slide)}, ${i + 1} of ${slides.length}`}
            data-design={slide.design}
            aria-current={i === index || undefined}
          >
            {renderSlide(slide, i)}
          </div>
        ))}
      </div>
      <div className="share-carousel-nav">
        {/* One slide has nowhere to go: no arrows, no dots and no rule, and
            the format pair stands alone in the middle (share-cards §5). */}
        {last > 0 && (
          <>
            <button
              ref={previous}
              type="button"
              className="icon-button"
              aria-label="Previous design"
              title="Previous design"
              disabled={index === 0}
              onClick={() => go(index - 1, "previous")}
            >
              <Icon name="chevron-left" />
            </button>
            {/* Decoration: the arrows, the keys and the swipe are the
                controls, the slides' own names say where the reader is. */}
            <div className="share-dots" aria-hidden="true">
              {slides.map((slide, i) => (
                <span
                  key={slide.design}
                  className={[
                    "share-dot",
                    i === index ? "share-dot-on" : "",
                    slide.request === null ? "share-dot-dimmed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
            <button
              ref={next}
              type="button"
              className="icon-button"
              aria-label="Next design"
              title="Next design"
              disabled={index === last}
              onClick={() => go(index + 1, "next")}
            >
              <Icon name="chevron-right" />
            </button>
            <span className="share-nav-rule" aria-hidden="true" />
          </>
        )}
        {trailing}
      </div>
      <p className="share-design-name" aria-live="polite">
        {label(slides[index])}
      </p>
    </>
  );
}

interface FormatPairProps {
  format: CardFormat;
  onChange: (format: CardFormat) => void;
}

/** *Square* · *Story* as two borderless radios at the end of the dots row:
 * the glyph is the shape it makes, the word the reader's alone. */
function FormatPair({ format, onChange }: FormatPairProps) {
  return (
    <div className="share-formats" role="radiogroup" aria-label="Format">
      {FORMATS.map((value) => (
        <label
          key={value}
          className="share-format"
          title={FORMAT_LABELS[value]}
        >
          <input
            className="visually-hidden"
            type="radio"
            name="share-format"
            value={value}
            checked={format === value}
            onChange={() => onChange(value)}
          />
          <span className="share-format-glyph">
            <Icon name={FORMAT_ICONS[value]} />
            <span className="visually-hidden">{FORMAT_LABELS[value]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

interface TogglesProps {
  /** Each toggle's state, as the reader left it. */
  values: Record<ShareToggle, boolean>;
  /** What the slide in view cannot honour, and why. */
  reasons: ToggleReasons;
  onToggle: (toggle: ShareToggle) => void;
  /** The toggle the line under the row is to speak of. */
  onExplain: (toggle: ShareToggle) => void;
}

/**
 * The options row (share-cards §5): the same three icon toggles in the same
 * order on every slide, each `.icon-toggle`. One the slide cannot honour is
 * dimmed in place and keeps the state the reader left it in — the slides
 * that honour it still use it — and a press on it changes nothing but the
 * line, which says why.
 */
function ShareToggles({ values, reasons, onToggle, onExplain }: TogglesProps) {
  return (
    <div className="share-toggles" role="group" aria-label="On the card">
      {SHARE_TOGGLES.map((toggle) => {
        const dimmed = reasons[toggle] !== null;
        return (
          <button
            key={toggle}
            type="button"
            className="icon-button icon-toggle"
            data-toggle={toggle}
            aria-label={TOGGLE_LABELS[toggle]}
            title={TOGGLE_LABELS[toggle]}
            aria-pressed={values[toggle]}
            aria-disabled={dimmed || undefined}
            onClick={() => {
              onExplain(toggle);
              if (!dimmed) onToggle(toggle);
            }}
            onFocus={() => onExplain(toggle)}
            // A mouse alone: a tap's emulated hover would be a second trigger
            // for what the tap itself already says.
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") onExplain(toggle);
            }}
          >
            {toggle === "logo" ? (
              <img src={LOGO_URL} alt="" width={24} height={24} />
            ) : (
              <Icon name={toggle === "pictures" ? "image" : "calendar"} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The share panel (share-cards.md §5, ui-guidelines §7 *Share cards*): a bare
 * modal with no visible heading over the card's designs as real pictures in a
 * carousel, the format beside the dots, the three toggles and the line that
 * explains them, and the buttons this browser can actually carry out.
 */
export default function ShareCardPanel({
  target,
  players,
  onClose,
}: ShareCardPanelProps) {
  const auth = useAuth();
  const me = auth.user?.player_id ?? null;
  const [prefs, setPrefs] = useState<SharePrefs>(readPrefs);
  /** The slide in view; `null` until the carousel opens on the remembered
   * design. */
  const [inView, setInView] = useState<number | null>(null);
  /** The toggle the line speaks of: the last one pressed, focused or hovered
   * by a mouse. Leaving it never puts the resting line back. */
  const [explained, setExplained] = useState<ShareToggle | null>(null);

  // On the prefs as they are when it lands, not as a render saw them: a
  // swipe's settled reading arrives a moment after the scroll, and a toggle
  // pressed in between must not be written back over.
  const update = (patch: Partial<SharePrefs>) => {
    setPrefs((was) => {
      const next = { ...was, ...patch };
      writePrefs(next);
      return next;
    });
  };

  // The flags need the song's whole history, which is the archive: only a
  // reader holding `stats.history` asks, and everybody else's card has none
  // (§7.4). Asked of `/auth/me`'s answer, never of its absence: `can` says
  // yes to anything while that is in flight.
  const scored = target.kind === "score" ? target.score : null;
  const askHistory =
    scored !== null &&
    scored.song !== null &&
    auth.loaded &&
    auth.can("stats.history");
  const history = useQuery({
    ...listSongScoresOptions({ path: { song_id: scored?.song?.id ?? "" } }),
    enabled: askHistory,
  });
  const historyScores = history.data?.scores;
  const flags = useMemo(
    () =>
      askHistory && scored !== null && historyScores !== undefined
        ? scoreFlags(scored, historyScores)
        : null,
    [askHistory, scored, historyScores],
  );
  // A failed read is no history: the card is drawn without a flag. Nothing is
  // drawn before the reader is known — whose picture is always theirs, and
  // whether there is a history to read, both hang on it.
  const flagsSettled = auth.loaded && (!askHistory || !history.isPending);

  // A party has two contents: the whole party, which four of its slides
  // draw, and the sharer alone, which *You* draws.
  const { content, mine } = useMemo<{
    content: CardContent;
    mine: PartyCardContent | null;
  }>(() => {
    const toggles = {
      players,
      me,
      otherPictures: prefs.otherPictures,
      partyNameAndDate: prefs.partyNameAndDate,
    };
    if (target.kind === "party") {
      const input = {
        ...toggles,
        scores: target.scores,
        session: target.session,
      };
      return {
        content: partyCard({ ...input, onlyMe: false }),
        mine: partyCard({ ...input, onlyMe: true }),
      };
    }
    if (target.kind === "player") {
      return {
        content: playerCard({
          ...toggles,
          scores: target.scores,
          session: target.session,
        }),
        mine: null,
      };
    }
    // No toggle reaches its content: the only face is the sharer's own, and
    // the day is the achievement's (share-cards §10).
    if (target.kind === "achievement") {
      return {
        content: achievementCard({
          row: target.row,
          player: target.player,
          name: target.name,
        }),
        mine: null,
      };
    }
    return {
      content: scoreCard({
        ...toggles,
        score: target.score,
        partyScores: target.singScores,
        session: target.session,
        newHighscore: flags?.newHighscore,
        personalBest: flags?.personalBest,
      }),
      mine: null,
    };
  }, [target, players, me, prefs.otherPictures, prefs.partyNameAndDate, flags]);

  // ------------------------------------------------------------- pictures
  // Loaded once per URL for as long as the panel is open, so a change of
  // option never asks for a picture twice.
  const cache = useRef<ImageCache>(new Map());
  const urls = useMemo(
    () => [
      ...new Set([
        LOGO_URL,
        ...cardImageUrls(content),
        ...(mine === null ? [] : cardImageUrls(mine)),
      ]),
    ],
    [content, mine],
  );
  const urlsKey = urls.join("\n");
  const [images, setImages] = useState<{
    key: string;
    map: Map<string, HTMLImageElement>;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void loadCardImages(urls, cache.current).then((map) => {
      if (live) setImages({ key: urlsKey, map });
    });
    return () => {
      live = false;
    };
    // `urlsKey` is `urls` as a value: the list is rebuilt on every content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);
  const imagesReady = images !== null && images.key === urlsKey;
  // The slides wait for the pictures: whether a Cover or a Mosaic can be
  // drawn is only known once the covers have arrived, and a slide that dims
  // itself a moment later reads as a fault. A toggle that asks for other
  // pictures (*Other singers' pictures* back on) keeps the slides it has,
  // read off the pictures there were, while the new ones arrive: the songs
  // and so the covers are the same.
  const ready = images !== null && auth.loaded;

  // ---------------------------------------------------------------- slides
  // One per design, in the fixed order; each asks for exactly what it draws
  // (the resolved options), so a toggle that changes nothing a slide is given
  // — the pictures on *You*, whose only face is the sharer's — never redraws
  // it. The spread is handed the whole party, pictures and all, and draws
  // again on that toggle although it shows no face.
  const loadedMap = images?.map;
  const slides = useMemo<Slide[]>(() => {
    if (!ready || loadedMap === undefined) return [];
    const loaded = (url: string) => loadedMap.has(url);
    const slide = (
      choice: Choice<Design>,
      request: CardRequest,
      toggles: ToggleReasons,
    ): Slide =>
      choice.ok
        ? {
            design: choice.value,
            choice,
            request,
            key: JSON.stringify(request),
            toggles,
          }
        : { design: choice.value, choice, request: null, key: "", toggles };
    if (content.kind === "score") {
      const toggles = scoreSlideToggles(content);
      return scoreCardDesigns(content, loaded).map((choice) =>
        slide(
          choice,
          {
            kind: "score",
            content,
            options: resolveScoreOptions(
              content,
              { format: prefs.format, look: choice.value, logo: prefs.logo },
              loaded,
            ),
          },
          toggles,
        ),
      );
    }
    if (content.kind === "player") {
      const toggles = playerSlideToggles(content);
      return playerCardDesigns(content).map((choice) =>
        slide(
          choice,
          {
            kind: "player",
            content,
            options: resolvePlayerOptions(
              content,
              choice.value,
              prefs.format,
              prefs.logo,
            ),
          },
          toggles,
        ),
      );
    }
    if (content.kind === "achievement") {
      return achievementCardDesigns().map((choice) =>
        slide(
          choice,
          {
            kind: "achievement",
            content,
            options: resolveAchievementOptions(prefs.format, prefs.logo),
          },
          achievementSlideToggles(),
        ),
      );
    }
    const alone = mine ?? content;
    return partyCardDesigns(content, alone, loaded).map((choice) => {
      const drawn = choice.value === "you" ? alone : content;
      return slide(
        choice,
        {
          kind: "party",
          content: drawn,
          options: resolvePartyOptions(
            drawn,
            choice.value,
            prefs.format,
            prefs.logo,
            loaded,
          ),
        },
        partySlideToggles(choice.value, drawn),
      );
    });
  }, [ready, content, mine, loadedMap, prefs.format, prefs.logo]);

  /** Where the carousel opens: on the design remembered, unless this card
   * cannot draw it — a panel opening on held buttons reads as broken. */
  const remembered: Design =
    content.kind === "score"
      ? prefs.scoreLook
      : content.kind === "player"
        ? prefs.playerDesign
        : content.kind === "achievement"
          ? "badge"
          : prefs.partyDesign;
  // Otherwise the first one it can draw: a party's Podium and a score's Dark
  // always can, a player's Histogram not below four scores.
  const rememberedAt = slides.findIndex(
    (slide) => slide.design === remembered && slide.request !== null,
  );
  const opening = Math.max(
    0,
    rememberedAt >= 0
      ? rememberedAt
      : slides.findIndex((slide) => slide.request !== null),
  );
  const index = Math.min(inView ?? opening, Math.max(0, slides.length - 1));
  useEffect(() => {
    if (imagesReady && slides.length > 0 && inView === null) setInView(opening);
  }, [imagesReady, slides.length, inView, opening]);

  /** The slide in view is the choice, and the one remembered — but a dimmed
   * slot is no choice, and *Spread* and *You* are not kept (share-cards §5). */
  const move = (to: number) => {
    setInView(to);
    const slide = slides[to];
    if (slide === undefined || slide.request === null) return;
    if (slide.request.kind === "score")
      update({ scoreLook: slide.design as ScoreDesign });
    else if (slide.request.kind === "player")
      update({ playerDesign: slide.design as PlayerDesign });
    // One design, nothing to remember of it: the format and the logo are
    // all an achievement card keeps.
    else if (slide.request.kind === "achievement") return;
    else if (
      REMEMBERED_PARTY_DESIGNS.includes(slide.design as RememberedPartyDesign)
    )
      update({ partyDesign: slide.design as RememberedPartyDesign });
  };

  // ---------------------------------------------------------- the pictures
  // Built the moment the options settle and never inside a click: awaiting
  // the PNG in the click can use up the tap's user activation, and Safari's
  // `share()` then refuses (§5). The slide in view and its neighbours are
  // drawn, one at a time and the one in view first; each keeps its latest
  // picture, cached under the request it was drawn from, so a swipe back to
  // a slide whose options have not moved draws nothing.
  const shots = useRef(new Map<Design, Shot>());
  /** The URLs a slide stood on before, let go once its new picture is on
   * screen (`onLoad` below): revoked any sooner, the old one could flash as a
   * broken image. */
  const retired = useRef(new Map<Design, string[]>());
  const [failed, setFailed] = useState<Partial<Record<Design, string>>>({});
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /** The drawing on its way, if any. */
  const drawing = useRef<object | null>(null);
  /** Moves on when the panel goes, so a drawing that lands late is let
   * fall. */
  const generation = useRef(0);

  const letRetiredGo = (design: Design) => {
    for (const url of retired.current.get(design) ?? [])
      URL.revokeObjectURL(url);
    retired.current.delete(design);
  };
  /** One slide's pictures, for a slide that has nothing to show any more. */
  const letSlideGo = (design: Design) => {
    letRetiredGo(design);
    const shot = shots.current.get(design);
    if (shot !== undefined) URL.revokeObjectURL(shot.url);
    shots.current.delete(design);
  };
  /** Every URL at once, for when nothing is to be shown any more. Safari
   * keeps canvas memory alive behind a live URL. */
  const letAllGo = () => {
    for (const design of [...retired.current.keys()]) letRetiredGo(design);
    for (const shot of shots.current.values()) URL.revokeObjectURL(shot.url);
    shots.current.clear();
  };

  const slidesKey = slides.map((slide) => `${slide.design}=${slide.key}`);
  // In view first: it is the one drawn first.
  const wanted = [index, index - 1, index + 1]
    .map((i) => slides[i])
    .filter((slide): slide is Slide => slide?.request != null);

  // A slot that has dimmed since it was drawn has no picture to keep.
  useEffect(() => {
    let dropped = false;
    for (const slide of slides)
      if (slide.request === null && shots.current.has(slide.design)) {
        letSlideGo(slide.design);
        dropped = true;
      }
    if (dropped) redraw();
    // `slidesKey` is `slides` as a value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidesKey.join("\n")]);

  // After every render, and cheap when there is nothing to do: one drawing at
  // a time, and the one that finishes calls `redraw`, which is what brings
  // the next slide's turn.
  useEffect(() => {
    if (
      !flagsSettled ||
      !imagesReady ||
      images === null ||
      drawing.current !== null
    )
      return;
    const slide = wanted.find(
      (candidate) =>
        shots.current.get(candidate.design)?.key !== candidate.key &&
        failed[candidate.design] !== candidate.key,
    );
    if (slide === undefined || slide.request === null) return;
    const token = {};
    drawing.current = token;
    const at = generation.current;
    const { design, key } = slide;
    const name = fileName(slide.request.content);
    renderCard(slide.request, images.map).then(
      (blob) => {
        if (drawing.current === token) drawing.current = null;
        if (at !== generation.current) return;
        const file = new File([blob], name, { type: "image/png" });
        const url = URL.createObjectURL(file);
        // The old picture stands through the redraw and goes once the new
        // one is shown.
        const old = shots.current.get(design);
        if (old !== undefined)
          retired.current.set(design, [
            ...(retired.current.get(design) ?? []),
            old.url,
          ]);
        shots.current.set(design, { file, url, key });
        setFailed((was) => {
          if (was[design] === undefined) return was;
          const rest = { ...was };
          delete rest[design];
          return rest;
        });
        redraw();
      },
      () => {
        if (drawing.current === token) drawing.current = null;
        if (at !== generation.current) return;
        // A picture of the options before is not this card: it goes, and
        // with it every button that could send it.
        letSlideGo(design);
        setFailed((was) => ({ ...was, [design]: key }));
        redraw();
      },
    );
  });

  // Whatever URL is left when the panel goes, and nothing drawn after it.
  useEffect(
    () => () => {
      generation.current += 1;
      drawing.current = null;
      letAllGo();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---------------------------------------------------------- the buttons
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const saveLink = useRef<HTMLAnchorElement>(null);
  const slide = slides[index] as Slide | undefined;
  const shot =
    slide === undefined ? undefined : shots.current.get(slide.design);
  const anyShot = shot ?? shots.current.values().next().value;
  const slideFailed =
    slide !== undefined &&
    slide.request !== null &&
    failed[slide.design] === slide.key;
  // Up from the first moment the slides are known, and kept while a toggle's
  // new pictures arrive, as long as there is a picture to stand on.
  const showCarousel =
    slides.length > 0 && (imagesReady || anyShot !== undefined);
  const shareable = anyShot !== undefined && canShareFile(anyShot.file);
  const copyable = anyShot !== undefined && canCopyImage();
  // Whether the picture in view is the card the options now ask for. While a
  // redraw is on its way it is not, and a dimmed slot has none: the buttons
  // hold still rather than send the card from before, and the file they wait
  // for is built outside the click all the same.
  const current =
    slide !== undefined &&
    slide.request !== null &&
    shot !== undefined &&
    shot.key === slide.key;

  const share = () => {
    if (shot === undefined || !current) return;
    setNotice(null);
    setFailure(null);
    // Called straight from the click, the file already built; the file alone,
    // because a title or a text adds a stray `.txt` to the iOS share sheet.
    navigator.share({ files: [shot.file] }).then(
      () => undefined,
      (error: unknown) => {
        const name = errorName(error);
        // The reader closed the share sheet: nothing follows.
        if (name === "AbortError") return;
        if (name === "NotAllowedError" || name === "TypeError") {
          saveLink.current?.click();
          setNotice(
            "This browser would not share the picture, so it was saved instead.",
          );
          return;
        }
        setFailure("Could not share the picture.");
      },
    );
  };

  const copy = () => {
    if (shot === undefined || !current) return;
    setNotice(null);
    setFailure(null);
    navigator.clipboard
      .write([new ClipboardItem({ [shot.file.type]: shot.file })])
      .then(
        () => setNotice("Copied. Paste it into a chat."),
        (error: unknown) => {
          if (errorName(error) === "AbortError") return;
          setFailure("Could not copy the picture.");
        },
      );
  };

  // ---------------------------------------------------------- the toggles
  const values: Record<ShareToggle, boolean> = {
    pictures: prefs.otherPictures,
    date: prefs.partyNameAndDate,
    logo: prefs.logo,
  };
  const reasons = slide?.toggles ?? NO_REASONS;
  // Worked out on every render from the slide in view, so a new slide coming
  // into view re-reads the last toggle's sentence for itself: one dimmed
  // there says why without being touched again.
  const line =
    explained === null
      ? TOGGLES_REST
      : toggleSentence(
          explained,
          values[explained],
          reasons[explained],
          content.kind,
        );
  const toggle = (which: ShareToggle) => {
    if (which === "pictures") update({ otherPictures: !prefs.otherPictures });
    else if (which === "date")
      update({ partyNameAndDate: !prefs.partyNameAndDate });
    else update({ logo: !prefs.logo });
  };

  const title =
    target.kind === "party"
      ? "Share this party"
      : target.kind === "player"
        ? "Share these stats"
        : target.kind === "achievement"
          ? "Share this achievement"
          : "Share this score";
  const format: CardFormat = prefs.format;
  const pressHold = longPressPage();
  const wantedDesigns = new Set(wanted.map((candidate) => candidate.design));

  const renderSlide = (candidate: Slide) => {
    const picture = shots.current.get(candidate.design);
    const box = `share-slide-box share-slide-box-${format}`;
    if (candidate.request === null)
      return (
        <div className={`${box} share-slide-dimmed`}>
          <span className="share-slide-dimmed-name">
            {DESIGN_LABELS[candidate.design]}
          </span>
          <span className="share-slide-dimmed-reason">
            {candidate.choice.reason}
          </span>
        </div>
      );
    const waiting = picture === undefined || picture.key !== candidate.key;
    const broken = failed[candidate.design] === candidate.key;
    return (
      <div className={box} aria-busy={(waiting && !broken) || undefined}>
        {picture !== undefined ? (
          <img
            className="share-preview-image"
            src={picture.url}
            alt={altText(candidate.request.content)}
            onLoad={() => letRetiredGo(candidate.design)}
            onError={() => letRetiredGo(candidate.design)}
          />
        ) : broken || !wantedDesigns.has(candidate.design) ? null : (
          <Loading />
        )}
      </div>
    );
  };

  return (
    <Modal title={title} onClose={onClose} bare hideTitle>
      <div className="share-panel">
        {/* Known from the moment the panel opens, so nothing moves under it
            once the picture arrives. */}
        {pressHold && (
          <p className="section-note share-press-note">{LONG_PRESS_NOTE}</p>
        )}
        {!showCarousel ? (
          // The first drawing is a wait, at the size the slide will have.
          <div
            className={`share-carousel share-carousel-${format} share-carousel-waiting`}
          >
            <div className="share-slide">
              <div className={`share-slide-box share-slide-box-${format}`}>
                <Loading />
              </div>
            </div>
          </div>
        ) : (
          <DesignCarousel
            format={format}
            slides={slides}
            index={index}
            onMove={move}
            renderSlide={renderSlide}
            trailing={
              <FormatPair
                format={format}
                onChange={(next) => update({ format: next })}
              />
            }
          />
        )}
        {slideFailed && (
          <p className="error-notice share-notice" role="alert">
            The card could not be drawn in this browser.
          </p>
        )}

        {showCarousel && (
          <>
            <ShareToggles
              values={values}
              reasons={reasons}
              onToggle={toggle}
              onExplain={setExplained}
            />
            <p className="section-note share-toggle-line" aria-live="polite">
              {line}
            </p>
          </>
        )}

        {/* Only what works in this browser, and never a greyed button: the
            row waits for the first picture, and holds still for the moment
            a redraw takes and on a design the card cannot draw. The primary
            is the last one — Share where the browser can, Save image where
            it cannot. A drawing that failed takes the row with it. */}
        {anyShot !== undefined && !slideFailed && (
          <div className="share-actions">
            {copyable && (
              <button
                type="button"
                className="button"
                disabled={!current}
                onClick={copy}
              >
                Copy image
              </button>
            )}
            <a
              ref={saveLink}
              role="link"
              className={shareable ? "button" : "button button-primary"}
              href={shot?.url}
              download={shot?.file.name ?? fileName(content)}
              aria-disabled={!current || undefined}
              onClick={(event) => {
                if (!current) {
                  event.preventDefault();
                  return;
                }
                setNotice(null);
                setFailure(null);
              }}
            >
              Save image
            </a>
            {shareable && (
              <button
                type="button"
                className="button button-primary share-action-share"
                disabled={!current}
                onClick={share}
              >
                <Icon name="share" />
                Share
              </button>
            )}
          </div>
        )}
        {notice !== null && (
          <p className="section-note share-status" role="status">
            {notice}
          </p>
        )}
        {failure !== null && (
          <p className="error-notice share-notice" role="alert">
            {failure}
          </p>
        )}
      </div>
    </Modal>
  );
}
