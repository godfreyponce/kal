"use client";

import { useState } from "react";
import type { GroceryGroupItem, GroceryGroups } from "@/lib/groceries";
import { servingDisplay } from "@/lib/serving-display";
import { GroceryEditor } from "./grocery-editor";

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

export function GroceriesList({ groups }: { groups: GroceryGroups }) {
  const [mode, setMode] = useState<"meal" | "cat">("meal");
  const [editing, setEditing] = useState<GroceryGroupItem | "new" | null>(null);

  // Plain render helpers (not <Card/> components) so they don't remount — and
  // flicker the product <img> — on every parent re-render.
  const renderRow = (g: GroceryGroupItem, key: string, idx: number) => {
    const cat = normCat(g.category);
    const disp = servingDisplay(g);
    const macros = disp.baseMacros;
    const protein = Math.round(macros.proteinG);
    return (
      <li key={key}>
        <button
          type="button"
          className="gro-row"
          style={{ "--gro-d": `${Math.min(idx * 30, 300)}ms` } as React.CSSProperties}
          onClick={() => setEditing(g)}
        >
          {g.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="gro-ph" src={g.imageUrl} alt="" />
          ) : (
            <span className={`gro-fall gro-t-${cat}`}>{g.name.charAt(0).toUpperCase()}</span>
          )}
          <span className="gro-txt">
            <span className="gro-pills">
              <span className="gro-pill">{macros.kcal} cal</span>
              {protein > 0 && <span className="gro-pill pro">{protein}P</span>}
            </span>
            <span className="gro-nm">{disp.title}</span>
          </span>
        </button>
      </li>
    );
  };

  const renderShelf = (key: string, title: string, meta: string, items: GroceryGroupItem[], startIdx: number) => {
    if (items.length === 0) return null;
    return (
      <div className="gro-shelf" key={key} style={{ "--gro-d": `${Math.min(startIdx * 30, 300)}ms` } as React.CSSProperties}>
        <div className="gro-kick">{title} <small>{meta}</small></div>
        <ul className="gro-list">{items.map((g, i) => renderRow(g, `${key}-${g.id}`, startIdx + i))}</ul>
      </div>
    );
  };

  const { groceries, meals } = groups;

  const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

  const mealShelfNodes: React.ReactNode[] = [];
  let mealIdx = 0;
  for (const m of meals) {
    const items = groceries.filter((g) => g.mealIds.includes(m.id));
    mealShelfNodes.push(renderShelf(`meal-${m.id}`, m.name, `${m.plannedKcal} kcal`, items, mealIdx));
    mealIdx += items.length;
  }
  const pantryItems = groceries.filter((g) => g.mealIds.length === 0);
  mealShelfNodes.push(renderShelf("pantry", "Pantry", "not in rotation", pantryItems, mealIdx));
  const mealShelves = <>{mealShelfNodes}</>;

  const catShelfNodes: React.ReactNode[] = [];
  let catIdx = 0;
  for (const c of CATEGORIES) {
    const items = groceries.filter((g) => normCat(g.category) === c);
    catShelfNodes.push(renderShelf(`cat-${c}`, CAT_LABEL[c], plural(items.length), items, catIdx));
    catIdx += items.length;
  }
  const catShelves = <>{catShelfNodes}</>;

  if (editing) {
    return (
      <div className="gr">
        <GroceryEditor
          key={editing === "new" ? "new" : editing.id}
          item={editing}
          onDone={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="gr">
      <div className="gro-modes">
        <button className={mode === "meal" ? "on" : ""} onClick={() => setMode("meal")}>Today&apos;s meals</button>
        <button className={mode === "cat" ? "on" : ""} onClick={() => setMode("cat")}>By category</button>
      </div>
      <button type="button" className="gro-fab" aria-label="Add grocery" onClick={() => setEditing("new")}>＋</button>
      {mode === "meal" ? mealShelves : catShelves}
    </div>
  );
}
