// Nutrition lookup. Two free databases, queried together and merged:
//   • USDA FoodData Central — strong on US branded items (incl. store brands); needs FDC_API_KEY.
//   • OpenFoodFacts — open/crowdsourced; broad but thinner on US store brands; no key.
// Both store macros per 100 g; we scale to the label serving when its gram weight
// is known so a card reads like the package (e.g. 180 kcal / 28 g), else per 100 g.

export type NutritionHit = {
  source: "USDA" | "OpenFoodFacts";
  code: string;
  name: string;
  brand: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingGrams: number;
};

const num = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};
const round1 = (v: unknown): number => Math.round(num(v) * 10) / 10;

/** Build a hit from per-100g macros, scaled to `servingG` grams when known (else per 100g). */
function buildHit(args: {
  source: NutritionHit["source"];
  code: string;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  servingG: number | null;
}): NutritionHit | null {
  const name = args.name.trim();
  if (!name || !Number.isFinite(args.kcal100)) return null;
  const basis = args.servingG && args.servingG > 0 ? args.servingG : 100;
  const k = basis / 100;
  return {
    source: args.source,
    code: args.code,
    name,
    brand: args.brand,
    kcal: Math.round(args.kcal100 * k),
    proteinG: round1(args.protein100 * k),
    carbsG: round1(args.carbs100 * k),
    fatG: round1(args.fat100 * k),
    servingGrams: Math.round(basis * 100) / 100,
  };
}

// ---- OpenFoodFacts ----

type OffProduct = {
  code?: string | number;
  product_name?: string;
  brands?: string | string[];
  serving_quantity?: string | number;
  nutriments?: Record<string, unknown>;
};

export function normalizeOffProduct(raw: OffProduct): NutritionHit | null {
  const n = raw.nutriments ?? {};
  const kcal100 = n["energy-kcal_100g"];
  if (typeof kcal100 !== "number" || !Number.isFinite(kcal100)) return null;

  const brand = Array.isArray(raw.brands)
    ? (raw.brands[0]?.trim() || null)
    : typeof raw.brands === "string"
      ? (raw.brands.split(",")[0]?.trim() || null)
      : null;

  const sq = num(raw.serving_quantity);
  return buildHit({
    source: "OpenFoodFacts",
    code: String(raw.code ?? ""),
    name: raw.product_name ?? "",
    brand,
    kcal100,
    protein100: num(n["proteins_100g"]),
    carbs100: num(n["carbohydrates_100g"]),
    fat100: num(n["fat_100g"]),
    servingG: sq > 0 ? sq : null,
  });
}

async function searchOpenFoodFacts(q: string): Promise<NutritionHit[]> {
  const url =
    `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}` +
    `&page_size=15&fields=code,product_name,brands,serving_quantity,nutriments`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "KalApp/1.0 (single-user nutrition lookup)" },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: OffProduct[]; products?: OffProduct[] };
    return (data.hits ?? data.products ?? []).map(normalizeOffProduct).filter((h): h is NutritionHit => h !== null);
  } catch {
    return [];
  }
}

// ---- USDA FoodData Central ----

type FdcFood = {
  fdcId?: number;
  gtinUpc?: string;
  description?: string;
  brandName?: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: { nutrientId?: number; value?: number; unitName?: string }[];
};

export function normalizeFdcFood(raw: FdcFood): NutritionHit | null {
  const nutr = raw.foodNutrients ?? [];
  const find = (id: number): number => {
    const f = nutr.find((x) => x.nutrientId === id);
    return f ? num(f.value) : NaN;
  };
  const kcal100 = find(1008); // Energy, KCAL
  if (!Number.isFinite(kcal100)) return null;

  const unit = (raw.servingSizeUnit ?? "").toLowerCase();
  const servingG = unit.startsWith("g") && raw.servingSize ? num(raw.servingSize) : null;
  const brand = (raw.brandName || raw.brandOwner || "").trim() || null;

  return buildHit({
    source: "USDA",
    code: String(raw.gtinUpc || raw.fdcId || ""),
    name: raw.description ?? "",
    brand,
    kcal100,
    protein100: find(1003), // Protein
    carbs100: find(1005), // Carbohydrate, by difference
    fat100: find(1004), // Total lipid (fat)
    servingG: servingG && servingG > 0 ? servingG : null,
  });
}

async function searchUsda(q: string): Promise<NutritionHit[]> {
  const key = process.env.FDC_API_KEY;
  if (!key) return []; // no key configured → silently skip USDA, OFF still works
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}` +
    `&query=${encodeURIComponent(q)}&dataType=Branded&pageSize=15`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { foods?: FdcFood[] };
    return (data.foods ?? []).map(normalizeFdcFood).filter((h): h is NutritionHit => h !== null);
  } catch {
    return [];
  }
}

// ---- merged search ----

/** Search both databases (USDA first for US-brand quality); dedupe; cap at 8. */
export async function searchNutrition(query: string): Promise<NutritionHit[]> {
  const q = query.trim();
  if (!q) return [];
  const [usda, off] = await Promise.all([searchUsda(q), searchOpenFoodFacts(q)]);

  const out: NutritionHit[] = [];
  const seen = new Set<string>();
  for (const h of [...usda, ...off]) {
    const key = h.code || h.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= 8) break;
  }
  return out;
}
