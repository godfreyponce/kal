"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GroceryGroupItem } from "@/lib/groceries";
import type { NutritionHit } from "@/lib/nutrition-lookup";
import type { LabelNutrition } from "@/lib/label-vision";
import { buildGroceryPatch, EMPTY, toForm, type FormState, type WeightUnit } from "@/lib/grocery-form";
import { fileToScaledJpeg } from "@/app/image-scale";

const CATEGORIES = ["protein", "carb", "fat", "dairy", "fruit", "veg", "other"] as const;
const CAT_LABEL: Record<string, string> = {
  protein: "Protein", carb: "Carb", fat: "Fat and oil", dairy: "Dairy",
  fruit: "Fruit", veg: "Veg", other: "Other",
};

const EXIT_MS = 240; // must match the .sheet-card exit transition in globals.css

// Which FormState key the pad is editing, and how to render it.
type PadTarget = {
  key: keyof FormState;
  label: string;
  kind: "text" | "number" | "select";
  unitKey?: "servingUnit" | "myServingUnit" | "purchaseUnit";
  units?: readonly WeightUnit[];
  fixedUnit?: string; // count foods: show the basis, offer no toggle
};

export function GroceryEditor({
  item,
  onDone,
}: {
  item: GroceryGroupItem | "new";
  onDone: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const original = useRef<FormState>(item === "new" ? { ...EMPTY } : toForm(item));
  const [form, setForm] = useState<FormState>(original.current);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pad, setPad] = useState<PadTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [draftUnit, setDraftUnit] = useState<WeightUnit>("g");
  const [padOpen, setPadOpen] = useState(false);

  const [more, setMore] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [hits, setHits] = useState<NutritionHit[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [visioning, setVisioning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [tools, setTools] = useState<"none" | "lookup" | "photo">("none");

  const dirty = JSON.stringify(form) !== JSON.stringify(original.current);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ---- pad lifecycle: mount closed, add .open next frame, unmount after the sink ----
  function openPad(t: PadTarget) {
    setPad(t);
    setDraft(String(form[t.key] ?? ""));
    if (t.unitKey) setDraftUnit(form[t.unitKey]);
  }

  useEffect(() => {
    if (!pad) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPadOpen(true)));
    return () => cancelAnimationFrame(raf);
  }, [pad]);

  const closePad = useCallback(() => {
    setPadOpen(false);
    window.setTimeout(() => setPad(null), EXIT_MS);
  }, []);

  useEffect(() => {
    if (!pad) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePad(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pad, closePad]);

  function commitPad() {
    if (!pad) return;
    setForm((f) => {
      const next: FormState = { ...f, [pad.key]: draft };
      if (pad.unitKey) next[pad.unitKey] = draftUnit;
      return next;
    });
    closePad();
  }

  // ---- save / delete ----
  async function save() {
    if (saving) return;
    const built = buildGroceryPatch(form);
    if (!built.ok) { setError(built.error); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(form.id ? `/api/groceries/${form.id}` : "/api/groceries", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      startTransition(() => router.refresh());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (form.id === null || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/groceries/${form.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
        return;
      }
      startTransition(() => router.refresh());
      onDone();
    } finally {
      setDeleting(false);
    }
  }

  // ---- lookup / vision / upload (the add flow's first stop, and a More tool when editing) ----
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
      if (data.length === 0) setLookupMsg("No nutrition data found, enter it manually below.");
    } catch {
      setLookupMsg("Lookup failed, enter it manually below.");
    } finally {
      setLooking(false);
    }
  }

  // Prefill macros from a hit (per 100g); keep any name/brand the user already typed.
  function applyHit(h: NutritionHit) {
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : h.name,
      brand: f.brand.trim() ? f.brand : h.brand ?? "",
      serving: String(h.servingGrams),
      servingUnit: "g",
      kcal: String(h.kcal),
      proteinG: String(h.proteinG),
      carbsG: String(h.carbsG),
      fatG: String(h.fatG),
    }));
    setHits(null);
    setLookupQuery("");
    setLookupMsg(null);
  }

  function applyLabel(l: LabelNutrition) {
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : l.name ?? "",
      serving: String(l.servingGrams),
      servingUnit: "g",
      kcal: String(l.kcal),
      proteinG: String(l.proteinG),
      carbsG: String(l.carbsG),
      fatG: String(l.fatG),
    }));
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
      setForm((f) => ({ ...f, imageUrl: url }));
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
      setLookupMsg("Filled from the label photo, check the values and save.");
    } catch {
      setLookupMsg("Couldn't read the photo.");
    } finally {
      setVisioning(false);
    }
  }

  // ---- the label card ----
  const isCount = form.basisUnit !== null;
  const subtitle = [form.brand, form.store].filter(Boolean).join(", ") || "Add a brand";
  const catKey = (CATEGORIES as readonly string[]).includes(form.category) ? form.category : "other";

  // Held as JSX consts, not local components: a function component declared in
  // this body gets a new identity every render, so React would remount the block
  // on each keystroke and the lookup box would lose focus.
  const lookupBlock = (
    <div className="gr-lookup">
      <div className="gr-lookup-row">
        <input
          aria-label="Look up nutrition"
          placeholder="Look up nutrition by name or barcode"
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
  );

  const moreBlock = (
    <>
      <button type="button" className="gre-more-btn" onClick={() => setMore((m) => !m)}>
        {more ? "Less" : "＋ More"}
      </button>

      {more && (
        <div>
          <div className="gre-lines">
            {!isCount && (
              <button
                type="button"
                className="gre-line"
                onClick={() => openPad({ key: "serving", label: "Serving size", kind: "number", unitKey: "servingUnit", units: ["g", "oz"] })}
              >
                <span className="l">Serving size</span>
                <span className="v">{form.serving || "not set"}<small>{form.servingUnit}</small></span>
              </button>
            )}
            <button
              type="button"
              className="gre-line"
              onClick={() => openPad({ key: "category", label: "Category", kind: "select" })}
            >
              <span className="l">Category</span>
              <span className={`v${form.category ? "" : " empty"}`}>
                {form.category ? CAT_LABEL[form.category] : "not set"}
              </span>
            </button>
            <button
              type="button"
              className="gre-line"
              onClick={() => openPad({ key: "store", label: "Store", kind: "text" })}
            >
              <span className="l">Store</span>
              <span className={`v${form.store ? "" : " empty"}`}>{form.store || "not set"}</span>
            </button>
            <button
              type="button"
              className="gre-line"
              onClick={() => openPad({ key: "purchase", label: "Package weight", kind: "number", unitKey: "purchaseUnit", units: ["lb", "oz", "g"] })}
            >
              <span className="l">Package</span>
              <span className={`v${form.purchase ? "" : " empty"}`}>
                {form.purchase || "not set"}
                {form.purchase && <small>{form.purchaseUnit}</small>}
              </span>
            </button>
            <button
              type="button"
              className="gre-line"
              onClick={() => openPad({ key: "price", label: "Price", kind: "number" })}
            >
              <span className="l">Price</span>
              <span className={`v${form.price ? "" : " empty"}`}>{form.price ? `$${form.price}` : "not set"}</span>
            </button>
            <button
              type="button"
              className="gre-line"
              onClick={() => openPad({ key: "link", label: "Product link", kind: "text" })}
            >
              <span className="l">Product link</span>
              <span className={`v${form.link ? "" : " empty"}`}>{form.link ? "set" : "not set"}</span>
            </button>
          </div>

          <div className="gre-tools">
            <button type="button" className="gre-tool" onClick={() => setTools((t) => (t === "photo" ? "none" : "photo"))}>
              {form.imageUrl ? "Change the product photo" : "Add a product photo"}
            </button>
            {tools === "photo" && (
              <div className="gr-photo-field">
                {form.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="gr-photo-preview" src={form.imageUrl} alt="" />
                )}
                <div className="gr-photo-controls">
                  <label className="gr-photo-btn small">
                    {uploading ? "Uploading…" : "📷 Take or choose a photo"}
                    <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} disabled={uploading} hidden />
                  </label>
                  <input
                    aria-label="Image URL"
                    placeholder="…or paste an image URL"
                    value={form.imageUrl}
                    onChange={(e) => set("imageUrl", e.target.value)}
                  />
                </div>
              </div>
            )}
            <button type="button" className="gre-tool" onClick={() => setTools((t) => (t === "lookup" ? "none" : "lookup"))}>
              Look up nutrition, or read a label photo
            </button>
            {tools === "lookup" && lookupBlock}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="gre">
      {error && <div className="gr-error">{error}</div>}

      <button type="button" className="gre-back" onClick={onDone}>&larr; Groceries</button>

      <div className="gre-hero">
        {form.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="gre-shot" src={form.imageUrl} alt="" />
        ) : (
          <span className={`gro-fall gro-t-${catKey}`}>{(form.name || "?").charAt(0).toUpperCase()}</span>
        )}
        <button
          type="button"
          className={`gre-name${pad?.key === "name" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "name", label: "Name", kind: "text" })}
        >
          {form.name || "Name"}
        </button>
        <button
          type="button"
          className={`gre-sub${pad?.key === "brand" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "brand", label: "Brand", kind: "text" })}
        >
          {subtitle}
        </button>
      </div>

      <div className="gre-figs">
        <button
          type="button"
          className={`gre-fig${pad?.key === "myServing" ? " gre-editing" : ""}`}
          onClick={() =>
            openPad(
              isCount
                ? { key: "myServing", label: "My serving", kind: "number", fixedUnit: form.basisUnit! }
                : { key: "myServing", label: "My serving", kind: "number", unitKey: "myServingUnit", units: ["g", "oz"] },
            )
          }
        >
          <span className="v">
            {form.myServing || "not set"}
            <small>{isCount ? form.basisUnit : form.myServingUnit}</small>
          </span>
          <span className="l">My serving</span>
        </button>
        <button
          type="button"
          className={`gre-fig${pad?.key === "kcal" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "kcal", label: "Calories", kind: "number" })}
        >
          <span className="v">{form.kcal || "0"}<small>cal</small></span>
          <span className="l">Calories</span>
        </button>
      </div>

      <div className="gre-macros">
        <button
          type="button"
          className={`gre-pill pro${pad?.key === "proteinG" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "proteinG", label: "Protein, grams", kind: "number" })}
        >
          {form.proteinG || 0} P
        </button>
        <button
          type="button"
          className={`gre-pill${pad?.key === "carbsG" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "carbsG", label: "Carbs, grams", kind: "number" })}
        >
          {form.carbsG || 0} C
        </button>
        <button
          type="button"
          className={`gre-pill${pad?.key === "fatG" ? " gre-editing" : ""}`}
          onClick={() => openPad({ key: "fatG", label: "Fat, grams", kind: "number" })}
        >
          {form.fatG || 0} F
        </button>
      </div>

      {moreBlock}

      <div className="gre-foot">
        <button type="button" className="gr-delete" style={{ marginLeft: 0 }} disabled={deleting || saving} onClick={remove}>
          {deleting ? "…" : "Delete"}
        </button>
      </div>

      {dirty && (
        <div className="gre-dirty">
          <button type="button" className="btn-dark" disabled={saving} onClick={save}>
            {saving ? "Saving…" : form.id ? "Save" : "Add"}
          </button>
          <button
            type="button"
            className="gr-cancel"
            onClick={() => { setForm(original.current); setError(null); }}
          >
            Discard
          </button>
        </div>
      )}

      {pad && (
        <div className={`sheet${padOpen ? " open" : ""}`}>
          <button type="button" className="sheet-scrim" aria-label="Close" onClick={closePad} />
          <div className="sheet-card" role="dialog" aria-label={pad.label}>
            <div className="sheet-grab" />
            <div className="gre-pad-l">{pad.label}</div>
            <div className="gre-pad-row">
              {pad.kind === "select" ? (
                <select autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}>
                  <option value="">Category</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                </select>
              ) : (
                <input
                  autoFocus
                  className={pad.kind === "text" ? "txt" : ""}
                  inputMode={pad.kind === "number" ? "decimal" : "text"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitPad(); } }}
                />
              )}
              {pad.fixedUnit && <span className="gre-fixed-unit">{pad.fixedUnit}</span>}
              {pad.units && (
                <div className="gre-unit">
                  {pad.units.map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={u === draftUnit ? "on" : ""}
                      onClick={() => setDraftUnit(u)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="gre-pad-acts">
              <button type="button" className="btn-dark" onClick={commitPad}>Done</button>
              <button type="button" className="gr-cancel" onClick={closePad}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
