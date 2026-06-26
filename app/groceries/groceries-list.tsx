"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GroceryGroupItem, GroceryGroups } from "@/lib/groceries";
import type { NutritionHit } from "@/lib/nutrition-lookup";
import type { LabelNutrition } from "@/lib/label-vision";
import { toGrams } from "@/lib/units";

// Shrink a chosen photo to ≤1024px JPEG so the vision request stays small (Vercel
// caps request bodies ~4.5MB; full-res phone photos blow past that as base64).
async function fileToScaledJpeg(file: File, max = 1024): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" };
}

type WeightUnit = "g" | "oz" | "lb";

// Fixed category list (drives the colored shelves + the form dropdown).
const CATEGORIES = ["protein", "carb", "fat", "dairy", "fruit", "veg", "other"] as const;
type Cat = (typeof CATEGORIES)[number];
const CAT_LABEL: Record<Cat, string> = {
  protein: "Protein", carb: "Carb", fat: "Fat & Oil", dairy: "Dairy",
  fruit: "Fruit", veg: "Veg", other: "Other",
};

// Map any stored/free-text category (incl. chat-written ones) to a fixed bucket.
function normCat(c: string | null): Cat {
  const k = (c ?? "").toLowerCase().trim();
  if (k === "protein") return "protein";
  if (k === "carb" || k === "carbs" || k === "grain" || k === "grains") return "carb";
  if (k === "fat" || k === "fats" || k === "oil") return "fat";
  if (k === "dairy") return "dairy";
  if (k === "fruit" || k === "fruits") return "fruit";
  if (k === "veg" || k === "veggie" || k === "vegetable" || k === "vegetables") return "veg";
  return "other";
}

function costPerServing(g: GroceryGroupItem): string | null {
  return g.price != null && g.purchaseWeightG != null && g.servingGrams
    ? (g.price / (g.purchaseWeightG / g.servingGrams)).toFixed(2)
    : null;
}

type FormState = {
  id: number | null;
  name: string;
  brand: string;
  store: string;
  link: string;
  imageUrl: string;
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
  id: null, name: "", brand: "", store: "", link: "", imageUrl: "", category: "",
  serving: "", servingUnit: "g", kcal: "", proteinG: "", carbsG: "", fatG: "",
  purchase: "", purchaseUnit: "lb", price: "",
};

