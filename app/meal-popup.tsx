"use client";

import { useCallback, useEffect, useState } from "react";
import type { TodayMeal, TodayMealItem } from "@/lib/today";
import type { MealStatusValue } from "@/lib/meal-status";

const n = (x: number) => Math.round(x).toLocaleString("en-US");
// Whole grams like the totals row, but keep one decimal for small serving
// values (e.g. an egg's 0.5g C) so they don't collapse to a misleading 0/1.
const g = (x: number) => (x < 10 && x % 1 !== 0 ? x.toFixed(1) : String(Math.round(x)));
// A raw hint means the food is cooked-basis (meats, rice) — say so on the
// amount, since the macros are computed from the cooked weight.
const amt = (it: TodayMealItem) => (it.rawLabel ? `${it.amountLabel} cooked` : it.amountLabel);
// The amount already says "cooked" for those foods — drop the redundant
// ", cooked" from the display name ("Chicken breast, cooked" → "Chicken breast").
const displayName = (s: string) => s.replace(/,\s*cooked$/i, "");

// Short per-serving unit for the strip's sub-lines: "100 g (3.5 oz)" → "100 g",
// "1 egg" → "egg" — the full servingLabel doesn't fit a quarter-width column.
const per = (s: string) => s.replace(/\s*\(.*\)$/, "").replace(/^1 /, "");

function StatStrip({ it }: { it: TodayMealItem }) {
  const unit = per(it.servingLabel);
  const cols = [
    { cls: "", lab: "kcal", v: n(it.kcal), s: n(it.serving.kcal) },
    { cls: " p", lab: "protein", v: `${g(it.proteinG)}g`, s: `${g(it.serving.proteinG)}g` },
    { cls: " c", lab: "carbs", v: `${g(it.carbsG)}g`, s: `${g(it.serving.carbsG)}g` },
    { cls: " f", lab: "fat", v: `${g(it.fatG)}g`, s: `${g(it.serving.fatG)}g` },
  ];
  return (
    <div className="mpop-stats">
      {cols.map((c) => (
        <span key={c.lab} className={`ms${c.cls}`}>
          <span className="ms-lab">{c.lab}</span>
          <span className="ms-v">{c.v}</span>
          <span className="ms-s">
            {c.s} / {unit}
          </span>
        </span>
      ))}
    </div>
  );
}

export function MealPopup({
  meal,
  status,
  busy,
  onToggle,
  onClose,
}: {
  meal: TodayMeal;
  status: MealStatusValue;
  busy: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Rise & sink: mount closed, add .open a frame later so the enter transition
  // runs; on close, drop .open and unmount after the exit transition (170ms).
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function toggleItem(j: number) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(j)) next.delete(j);
      else next.add(j);
      return next;
    });
  }

  // Totals sum the line-rounded values so lines + totals always agree.
  const totals = meal.items.reduce(
    (a, it) => ({ kcal: a.kcal + it.kcal, p: a.p + it.proteinG, c: a.c + it.carbsG, f: a.f + it.fatG }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  const eaten = status === "eaten";

  return (
    <div className={`mpop${shown ? " open" : ""}`}>
      <div className="mpop-scrim" onClick={close} />
      <div className="mpop-card" role="dialog" aria-modal="true" aria-label={`${meal.name} details${meal.adjusted ? ", adjusted today" : ""}`}>
        <div className="mpop-head">
          <span className="mpop-title">{meal.name}</span>
          <span className="mpop-kcal">
            {meal.adjusted && <span className="adjmark" aria-hidden="true">⇄</span>}
            {n(meal.plannedKcal)} kcal
          </span>
          <button type="button" className="mpop-x" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {meal.timeHint && <div className="mpop-hint">{meal.timeHint}</div>}
        {meal.items.map((it, j) => {
          const open = expanded.has(j);
          // The last line before the totals' dark rule carries no grey border.
          const last = j === meal.items.length - 1 ? " last" : "";
          return (
            <div key={j}>
              <button
                type="button"
                className={`mpop-item${open ? " open" : ""}${last}`}
                aria-expanded={open}
                onClick={() => toggleItem(j)}
              >
                <span className="mi-name">
                  {displayName(it.foodName)}
                  {it.rawLabel && <span className="mi-raw">{it.rawLabel}</span>}
                </span>
                <span className="mi-amt">{amt(it)}</span>
                <span className="mi-kcal">{n(it.kcal)}</span>
                <span className="mi-caret">›</span>
              </button>
              {open && (
                <div className={`mpop-serv${last}`}>
                  <StatStrip it={it} />
                </div>
              )}
            </div>
          );
        })}
        <div className="mpop-totals">
          <span>
            <b>{n(totals.kcal)}</b> kcal
          </span>
          <span className="p">
            <b>{Math.round(totals.p)}g</b> P
          </span>
          <span className="c">
            <b>{Math.round(totals.c)}g</b> C
          </span>
          <span className="f">
            <b>{Math.round(totals.f)}g</b> F
          </span>
        </div>
        <button
          type="button"
          className={`mpop-btn${eaten ? " undo" : ""}`}
          disabled={busy}
          onClick={onToggle}
        >
          {eaten ? "Eaten ✓ — tap to undo" : "Mark eaten"}
        </button>
      </div>
    </div>
  );
}
