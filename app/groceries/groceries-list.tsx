"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GroceryView } from "@/lib/groceries";

type WeightUnit = "g" | "oz" | "lb";
const OZ = 28.3495;
const LB = 453.592;
const toG = (v: number, u: WeightUnit) => (u === "oz" ? v * OZ : u === "lb" ? v * LB : v);

type FormState = {
  id: number | null;
  name: string;
  brand: string;
  store: string;
  link: string;
  category: string;
  serving: string;
  servingUnit: WeightUnit;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  purchase: string;
  purchaseUnit: WeightUnit;
  price: string;
};

const EMPTY: FormState = {
  id: null, name: "", brand: "", store: "", link: "", category: "",
  serving: "", servingUnit: "g", kcal: "", proteinG: "", carbsG: "", fatG: "",
  purchase: "", purchaseUnit: "lb", price: "",
};

function toForm(g: GroceryView): FormState {
  return {
    id: g.id,
    name: g.name,
    brand: g.brand ?? "",
    store: g.store ?? "",
    link: g.link ?? "",
    category: g.category ?? "",
    serving: g.servingGrams != null ? String(g.servingGrams) : "",
    servingUnit: "g",
    kcal: String(g.kcal),
    proteinG: String(g.proteinG),
    carbsG: String(g.carbsG),
    fatG: String(g.fatG),
    purchase: g.purchaseWeightG != null ? String(g.purchaseWeightG) : "",
    purchaseUnit: "g",
    price: g.price != null ? String(g.price) : "",
  };
}

export function GroceriesList({ initial }: { initial: GroceryView[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    const serving = Number(form.serving);
    const kcal = Number(form.kcal);
    if (!form.name.trim() || !Number.isFinite(serving) || serving <= 0 || !Number.isFinite(kcal)) {
      setError("Name, a positive serving size, and calories are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      brand: form.brand || null,
      store: form.store || null,
      link: form.link || null,
      category: form.category || null,
      servingGrams: toG(serving, form.servingUnit),
      kcal,
      proteinG: Number(form.proteinG) || 0,
      carbsG: Number(form.carbsG) || 0,
      fatG: Number(form.fatG) || 0,
      purchaseWeightG: form.purchase ? toG(Number(form.purchase), form.purchaseUnit) : null,
      price: form.price ? Number(form.price) : null,
    };
    try {
      const res = await fetch(form.id ? `/api/groceries/${form.id}` : "/api/groceries", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setForm(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (deletingId !== null) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/groceries/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      {error && <div className="gr-error">{error}</div>}

      {form ? (
        <form className="gr-form" onSubmit={save}>
          <input aria-label="Name" placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <div className="gr-2">
            <input aria-label="Brand" placeholder="Brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            <input aria-label="Store" placeholder="Store" value={form.store} onChange={(e) => set("store", e.target.value)} />
          </div>
          <div className="gr-2">
            <input aria-label="Category" placeholder="Category (oil, protein…)" value={form.category} onChange={(e) => set("category", e.target.value)} />
            <input aria-label="Link" placeholder="Link" value={form.link} onChange={(e) => set("link", e.target.value)} />
          </div>
          <div className="gr-row">
            <input aria-label="Serving size" inputMode="decimal" placeholder="Serving size" value={form.serving} onChange={(e) => set("serving", e.target.value)} />
            <select aria-label="Serving size unit" value={form.servingUnit} onChange={(e) => set("servingUnit", e.target.value as WeightUnit)}>
              <option value="g">g</option>
              <option value="oz">oz</option>
            </select>
            <span className="gr-hint">per serving →</span>
          </div>
          <div className="gr-4">
            <input aria-label="Calories per serving" inputMode="decimal" placeholder="kcal" value={form.kcal} onChange={(e) => set("kcal", e.target.value)} />
            <input aria-label="Protein grams per serving" inputMode="decimal" placeholder="P" value={form.proteinG} onChange={(e) => set("proteinG", e.target.value)} />
            <input aria-label="Carb grams per serving" inputMode="decimal" placeholder="C" value={form.carbsG} onChange={(e) => set("carbsG", e.target.value)} />
            <input aria-label="Fat grams per serving" inputMode="decimal" placeholder="F" value={form.fatG} onChange={(e) => set("fatG", e.target.value)} />
          </div>
          <div className="gr-row">
            <input aria-label="Package weight" inputMode="decimal" placeholder="Package weight" value={form.purchase} onChange={(e) => set("purchase", e.target.value)} />
            <select aria-label="Package weight unit" value={form.purchaseUnit} onChange={(e) => set("purchaseUnit", e.target.value as WeightUnit)}>
              <option value="lb">lb</option>
              <option value="oz">oz</option>
              <option value="g">g</option>
            </select>
            <input aria-label="Price" inputMode="decimal" placeholder="$ price" value={form.price} onChange={(e) => set("price", e.target.value)} />
          </div>
          <div className="gr-actions">
            <button type="submit" className="btn-dark" disabled={saving}>{form.id ? "Save" : "Add"}</button>
            <button type="button" className="gr-cancel" onClick={() => { setForm(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-dark gr-add" onClick={() => setForm({ ...EMPTY })}>+ Add grocery</button>
      )}

      <ul className="gr-list">
        {initial.map((g) => {
          const costPerServing =
            g.price != null && g.purchaseWeightG != null && g.servingGrams
              ? (g.price / (g.purchaseWeightG / g.servingGrams)).toFixed(2)
              : null;
          return (
            <li key={g.id} className="gr-item">
              <div className="gr-main">
                <b>{g.name}</b>
                <small>
                  {[g.brand, g.store].filter(Boolean).join(" · ")}
                  {g.servingGrams != null ? ` · ${g.servingGrams}g serving` : " · no weight set"}
                </small>
                <small>
                  {g.kcal} kcal · {g.proteinG}P · {g.carbsG}C · {g.fatG}F
                  {costPerServing ? ` · ~$${costPerServing}/serving` : ""}
                </small>
              </div>
              <div className="gr-item-actions">
                <button type="button" onClick={() => { setError(null); setForm(toForm(g)); }}>Edit</button>
                <button type="button" disabled={deletingId === g.id} onClick={() => remove(g.id)}>
                  {deletingId === g.id ? "…" : "Delete"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
