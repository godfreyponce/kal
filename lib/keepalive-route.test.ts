import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/cron/keepalive/route";
import { upstashStore } from "@/lib/rate-limit";

// One fake store shared by every request, standing in for Upstash.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const { fakeStore } = await import("./rate-limit-fake-store");
  const store = fakeStore({ now: 0 });
  return { ...(await importOriginal<typeof import("./rate-limit")>()), upstashStore: () => store };
});

const store = upstashStore();

function ping(auth?: string) {
  const headers = auth === undefined ? undefined : { authorization: auth };
  return GET(new NextRequest("http://localhost/api/cron/keepalive", { headers }));
}

describe("GET /api/cron/keepalive", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no Authorization header gets 401 and does not touch the store", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-1234");
    expect((await ping()).status).toBe(401);
    expect(await store.pttl("keepalive:kal")).toBe(-2);
  });

  it("a wrong secret gets 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-1234");
    expect((await ping("Bearer wrong")).status).toBe(401);
    expect(await store.pttl("keepalive:kal")).toBe(-2);
  });

  it("with CRON_SECRET unset, Bearer undefined gets 401", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await ping("Bearer undefined")).status).toBe(401);
    expect((await ping("Bearer ")).status).toBe(401);
    expect(await store.pttl("keepalive:kal")).toBe(-2);
  });

  it("the right secret gets 200 and counts one ping", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-1234");
    const res = await ping("Bearer s3cret-value-1234");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await store.incr("keepalive:kal")).toBe(2);
  });
});
