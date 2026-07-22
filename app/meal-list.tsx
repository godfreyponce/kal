"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TodayMeal } from "@/lib/today";
import type { MealStatusValue } from "@/lib/meal-status";
import { MealPopup } from "./meal-popup";

const n = (x: number) => Math.round(x).toLocaleString("en-US");

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function MealList({ meals, date }: { meals: TodayMeal[]; date: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic overrides applied on top of server-provided status, keyed by meal id.
  const [optimistic, setOptimistic] = useState<Record<number, MealStatusValue>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const statusOf = (m: TodayMeal): MealStatusValue => optimistic[m.id] ?? m.status;

  async function toggle(m: TodayMeal) {
    if (busy !== null) return;
    const next: MealStatusValue = statusOf(m) === "eaten" ? "pending" : "eaten";
    setOptimistic((o) => ({ ...o, [m.id]: next }));
    setBusy(m.id);
    try {
      const res = await fetch(`/api/meals/${m.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, date }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Re-read server truth (ring + macros + counts). Keep the optimistic value
      // — it matches the server now, so dropping it here would flash the checkbox
      // back until the refresh lands.
      startTransition(() => router.refresh());
    } catch {
      setOptimistic((o) => {
        const { [m.id]: _, ...rest } = o;
        return rest;
      });
    } finally {
      setBusy(null);
    }
  }

  const openMeal = openId === null ? null : (meals.find((m) => m.id === openId) ?? null);

  return (
    <>
      <div className="meals-band anim" style={{ animationDelay: "0.15s" }}>Meals</div>
      <ul className="checklist">
        {meals.map((m, i) => {
          const status = statusOf(m);
          const eaten = status === "eaten";
          const now = !eaten && m.isNow;
          return (
            <li key={m.id} className="anim" style={{ animationDelay: `${0.18 + i * 0.03}s` }}>
              <button
                type="button"
                className={`box${eaten ? " done" : now ? " now" : ""}`}
                aria-pressed={eaten}
                aria-label={`${eaten ? "Unmark" : "Mark"} ${m.name} eaten`}
                disabled={busy !== null || isPending}
                onClick={() => toggle(m)}
              >
                {eaten && <Check />}
              </button>
              <button
                type="button"
                className="rowbtn"
                aria-haspopup="dialog"
                aria-label={`${m.name} details${m.adjusted ? ", adjusted today" : ""}`}
                onClick={() => setOpenId(m.id)}
              >
                <span className="ct">
                  <span className={`n${eaten ? " done" : ""}`}>{m.name}</span>
                  {!eaten && m.timeHint && <small>{m.timeHint}</small>}
                </span>
                <span className={`ck${eaten ? " faded" : ""}`}>
                  {m.adjusted && <span className="adjmark" aria-hidden="true">⇄</span>}
                  {n(m.plannedKcal)} cal
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {openMeal && (
        <MealPopup
          key={openMeal.id}
          meal={openMeal}
          status={statusOf(openMeal)}
          busy={busy !== null || isPending}
          onToggle={() => toggle(openMeal)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
