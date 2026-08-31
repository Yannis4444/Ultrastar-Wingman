import {
  SCORE_TICKS,
  jitterOf,
  scoreTickLabel,
  scoreX,
  swarm,
  timeTicks,
} from "./chartLayout";

test("the score scale runs 0 to 10k in quarter steps, labelled short", () => {
  expect([...SCORE_TICKS]).toEqual([0, 2500, 5000, 7500, 10000]);
  expect(SCORE_TICKS.map(scoreTickLabel)).toEqual([
    "0",
    "2.5k",
    "5k",
    "7.5k",
    "10k",
  ]);
  expect(scoreX(5000, 300)).toBe(150);
  expect(scoreX(10000, 300)).toBe(300);
});

test("a near-tie steps aside instead of hiding behind its neighbour", () => {
  // Two scores four points apart on a 300px track land on the same pixel.
  const placed = swarm([8400, 8404], (value) => value, 20, 10);

  expect(placed[0]).toMatchObject({ y: 20 });
  // The second mark takes the nearest free spot off the base line.
  expect(Math.abs(placed[1].y - 20)).toBe(10);
  const dx = placed[1].x - placed[0].x;
  const dy = placed[1].y - placed[0].y;
  expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(100);
});

test("marks far enough apart all stay on the base line", () => {
  const placed = swarm([1000, 5000, 9000], (value) => value / 40, 20, 10);
  expect(placed.map((mark) => mark.y)).toEqual([20, 20, 20]);
});

test("a pile alternates above and below the base line", () => {
  const placed = swarm([5000, 5000, 5000, 5000, 5000], () => 100, 50, 10);
  expect(placed.map((mark) => mark.y).sort((a, b) => a - b)).toEqual([
    30, 40, 50, 60, 70,
  ]);
});

test("the offset cap keeps a huge pile inside the track", () => {
  const placed = swarm(new Array<number>(50).fill(5000), () => 100, 50, 10, 20);
  for (const mark of placed) {
    expect(mark.y).toBeGreaterThanOrEqual(30);
    expect(mark.y).toBeLessThanOrEqual(70);
  }
});

test("the jitter is deterministic and stays inside [-1, 1]", () => {
  for (const id of [0, 1, 7, 12345, 987654321]) {
    const value = jitterOf(id);
    expect(value).toBe(jitterOf(id));
    expect(Math.abs(value)).toBeLessThanOrEqual(1);
  }
  // Not everything on one spot — the ids used here must spread out.
  const spread = new Set([1, 2, 3, 4, 5].map(jitterOf));
  expect(spread.size).toBeGreaterThan(3);
});

test("timeline ticks land on whole clock times inside the range", () => {
  // An evening from 20:30 to 23:40 local time: 190 minutes fit four 60-minute
  // steps, so the ticks are the whole hours 21:00, 22:00 and 23:00.
  const start = new Date(2026, 7, 23, 20, 30).getTime();
  const end = new Date(2026, 7, 23, 23, 40).getTime();

  const ticks = timeTicks(start, end);

  expect(
    ticks.map((tick) => {
      const at = new Date(tick);
      return `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;
    }),
  ).toEqual(["21:00", "22:00", "23:00"]);
});

test("a long night widens the step instead of crowding the axis", () => {
  // 20:30 to 02:30 the next day is 360 minutes: 120-minute steps fit.
  const start = new Date(2026, 7, 23, 20, 30).getTime();
  const end = new Date(2026, 7, 24, 2, 30).getTime();

  const ticks = timeTicks(start, end);

  expect(ticks.length).toBeLessThanOrEqual(4);
  for (const tick of ticks) {
    expect(tick).toBeGreaterThanOrEqual(start);
    expect(tick).toBeLessThanOrEqual(end);
    const at = new Date(tick);
    expect(at.getMinutes()).toBe(0);
    expect(at.getHours() % 2).toBe(0);
  }
});

test("a very short range still gets at least one tick's chance", () => {
  // Two scores in the same half hour: the 30-minute step applies, and any
  // tick that exists is a real clock time inside the range.
  const start = new Date(2026, 7, 23, 21, 1).getTime();
  const end = new Date(2026, 7, 23, 21, 40).getTime();

  const ticks = timeTicks(start, end);

  expect(ticks.length).toBeLessThanOrEqual(2);
  for (const tick of ticks) {
    expect(new Date(tick).getMinutes() % 30).toBe(0);
  }
});
