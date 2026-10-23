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
import type { PlayerRead, ScoreWithContext, SessionRead } from "../api";
import { listSongScoresOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import {
  cardImageUrls,
  partyCard,
  scoreCard,
  type CardContent,
} from "../shareCard/content";
import { LOGO_URL, renderCard, type CardRequest } from "../shareCard/draw";
import { scoreFlags } from "../shareCard/flags";
import { loadCardImages, type ImageCache } from "../shareCard/images";
import type { CardFormat, UnderPodium } from "../shareCard/layout";
import {
  FORMATS,
  partyCardChoices,
  partyDesignOptions,
  resolvePartyOptions,
  resolveScoreOptions,
  scoreCardChoices,
  type Choice,
  type PartyDesign,
  type ScoreDesign,
  underPodiumNote,
} from "../shareCard/possible";
import { readPrefs, writePrefs, type SharePrefs } from "../shareCard/prefs";
import type { Grouping } from "../stats";
import CheckOption from "./CheckOption";
import { Icon } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import { ScoreEntryBody } from "./ScoreGroupList";
import "./ScoreGroupList.css";
import "./ShareCardPanel.css";

/** What the panel makes a card of: a whole party, or one score of a group. */
export type ShareTarget =
  | {
      kind: "party";
      session: SessionRead;
      /** The party's scores, exactly as `/scores` showed them. */
      scores: ScoreWithContext[];
    }
  | {
      kind: "score";
      /** The group's scores in the order the group draws them, best first. */
      scores: ScoreWithContext[];
      /** How the page is grouped — what the chooser's rows lead with. */
      grouping: Grouping;
      /** The party the scores belong to; `null` on the head row, which is
       * every party at once and names none. */
      session: SessionRead | null;
      /** Every score the page showed: where the rest of a sing is found, the
       * other half of a duet sitting in another singer's group. */
      pageScores: ScoreWithContext[];
    };

interface ShareCardPanelProps {
  target: ShareTarget;
  /** Registered players by id, for the pictures. */
  players: Map<string, PlayerRead>;
  onClose: () => void;
}

type Design = ScoreDesign | PartyDesign;

const FORMAT_LABELS = { square: "Square", story: "Story" } as const;
const FORMAT_ICONS = {
  square: "format-square",
  story: "format-story",
} as const;
const DESIGN_LABELS: Record<Design, string> = {
  dark: "Dark",
  cover: "Cover",
  mosaic: "Mosaic",
  spread: "Spread",
};
const UNDER_LABELS = { ranking: "Ranking", strip: "Score strip" } as const;

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
  return content.kind === "score"
    ? `wingman-${slug(content.title)}-${content.score}.png`
    : `wingman-${slug(content.party)}.png`;
}

