"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GroceryGroupItem } from "@/lib/groceries";
import { buildGroceryPatch, EMPTY, toForm, type FormState, type WeightUnit } from "@/lib/grocery-form";

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

  const dirty = JSON.stringify(form) !== JSON.stringify(original.current);

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

  // ---- the label card ----
  const isCount = form.basisUnit !== null;
  const subtitle = [form.brand, form.store].filter(Boolean).join(", ") || "Add a brand";
  const catKey = (CATEGORIES as readonly string[]).includes(form.category) ? form.category : "other";

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

      {/* Task 3 inserts the More disclosure here. */}

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
