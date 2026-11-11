import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { upstashStore } from "@/lib/rate-limit";

// Free Upstash stores are archived after 30 days without a command. This store
// holds the login limiter for Kal and star, so a daily Vercel cron (vercel.json)
// writes one counter here to keep it alive.

// Hashing both sides first makes the buffers equal length, so timingSafeEqual
// neither throws nor leaks the secret's length.
function secretMatches(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// GET /api/cron/keepalive  header: Authorization: Bearer $CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !secretMatches(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await upstashStore().incr("keepalive:kal");
  return Response.json({ ok: true });
}
