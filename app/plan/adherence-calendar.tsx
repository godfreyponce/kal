"use client";

// Bottom sheet showing the full adherence history calendar (issue #23). Mount
// choreography mirrors day-detail-modal.tsx: the sheet subtree mounts closed
// (shown=false), a double-rAF then adds .open to spring it up, and close()
// drops .open then unmounts after EXIT_MS (the sink-down transition length).
// Task 5 wires the swipe-up (stripRef) and drag-to-dismiss (dragging/cardRef)
// gestures on top of that scaffold.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { flushSync } from "react-dom";
import { buildCalMonth, historyMonthRange } from "@/lib/adherence-calendar";
import type { AdherenceHistory } from "@/lib/adherence-calendar";
import { rubberBand, shouldDismiss, scrimProgress } from "@/lib/sheet-gesture";

const EXIT_MS = 240; // must match the .sheet-card exit transition (see globals.css)
const DOWS = ["M", "T", "W", "T", "F", "S", "S"];

// Swipe-up pull thresholds — owner tunes these on-phone (see STATE.md run/verify,
// the touch-action/passive-listener interaction on iOS Safari is a known tuning spot).
const PULL_CLAIM_UP_PX = -6;    // upward travel that claims the gesture as a pull-open
const PULL_ABANDON_DOWN_PX = 12; // downward travel before claim -> treat as a scroll, abandon
const PULL_OPEN_RATIO = 0.3;    // fraction of sheet height pulled -> commits to open
const PULL_OPEN_VELOCITY = 0.5; // px/ms flick velocity -> commits to open

