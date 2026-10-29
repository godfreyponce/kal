// Runs before anything that loads ../db. The dummy DATABASE_URL is set first because dotenv never
// overwrites a variable that is already set: .env.local still supplies ANTHROPIC_API_KEY, but an
// import that reaches the DB by mistake fails on the reserved .invalid host and writes nothing.
import { config } from "dotenv";

process.env.DATABASE_URL = "postgresql://eval:eval@db.invalid/eval";
config({ path: ".env.local", quiet: true });
