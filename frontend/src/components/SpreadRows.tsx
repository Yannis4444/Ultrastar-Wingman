import type { ReactNode } from "react";
import type { ScoreWithContext } from "../api";
import {
  CHART_LABEL_SIZE,
  SCORE_INSET,
  SCORE_TICKS,
  jitterOf,
  scoreTickLabel,
  scoreX,
  swarm,
  tickAnchor,
} from "../chartLayout";
import { chartTheme } from "../chartTheme";
import { useChartTip, type SurfaceMark } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import {
  bestScoreOf,
  boxStats,
  scoreTipLines,
  type ScoreGroup,
} from "../stats";
import ChartTip from "./ChartTip";
import "./SpreadRows.css";

/** How many groups the chart draws at most — the full list sits right below. */
const CHART_GROUPS = 8;
/** Below this many scores a quartile box is interpolation fiction — the group
 * shows its scores as plain marks instead of pretending to a distribution. */
const BOX_MIN_SCORES = 5;
/** From this many scores a song row's initials would crowd the line — it is
 * two full four-mic performances — so they retire in favour of plain dots. */
const INITIALS_MAX_SCORES = 8;
/** A row's height while nothing on it has to step aside. */
const ROW_HEIGHT = 32;
/** What a row keeps above and below its outermost mark once it has to grow. */
const ROW_PAD = 6;
/** The name column: a singer's name and count, or a song's title. */
const NAME_WIDTH = { player: 88, song: 104 } as const;
/** The group's best, right-aligned. Wide enough for "10000" in bold 13px. */
const BEST_WIDTH = 40;
/** The gap between the three columns. */
const GAP = 8;
const AXIS_HEIGHT = 20;
/** A plain score dot and the ring that keeps a pile of them countable. */
const DOT = { r: 3.5, ring: 1.5, gap: 9 };
/** An initial chip, 18px across ring and all. */
const CHIP = { r: 8.25, ring: 1.5, gap: 15 };

interface SpreadRowsProps {
  /** The groups in the reader's order — the chart draws the head of the same
   * list the page shows, so the two can never disagree. */
  groups: ScoreGroup[];
  grouping: "player" | "song";
  /** Announced to screen readers, which get nothing out of the drawing —
   * everything in it is also in the ranking list below. */
  label: string;
  /**
   * Whether a song row's marks wear their singers' initials. The account's
   * own history turns this off: every mark would be the same letter.
   */
  initials?: boolean;
  /** Whether the tooltips date a score: on for a list that spans parties. */
  dated?: boolean;
  /** The colour behind the chart, which the mark rings stroke so two piled
   * marks still read as two — a ring painted for the wrong ground haloes. */
  surface?: string;
}

/** One drawn row: its marks in row-local coordinates and how tall it is. */
interface Row {
  height: number;
  tappable: SurfaceMark[];
  nodes: ReactNode;
}

/**
 * The score spread, one 32px row per group: the name at the left, the track
 * on the shared 0–10k scale in the middle, the group's best at the right, the
 * gridlines drawn once behind every row and the axis once under them. A
 * singer with enough scores gets the standard box plot — Tukey whiskers ending
 * on real scores, outliers past them on either side — with every raw score as
 * a small grey dot on top. A song is usually one performance rather than a
 * distribution, so its row is a strip in miniature: the scores swarm on the
 * line, wearing their singers' initials while they are few. The party's best
 * score is the one gold mark.
 */