function toForm(g: GroceryGroupItem): FormState {
  return {
    id: g.id,
    name: g.name,
    brand: g.brand ?? "",
    store: g.store ?? "",
    link: g.link ?? "",
    imageUrl: g.imageUrl ?? "",
    category: (CATEGORIES as readonly string[]).includes(g.category ?? "") ? g.category! : "",
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

export function GroceriesList({ groups }: { groups: GroceryGroups }) {
  const router = useRouter();
  const [mode, setMode] = useState<"meal" | "cat">("meal");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [hits, setHits] = useState<NutritionHit[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [visioning, setVisioning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
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
      imageUrl: form.imageUrl || null,
      category: form.category || null,
      servingGrams: toGrams(serving, form.servingUnit),
      kcal,
      proteinG: Number(form.proteinG) || 0,
      carbsG: Number(form.carbsG) || 0,
      fatG: Number(form.fatG) || 0,
      purchaseWeightG: form.purchase.trim() === "" ? null : toGrams(Number(form.purchase), form.purchaseUnit),
      price: form.price.trim() === "" ? null : Number(form.price),
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

  async function lookup() {
    const q = lookupQuery.trim();
    if (!q || looking) return;
    setLooking(true);
    setLookupMsg(null);
    setHits(null);
    try {
      const res = await fetch(`/api/nutrition?q=${encodeURIComponent(q)}`);
      const data: NutritionHit[] = res.ok ? await res.json() : [];
      setHits(data);
      if (data.length === 0) setLookupMsg("No nutrition data found — enter it manually below.");
    } catch {
      setLookupMsg("Lookup failed — enter it manually below.");
    } finally {
      setLooking(false);
    }
  }

  // Prefill macros from a hit (per 100g); keep any name/brand the user already typed.
  function applyHit(h: NutritionHit) {
    setForm((f) =>
      f
        ? {
            ...f,
            name: f.name.trim() ? f.name : h.name,
            brand: f.brand.trim() ? f.brand : h.brand ?? "",
            serving: String(h.servingGrams),
            servingUnit: "g",
            kcal: String(h.kcal),
            proteinG: String(h.proteinG),
            carbsG: String(h.carbsG),
            fatG: String(h.fatG),
          }
        : f,
    );
    setHits(null);
    setLookupQuery("");
    setLookupMsg(null);
  }

  function applyLabel(l: LabelNutrition) {
    setForm((f) =>
      f
        ? {
            ...f,
            name: f.name.trim() ? f.name : l.name ?? "",
            serving: String(l.servingGrams),
            servingUnit: "g",
            kcal: String(l.kcal),
            proteinG: String(l.proteinG),
            carbsG: String(l.carbsG),
            fatG: String(l.fatG),
          }
        : f,
    );
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const { base64, mediaType } = await fileToScaledJpeg(file, 800);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Photo upload failed");
        return;
      }
      const { url } = await res.json();
      setForm((f) => (f ? { ...f, imageUrl: url } : f));
    } catch {
      setError("Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function readLabel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || visioning) return;
    setVisioning(true);
    setLookupMsg(null);
    setHits(null);
    try {
      const { base64, mediaType } = await fileToScaledJpeg(file);
      const res = await fetch("/api/nutrition/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      if (!res.ok) {
        setLookupMsg((await res.json().catch(() => ({}))).error ?? "Couldn't read the label.");
        return;
      }
      applyLabel(await res.json());
      setLookupMsg("Filled from the label photo — check the values and save.");
    } catch {
      setLookupMsg("Couldn't read the photo.");
    } finally {
      setVisioning(false);
    }
  }

  // Plain render helpers (not <Card/> components) so they don't remount — and
  // flicker the product <img> — on every parent re-render (toggle/delete).
  const renderCard = (g: GroceryGroupItem, key: string) => {
    const cat = normCat(g.category);
    const cost = costPerServing(g);
    const meta = [g.brand, g.store, g.servingGrams != null ? `${g.servingGrams}g` : "no weight"].filter(Boolean);
    // Only macros present (>0) get a bar segment AND a number; both use flex = grams
    // so each number sits under its own segment and tracks its width.
    const segs = ([["mp", "P", g.proteinG], ["mc", "C", g.carbsG], ["mf", "F", g.fatG]] as const).filter(([, , v]) => v > 0);
    return (
      <li className="gcard" key={key}>
        <div className={`gcard-photo${g.imageUrl ? "" : ` gcat-${cat}`}`}>
          {g.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.imageUrl} alt="" />
          ) : (
            <span>{g.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="gcard-body">
          <div className="gcard-nm">{g.name}</div>
          <div className="gcard-src">
            {meta.map((m, i) => <span key={i}>{m}</span>)}
          </div>
          <div className="gcard-kc">{g.kcal}<span>kcal</span></div>
          <div className="gcard-bar">
            {segs.length ? (
              segs.map(([cls, , v]) => <i key={cls} className={cls} style={{ flex: v }} />)
            ) : (
              <i className="empty" style={{ flex: 1 }} />
            )}
          </div>
          <div className="gcard-macnums">
            {segs.map(([cls, letter, v]) => (
              <span key={cls} className={cls} style={{ flex: v }}>{v}{letter}</span>
            ))}
          </div>
          <div className="gcard-foot">
            <span className="gcard-cost">{cost ? `$${cost}/srv` : ""}</span>
            <span className="gcard-actions">
              <button onClick={() => { setError(null); setForm(toForm(g)); }}>Edit</button>
              <button disabled={deletingId === g.id} onClick={() => remove(g.id)}>
                {deletingId === g.id ? "…" : "Delete"}
              </button>
            </span>
          </div>
        </div>
      </li>
    );
  };

  const renderShelf = (key: string, title: string, metaParts: string[], items: GroceryGroupItem[], catClass?: string) => {
    if (items.length === 0) return null;
    return (
      <div className={`gr-shelf${catClass ? ` cat ${catClass}` : ""}`} key={key}>
        <div className="gr-shelf-head">
          <span className="nm">{title}</span>
          <span className="meta">{metaParts.map((p, i) => <span key={i}>{p}</span>)}</span>
        </div>
        <ul className="gcard-grid">
          {items.map((g) => renderCard(g, `${key}-${g.id}`))}
        </ul>
      </div>
    );
  };

  const { groceries, meals } = groups;

  const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

  const mealShelves = (
    <>
      {meals.map((m) => {
        const items = groceries.filter((g) => g.mealIds.includes(m.id));
        return renderShelf(`meal-${m.id}`, m.name, [plural(items.length), `${m.plannedKcal} kcal`], items);
      })}
      {renderShelf("pantry", "Pantry", ["not in today's rotation"], groceries.filter((g) => g.mealIds.length === 0))}
    </>
  );

  const catShelves = (
    <>
      {CATEGORIES.map((c) => {
        const items = groceries.filter((g) => normCat(g.category) === c);
        return renderShelf(`cat-${c}`, CAT_LABEL[c], [plural(items.length)], items, c);
      })}
    </>
  );

  return (
    <div className="gr">
      {error && <div className="gr-error">{error}</div>}

      {!form && (
        <div className="gr-toggle">
          <button className={mode === "meal" ? "on" : ""} onClick={() => setMode("meal")}>Today&apos;s meals</button>
          <button className={mode === "cat" ? "on" : ""} onClick={() => setMode("cat")}>By category</button>
        </div>
      )}

      {form ? (
        <form className="gr-form" onSubmit={save}>
          <div className="gr-lookup">
            <div className="gr-lookup-row">
              <input
                aria-label="Look up nutrition"
                placeholder="Look up nutrition — name or barcode"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }}
              />
              <button type="button" className="btn-dark" onClick={lookup} disabled={looking}>
                {looking ? "…" : "Find"}
              </button>
            </div>
            <label className="gr-photo-btn">
              {visioning ? "Reading label…" : "📷 Read nutrition label photo"}
              <input type="file" accept="image/*" capture="environment" onChange={readLabel} disabled={visioning} hidden />
            </label>
            {lookupMsg && <div className="gr-lookup-msg">{lookupMsg}</div>}
            {hits && hits.length > 0 && (
              <ul className="gr-hits">
                {hits.map((h) => (
                  <li key={`${h.source}-${h.code}`}>
                    <button type="button" onClick={() => applyHit(h)}>
                      <span className="hn">
                        <span className={`src-tag ${h.source === "USDA" ? "usda" : "off"}`}>{h.source === "USDA" ? "USDA" : "OFF"}</span>
                        {h.name}
                      </span>
                      <span className="hm">
                        {[h.brand, `${h.kcal} kcal / ${h.servingGrams}g`, `${h.proteinG}P ${h.carbsG}C ${h.fatG}F`].filter(Boolean).join("   ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input aria-label="Name" placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <div className="gr-2">
            <input aria-label="Brand" placeholder="Brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            <input aria-label="Store" placeholder="Store" value={form.store} onChange={(e) => set("store", e.target.value)} />
          </div>
          <div className="gr-2">
            <select aria-label="Category" value={form.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Category…</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
            <input aria-label="Product link" placeholder="Product link" value={form.link} onChange={(e) => set("link", e.target.value)} />
          </div>
          <div className="gr-photo-field">
            {form.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="gr-photo-preview" src={form.imageUrl} alt="" />
            )}
            <div className="gr-photo-controls">
              <label className="gr-photo-btn small">
                {uploading ? "Uploading…" : "📷 Add product photo"}
                <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} disabled={uploading} hidden />
              </label>
              <input aria-label="Image URL" placeholder="…or paste an image URL" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
            </div>
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
            <button type="submit" className="btn-dark" disabled={saving}>{saving ? "Saving…" : form.id ? "Save" : "Add"}</button>
            <button type="button" className="gr-cancel" onClick={() => { setForm(null); setError(null); setHits(null); setLookupQuery(""); setLookupMsg(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="gr-add" onClick={() => setForm({ ...EMPTY })}>+ Add grocery</button>
      )}

      {!form && (mode === "meal" ? mealShelves : catShelves)}
    </div>
  );
}
