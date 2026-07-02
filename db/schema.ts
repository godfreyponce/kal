import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  date,
  timestamp,
  jsonb,
  uuid,
  unique,
  boolean,
} from "drizzle-orm/pg-core";

// Singleton (id = 1). Targets are stored explicitly, not derived at runtime.
// The assistant may propose new targets; the user confirms in the UI.
export const profile = pgTable("profile", {
  id: integer("id").primaryKey().default(1),
  heightCm: integer("height_cm").notNull(),
  weightLb: numeric("weight_lb", { precision: 6, scale: 2 }).notNull(),
  age: integer("age").notNull(),
  sex: text("sex").notNull(),
  bodyFatPct: numeric("body_fat_pct", { precision: 4, scale: 1 }),
  goalWeightLb: numeric("goal_weight_lb", { precision: 6, scale: 2 }),
  goalDate: date("goal_date"),
  activityLevel: text("activity_level"),
  targetKcal: integer("target_kcal").notNull(),
  targetProteinG: integer("target_protein_g").notNull(),
  targetCarbsG: integer("target_carbs_g").notNull(),
  targetFatG: integer("target_fat_g").notNull(),
});

// Self-maintained food library = the owner's "Groceries". Macros are per one
// `serving_desc` unit; `serving_grams` gives that serving's weight so chat can
// log by weight (oz/g). `is_estimated=false` means the numbers came off a real
// label. purchase_weight (grams) + price are recorded attributes (no auto-decrement).
export const foods = pgTable("foods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand"),
  servingDesc: text("serving_desc").notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: numeric("protein_g", { precision: 6, scale: 2 }).notNull(),
  carbsG: numeric("carbs_g", { precision: 6, scale: 2 }).notNull(),
  fatG: numeric("fat_g", { precision: 6, scale: 2 }).notNull(),
  store: text("store"),
  link: text("link"),
  imageUrl: text("image_url"),
  category: text("category"),
  servingGrams: numeric("serving_grams", { precision: 8, scale: 2 }),
  isEstimated: boolean("is_estimated").notNull().default(false),
  // Cooked-weight is canonical everywhere (logging, macros). This ratio exists
  // ONLY for the future grocery/shopping feature (raw amounts to buy):
  // meats store cooked/raw (chicken 0.75); rice stores dry→cooked (3.0).
  rawToCookedYield: numeric("raw_to_cooked_yield", { precision: 5, scale: 2 }),
  purchaseWeight: numeric("purchase_weight", { precision: 8, scale: 2 }),
  price: numeric("price", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The plan template: which meals exist.
export const meals = pgTable("meals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  timeHint: text("time_hint"),
});

// What the plan says each meal contains. quantity = multiplier of the food's serving.
export const mealItems = pgTable("meal_items", {
  id: serial("id").primaryKey(),
  mealId: integer("meal_id")
    .notNull()
    .references(() => meals.id, { onDelete: "cascade" }),
  foodId: integer("food_id")
    .notNull()
    .references(() => foods.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 8, scale: 3 }).notNull(),
});

// What actually happened. Macros are SNAPSHOTTED on purpose so editing a food
// later never rewrites history. meal_id null = unplanned/freeform eating.
// write_batch_id groups rows created by a single tool action for batch Undo.
export const logEntries = pgTable("log_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  mealId: integer("meal_id").references(() => meals.id, { onDelete: "set null" }),
  foodId: integer("food_id")
    .notNull()
    .references(() => foods.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 8, scale: 3 }).notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: numeric("protein_g", { precision: 6, scale: 2 }).notNull(),
  carbsG: numeric("carbs_g", { precision: 6, scale: 2 }).notNull(),
  fatG: numeric("fat_g", { precision: 6, scale: 2 }).notNull(),
  source: text("source").notNull(), // 'user_ui' | 'assistant_tool'
  writeBatchId: uuid("write_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-day status of each planned meal. write_batch_id ties an 'eaten' status to
// the log_entries it auto-created, so Undo can revert the whole batch.
export const mealStatus = pgTable(
  "meal_status",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    mealId: integer("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // 'eaten' | 'missed' | 'substituted' | 'pending'
    writeBatchId: uuid("write_batch_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("meal_status_date_meal_unique").on(t.date, t.mealId)],
);

export const weighIns = pgTable("weigh_ins", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  weightLb: numeric("weight_lb", { precision: 6, scale: 2 }).notNull(),
  note: text("note"),
});

// Lean cross-session memory: short, durable facts the assistant writes and the
// user can edit. Injected into every fresh chat session.
export const memoryFacts = pgTable("memory_facts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Chat is ephemeral: a fresh session_id per chat open, no browsable threads.
// content stores full Anthropic content blocks (incl. tool_use / tool_result).
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
