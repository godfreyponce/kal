import { Redis } from "@upstash/redis";

export interface RateLimitStore {
  pttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  set(key: string, value: string, opts: { px: number; nx: true }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export interface RateLimitConfig {
  threshold: number;
  windowMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

// The window outlasts the backoff cap on purpose: a shorter window would clear
// the count during a long lockout and hand the attacker fresh guesses.
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  threshold: 5,
  windowMs: 24 * 60 * 60_000,
  baseBackoffMs: 30_000,
  maxBackoffMs: 60 * 60_000,
};

export type AttemptVerdict = { allowed: true } | { allowed: false; retryAfterMs: number };

export class LoginRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly cfg: RateLimitConfig = LOGIN_RATE_LIMIT,
  ) {}

  private countKey(id: string) {
    return `rl:login:count:${id}`;
  }
  private blockKey(id: string) {
    return `rl:login:block:${id}`;
  }

  // Counts the attempt before the caller compares the password, and past the
  // threshold lets through only the attempt that wins SET NX on the lockout
  // key. Checking first and counting after the compare would let a parallel
  // burst pass the check before any of it is counted.
  async attempt(id: string): Promise<AttemptVerdict> {
    const block = this.blockKey(id);
    const ttl = await this.store.pttl(block);
    if (ttl > 0) return { allowed: false, retryAfterMs: ttl };

    const count = this.countKey(id);
    const n = await this.store.incr(count);
    await this.store.pexpire(count, this.cfg.windowMs);
    if (n < this.cfg.threshold) return { allowed: true };

    const backoff = Math.min(this.cfg.baseBackoffMs * 2 ** (n - this.cfg.threshold), this.cfg.maxBackoffMs);
    if (await this.store.set(block, "1", { px: backoff, nx: true })) return { allowed: true };

    const left = await this.store.pttl(block);
    return { allowed: false, retryAfterMs: left > 0 ? left : backoff };
  }

  async reset(id: string): Promise<void> {
    await this.store.del(this.countKey(id), this.blockKey(id));
  }
}

// Redis rather than process memory: serverless instances share no memory, so an
// in-process counter would reset on every cold start and differ per instance.
export function upstashStore(): RateLimitStore {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
  return new Redis({ url, token });
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
