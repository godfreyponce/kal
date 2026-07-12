import { describe, it, expect } from "vitest";
import { buildTrendGeometry, nearestPoint, recentLog } from "./trend-geometry";

describe("buildTrendGeometry", () => {
  it("0 entries: empty points, null path/labels/gridlines/goal", () => {
    const g = buildTrendGeometry([], 160);
    expect(g).toEqual({ points: [], pathD: null, gridlines: [], goalY: null, xLabels: null });
  });

  it("1 entry: centered dot, no path, single-value domain clamped", () => {
    const g = buildTrendGeometry([{ date: "2026-07-04", weightLb: 171.5 }], null);
    expect(g.points).toEqual([{ x: 170, y: 66, date: "2026-07-04", weightLb: 171.5 }]);
    expect(g.pathD).toBeNull();
    expect(g.xLabels).toEqual({ first: "JUL 4", last: "JUL 4" });
    expect(g.goalY).toBeNull();
    // domain [170.5,172.5] (171.5 ± clamped 1-lb pad) → no 5-lb multiple falls inside
    expect(g.gridlines).toEqual([]);
  });

  it("many entries with UNEVEN date gaps: x spacing proportional to days, not index", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 170 },
        { date: "2026-01-02", weightLb: 169 },
        { date: "2026-01-05", weightLb: 168 },
      ],
      null,
    );
    // day range is 4 (Jan1→Jan5); Jan2 is 1/4 of the way across
    expect(g.points.map((p) => p.x)).toEqual([10, 90, 330]);
    expect(g.points.map((p) => p.y)).toEqual([33, 66, 99]);
    expect(g.pathD).toBe("M10,33 L90,66 L330,99");
    expect(g.xLabels).toEqual({ first: "JAN 1", last: "JAN 5" });
  });

  it("goal below all weights: goalY inside viewBox, domain stretched to include it", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 172 },
        { date: "2026-01-08", weightLb: 170 },
      ],
      150,
    );
    expect(g.goalY).toBe(122.9);
    expect(g.goalY!).toBeGreaterThan(0);
    expect(g.goalY!).toBeLessThan(132);
    // domain stretched well below the 170/172 weights to reach the 150 goal
    expect(g.gridlines.map((gl) => gl.label)).toEqual(["150", "155", "160", "165", "170"]);
  });

  it("goal null: goalY null, domain from weights only", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 172 },
        { date: "2026-01-08", weightLb: 170 },
      ],
      null,
    );
    expect(g.goalY).toBeNull();
    // domain is just the weights ± padding — no gridline anywhere near 150
    expect(g.gridlines.map((gl) => gl.label)).not.toContain("150");
  });

  it("gridline labels at 5-lb multiples inside the padded domain", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 160 },
        { date: "2026-01-08", weightLb: 170 },
      ],
      null,
    );
    // range 10, 8% pad = 0.8 lb — below the 1-lb clamp floor, so pad clamps to 1:
    // domain [159, 171] → 5-lb multiples inside: 160, 165, 170
    expect(g.gridlines).toEqual([
      { y: 121, label: "160" },
      { y: 66, label: "165" },
      { y: 11, label: "170" },
    ]);
  });

  it("all-identical weights: padding clamp keeps the flat line off the edges", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 170 },
        { date: "2026-01-08", weightLb: 170 },
        { date: "2026-01-15", weightLb: 170 },
      ],
      null,
    );
    // range is 0 → 8% pad is 0, clamped to the 1-lb minimum instead → domain [169,171]
    expect(g.points.every((p) => p.y === 66)).toBe(true);
    expect(g.points[0].y).toBeGreaterThan(0);
    expect(g.points[0].y).toBeLessThan(132);
    expect(g.gridlines).toEqual([{ y: 66, label: "170" }]);
  });

  it("honors a custom viewBox, scaling coordinates accordingly", () => {
    const g = buildTrendGeometry(
      [
        { date: "2026-01-01", weightLb: 160 },
        { date: "2026-01-08", weightLb: 170 },
      ],
      null,
      { w: 100, h: 50 },
    );
    // drawableW = 100 - 10 - 10 = 80; two points → x = 10 and 90
    expect(g.points.map((p) => p.x)).toEqual([10, 90]);
    // domain [159,171] range 12; y = h*(171-w)/12 at h=50
    expect(g.points.map((p) => p.y)).toEqual([45.8, 4.2]);
  });
});

describe("nearestPoint", () => {
  const points = [
    { x: 10, y: 20, date: "2026-01-01", weightLb: 170 },
    { x: 100, y: 30, date: "2026-01-05", weightLb: 168 },
    { x: 200, y: 40, date: "2026-01-10", weightLb: 165 },
  ];

  it("snaps to the closest point by x", () => {
    expect(nearestPoint(points, 95)).toEqual(points[1]);
    expect(nearestPoint(points, 205)).toEqual(points[2]);
  });

  it("breaks exact ties toward the first (leftmost) point", () => {
    // 55 is equidistant from points[0].x=10 and points[1].x=100
    expect(nearestPoint(points, 55)).toEqual(points[0]);
  });

  it("returns null for an empty points array", () => {
    expect(nearestPoint([], 50)).toBeNull();
  });
});

describe("recentLog", () => {
  const entries = [
    { date: "2026-01-01", weightLb: 170.0 },
    { date: "2026-01-08", weightLb: 169.0 },
    { date: "2026-01-15", weightLb: 168.5 },
    { date: "2026-01-22", weightLb: 168.5 },
    { date: "2026-01-29", weightLb: 167.0 },
  ];

  it("defaults to the last 3, newest first, delta vs the true previous weigh-in", () => {
    expect(recentLog(entries)).toEqual([
      { date: "2026-01-29", weightLb: 167.0, delta: -1.5 },
      { date: "2026-01-22", weightLb: 168.5, delta: 0 },
      { date: "2026-01-15", weightLb: 168.5, delta: -0.5 },
    ]);
  });

  it("n > entries.length returns everything, including the first-ever null delta", () => {
    expect(recentLog(entries, 10)).toEqual([
      { date: "2026-01-29", weightLb: 167.0, delta: -1.5 },
      { date: "2026-01-22", weightLb: 168.5, delta: 0 },
      { date: "2026-01-15", weightLb: 168.5, delta: -0.5 },
      { date: "2026-01-08", weightLb: 169.0, delta: -1.0 },
      { date: "2026-01-01", weightLb: 170.0, delta: null },
    ]);
  });

  it("empty entries returns empty", () => {
    expect(recentLog([])).toEqual([]);
  });
});
