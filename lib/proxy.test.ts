import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

// sessionOptions reads SESSION_SECRET at import, so the test supplies its own
// 32+ character password. Requests carry no cookie, so no session is logged in.
vi.mock("@/lib/session", () => ({
  sessionOptions: { password: "test-password-at-least-32-characters-long", cookieName: "kal_session" },
}));

const get = (path: string) => proxy(new NextRequest(`http://localhost${path}`));

describe("proxy without a session", () => {
  it("lets GET /api/cron/keepalive through without a session", async () => {
    const res = await get("/api/cron/keepalive");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still returns 401 for another /api/cron path", async () => {
    expect((await get("/api/cron/other")).status).toBe(401);
  });

  it("still returns 401 for other API routes", async () => {
    expect((await get("/api/profile")).status).toBe(401);
  });
});
