"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DayCell, Macros, DayFood } from "@/lib/adherence-view";
import { dayVerdict, kcalWithinBand, proteinMet } from "@/lib/adherence-view";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z"); // UTC, like the strip
  return `${WEEKDAY[d.getUTCDay()]} · ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

// kcal bar: the target sits at a fixed mark so an over-target day visibly extends past it.
const KCAL_TARGET_MARK = 78; // %
const PROTEIN_TARGET_MARK = 90; // % (= the 0.9 floor)

export function DayDetailModal({
  day,
  targets,
  foods,
  onClose,
}: {
  day: DayCell;
  targets: Macros;
  foods: DayFood[];
  onClose: () => void;
}) {
  // Rise & sink, matching meal-popup: mount closed, add .open next frame; on close
  // drop .open and unmount after the 170ms exit.
  const [shown, setShown] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const toggle = (i: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const v = dayVerdict(day, targets);
  const c = day.consumed ?? { kcal: 0, proteinG: 0 };
  const today = day.state === "today";
  const unlogged = day.state === "unlogged";

  const maxK = Math.max(targets.kcal / (KCAL_TARGET_MARK / 100), c.kcal);
  const kPct = Math.min(100, (c.kcal / maxK) * 100);
  const kOk = kcalWithinBand(c, targets);
  const kBar = today ? "now" : kOk ? "hit" : "over";
  const kNote = today
    ? `${num(Math.max(0, targets.kcal - c.kcal))} kcal left`
    : kOk
      ? "within target"
      : c.kcal > targets.kcal
        ? `${num(c.kcal - targets.kcal)} over target`
        : `${num(targets.kcal - c.kcal)} under target`;

  const pPct = Math.min(100, (c.proteinG / targets.proteinG) * 100);
  const pOk = proteinMet(c, targets);
  const pBar = today ? "now" : pOk ? "pro-ok" : "pro-short";
  const pNote = today
    ? `${num(Math.max(0, targets.proteinG - c.proteinG))} g to go`
    : pOk
      ? "target met"
      : `short ${num(targets.proteinG - c.proteinG)} g`;

  return (
    <div className={`mpop${shown ? " open" : ""}`}>
      <div className="mpop-scrim" onClick={close} />
      <div
        className="mpop-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${dateLabel(day.date)} detail`}
      >
        <div className="mpop-head">
          <span className="mpop-title">{dateLabel(day.date)}</span>
          <button ref={closeBtn} type="button" className="mpop-x" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`dd-verdict v-${v.kind}`}>{v.text}</div>

        {unlogged ? (
          <div className="dd-empty">Nothing logged this day.</div>
        ) : (
          <>
            <div className="dd-stats">
              <div className="dd-stat">
                <div className="dd-stat-top">
                  <span className="dd-lab">kcal</span>
                  <span className="dd-val">
                    <b>{num(c.kcal)}</b> / {num(targets.kcal)}
                  </span>
                </div>
                <div className="dd-bar">
                  <div className={`dd-bar-fill ${kBar}`} style={{ width: `${kPct}%` }} />
                  <div className="dd-target" style={{ left: `${KCAL_TARGET_MARK}%` }} />
                </div>
                <div className={`dd-note ${today ? "wip" : kOk ? "good" : "bad"}`}>{kNote}</div>
              </div>
              <div className="dd-stat">
                <div className="dd-stat-top">
                  <span className="dd-lab">protein</span>
                  <span className="dd-val">
                    <b>{num(c.proteinG)}</b> / {num(targets.proteinG)} g
                  </span>
                </div>
                <div className="dd-bar">
                  <div className={`dd-bar-fill ${pBar}`} style={{ width: `${pPct}%` }} />
                  <div className="dd-target" style={{ left: `${PROTEIN_TARGET_MARK}%` }} />
                </div>
                <div className={`dd-note ${today ? "wip" : pOk ? "good" : "bad"}`}>{pNote}</div>
              </div>
            </div>

            <div className="dd-foods-label">{today ? "Logged so far" : "What you ate"}</div>
            {foods.map((f, i) => {
              const open = expanded.has(i);
              const last = i === foods.length - 1 ? " last" : "";
              return (
                <div key={i}>
                  <button
                    type="button"
                    className={`mpop-item${open ? " open" : ""}${last}`}
                    aria-expanded={open}
                    onClick={() => toggle(i)}
                  >
                    <span className="mi-name">{f.name}</span>
                    <span className="mi-amt">{f.amountLabel}</span>
                    <span className="mi-kcal">{num(f.kcal)}</span>
                    <span className="mi-caret">›</span>
                  </button>
                  {open && (
                    <div className={`mpop-serv${last}`}>
                      <div className="mpop-stats">
                        <span className="ms">
                          <span className="ms-lab">kcal</span>
                          <span className="ms-v">{num(f.kcal)}</span>
                        </span>
                        <span className="ms p">
                          <span className="ms-lab">protein</span>
                          <span className="ms-v">{num(f.proteinG)} g</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
