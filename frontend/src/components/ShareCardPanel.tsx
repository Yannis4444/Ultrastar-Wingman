import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { PartyFocus, UnderPodium } from "../shareCard/layout";
import {
  partyCardChoices,
  resolvePartyOptions,
  resolveScoreOptions,
  scoreCardChoices,
  type Choice,
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

const FORMAT_LABELS = { square: "Square", story: "Story" } as const;
const LOOK_LABELS = { dark: "Dark", cover: "Cover", mosaic: "Mosaic" } as const;
const FOCUS_LABELS = { podium: "Podium", spread: "Spread" } as const;
const UNDER_LABELS = { ranking: "Ranking", strip: "Score strip" } as const;

/** What the long press is for on a page that may not share or copy. */
export const LONG_PRESS_NOTE =
  "Press and hold the picture to save or share it.";

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

function fileName(content: CardContent): string {
  return content.kind === "score"
    ? `wingman-${slug(content.title)}-${content.score}.png`
    : `wingman-${slug(content.head)}.png`;
}

/** What the picture shows, for a reader who cannot see it. */
function altText(content: CardContent): string {
  return content.kind === "score"
    ? `Share card: ${content.singer.name} scored ${content.score} on ${content.title}`
    : `Share card of ${content.head}, ranked by best score`;
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

/** A touch screen on a page that is not a secure context: no share, no copy,
 * and the long press on the picture is what is left besides the download. */
function longPressPage(): boolean {
  if (window.isSecureContext) return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

interface PillsProps<T extends string> {
  legend: string;
  name: string;
  choices: Choice<T>[];
  labels: Record<T, string>;
  /** The choice as drawn, which is not always the one asked for. */
  checked: T | null;
  onChange: (value: T) => void;
}

/**
 * One of the panel's choices as §4's pills: a hidden radio in a label, the
 * span that is drawn. A choice the card cannot take is a disabled pill over
 * the sentence saying why — never a pill that does nothing.
 */
function Pills<T extends string>({
  legend,
  name,
  choices,
  labels,
  checked,
  onChange,
}: PillsProps<T>) {
  const reasons = choices.filter((choice) => choice.reason !== null);
  return (
    <fieldset className="share-group">
      <legend className="share-group-legend">{legend}</legend>
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
            <span className="share-pill-text">{labels[choice.value]}</span>
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

/**
 * The share panel (share-cards.md §5, ui-guidelines §7 *Share cards*): the
 * card as a real picture, the few choices it takes, and the buttons this
 * browser can actually carry out. *Share a score* on a group of several first
 * asks which score, and its close goes back to that list.
 */
export default function ShareCardPanel({
  target,
  players,
  onClose,
}: ShareCardPanelProps) {
  const auth = useAuth();
  const me = auth.user?.player_id ?? null;
  const [prefs, setPrefs] = useState<SharePrefs>(readPrefs);
  const [focus, setFocus] = useState<PartyFocus>("podium");
  const [under, setUnder] = useState<Exclude<UnderPodium, "none">>("ranking");
  const choosing = target.kind === "score" && target.scores.length > 1;
  const [chosen, setChosen] = useState<ScoreWithContext | null>(
    target.kind === "score" && target.scores.length === 1
      ? target.scores[0]
      : null,
  );
  const panelBody = useRef<HTMLDivElement>(null);
  /** The row the chooser goes back to, so the keyboard lands where it left. */
  const lastChosen = useRef<number | null>(null);

  const update = (patch: Partial<SharePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
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
  const loaded = (url: string) => images?.map.has(url) ?? false;

  // -------------------------------------------------------------- options
  const request: CardRequest | null = useMemo(() => {
    if (content === null) return null;
    if (content.kind === "score")
      return {
        kind: "score",
        content,
        options: { format: prefs.format, look: prefs.scoreLook },
      };
    return {
      kind: "party",
      content,
      options: { format: prefs.format, look: prefs.partyLook, focus, under },
    };
  }, [content, prefs, focus, under]);
  const requestKey = request === null ? "" : JSON.stringify(request);

  // ----------------------------------------------------------- the picture
  // Built the moment the options settle and never inside a click: awaiting
  // the PNG in the click can use up the tap's user activation, and Safari's
  // `share()` then refuses (§5).
  // `key` is the request the picture was drawn from: while it is not the
  // request on screen, the old picture stands but is not what the reader
  // asked for, so nothing sends it (`current` below).
  const [shot, setShot] = useState<{
    file: File;
    url: string;
    key: string;
  } | null>(null);
  const [drawError, setDrawError] = useState(false);
  /** The URL the preview stands on, and the ones it stood on before, which
   * are let go once the new picture is on screen (`onLoad` below): revoked
   * any sooner, the old one could flash as a broken image. */
  const shotUrl = useRef<string | null>(null);
  const retired = useRef<string[]>([]);
  const letRetiredGo = () => {
    for (const url of retired.current) URL.revokeObjectURL(url);
    retired.current = [];
  };
  /** Every URL at once, for when nothing is to be shown any more. Safari
   * keeps canvas memory alive behind a live URL. */
  const letAllGo = () => {
    letRetiredGo();
    if (shotUrl.current !== null) URL.revokeObjectURL(shotUrl.current);
    shotUrl.current = null;
  };
  useEffect(() => {
    if (request === null || !imagesReady || !flagsSettled || images === null)
      return;
    let live = true;
    const name = fileName(request.content);
    const key = requestKey;
    renderCard(request, images.map).then(
      (blob) => {
        if (!live) return;
        const file = new File([blob], name, { type: "image/png" });
        const url = URL.createObjectURL(file);
        // The old picture stands through the redraw and goes once the new
        // one is shown.
        if (shotUrl.current !== null) retired.current.push(shotUrl.current);
        shotUrl.current = url;
        setShot({ file, url, key });
        setDrawError(false);
      },
      () => {
        if (!live) return;
        // A picture of the options before is not this card: it goes, and
        // with it every button that could send it.
        letAllGo();
        setShot(null);
        setDrawError(true);
      },
    );
    return () => {
      live = false;
    };
    // `requestKey` is `request` as a value; `images` is read through
    // `imagesReady`, which moves with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, imagesReady, flagsSettled]);

  // Whatever URL is left when the panel goes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => letAllGo, []);

  // ---------------------------------------------------------- the buttons
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const saveLink = useRef<HTMLAnchorElement>(null);
  const shareable = shot !== null && canShareFile(shot.file);
  const copyable = shot !== null && canCopyImage();
  // Whether the picture standing is the card the options now ask for. While a
  // redraw is on its way it is not: the buttons hold still rather than send
  // the card from before, and the file they wait for is built outside the
  // click all the same.
  const current = shot !== null && shot.key === requestKey;

  const share = () => {
    if (shot === null || !current) return;
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
    if (shot === null || !current) return;
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
  // Another score is another card: the last one's picture and file go, so a
  // quick press can never send the score that was there before, and the next
  // card is a first drawing behind `Loading`.
  const dropShot = () => {
    letAllGo();
    setShot(null);
    setDrawError(false);
    setNotice(null);
    setFailure(null);
  };
  const choose = (score: ScoreWithContext) => {
    lastChosen.current = score.id;
    dropShot();
    setChosen(score);
  };
  // The close is the way back to the list for a group of several — the song
  // modal's sub-view idiom — and the way out everywhere else.
  const close =
    choosing && chosen !== null
      ? () => {
          dropShot();
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
  const scoreChoices =
    card.kind === "score" ? scoreCardChoices(card, loaded) : null;
  const scoreDrawn =
    card.kind === "score"
      ? resolveScoreOptions(
          card,
          { format: prefs.format, look: prefs.scoreLook },
          loaded,
        )
      : null;
  const partyRequested = {
    format: prefs.format,
    look: prefs.partyLook,
    focus,
    under,
  };
  const partyChoices =
    card.kind === "party"
      ? partyCardChoices(card, partyRequested, loaded)
      : null;
  const partyDrawn =
    card.kind === "party"
      ? resolvePartyOptions(card, partyRequested, loaded)
      : null;
  const pressHold = longPressPage();

  return (
    <Modal title={title} onClose={close}>
      <div ref={panelBody} className="share-panel">
        <div
          className="share-preview"
          aria-busy={(!current && !drawError) || undefined}
        >
          {shot !== null ? (
            <img
              className="share-preview-image"
              src={shot.url}
              alt={altText(card)}
              onLoad={letRetiredGo}
              onError={letRetiredGo}
            />
          ) : drawError ? null : (
            <Loading />
          )}
        </div>
        {drawError && (
          <p className="error-notice share-notice" role="alert">
            The card could not be drawn in this browser.
          </p>
        )}
        {pressHold && shot !== null && (
          <p className="section-note share-press-note">{LONG_PRESS_NOTE}</p>
        )}

        {/* The choices wait for the pictures: whether a Cover or a Mosaic can
            be drawn is only known once the covers have arrived, and a pill
            that turns itself off a moment later reads as a fault. */}
        {(imagesReady || shot !== null) && auth.loaded && (
          <>
            <Pills
              legend="Format"
              name="share-format"
              choices={(scoreChoices ?? partyChoices)?.formats ?? []}
              labels={FORMAT_LABELS}
              checked={prefs.format}
              onChange={(format) => update({ format })}
            />
            {scoreChoices !== null && scoreDrawn !== null && (
              <Pills
                legend="Look"
                name="share-look"
                choices={scoreChoices.looks}
                labels={LOOK_LABELS}
                checked={scoreDrawn.look}
                onChange={(look) => update({ scoreLook: look })}
              />
            )}
            {partyChoices !== null && partyDrawn !== null && (
              <>
                <Pills
                  legend="Look"
                  name="share-look"
                  choices={partyChoices.looks}
                  labels={LOOK_LABELS}
                  checked={partyDrawn.look}
                  onChange={(look) => update({ partyLook: look })}
                />
                <Pills
                  legend="Focus"
                  name="share-focus"
                  choices={partyChoices.focus}
                  labels={FOCUS_LABELS}
                  checked={partyDrawn.focus}
                  onChange={setFocus}
                />
                {/* Only where it applies: a square Dark podium card. A story
                    has room for both, Mosaic keeps the podium alone, and the
                    spread takes the podium's place. */}
                {partyChoices.under !== null && (
                  <Pills
                    legend="Under the podium"
                    name="share-under"
                    choices={partyChoices.under}
                    labels={UNDER_LABELS}
                    checked={
                      partyDrawn.under === "none" ? null : partyDrawn.under
                    }
                    onChange={setUnder}
                  />
                )}
              </>
            )}

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
              {partyChoices !== null && card.kind === "party" && (
                <>
                  <CheckOption
                    type="checkbox"
                    label="Only me and my place"
                    checked={card.onlyMe}
                    disabled={!partyChoices.onlyMe.ok}
                    onChange={() => update({ onlyMe: !prefs.onlyMe })}
                  />
                  {partyChoices.onlyMe.reason !== null && (
                    <p className="section-note share-toggle-note">
                      {partyChoices.onlyMe.reason}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Only what works in this browser, and never a greyed button: the
            row waits for the first picture, and holds still for the moment
            a redraw takes. The primary is the last one — Share where the
            browser can, Save image where it cannot. */}
        {shot !== null && (
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
              className={shareable ? "button" : "button button-primary"}
              href={shot.url}
              download={shot.file.name}
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
