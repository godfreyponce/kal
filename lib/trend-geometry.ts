// Pure chart math for the weight-trend SVG (design/plan-figure.html lines 399-419).
// No DB, no DOM — plain functions over arrays so the renderer (later task) and this
// math can be tested/changed independently.

export type TrendPoint = { x: number; y: number; date: string; weightLb: number };
export type TrendGeometry = {
  points: TrendPoint[]; // time-scaled x across [PAD_L, W-PAD_R]; single point → centered
  pathD: string | null; // null when < 2 points
  gridlines: { y: number; label: string }[]; // 5-lb steps inside the padded domain
  goalY: number | null; // null when goalWeightLb is null OR entries is empty (the renderer
  // shows a text empty state instead of the SVG at 0 points — plan D2); with ≥1 entry and a
  // set goal, the domain always stretches to fit it, so goalY is always drawable
  xLabels: { first: string; last: string } | null; // "MAY 30" / "JUL 11" style, null when 0 points
};

const PAD_L = 10;
const PAD_R = 10;
const Y_PAD_FRACTION = 0.08;
// Conservative clamp: an 8% pad of a zero (or near-zero) weight range would collapse
// the y-domain to nothing, dividing by zero and/or pinning a flat line to an edge.
// A 1-lb floor keeps a flat (or nearly flat) line centered and off the top/bottom edge.
const MIN_Y_PAD_LB = 1;
const GRID_STEP_LB = 5;
// Above this many points, per-point dots overlap (e.g. daily weigh-ins over 90 days) —
// the renderer skips them and keeps just the path + the latest-point marker.
const MAX_DOTS = 40;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatDateLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildTrendGeometry(
  entries: { date: string; weightLb: number }[], // ascending
  goalWeightLb: number | null,
  viewBox: { w: number; h: number } = { w: 340, h: 132 },
): TrendGeometry {
  if (entries.length === 0) {
    return { points: [], pathD: null, gridlines: [], goalY: null, xLabels: null };
  }

  const { w, h } = viewBox;

  const values = entries.map((e) => e.weightLb);
  if (goalWeightLb !== null) values.push(goalWeightLb);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yPad = Math.max((rawMax - rawMin) * Y_PAD_FRACTION, MIN_Y_PAD_LB);
  const domainMin = rawMin - yPad;
  const domainMax = rawMax + yPad;
  const domainRange = domainMax - domainMin;
  const yFor = (weight: number) => round1((h * (domainMax - weight)) / domainRange);

  const drawableW = w - PAD_L - PAD_R;
  let points: TrendPoint[];
  if (entries.length === 1) {
    const e = entries[0];
    points = [{ x: round1(PAD_L + drawableW / 2), y: yFor(e.weightLb), date: e.date, weightLb: e.weightLb }];
  } else {
    const times = entries.map((e) => new Date(e.date + "T00:00:00Z").getTime());
    const tMin = times[0];
    const tMax = times[times.length - 1];
    const tRange = tMax - tMin;
    points = entries.map((e, i) => {
      const frac = tRange === 0 ? 0.5 : (times[i] - tMin) / tRange;
      return { x: round1(PAD_L + frac * drawableW), y: yFor(e.weightLb), date: e.date, weightLb: e.weightLb };
    });
  }

  const pathD = points.length < 2 ? null : "M" + points.map((p) => `${p.x},${p.y}`).join(" L");

  const lo = Math.ceil(domainMin / GRID_STEP_LB) * GRID_STEP_LB;
  const hi = Math.floor(domainMax / GRID_STEP_LB) * GRID_STEP_LB;
  const gridlines: { y: number; label: string }[] = [];
  for (let v = lo; v <= hi; v += GRID_STEP_LB) {
    gridlines.push({ y: yFor(v), label: String(v) });
  }

  const goalY = goalWeightLb === null ? null : yFor(goalWeightLb);

  const xLabels = {
    first: formatDateLabel(entries[0].date),
    last: formatDateLabel(entries[entries.length - 1].date),
  };

  return { points, pathD, gridlines, goalY, xLabels };
}

export function shouldShowDots(pointCount: number): boolean {
  return pointCount <= MAX_DOTS;
}

export function nearestPoint(points: TrendPoint[], x: number): TrendPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  }
  return best;
}

export function recentLog(
  entries: { date: string; weightLb: number }[], // ascending
  n = 3,
): { date: string; weightLb: number; delta: number | null }[] {
  const withDeltas = entries.map((e, i) => ({
    date: e.date,
    weightLb: e.weightLb,
    delta: i === 0 ? null : round1(e.weightLb - entries[i - 1].weightLb),
  }));
  const start = Math.max(0, entries.length - n);
  return withDeltas.slice(start).reverse();
}
