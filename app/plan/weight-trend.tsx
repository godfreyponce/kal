// app/plan/weight-trend.tsx
"use client";

import { useState } from "react";
import { buildTrendGeometry, nearestPoint, recentLog, type TrendPoint } from "@/lib/trend-geometry";
import type { WeighInView } from "@/lib/weigh-ins";

// Matches the default viewBox (340×132) and PAD_L/PAD_R (10) baked into
// buildTrendGeometry — this component never passes a custom viewBox.
const VIEWBOX_W = 340;
const CHART_X1 = 10;
const CHART_X2 = 330;
const GOAL_LINE_X2 = 278; // dashed goal line stops short of the right-aligned "GOAL n" label

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Duplicated from lib/trend-geometry.ts (not exported there) — see task brief.
function formatDateLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function deltaLabel(delta: number): string {
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${Math.abs(delta).toFixed(1)}`;
}

// Client-only presentation component: renders Phase 2's weight-trend chart from
// already-computed geometry (lib/trend-geometry.ts). No fetch, no router.
export function WeightTrend({ entries, goalWeightLb }: { entries: WeighInView[]; goalWeightLb: number | null }) {
  const [hovered, setHovered] = useState<TrendPoint | null>(null);

  if (entries.length === 0) {
    return (
      <div className="plan-trend">
        <div className="plan-tr-empty">no weigh-ins yet — log one in chat</div>
      </div>
    );
  }

  const geometry = buildTrendGeometry(entries, goalWeightLb);
  const first = geometry.points[0];
  const latest = geometry.points[geometry.points.length - 1];
  const displayPoint = hovered ?? latest;
  const readout = `${formatDateLabel(displayPoint.date)} ${displayPoint.weightLb.toFixed(1)} LB`;

  const direction =
    latest.weightLb < first.weightLb ? "down to" : latest.weightLb > first.weightLb ? "up to" : "steady at";
  const ariaLabel =
    `Weight trend, ${first.weightLb.toFixed(1)} ${direction} ${latest.weightLb.toFixed(1)} pounds` +
    (goalWeightLb !== null ? `, goal ${goalWeightLb}` : "");

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W;
    setHovered(nearestPoint(geometry.points, x));
  }

  function handlePointerLeave() {
    setHovered(null);
  }

  return (
    <div className="plan-trend">
      <div className="plan-tr-head">
        <span className="plan-tr-k">Trend</span>
        <span className="plan-tr-readout">{readout}</span>
      </div>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} 132`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {geometry.gridlines.map((g) => (
          <g key={g.y}>
            <line className="plan-tr-grid" x1={CHART_X1} y1={g.y} x2={CHART_X2} y2={g.y} />
            <text className="plan-tr-lab" x={CHART_X2} y={g.y - 3} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
        {geometry.goalY !== null && (
          <>
            <line className="plan-tr-goal" x1={CHART_X1} y1={geometry.goalY} x2={GOAL_LINE_X2} y2={geometry.goalY} />
            <text className="plan-tr-goal-lab" x={CHART_X2} y={geometry.goalY + 3} textAnchor="end">
              GOAL {goalWeightLb}
            </text>
          </>
        )}
        <line
          className="plan-tr-x"
          x1={hovered ? hovered.x : 0}
          y1={12}
          x2={hovered ? hovered.x : 0}
          y2={112}
          opacity={hovered ? 0.7 : 0}
        />
        {geometry.pathD && <path className="plan-tr-line" d={geometry.pathD} />}
        <g fill="#2f3437">
          {geometry.points.slice(0, -1).map((p) => (
            <circle key={p.date} cx={p.x} cy={p.y} r={2.3} />
          ))}
        </g>
        <circle cx={latest.x} cy={latest.y} r={5.5} fill="#fff" />
        <circle cx={latest.x} cy={latest.y} r={4} fill="var(--accent)" />
        {geometry.xLabels && (
          <>
            <text className="plan-tr-lab" x={CHART_X1} y={126}>
              {geometry.xLabels.first}
            </text>
            <text className="plan-tr-lab" x={CHART_X2} y={126} textAnchor="end">
              {geometry.xLabels.last}
            </text>
          </>
        )}
      </svg>
      <div className="plan-tr-log">
        {recentLog(entries).map((row) => (
          <div key={row.date}>
            <span>{formatDateLabel(row.date)}</span>
            <span>
              {row.weightLb.toFixed(1)}
              {row.delta !== null && <em>{deltaLabel(row.delta)}</em>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
