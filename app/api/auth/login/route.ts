import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { LoginRateLimiter, clientIp, upstashStore } from "@/lib/rate-limit";

// Hashing both sides first makes the buffers equal length, so timingSafeEqual
// neither throws nor leaks the password's length.
function passwordMatches(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// POST /api/auth/login  body: { password }
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const limiter = new LoginRateLimiter(upstashStore());
  const verdict = await limiter.attempt(ip);
  if (!verdict.allowed) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(verdict.retryAfterMs / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) ?? {};
  const password = typeof body.password === "string" ? body.password : "";

  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected || !passwordMatches(password, expected)) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  await limiter.reset(ip);
  const session = await getSession();
  session.loggedIn = true;
  await session.save();
  return Response.json({ ok: true });
}
