// Load env for standalone scripts (seed). Vercel pulls vars into .env.local.
// Imported as a side-effect BEFORE ./index so DATABASE_URL is set in time.
import { config } from "dotenv";

config({ path: ".env.local" });
