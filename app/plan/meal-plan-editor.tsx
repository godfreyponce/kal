// app/plan/meal-plan-editor.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GroceryView } from "@/lib/groceries";
import type { PlanView, RetargetResult } from "@/lib/plan";

export type EditItem = { foodId: number; quantity: number; foodName: string; servingDesc: string; servingGrams: number | null; unitKcal: number };

export function MealPlanEditor({
  plan,
  groceries,
  overridesByMeal,
}: {
  plan: PlanView;
  groceries: GroceryView[];
  overridesByMeal: { mealId: number; items: EditItem[] }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [choosingId, setChoosingId] = useState<number | null>(null);
  const [editSource, setEditSource] = useState<"override" | "template" | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [baselineMealKcal, setBaselineMealKcal] = useState(0);
  const [scope, setScope] = useState<"today" | "template">("today");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<RetargetResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [addingMeal, setAddingMeal] = useState(false);
  const [newMeal, setNewMeal] = useState({ name: "", timeHint: "" });
  const overrideItems = new Map(overridesByMeal.map((o) => [o.mealId, o.items]));
  const adjusted = new Set(overrideItems.keys());
  const pendingMealKcal = items.reduce((sum, it) => sum + it.quantity * it.unitKcal, 0);
  const totalsDirty = editingId !== null && editSource !== "override" && pendingMealKcal !== baselineMealKcal;
  const stripKcal =
    editingId !== null && editSource !== "override"
      ? Math.round(plan.totals.kcal - baselineMealKcal + pendingMealKcal)
      : plan.totals.kcal;

  function beginEdit(mealId: number, source: "override" | "template" | null = null) {
    const meal = plan.meals.find((m) => m.id === mealId)!;
    const seed: EditItem[] =
      source === "override"
        ? overrideItems.get(mealId)!.map((i) => ({ ...i }))
        : meal.items.map((i) => ({
            foodId: i.foodId,
            quantity: i.quantity,
            foodName: i.foodName,
            servingDesc: i.servingDesc,
            servingGrams: i.servingGrams,
            unitKcal: i.unitKcal,
          }));
    setItems(seed);
    setBaselineMealKcal(seed.reduce((sum, i) => sum + i.quantity * i.unitKcal, 0));
    setScope(source === "template" ? "template" : "today");
    setEditSource(source);
    setChoosingId(null);
    setError(null);
    setBanner(null);
    setArmedDelete(false);
    setEditingId(mealId);
  }

  const step = (it: EditItem) => (it.servingGrams === null ? 1 : 0.1);
  const round3 = (x: number) => Math.round(x * 1000) / 1000;

  function bump(idx: number, dir: 1 | -1) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(0, round3(it.quantity + dir * step(it))) } : it)));
  }
  function setQty(idx: number, raw: string) {
    const q = Number(raw);
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: Number.isFinite(q) ? q : it.quantity } : it)));
  }
  function addFood(foodId: number) {
    const f = groceries.find((g) => g.id === foodId);
    if (!f) return;
    setItems((prev) => (prev.some((it) => it.foodId === foodId) ? prev : [...prev, { foodId: f.id, quantity: 1, foodName: f.name, servingDesc: f.servingDesc, servingGrams: f.servingGrams, unitKcal: f.kcal }]));
  }

  async function save() {
    if (editingId === null) return;
    const mealId = editingId;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meals/${mealId}/items`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, items: items.filter((i) => i.quantity > 0).map((i) => ({ foodId: i.foodId, quantity: i.quantity })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "save failed");
        return;
      }
      if (body.scope === "template") setBanner(body.targets);
      setEditingId((cur) => (cur === mealId ? null : cur));
      startTransition(() => router.refresh());
    } catch {
      setError("network error, try again");
    } finally {
      setSaving(false);
    }
  }

  async function removeMeal() {
    if (editingId === null) return;
    if (!armedDelete) {
      setArmedDelete(true);
      return;
    }
    const mealId = editingId;
    try {
      const res = await fetch(`/api/meals/${mealId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "delete failed");
        return;
      }
      setBanner(body.targets);
      setEditingId((cur) => (cur === mealId ? null : cur));
      startTransition(() => router.refresh());
    } catch {
      setError("network error, try again");
    }
  }

  async function addMeal() {
    if (!newMeal.name.trim()) return;
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newMeal.name, timeHint: newMeal.timeHint || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "add failed");
        return;
      }
      setAddingMeal(false);
      setNewMeal({ name: "", timeHint: "" });
      startTransition(() => router.refresh());
    } catch {
      setError("network error, try again");
    }
  }

  return (
    <div>
      {error && <div className="gr-error">{error}</div>}
      <div className="plan-totals">
        <span>PLAN <b>{stripKcal}</b> KCAL</span>
        <span className={totalsDirty ? "plan-macros plan-totals-dim" : "plan-macros"}>
          <b className="mac-p">P {plan.totals.proteinG}</b>&ensp;
          <b className="mac-c">C {plan.totals.carbsG}</b>&ensp;
          <b className="mac-f">F {plan.totals.fatG}</b>
        </span>
      </div>

      {banner && (
        <div className="plan-recalc">
          <div className="plan-recalc-k">Targets recalculated</div>
          <div className="plan-recalc-v">{banner.old.kcal} → <b>{banner.next.kcal}</b> kcal</div>
          <div className="plan-recalc-why">targets always derive from the plan</div>
        </div>
      )}

      {plan.meals.map((meal) => {
        const editing = editingId === meal.id;
        return (
          <div className="plan-meal" key={meal.id}>
            <div className="plan-meal-head">
              <span>
                <span className="plan-meal-nm">{meal.name}</span>
                {meal.timeHint && <span className="plan-meal-hint">{meal.timeHint}</span>}
                {adjusted.has(meal.id) && <span className="plan-adjusted" aria-label="adjusted today">⇄</span>}
              </span>
              <span className="plan-meal-end">
                <span className="plan-meal-kc">
                  {editing
                    ? editSource === "override"
                      ? Math.round(pendingMealKcal)
                      : Math.round(meal.kcal - baselineMealKcal + pendingMealKcal)
                    : meal.kcal} kcal
                </span>
                {!editing && (
                  <button
                    className="plan-edit-btn"
                    onClick={() => {
                      if (adjusted.has(meal.id)) {
                        setEditingId(null);
                        setChoosingId(meal.id);
                      } else {
                        beginEdit(meal.id);
                      }
                    }}
                  >Edit</button>
                )}
              </span>
            </div>

            {choosingId === meal.id && (
              <div className="plan-choose">
                <button onClick={() => beginEdit(meal.id, "override")}>
                  <span className="plan-choose-big">Edit today&apos;s ⇄ version</span>
                  <span className="plan-choose-sub">
                    {overrideItems.get(meal.id)!.map((i) => i.foodName.toLowerCase()).join(", ")}, saves just for today
                  </span>
                </button>
                <button onClick={() => beginEdit(meal.id, "template")}>
                  <span className="plan-choose-big">Edit the everyday meal</span>
                  <span className="plan-choose-sub">
                    {meal.items.map((i) => i.foodName.toLowerCase()).join(", ")}, changes the template
                  </span>
                </button>
                <button className="plan-choose-cancel" onClick={() => setChoosingId(null)}>cancel</button>
              </div>
            )}

            {!editing && choosingId !== meal.id &&
              meal.items.map((i) => (
                <div className="plan-food" key={i.id}>
                  <span className="plan-thumb">
                    {i.imageUrl ? <img src={i.imageUrl} alt="" /> : i.foodName[0]}
                  </span>
                  <span className="plan-food-mid">
                    <span className="plan-food-nm">{i.foodName}</span>
                    <span className="plan-food-meta">{i.unitKcal} kcal per {i.servingDesc}</span>
                  </span>
                  <span className="plan-food-amt">
                    {i.amountLabel}
                    <span className="plan-food-kc">{i.kcal} kcal</span>
                  </span>
                </div>
              ))}

            {editing && (
              <div className="plan-edit">
                {items.map((it, idx) => (
                  <div className="plan-edit-row" key={it.foodId}>
                    <span className="plan-food-mid">
                      <span className="plan-food-nm">{it.foodName}</span>
                      <span className="plan-food-meta">{it.unitKcal} kcal per {it.servingDesc}</span>
                    </span>
                    <span className="plan-stepper">
                      <button onClick={() => bump(idx, -1)}>−</button>
                      <input inputMode="decimal" value={String(it.quantity)} onChange={(e) => setQty(idx, e.target.value)} />
                      <button onClick={() => bump(idx, 1)}>+</button>
                    </span>
                    <button className="plan-x" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</button>
                  </div>
                ))}

                <select
                  className="plan-add-select"
                  value=""
                  onChange={(e) => addFood(Number(e.target.value))}
                >
                  <option value="" disabled>+ add item from groceries</option>
                  {groceries
                    .filter((g) => !items.some((it) => it.foodId === g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.servingDesc})</option>
                    ))}
                </select>
                <button className="plan-ask-chat" onClick={() => router.push("/chat")}>
                  not in groceries? ask kal in chat →
                </button>

                {editSource === null ? (
                  <>
                    <div className="plan-scope">
                      <span className="plan-lbl" style={{ marginBottom: 0 }}>Apply</span>
                      <div className="plan-scope-seg">
                        <button className={scope === "today" ? "on" : ""} onClick={() => setScope("today")}>Just today</button>
                        <button className={scope === "template" ? "on" : ""} onClick={() => setScope("template")}>Every day</button>
                      </div>
                    </div>
                    <div className="plan-scope-hint">
                      {scope === "today"
                        ? "just today = a ⇄ override, template untouched, back to normal tomorrow"
                        : "every day changes the template, targets re-derive from the new plan"}
                    </div>
                  </>
                ) : (
                  <div className="plan-scope-hint">
                    {editSource === "override"
                      ? "editing today's ⇄ version, saves just for today, back to normal tomorrow"
                      : "editing the everyday meal, targets re-derive from the new plan"}
                  </div>
                )}

                <div className="plan-actions">
                  <button className="btn-dark" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : scope === "today" ? "Save for today" : "Save meal"}
                  </button>
                  <button className="plan-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
                {editSource !== "override" && (
                  <button className="plan-remove" onClick={removeMeal}>
                    {armedDelete ? "really remove this meal from every day?" : "remove meal"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!addingMeal && (
        <button className="plan-add-meal" onClick={() => setAddingMeal(true)}>+ add meal</button>
      )}
      {addingMeal && (
        <div className="plan-new-meal">
          <input className="plan-inp" placeholder="Meal name" value={newMeal.name} onChange={(e) => setNewMeal({ ...newMeal, name: e.target.value })} />
          <input className="plan-inp" placeholder="Time hint (optional)" value={newMeal.timeHint} onChange={(e) => setNewMeal({ ...newMeal, timeHint: e.target.value })} />
          <div className="plan-actions">
            <button className="btn-dark" onClick={addMeal}>Add meal</button>
            <button className="plan-cancel" onClick={() => setAddingMeal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
