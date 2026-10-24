import type { CSSProperties, ReactNode } from "react";
import type { ScoreWithContext } from "../api";
import { histogramLineX } from "../chartLayout";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import {
  CHART_MIN_SCORES,
  countWord,
  scoreSummary,
  spreadMarkLabels,
} from "../stats";
import ScoreHistogram, { type HistogramMark } from "./ScoreHistogram";
import "./ScoreOverview.css";

interface ScoreOverviewProps {
  /** The scores being added up. Empty draws nothing at all. */
  scores: ScoreWithContext[];
  /**
   * Whether the head line counts the distinct songs. Left out where every
   * score is one song, which would make it a permanent "1 song".
   */
  songs?: boolean;
  /**
   * Whether Best and Worst name the singer who holds them: where the scores
   * are several singers'. Never under one singer's, whose name twice says
   * nothing (§1.5).
   */
  named?: boolean;
  /** The surface's one control, at the head line's far end: *Share stats*. */
  action?: ReactNode;
  /**
   * Whether the histogram is drawn from `CHART_MIN_SCORES` on. Off keeps the
   * numbers as one line at any count — the song modal, whose picture is the
   * dated strip under it.
   */
  chart?: boolean;
  /** The histogram's name for screen readers. */
  label: string;
  /** The surface's own margins. Never its layout — that is this one's. */
  className?: string;
}

/** One of the three numbers, as both forms print it. */
interface Mark {
  kind: HistogramMark["kind"];
  word: string;
  value: number;
  /** Who holds it, where the peaks are named; the average is nobody's. */
  holder: string | null;
}

/**
 * What a set of scores adds up to on a phone (ui-guidelines §7, *Score
 * overviews*): a head line saying what was sung, then the numbers on the
 * chart — Best · Average · Worst as lines through the histogram, labelled in a
 * band over it. Under `CHART_MIN_SCORES` there is no chart, a few bars across
 * twenty buckets being noise, and the three numbers are one quiet line.
 *
 * The labels are HTML outside the drawing's `role="img"`, so a screen reader
 * reads them and a tap still reaches the bucket under them; `spreadMarkLabels`
 * keeps them apart and never drops one, because they are the numbers' only
 * print. Every score the same number is one *Best*, in both forms.
 */
export default function ScoreOverview({
  scores,
  songs = false,
  named = false,
  action,
  chart = true,
  label,
  className,
}: ScoreOverviewProps) {
  const summary = scoreSummary(scores);
  // Nothing to add up: the surface says why in its own words, if at all.
  if (summary === null) return null;

  const best: Mark = {
    kind: "best",
    word: "Best",
    value: summary.best,
    holder: named ? summary.bestBy : null,
  };
  // Reading order, from the best down; one Best where every score is equal.
  const marks: Mark[] =
    summary.best === summary.worst
      ? [best]
      : [
          best,
          {
            kind: "average",
            word: "Average",
            value: summary.average,
            holder: null,
          },
          {
            kind: "worst",
            word: "Worst",
            value: summary.worst,
            holder: named ? summary.worstBy : null,
          },
        ];
  const drawn = chart && scores.length >= CHART_MIN_SCORES;
  // A surface may hand over `cond && <button>`: false is no action either.
  const hasAction = action !== undefined && action !== null && action !== false;

  const classes = ["score-overview"];
  if (className !== undefined) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <div
        className={
          hasAction
            ? "score-overview-head score-overview-head-action"
            : "score-overview-head"
        }
      >
        <p className="score-overview-counts">
          <span className="score-overview-number">{summary.sings}</span>{" "}
          {countWord(summary.sings, "sing")}
          {songs && (
            <>
              {" · "}
              <span className="score-overview-number">
                {summary.songs}
              </span>{" "}
              {countWord(summary.songs, "song")}
            </>
          )}
        </p>
        {hasAction && action}
      </div>
      {drawn ? (
        <OverviewChart
          scores={scores}
          marks={marks}
          named={named}
          label={label}
        />
      ) : (
        <p className="score-overview-line">
          {marks.map((mark, index) => (
            <span key={mark.kind}>
              {/* Between entries, never inside one: the line wraps here. */}
              {index > 0 && " · "}
              <span className="score-overview-entry">
                {mark.word}{" "}
                <span className={`score-overview-value-${mark.kind}`}>
                  {mark.value}
                </span>
                {mark.holder !== null && (
                  <>
                    {" "}
                    <span className="score-overview-holder">{mark.holder}</span>
                  </>
                )}
              </span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * The band and the bars under it. Its own component so the width is measured
 * when the chart appears — a group that reaches its fourth score while open
 * would otherwise lay its labels out on the fallback width for good.
 */
function OverviewChart({
  scores,
  marks,
  named,
  label,
}: {
  scores: ScoreWithContext[];
  marks: Mark[];
  named: boolean;
  label: string;
}) {
  const [chartRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const best = marks[0];
  return (
    <div className="score-overview-chart" ref={chartRef}>
      <MarkBand marks={marks} width={width} named={named} />
      <ScoreHistogram
        scores={scores}
        height={96}
        label={label}
        marks={marks.map(({ kind, value }) => ({ kind, score: value }))}
        best={{ score: best.value, holder: best.holder ?? undefined }}
      />
    </div>
  );
}

/**
 * The labels over the bars, each in a slot `spreadMarkLabels` placed over its
 * line. Laid out on ascending score — the lines' order — and written in
 * reading order, Best first.
 */
function MarkBand({
  marks,
  width,
  named,
}: {
  marks: Mark[];
  width: number;
  named: boolean;
}) {
  const ascending = [...marks].reverse();
  const slots = spreadMarkLabels(
    ascending.map((mark) => histogramLineX(mark.value, width)),
    width,
  );
  return (
    <div
      className={
        named
          ? "score-overview-band score-overview-band-named"
          : "score-overview-band"
      }
    >
      {marks.map((mark, index) => {
        // `marks` is `ascending` read backwards, and so is its slot.
        const slot = slots[marks.length - 1 - index];
        const percent = `${slot.anchor * 100}%`;
        // The words hang off the line's point in the slot: centred on it while
        // the slot is, flush with the slot's edge when it was pushed aside.
        const textStyle: CSSProperties = {
          left: percent,
          transform: `translateX(-${percent})`,
          textAlign:
            slot.anchor < 1 / 3
              ? "left"
              : slot.anchor > 2 / 3
                ? "right"
                : "center",
        };
        return (
          <span
            key={mark.kind}
            className="score-overview-mark"
            data-testid={`overview-mark-${mark.kind}`}
            style={{ left: slot.left, width: slot.width }}
          >
            <span className="score-overview-mark-text" style={textStyle}>
              <span className="score-overview-mark-line">
                {mark.word}{" "}
                <span className={`score-overview-value-${mark.kind}`}>
                  {mark.value}
                </span>
              </span>
              {mark.holder !== null && (
                <span className="score-overview-mark-line score-overview-holder">
                  {mark.holder}
                </span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}
