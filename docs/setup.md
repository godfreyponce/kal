# setup

How to run Kal locally. Read the warning in the README first: out of the box this is my
app with my meal plan, and it stays that way until you reseed it.

## you need

- Node and npm
- A [Neon](https://neon.tech) Postgres database (the app uses the Neon serverless driver)
- An Anthropic API key

## env

Everything goes in `.env.local`. Required:

- `DATABASE_URL`: Neon Postgres connection string. The app refuses to start without it.
- `ANTHROPIC_API_KEY`: for the chat route. Everything else works without it.
- `APP_PASSWORD`: the one password. There are no accounts.
- `SESSION_SECRET`: encrypts the session cookie (iron-session wants at least 32 characters).

Optional:

- `ANTHROPIC_MODEL`: swaps the chat model. Default is `claude-haiku-4-5`.
- `FDC_API_KEY`: USDA FoodData Central key for `search_nutrition`. OpenFoodFacts needs no key.
- `DATABASE_URL_UNPOOLED`: if set, drizzle-kit uses it for migrations instead of the pooled URL.
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob store for grocery product photos. Uploads fail without it.
- `MODEL_BLOB_READ_WRITE_TOKEN`: a second, private Blob store that holds the 3D figure on the
  Plan screen. No token, no figure.

## database

```
npm run db:migrate
npm run db:seed
```

`db:seed` is a full wipe: it deletes log history, meal statuses, and all foods, including
any groceries you added, then installs the starter plan. `db:generate` exists too, but you
only need it when changing the schema.

## run

```
npm run dev
```

Open localhost:3000 and log in with `APP_PASSWORD`. The app is built to be installed on a
phone (it ships a PWA manifest), but it works in a desktop browser.

## tests

```
npm test
```

179 tests across 25 files. They hit the live database in `DATABASE_URL`, not mocks, and
run file by file on purpose: several files snapshot and restore shared state, so parallel
runs would see each other. Point them at a database you are comfortable having written to.

## deploy

It deploys as a normal Next.js app on Vercel. `proxy.ts` gates every route behind the
session: logged out, you can reach the login page and the auth API, nothing else.
