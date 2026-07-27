"use client";

// The per-day popup for the adherence calendar sheet (issue #30). The body is shared;
// the shell is the owner-picked variant from design/plan-cal-day-variants.html (pick 2,
// the centred mini card).
import { useEffect, useState } from "react";
import { calDayVerdict } from "@/lib/adherence-calendar";
import type { CalCell } from "@/lib/adherence-calendar";
import { monthDayLabel, kcalWithinBand, proteinMet } from "@/lib/adherence-view";
import type { Macros } from "@/lib/adherence-view";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const EXIT_MS = 180; // must match the .dp-card exit transition (see globals.css)

export function DayFacts({
  cell,
  consumed,
  targets,
}: {
  cell: CalCell;
  consumed: Macros | null;
  targets: Macros;
}) {
  const verdict = calDayVerdict(cell.state, consumed, targets);
  return (
    <>
      <div className="dp-date">
        {monthDayLabel(cell.date)}
        {cell.state === "today" ? ", today" : ""}
      </div>
      {consumed ? (
        <div className="dp-rows">
          kcal <i className={kcalWithinBand(consumed, targets) ? "" : "bad"}>{num(consumed.kcal)}</i>{" "}
          of {num(targets.kcal)}
          <br />
          protein <i className={proteinMet(consumed, targets) ? "" : "bad"}>{num(consumed.proteinG)}</i>{" "}
          of {num(targets.proteinG)} g
        </div>
      ) : (
        <div className="dp-rows">nothing logged</div>
      )}
      {verdict && <div className={`dp-verdict ${verdict.kind}`}>{verdict.text}</div>}
    </>
  );
}

export function CalDayPopup({
  cell,
  consumed,
  targets,
  onClose,
}: {
  cell: CalCell;
  consumed: Macros | null;
  targets: Macros;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Drop .open first so the exit transition plays, then unmount. The sheet's own
  // Escape handler stands down while this popup is mounted, so Escape lands here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShown(false);
      window.setTimeout(onClose, EXIT_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const close = () => {
    setShown(false);
    window.setTimeout(onClose, EXIT_MS);
  };

  return (
    <div className={`dp-wrap${shown ? " open" : ""}`}>
      <div className="dp-scrim" onClick={close} />
      <div
        className="dp-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${monthDayLabel(cell.date)} detail`}
      >
        <DayFacts cell={cell} consumed={consumed} targets={targets} />
      </div>
    </div>
  );
}
