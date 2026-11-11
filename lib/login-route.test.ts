import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/auth/login/route";
import { fakeStore } from "./rate-limit-fake-store";
import type { RateLimitStore } from "./rate-limit";

// A fake store standing in for Upstash, new for each test so the global count
// does not carry over between tests. cookies() throws outside a real request,
// so the session is a stub.
let store: RateLimitStore;
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rate-limit")>()),
  upstashStore: () => store,
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ loggedIn: false, save: async () => {} }) }));

function login(ip: string, password: string) {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ password }),
    }),
  );
}

async function statuses(ip: string, passwords: string[]) {
  const out = [];
  for (const p of passwords) out.push((await login(ip, p)).status);
  return out;
}

const wrong = (n: number) => Array.from({ length: n }, (_, i) => `wrong-${i}`);

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    store = fakeStore({ now: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("five wrong passwords get 401 and the sixth gets 429 with Retry-After", async () => {
    vi.stubEnv("APP_PASSWORD", "correct-horse");
    const ip = "203.0.113.21";
    expect(await statuses(ip, wrong(5))).toEqual([401, 401, 401, 401, 401]);
    const sixth = await login(ip, "wrong-5");
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBe("30");
    expect(await sixth.json()).toEqual({ error: "Too many attempts. Try again later." });
  });

  it("wrong passwords of any length get 401, not 500", async () => {
    vi.stubEnv("APP_PASSWORD", "correct-horse");
    const ip = "203.0.113.22";
    expect((await login(ip, "x")).status).toBe(401);
    expect((await login(ip, "y".repeat(200))).status).toBe(401);
  });

  it("a correct password during a lockout gets 429", async () => {
    vi.stubEnv("APP_PASSWORD", "correct-horse");
    const ip = "203.0.113.23";
    await statuses(ip, wrong(5));
    expect((await login(ip, "correct-horse")).status).toBe(429);
  });

  it("a correct password logs in and clears the count", async () => {
    vi.stubEnv("APP_PASSWORD", "correct-horse");
    const ip = "203.0.113.24";
    await statuses(ip, wrong(4));
    const ok = await login(ip, "correct-horse");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(await statuses(ip, wrong(5))).toEqual([401, 401, 401, 401, 401]);
  });

  it("fails closed when APP_PASSWORD is unset", async () => {
    vi.stubEnv("APP_PASSWORD", undefined);
    const ip = "203.0.113.25";
    expect((await login(ip, "")).status).toBe(401);
    expect((await login(ip, "anything")).status).toBe(401);
  });
});