export default function SpreadRows({
  groups,
  grouping,
  label,
  initials = true,
  dated = false,
  surface = chartTheme.pageBg,
}: SpreadRowsProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip, surfaceTip } = useChartTip(containerRef);
  const shown = groups.slice(0, CHART_GROUPS);
  const nameWidth = NAME_WIDTH[grouping];
  const track = Math.max(width - nameWidth - BEST_WIDTH - 2 * GAP, 40);
  const trackLeft = nameWidth + GAP;
  const x = (value: number) => scoreX(value, track, SCORE_INSET);
  // Over every group and not only the drawn ones: the gold mark is the
  // party's best, the same one the strip and the summary mean.
  const best = bestScoreOf(groups.flatMap((group) => group.scores));

  /** A raw-score mark plus an invisible, finger-sized hover/tap target. */
  const dot = (
    score: ScoreWithContext,
    cx: number,
    cy: number,
    looks: { r: number; ring: string },
  ) => (
    <g key={score.id}>
      <circle
        data-testid="spread-dot"
        cx={cx}
        cy={cy}
        r={looks.r}
        fill={score === best ? chartTheme.gold : chartTheme.dot}
        stroke={looks.ring}
        strokeWidth={DOT.ring}
      />
      {/* The invisible target the dot answers hover on; taps resolve on
          the row's SVG itself, to the nearest mark. */}
      <circle
        cx={cx}
        cy={cy}
        r={8}
        fill="transparent"
        data-tipkey={`score:${score.id}`}
        {...markTip(`score:${score.id}`, scoreTipLines(score, dated))}
      />
    </g>
  );

  /** Tukey box with the raw scores jittered on top — the player rows. */
  const boxRow = (group: ScoreGroup): Row => {
    const mid = ROW_HEIGHT / 2;
    const box = boxStats(group);
    const tipLines = [
      group.label,
      `${group.scores.length} scores`,
      `Best: ${group.best}`,
      `Upper quartile: ${Math.round(box.q3)}`,
      `Median: ${group.median}`,
      `Lower quartile: ${Math.round(box.q1)}`,
      `Worst: ${group.worst}`,
    ];
    const boxKey = `box:${group.key}`;
    const dots = group.scores.map((score) => ({
      score,
      x: x(score.score),
      y: mid + jitterOf(score.id) * 5,
    }));
    const tappable: SurfaceMark[] = [
      ...dots.map(({ score, x: cx, y }) => ({
        key: `score:${score.id}`,
        x: cx,
        y,
        lines: scoreTipLines(score, dated),
      })),
      {
        key: boxKey,
        x: (x(box.q1) + x(box.q3)) / 2,
        y: mid,
        lines: tipLines,
      },
    ];
    const nodes = (
      <>
        {[
          [box.whiskerLow, box.q1],
          [box.q3, box.whiskerHigh],
        ].map(([from, to], side) => (
          <line
            // Five identical scores collapse every value into one — the side
            // is the one thing that still tells the two segments apart.
            key={side}
            x1={x(from)}
            x2={x(to)}
            y1={mid}
            y2={mid}
            stroke={chartTheme.accent}
            strokeWidth={1.5}
          />
        ))}
        {[box.whiskerLow, box.whiskerHigh].map((end, side) => (
          <line
            key={`cap-${side}`}
            x1={x(end)}
            x2={x(end)}
            y1={mid - 5}
            y2={mid + 5}
            stroke={chartTheme.accent}
            strokeWidth={1.5}
          />
        ))}
        <rect
          data-testid="spread-box"
          x={x(box.q1)}
          y={mid - 8}
          width={Math.max(x(box.q3) - x(box.q1), 2)}
          height={16}
          rx={3}
          fill={chartTheme.fill}
          stroke={chartTheme.accent}
          strokeWidth={1.5}
          data-tipkey={boxKey}
          {...markTip(boxKey, tipLines)}
        />
        <line
          x1={x(group.median)}
          x2={x(group.median)}
          y1={mid - 8}
          y2={mid + 8}
          stroke={chartTheme.median}
          strokeWidth={2}
        />
        {/* Ringed in the box's own body colour: on the box, where most of
            them stand, the ring is the gap between two dots. */}
        {dots.map(({ score, x: cx, y }) =>
          dot(score, cx, y, { r: 2.5, ring: chartTheme.fill }),
        )}
      </>
    );
    return { height: ROW_HEIGHT, tappable, nodes };
  };

  /** A strip in miniature — the song rows, and a singer with too few scores
   * for a box. Near-ties stagger apart instead of hiding each other, and the
   * row grows by what the stagger needs. */
  const swarmRow = (group: ScoreGroup, chips: boolean): Row => {
    const mark = chips ? CHIP : DOT;
    const ascending = [...group.scores].sort((a, b) => a.score - b.score);
    const placed = swarm(
      ascending,
      (score) => x(score.score),
      0,
      mark.gap,
      2 * mark.gap,
    );
    const above = Math.min(0, ...placed.map(({ y }) => y));
    const below = Math.max(0, ...placed.map(({ y }) => y));
    const height = Math.max(
      ROW_HEIGHT,
      below - above + 2 * (mark.r + mark.ring) + 2 * ROW_PAD,
    );
    // Centred on the marks' own extent, so a pile that only grew upwards is
    // not pushed against the row's top.
    const base = height / 2 - (above + below) / 2;
    const marks = placed.map((entry) => ({ ...entry, y: entry.y + base }));
    const tappable: SurfaceMark[] = marks.map(({ item, x: cx, y }) => ({
      key: `score:${item.id}`,
      x: cx,
      y,
      lines: scoreTipLines(item, dated),
    }));
    const nodes = marks.map(({ item, x: cx, y }) =>
      chips ? (
        <g key={item.id}>
          <circle
            data-testid="spread-chip"
            cx={cx}
            cy={y}
            r={CHIP.r}
            fill={item === best ? chartTheme.gold : chartTheme.chip}
            stroke={surface}
            strokeWidth={CHIP.ring}
            data-tipkey={`score:${item.id}`}
            {...markTip(`score:${item.id}`, scoreTipLines(item, dated))}
          />
          <text
            x={cx}
            y={y + 3.5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill={item === best ? chartTheme.pageBg : chartTheme.chipText}
            pointerEvents="none"
          >
            {item.player_name.slice(0, 1)}
          </text>
        </g>
      ) : (
        dot(item, cx, y, { r: DOT.r, ring: surface })
      ),
    );
    return { height, tappable, nodes };
  };

  return (
    <div
      className="chart-plot spread-rows"
      ref={containerRef}
      role="img"
      aria-label={label}
      onClick={clear}
    >
      <div className="spread-rows-body">
        {/* The gridlines once, behind every row — not a set per row, which
            drew a fence of short posts instead of one scale. */}
        <svg
          className="spread-rows-grid"
          width={track}
          height="100%"
          style={{ left: trackLeft }}
          aria-hidden="true"
        >
          {SCORE_TICKS.map((tick) => (
            <line
              key={tick}
              data-testid="spread-grid"
              x1={x(tick)}
              x2={x(tick)}
              y1={0}
              y2="100%"
              stroke={chartTheme.grid}
              strokeWidth={1}
              opacity={0.55}
            />
          ))}
        </svg>

        {shown.map((group) => {
          const row =
            grouping === "player" && group.scores.length >= BOX_MIN_SCORES
              ? boxRow(group)
              : swarmRow(
                  group,
                  grouping === "song" &&
                    initials &&
                    group.scores.length < INITIALS_MAX_SCORES,
                );
          return (
            <div className="spread-row" key={group.key}>
              <span
                className="spread-row-label"
                style={{ flexBasis: nameWidth, width: nameWidth }}
                title={`${group.label}: ${group.scores.length} ${
                  group.scores.length === 1 ? "score" : "scores"
                }`}
              >
                {grouping === "song" ? (
                  // The column is a hundred pixels: the title is what tells
                  // two songs apart, the artist is in the list below.
                  (group.song?.title ?? group.label)
                ) : (
                  <>
                    {group.label}{" "}
                    <span className="spread-row-count">
                      ×{group.scores.length}
                    </span>
                  </>
                )}
              </span>
              <svg
                width={track}
                height={row.height}
                viewBox={`0 0 ${track} ${row.height}`}
                {...surfaceTip(row.tappable)}
              >
                {row.nodes}
              </svg>
              {/* The group's best — the number the ranking list ranks by, so
                  the chart can never disagree with the row below it. */}
              <span className="spread-row-best">{group.best}</span>
            </div>
          );
        })}
      </div>

      {/* The axis once, under the rows and aligned to their tracks. */}
      <svg
        className="spread-rows-axis"
        width={track}
        height={AXIS_HEIGHT}
        viewBox={`0 0 ${track} ${AXIS_HEIGHT}`}
        style={{ marginLeft: trackLeft }}
      >
        <line
          x1={0}
          x2={track}
          y1={0.5}
          y2={0.5}
          stroke={chartTheme.grid}
          strokeWidth={1}
        />
        {SCORE_TICKS.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={15}
            textAnchor={tickAnchor(tick)}
            fontSize={CHART_LABEL_SIZE}
            fill={chartTheme.axisQuiet}
          >
            {scoreTickLabel(tick)}
          </text>
        ))}
      </svg>

      {shown.length < groups.length && (
        <p className="spread-more">
          … {groups.length - shown.length} more in the list below
        </p>
      )}
      <ChartTip tip={tip} />
    </div>
  );
}
