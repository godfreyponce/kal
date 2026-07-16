"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DayCell, Macros, DayFood } from "@/lib/adherence-view";
import { dayVerdict, kcalWithinBand, proteinMet } from "@/lib/adherence-view";
import { rubberBand, shouldDismiss, scrimProgress } from "@/lib/sheet-gesture";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z"); // UTC, like the strip
  return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`; // "Thu, Jul 10"
};

// kcal bar: the target sits at a fixed mark so an over-target day visibly extends past it.
const KCAL_TARGET_MARK = 78; // %
const PROTEIN_TARGET_MARK = 90; // % (= the 0.9 floor)
const EXIT_MS = 240; // must match the .sheet-card exit transition (see globals.css)

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
  // Bottom sheet: mount closed, add .open next frame to spring up; on close
  // drop .open and unmount after the EXIT_MS sink-down.
  const [shown, setShown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const closeBtn = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Whole-sheet, scroll-aware drag-to-dismiss. Native non-passive listeners so we
  // can preventDefault the scroll when hijacking a top-of-list downward pull.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // Reduced motion: no drag at all (CSS also disables the transform).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let active = false; // are we dragging the SHEET (vs. letting it scroll)?
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0; // px/ms, positive = downward
    let pointerId = -1;

    const setVars = (dy: number) => {
      card.style.setProperty("--sheet-y", `${dy}px`);
      card.style.setProperty("--scrim-o", `${scrimProgress(dy, card.offsetHeight)}`);
    };
    const clearVars = () => {
      card.style.removeProperty("--sheet-y");
      card.style.removeProperty("--scrim-o");
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return; // pointer-drag is a touch affordance
      pointerId = e.pointerId;
      startY = lastY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      active = false; // decide on first move whether this is a sheet-drag or a scroll
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dyRaw = e.clientY - startY;

      // Decide gesture ownership once: a downward pull with the list at the top
      // drags the sheet; anything else is left to native scroll.
      if (!active) {
        if (dyRaw > 4 && card.scrollTop <= 0) {
          active = true;
          setDragging(true);
          card.setPointerCapture(pointerId);
        } else {
          return; // let native scroll run
        }
      }

      e.preventDefault(); // we own the gesture — stop native scroll

      // velocity from the last sample (event.timeStamp is monotonic ms)
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;

      // dy>0 follows the finger 1:1; dy<0 (past the open detent) rubber-bands.
      const dy = dyRaw >= 0 ? dyRaw : -rubberBand(-dyRaw, card.offsetHeight); // ~0.55 factor
      setVars(dy);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !active) {
        active = false;
        return;
      }
      active = false;
      setDragging(false);
      if (card.hasPointerCapture?.(pointerId)) card.releasePointerCapture(pointerId);
      const dy = e.clientY - startY;
      if (shouldDismiss({ dy, sheetHeight: card.offsetHeight, velocity })) {
        clearVars();
        close(); // drops .open → sheet transitions to translateY(100%), then unmounts
      } else {
        clearVars(); // removing .dragging + clearing the var → CSS springs back to translateY(0)
      }
    };

    card.addEventListener("pointerdown", onDown);
    card.addEventListener("pointermove", onMove, { passive: false });
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
    return () => {
      card.removeEventListener("pointerdown", onDown);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onUp);
    };
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
    <div className={`sheet${shown ? " open" : ""}${dragging ? " dragging" : ""}`}>
      <div className="sheet-scrim" onClick={close} />
      <div
        className="sheet-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${dateLabel(day.date)} detail`}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <span className="sheet-title">{dateLabel(day.date)}</span>
          <button ref={closeBtn} type="button" className="sheet-x" onClick={close} aria-label="Close">
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
                    className={`sheet-food${open ? " open" : ""}${last}`}
                    aria-expanded={open}
                    onClick={() => toggle(i)}
                  >
                    <span className="mi-name">{f.name}</span>
                    <span className="mi-amt">{f.amountLabel}</span>
                    <span className="mi-kcal">{num(f.kcal)}</span>
                    <span className="mi-caret">›</span>
                  </button>
                  <div className={`sheet-food-wrap${open ? " open" : ""}${last}`}>
                    <div className="sheet-food-inner">
                      <div className="sheet-food-detail">
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
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