export function AdherenceCalendar({
  history,
  today,
  stripRef,
}: {
  history: AdherenceHistory;
  today: string;
  stripRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [monthIdx, setMonthIdx] = useState(() => historyMonthRange(history, today).last);
  const cardRef = useRef<HTMLDivElement>(null);
  // True from the moment a swipe-up pull claims the gesture until it settles.
  // Guards the auto-enter effect below so a pulled mount doesn't also spring
  // open on its own (settlePull drives `shown` itself for that path).
  const pullingRef = useRef(false);

  const range = historyMonthRange(history, today);
  const cal = useMemo(() => buildCalMonth(monthIdx, history, today), [monthIdx, history, today]);

  useEffect(() => {
    if (!open || pullingRef.current) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const openSheet = useCallback(() => {
    pullingRef.current = false; // ordinary tap-to-open, not a pull
    setMonthIdx(historyMonthRange(history, today).last); // re-init to the latest month on each open
    setOpen(true);
  }, [history, today]);

  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(() => setOpen(false), EXIT_MS);
  }, []);

  // Mount the sheet mid-drag, in the `dragging` state (no enter transition — the
  // finger drives --sheet-y/--scrim-o directly). flushSync forces the commit to
  // land synchronously so cardRef.current is already the real node by the time
  // the caller (the swipe-up pointermove handler) reads it in the same tick.
  const openPulled = useCallback(() => {
    pullingRef.current = true;
    flushSync(() => {
      setMonthIdx(historyMonthRange(history, today).last);
      setDragging(true);
      setOpen(true);
    });
  }, [history, today]);

  // Settle a swipe-up pull on release: clear the JS-driven transform and either
  // spring to fully open, or play the normal exit + unmount (reusing close()).
  const settlePull = useCallback(
    (openIt: boolean) => {
      pullingRef.current = false;
      setDragging(false);
      const card = cardRef.current;
      card?.style.removeProperty("--sheet-y");
      (card?.parentElement as HTMLElement | null)?.style.removeProperty("--scrim-o");
      if (openIt) {
        setShown(true);
        cardRef.current?.focus();
      } else {
        close();
      }
    },
    [close]
  );

  useEffect(() => {
    if (!open) return;
    if (!pullingRef.current) cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Whole-sheet, scroll-aware drag-to-dismiss. Copied from day-detail-modal.tsx's
  // pattern (#24) — native non-passive listeners so we can preventDefault the
  // scroll when hijacking a top-of-list downward pull. Re-attaches whenever the
  // card mounts/unmounts (`open` toggles), since cardRef only has a node while open.
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

    const sheet = card.parentElement as HTMLElement;
    const setVars = (dy: number) => {
      card.style.setProperty("--sheet-y", `${dy}px`);
      sheet.style.setProperty("--scrim-o", `${scrimProgress(dy, card.offsetHeight)}`);
    };
    const clearVars = () => {
      card.style.removeProperty("--sheet-y");
      sheet.style.removeProperty("--scrim-o");
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
  }, [open, close]);

  // Swipe-up pull on the weekly strip. Arm on the strip's pointerdown, but track
  // move/settle on window — the strip is short, a fast flick leaves its bounds
  // before the first sampled move (observed, not theoretical). Claiming mounts
  // the sheet mid-gesture via openPulled() and drives --sheet-y/--scrim-o
  // finger-coupled until release, when settlePull() springs open or sinks back.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let y0 = 0,
      t0 = 0,
      armed = false,
      active = false;

    const down = (e: PointerEvent) => {
      y0 = e.clientY;
      t0 = e.timeStamp;
      armed = true;
      active = false;
    };

    const move = (e: PointerEvent) => {
      if (!armed) return;
      const dy = e.clientY - y0;
      if (!active) {
        if (dy < PULL_CLAIM_UP_PX) {
          active = true;
          openPulled(); // mount sheet in dragging state (flushSync — cardRef is live below)
        } else if (dy > PULL_ABANDON_DOWN_PX) {
          armed = false; // clearly a downward scroll
          return;
        } else {
          return;
        }
      }
      const card = cardRef.current;
      if (!card) return;
      const h = card.offsetHeight,
        pull = Math.min(-dy, h);
      card.style.setProperty("--sheet-y", `${h - pull}px`);
      (card.parentElement as HTMLElement).style.setProperty("--scrim-o", String(pull / h)); // match how the shell CSS reads it
    };

    const upOrCancel = (e: PointerEvent) => {
      if (!armed) return;
      armed = false;
      if (!active) return;
      active = false;
      const dy = y0 - e.clientY,
        h = cardRef.current?.offsetHeight ?? 1;
      const v = dy / Math.max(1, e.timeStamp - t0);
      settlePull(dy > h * PULL_OPEN_RATIO || v > PULL_OPEN_VELOCITY); // true -> open, false -> sink back
    };

    // iOS: pointermove preventDefault does NOT stop scrolling; this non-passive
    // touchmove is what actually blocks the page from scrolling once we claim.
    const touch = (e: TouchEvent) => {
      if (active) e.preventDefault();
    };

    strip.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", upOrCancel);
    window.addEventListener("pointercancel", upOrCancel);
    strip.addEventListener("touchmove", touch, { passive: false });
    return () => {
      strip.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", upOrCancel);
      window.removeEventListener("pointercancel", upOrCancel);
      strip.removeEventListener("touchmove", touch);
    };
  }, [stripRef, openPulled, settlePull]);

  return (
    <>
      <button className="adh-grab" onClick={openSheet} aria-label="Show adherence history">
        <span aria-hidden="true" />
      </button>
      {open && (
        <div className={`sheet cal-sheet${shown ? " open" : ""}${dragging ? " dragging" : ""}`}>
          <div className="sheet-scrim" onClick={close} />
          <div
            className="sheet-card"
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-label="Adherence history"
            tabIndex={-1}
          >
            <div className="sheet-grab" aria-hidden="true" />
            <div className="cal-head">
              <span className="cal-month">{cal.label}</span>
              <div className="cal-nav">
                <button
                  onClick={() => setMonthIdx((i) => i - 1)}
                  disabled={monthIdx <= range.first}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <button
                  onClick={() => setMonthIdx((i) => i + 1)}
                  disabled={monthIdx >= range.last}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="cal-sum">
              {cal.summary.judged
                ? `${cal.summary.on} of ${cal.summary.judged} judged days on plan, best streak ${cal.summary.bestStreak}`
                : "no judged days yet"}
            </div>
            <div className="cal-dows">
              {DOWS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: cal.leading }, (_, i) => (
                <div key={`b${i}`} className="cal-cell" />
              ))}
              {cal.cells.map((c) => (
                <div key={c.date} className={`cal-cell ${c.state}`}>
                  <span className="cal-chip">{c.day}</span>
                </div>
              ))}
            </div>
            <div className="cal-legend">
              <div className="leg-row">
                <span className="leg-sw" style={{ background: "var(--green-tx)" }} />
                on plan
              </div>
              <div className="leg-row">
                <span className="leg-sw" style={{ background: "var(--green-bg)" }} />
                with extras
              </div>
              <div className="leg-row">
                <span className="leg-sw" style={{ background: "rgba(159,47,45,.45)" }} />
                miss or not logged
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
