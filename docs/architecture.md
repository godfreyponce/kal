# architecture

One Next.js app, one Postgres database, one model. The frontend talks to `/api/chat` and
a handful of plain REST routes, nothing else.

## the gate

`proxy.ts` puts everything behind an iron-session cookie and the one password.
Unauthenticated API calls get a 401, pages redirect to `/login`. The login page and
`/api/auth` are the only things reachable logged out.

## the chat route

`POST /api/chat` is where the product lives. One request:

1. Loads the last 30 messages from `chat_messages` (`HISTORY_CAP` in the route).
2. Builds the system prompt and runs the tool loop, at most 8 rounds
   (`MAX_TOOL_ITERATIONS` in `lib/anthropic.ts`), streaming the whole thing back as
   server-sent events.
3. Prompt caching does the cost work: the static system block and the tail of the tool
   list carry `cache_control` markers, and stale markers get stripped from history each
   turn so the cache stays byte-stable. A cached turn costs $0.0009 instead of $0.0057,
   which is how a full conversation stays around three cents.

`usageCostUsd` prices each turn from a small table in `lib/anthropic.ts` and the client
shows the running total. The model is `claude-haiku-4-5` unless `ANTHROPIC_MODEL` says
otherwise: cheapest-capable, bump it only if Haiku fumbles.

## the tools

Eleven, defined in `lib/tools.ts` and dispatched by `runTool`:

`get_day_summary`, `search_foods`, `log_food`, `add_grocery`, `set_meal_status`,
`log_weigh_in`, `get_weight_trend`, `add_memory_fact`, `search_nutrition`, `fetch_page`,
`override_meal`.

`search_nutrition` hits USDA FoodData Central and OpenFoodFacts. `fetch_page` is
SSRF-guarded: public http(s) URLs only, private and loopback ranges rejected (the guard
has its own test table). Every write is stamped with a `writeBatchId`, and `/api/undo`
calls `revertWriteBatch` to delete the batch across `log_entries`, `meal_status`, and
`meal_overrides`, then garbage-collects orphaned one-off foods. The Neon HTTP driver has
no interactive transactions, so the revert is sequential deletes. Fine for one user.

## the one rule

`lib/resolve-item.ts` turns a plan or log quantity into an absolute amount with computed
macros. The model and the UI only ever see its output, never a bare multiplier like
"6x Chicken breast". This is the fix for the day the model guessed a serving size and
handed me 372 g of protein.

## data

Ten tables in `db/schema.ts`, managed by drizzle: `profile`, `foods`, `meals`,
`meal_items`, `log_entries`, `meal_status`, `meal_overrides`, `weigh_ins`,
`memory_facts`, `chat_messages`.

## the client

No UI library, no state library, no motion library. The bottom sheets, springs, and
rubber-band drags are hand-rolled CSS and pointer math (`lib/sheet-gesture.ts`), the
weight chart is computed geometry (`lib/trend-geometry.ts`), and reduced motion drops it
all to fades. The one heavy dependency is three.js, which renders the Plan screen's 3D
figure from a GLB streamed out of a private blob store.

## tests

179 tests across 25 files, vitest, run sequentially (`fileParallelism: false`) against
the live database. No CI yet; they run locally as a commit gate.
