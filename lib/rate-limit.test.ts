import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT, LoginRateLimiter, clientIp, upstashStore } from "./rate-limit";
import { fakeStore } from "./rate-limit-fake-store";

function setup() {
  const clock = { now: 0 };
  return { clock, rl: new LoginRateLimiter(fakeStore(clock), LOGIN_RATE_LIMIT) };
}

async function attemptN(rl: LoginRateLimiter, ip: string, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await rl.attempt(ip));
  return out;
}

const ALLOWED = { allowed: true };

describe("LoginRateLimiter", () => {
  it("allows 5 attempts from one IP and blocks the 6th", async () => {
    const { rl } = setup();
    const ip = "203.0.113.1";
    expect(await attemptN(rl, ip, 5)).toEqual(Array(5).fill(ALLOWED));
    expect(await rl.attempt(ip)).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });

  it("after a lockout ends, allows one attempt and doubles the next lockout", async () => {
    const { clock, rl } = setup();
    const ip = "203.0.113.2";
    await attemptN(rl, ip, 5);
    expect(await rl.attempt(ip)).toEqual({ allowed: false, retryAfterMs: 30_000 });
    clock.now += 30_000;
    expect(await rl.attempt(ip)).toEqual(ALLOWED);
    expect(await rl.attempt(ip)).toEqual({ allowed: false, retryAfterMs: 60_000 });
    clock.now += 60_000;
    expect(await rl.attempt(ip)).toEqual(ALLOWED);
    expect(await rl.attempt(ip)).toEqual({ allowed: false, retryAfterMs: 120_000 });
  });

  it("caps the lockout at maxBackoffMs", async () => {
    const { clock, rl } = setup();
    const ip = "203.0.113.3";
    await attemptN(rl, ip, 5);
    const first = await rl.attempt(ip);
    let retryAfterMs = first.allowed ? 0 : first.retryAfterMs;
    for (let i = 0; i < 15; i++) {
      clock.now += retryAfterMs;
      expect(await rl.attempt(ip)).toEqual(ALLOWED);
      const blocked = await rl.attempt(ip);
      expect(blocked.allowed).toBe(false);
      retryAfterMs = blocked.allowed ? 0 : blocked.retryAfterMs;
      expect(retryAfterMs).toBeLessThanOrEqual(3_600_000);
    }
    expect(retryAfterMs).toBe(3_600_000);
  });

  it("a parallel burst from one IP gets at most 5 attempts through", async () => {
    const { rl } = setup();
    const ip = "203.0.113.4";
    const verdicts = await Promise.all(Array.from({ length: 20 }, () => rl.attempt(ip)));
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(5);
  });

  it("one IP's lockout does not block another IP", async () => {
    const { rl } = setup();
    await attemptN(rl, "203.0.113.5", 5);
    expect((await rl.attempt("203.0.113.5")).allowed).toBe(false);
    expect(await rl.attempt("203.0.113.6")).toEqual(ALLOWED);
  });

  it("reset clears the count and an active lockout", async () => {
    const { rl } = setup();
    const ip = "203.0.113.7";
    await attemptN(rl, ip, 5);
    expect((await rl.attempt(ip)).allowed).toBe(false);
    await rl.reset(ip);
    expect(await attemptN(rl, ip, 5)).toEqual(Array(5).fill(ALLOWED));
    expect((await rl.attempt(ip)).allowed).toBe(false);
  });

  it("the count starts over after windowMs with no attempts", async () => {
    const { clock, rl } = setup();
    const ip = "203.0.113.8";
    await attemptN(rl, ip, 4);
    clock.now += LOGIN_RATE_LIMIT.windowMs;
    expect(await attemptN(rl, ip, 5)).toEqual(Array(5).fill(ALLOWED));
    expect((await rl.attempt(ip)).allowed).toBe(false);
  });
});

describe("LoginRateLimiter global count", () => {
  function setupGlobal() {
    return new LoginRateLimiter(fakeStore({ now: 0 }), LOGIN_RATE_LIMIT, GLOBAL_LOGIN_RATE_LIMIT);
  }

  async function oneEach(rl: LoginRateLimiter, ips: string[]) {
    const out = [];
    for (const ip of ips) out.push(await rl.attempt(ip));
    return out;
  }

  const twentyIps = Array.from({ length: 20 }, (_, i) => `192.0.2.${i + 1}`);

  it("attempts from many IPs share one global count", async () => {
    const rl = setupGlobal();
    expect(await oneEach(rl, twentyIps)).toEqual(Array(20).fill(ALLOWED));
    expect(await rl.attempt("192.0.2.21")).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });

  it("a network with an owner pass gets through while the global count is tripped", async () => {
    const rl = setupGlobal();
    await rl.reset("192.0.2.200");
    await oneEach(rl, twentyIps);
    expect((await rl.attempt("192.0.2.21")).allowed).toBe(false);
    expect(await rl.attempt("192.0.2.200")).toEqual(ALLOWED);
  });

  it("an owner pass does not skip the per-IP limit", async () => {
    const rl = setupGlobal();
    const ip = "192.0.2.201";
    await rl.reset(ip);
    expect(await attemptN(rl, ip, 5)).toEqual(Array(5).fill(ALLOWED));
    expect(await rl.attempt(ip)).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });

  it("a correct password does not clear the global count", async () => {
    const rl = setupGlobal();
    await oneEach(rl, twentyIps);
    await rl.reset("192.0.2.21");
    expect((await rl.attempt("192.0.2.22")).allowed).toBe(false);
  });
});

describe("upstashStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when the KV env is missing", () => {
    vi.stubEnv("KV_REST_API_URL", undefined);
    expect(() => upstashStore()).toThrow();
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
  });

  it("trims whitespace", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.5 " }))).toBe("198.51.100.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it('falls back to "unknown" with no headers', () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