/** What the picture shows, for a reader who cannot see it. */
function altText(content: CardContent): string {
  return content.kind === "score"
    ? `Share card: ${content.singer.name} scored ${content.score} on ${content.title}`
    : `Share card of ${content.party}, ranked by best score`;
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

interface PillsProps<T extends string> {
  legend: string;
  /** The legend for a reader alone, where the pills say it themselves. */
  legendHidden?: boolean;
  name: string;
  choices: Choice<T>[];
  /** What a pill draws: its word, or a glyph over a hidden word. */
  label: (value: T) => ReactNode;
  /** The choice as drawn, which is not always the one asked for. */
  checked: T | null;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * One of the panel's choices as §4's pills: a hidden radio in a label, the
 * span that is drawn. A choice the card cannot take is a disabled pill over
 * the sentence saying why — never a pill that does nothing.
 */
function Pills<T extends string>({
  legend,
  legendHidden = false,
  name,
  choices,
  label,
  checked,
  onChange,
  className,
}: PillsProps<T>) {
  const reasons = choices.filter((choice) => choice.reason !== null);
  return (
    <fieldset
      className={className ? `share-group ${className}` : "share-group"}
    >
      <legend
        className={legendHidden ? "visually-hidden" : "share-group-legend"}
      >
        {legend}
      </legend>
      <div className="share-pills">
        {choices.map((choice) => (
          <label key={choice.value} className="share-pill">
            <input
              className="visually-hidden"
              type="radio"
              name={name}
              value={choice.value}
              checked={checked === choice.value}
              disabled={!choice.ok}
              onChange={() => onChange(choice.value)}
            />
            <span className="share-pill-text">{label(choice.value)}</span>
          </label>
        ))}
      </div>
      {reasons.map((choice) => (
        <p key={choice.value} className="section-note share-group-note">
          {choice.reason}
        </p>
      ))}
    </fieldset>
  );
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
  slides: Slide[];
  /** The slide in view. */
  index: number;
  onMove: (index: number) => void;
  /** What one slide holds. */
  renderSlide: (slide: Slide, index: number) => ReactNode;
}

/**
 * The card's designs as one scroll-snapped row (ui-guidelines §7, *Share
 * cards*), with the arrows and the dots under it. The slide in view is read
 * off the scroll position once a swipe has settled (`SETTLE_MS`): one path in
 * every browser, Safari's without `scrollend` included, and exact where an
 * `IntersectionObserver` would answer in thresholds. An arrow or a key moves
 * the choice at once and lets the row follow; the reading the settled scroll
 * then makes agrees with it, so nothing flickers.
 */
function DesignCarousel({ slides, index, onMove, renderSlide }: CarouselProps) {
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
    // disabled button drops the keyboard on the page: it moves to the other.
    if (from === "next" && to === last) previous.current?.focus();
    if (from === "previous" && to === 0) next.current?.focus();
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
        className="share-carousel"
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
        {/* Decoration: the arrows, the keys and the swipe are the controls,
            the slides' own names say where the reader is. */}
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
      </div>
      <p className="share-design-name" aria-live="polite">
        {label(slides[index])}
      </p>
    </>
  );
}

/**
 * The share panel (share-cards.md §5, ui-guidelines §7 *Share cards*): the
 * card's designs as real pictures in a carousel, the few choices it takes,
 * and the buttons this browser can actually carry out. *Share a score* on a
 * group of several first asks which score, and its close goes back to that
 * list.
 */
export default function ShareCardPanel({
  target,
  players,
  onClose,
}: ShareCardPanelProps) {
  const auth = useAuth();
  const me = auth.user?.player_id ?? null;
  const [prefs, setPrefs] = useState<SharePrefs>(readPrefs);
  const [under, setUnder] = useState<Exclude<UnderPodium, "none">>("ranking");
  /** The slide in view; `null` until the carousel opens on the remembered
   * design. */
  const [inView, setInView] = useState<number | null>(null);
  const choosing = target.kind === "score" && target.scores.length > 1;
  const [chosen, setChosen] = useState<ScoreWithContext | null>(
    target.kind === "score" && target.scores.length === 1
      ? target.scores[0]
      : null,
  );
  const panelBody = useRef<HTMLDivElement>(null);
  /** The row the chooser goes back to, so the keyboard lands where it left. */
  const lastChosen = useRef<number | null>(null);

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
  // (§7.4). One read per chosen score, through the route that exists. Asked
  // of `/auth/me`'s answer, never of its absence: `can` says yes to anything
  // while that is in flight.
  const askHistory =
    target.kind === "score" &&
    chosen !== null &&
    chosen.song !== null &&
    auth.loaded &&
    auth.can("stats.history");
  const history = useQuery({
    ...listSongScoresOptions({ path: { song_id: chosen?.song?.id ?? "" } }),
    enabled: askHistory,
  });
  const historyScores = history.data?.scores;
  const flags = useMemo(
    () =>
      askHistory && chosen !== null && historyScores !== undefined
        ? scoreFlags(chosen, historyScores)
        : null,
    [askHistory, chosen, historyScores],
  );
  // A failed read is no history: the card is drawn without a flag. Nothing is
  // drawn before the reader is known — whose picture is always theirs, and
  // whether there is a history to read, both hang on it.
  const flagsSettled = auth.loaded && (!askHistory || !history.isPending);

  const content = useMemo<CardContent | null>(() => {
    if (target.kind === "party")
      return partyCard({
        scores: target.scores,
        session: target.session,
        players,
        me,
        otherPictures: prefs.otherPictures,
        partyNameAndDate: prefs.partyNameAndDate,
        onlyMe: prefs.onlyMe,
      });
    if (chosen === null) return null;
    return scoreCard({
      score: chosen,
      partyScores: target.pageScores,
      session: target.session,
      players,
      me,
      otherPictures: prefs.otherPictures,
      partyNameAndDate: prefs.partyNameAndDate,
      newHighscore: flags?.newHighscore,
      personalBest: flags?.personalBest,
    });
  }, [target, chosen, players, me, prefs, flags]);

  // ------------------------------------------------------------- pictures
  // Loaded once per URL for as long as the panel is open, so a change of
  // option never asks for a picture twice.
  const cache = useRef<ImageCache>(new Map());
  const urls = useMemo(
    () => (content === null ? [] : [LOGO_URL, ...cardImageUrls(content)]),
    [content],
  );
  const urlsKey = urls.join("\n");
  const [images, setImages] = useState<{
    key: string;
    map: Map<string, HTMLImageElement>;
  } | null>(null);
  useEffect(() => {
    if (urls.length === 0) return;
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
  // The choices wait for the pictures: whether a Cover or a Mosaic can be
  // drawn is only known once the covers have arrived, and a slide that dims
  // itself a moment later reads as a fault. A toggle that asks for other
  // pictures (*Other singers' pictures* back on) keeps the slides it has,
  // read off the pictures there were, while the new ones arrive: the songs
  // and so the covers are the same.
  const ready = images !== null && auth.loaded && content !== null;

  // ---------------------------------------------------------------- slides
  // One per design, in the fixed order; each asks for exactly what it draws
  // (the resolved options), so a choice that does not reach a slide — *Under
  // the podium* on a Mosaic — never redraws it.
  const loadedMap = images?.map;
  const slides = useMemo<Slide[]>(() => {
    if (!ready || content === null || loadedMap === undefined) return [];
    const loaded = (url: string) => loadedMap.has(url);
    if (content.kind === "score") {
      return scoreCardChoices(content, loaded).designs.map((choice) => {
        if (!choice.ok)
          return { design: choice.value, choice, request: null, key: "" };
        const request: CardRequest = {
          kind: "score",
          content,
          options: resolveScoreOptions(
            content,
            { format: prefs.format, look: choice.value, logo: prefs.logo },
            loaded,
          ),
        };
        return {
          design: choice.value,
          choice,
          request,
          key: JSON.stringify(request),
        };
      });
    }
    const base = { format: prefs.format, under, logo: prefs.logo };
    return partyCardChoices(
      content,
      { ...base, look: "dark", focus: "podium" },
      loaded,
    ).designs.map((choice) => {
      if (!choice.ok)
        return { design: choice.value, choice, request: null, key: "" };
      const request: CardRequest = {
        kind: "party",
        content,
        options: resolvePartyOptions(
          content,
          { ...base, ...partyDesignOptions(choice.value) },
          loaded,
        ),
      };
      return {
        design: choice.value,
        choice,
        request,
        key: JSON.stringify(request),
      };
    });
  }, [ready, content, loadedMap, prefs.format, prefs.logo, under]);

  /** Where the carousel opens: on the design remembered, unless this card
   * cannot draw it — a panel opening on held buttons reads as broken. */
  const remembered =
    content?.kind === "score" ? prefs.scoreLook : prefs.partyLook;
  const opening = Math.max(
    0,
    slides.findIndex(
      (slide) => slide.design === remembered && slide.request !== null,
    ),
  );
  const index = Math.min(inView ?? opening, Math.max(0, slides.length - 1));
  useEffect(() => {
    if (imagesReady && slides.length > 0 && inView === null) setInView(opening);
  }, [imagesReady, slides.length, inView, opening]);

  /** The slide in view is the choice, and the one remembered — but a dimmed
   * slot is no choice, and the spread is not kept (share-cards §5). */
  const move = (to: number) => {
    setInView(to);
    const slide = slides[to];
    if (slide === undefined || slide.request === null) return;
    if (slide.design === "dark" || slide.design === "cover") {
      if (content?.kind === "score") update({ scoreLook: slide.design });
      else if (slide.design === "dark") update({ partyLook: "dark" });
    } else if (slide.design === "mosaic") update({ partyLook: "mosaic" });
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
  /** Moves on whenever the pictures there are stop being this card's — another
   * score, or the panel gone — so a drawing that lands late is let fall. */
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
  // Up from the first moment the choices are known, and kept while a toggle's
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

  // ------------------------------------------------- the chooser and back
  // Another score is another card: the last one's pictures and files go, so
  // a quick press can never send the score that was there before, and the
  // next card is a first drawing behind `Loading`, opening on the design
  // remembered.
  const dropShots = () => {
    generation.current += 1;
    drawing.current = null;
    letAllGo();
    setFailed({});
    setInView(null);
    setNotice(null);
    setFailure(null);
    redraw();
  };
  const choose = (score: ScoreWithContext) => {
    lastChosen.current = score.id;
    dropShots();
    setChosen(score);
  };
  // The close is the way back to the list for a group of several — the song
  // modal's sub-view idiom — and the way out everywhere else.
  const close =
    choosing && chosen !== null
      ? () => {
          dropShots();
          setChosen(null);
        }
      : onClose;

  // The view swaps inside one dialog of one title, so the dialog's own focus
  // recovery does not run: the chooser's row goes, and the keyboard would land
  // on the page behind. Into the card, the dialog takes it; back, the row
  // that was chosen does.
  const viewKey = chosen === null ? "list" : `score-${chosen.id}`;
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const body = panelBody.current;
    if (body === null) return;
    if (chosen === null && lastChosen.current !== null) {
      body
        .querySelector<HTMLElement>(
          `[data-share-score="${lastChosen.current}"]`,
        )
        ?.focus();
    } else {
      body.closest<HTMLElement>('[role="dialog"]')?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const title =
    target.kind === "party" ? "Share this party" : "Share this score";

  if (target.kind === "score" && chosen === null) {
    const rowsAreSongs = target.grouping === "player";
    return (
      <Modal title={title} onClose={close}>
        <div ref={panelBody}>
          <p className="section-note share-choose-note">
            Pick the score to put on the card.
          </p>
          <ul className="score-group-scores share-choices">
            {target.scores.map((score) => (
              <li key={score.id}>
                <button
                  type="button"
                  className="score-entry score-entry-button share-choice"
                  data-share-score={score.id}
                  onClick={() => choose(score)}
                >
                  <ScoreEntryBody
                    score={score}
                    players={players}
                    ownRows={false}
                    rowsAreSongs={rowsAreSongs}
                  />
                  <Icon name="chevron-right" className="share-choice-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    );
  }

  // `content` is set from here on: a party always has one, and a score target
  // without a chosen score returned the chooser above.
  const card = content as CardContent;
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
            alt={altText(card)}
            onLoad={() => letRetiredGo(candidate.design)}
            onError={() => letRetiredGo(candidate.design)}
          />
        ) : broken || !wantedDesigns.has(candidate.design) ? null : (
          <Loading />
        )}
      </div>
    );
  };

  // *Under the podium* keeps one row on every party slide, so a swipe moves
  // nothing: the pills where the slide in view takes them, its sentence in
  // their place where it does not, all of them laid in one grid cell so the
  // row is as tall as the tallest.
  let underRow: ReactNode = null;
  let onlyMe: Choice<boolean> | null = null;
  if (card.kind === "party" && slides.length > 0 && loadedMap !== undefined) {
    // The one slide that takes the choice is the square Dark podium, and the
    // pills are its; every other slide says why not, asked of its own design
    // — so a dimmed Spread says what the spread does, not what is drawn in
    // its stead.
    const podium = partyCardChoices(
      card,
      { format, under, logo: prefs.logo, look: "dark", focus: "podium" },
      (url) => loadedMap.has(url),
    );
    onlyMe = podium.onlyMe;
    const noteOf = (design: Design): string | null => {
      const { look, focus } = partyDesignOptions(design as PartyDesign);
      return underPodiumNote(format, look, focus);
    };
    const inViewNote = noteOf(slides[index].design);
    const notes = [
      ...new Set(
        slides
          .map((candidate) => noteOf(candidate.design))
          .filter((note): note is string => note !== null),
      ),
    ];
    const pills = podium.under;
    const pillsActive = pills !== null && inViewNote === null;
    const dark = slides.find((candidate) => candidate.design === "dark");
    const drawnUnder =
      dark?.request?.kind === "party" ? dark.request.options.under : "none";
    underRow = (
      <div className="share-under">
        {pills !== null && (
          <div
            className="share-under-variant"
            aria-hidden={!pillsActive || undefined}
            inert={!pillsActive}
            data-active={pillsActive}
          >
            <Pills
              legend="Under the podium"
              name="share-under"
              choices={pills}
              label={(value) => UNDER_LABELS[value]}
              checked={drawnUnder === "none" ? null : drawnUnder}
              onChange={setUnder}
            />
          </div>
        )}
        {notes.map((note) => {
          const active = inViewNote === note;
          return (
            <div
              key={note}
              className="share-under-variant"
              aria-hidden={!active || undefined}
              data-active={active}
            >
              <div className="share-group">
                <p className="share-group-legend">Under the podium</p>
                <p className="section-note share-group-note">{note}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Modal title={title} onClose={close}>
      <div ref={panelBody} className="share-panel">
        {!showCarousel ? (
          // The first drawing is a wait, at the size the slide will have.
          <div className="share-carousel share-carousel-waiting">
            <div className="share-slide">
              <div className={`share-slide-box share-slide-box-${format}`}>
                <Loading />
              </div>
            </div>
          </div>
        ) : (
          <>
            <Pills
              className="share-formats"
              legend="Format"
              legendHidden
              name="share-format"
              choices={FORMATS}
              label={(value) => (
                <>
                  <Icon name={FORMAT_ICONS[value]} />
                  <span className="visually-hidden">
                    {FORMAT_LABELS[value]}
                  </span>
                </>
              )}
              checked={format}
              onChange={(next) => update({ format: next })}
            />
            <DesignCarousel
              slides={slides}
              index={index}
              onMove={move}
              renderSlide={renderSlide}
            />
          </>
        )}
        {slideFailed && (
          <p className="error-notice share-notice" role="alert">
            The card could not be drawn in this browser.
          </p>
        )}
        {pressHold && anyShot !== undefined && (
          <p className="section-note share-press-note">{LONG_PRESS_NOTE}</p>
        )}

        {showCarousel && (
          <>
            {underRow}
            <div className="share-toggles">
              <CheckOption
                type="checkbox"
                label="Other singers' pictures"
                checked={prefs.otherPictures}
                onChange={() => update({ otherPictures: !prefs.otherPictures })}
              />
              <CheckOption
                type="checkbox"
                label="Party name and date"
                checked={prefs.partyNameAndDate}
                onChange={() =>
                  update({ partyNameAndDate: !prefs.partyNameAndDate })
                }
              />
              <CheckOption
                type="checkbox"
                label="Wingman logo"
                checked={prefs.logo}
                onChange={() => update({ logo: !prefs.logo })}
              />
              {onlyMe !== null && card.kind === "party" && (
                <>
                  <CheckOption
                    type="checkbox"
                    label="Only me and my place"
                    checked={card.onlyMe}
                    disabled={!onlyMe.ok}
                    onChange={() => update({ onlyMe: !prefs.onlyMe })}
                  />
                  {onlyMe.reason !== null && (
                    <p className="section-note share-toggle-note">
                      {onlyMe.reason}
                    </p>
                  )}
                </>
              )}
            </div>
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
              download={shot?.file.name ?? fileName(card)}
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
