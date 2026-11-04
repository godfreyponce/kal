import type { RateLimitStore } from "./rate-limit";

// In-memory stand-in for Upstash with a clock the test moves by hand, so
// expiry is deterministic without fake timers.
export function fakeStore(clock: { now: number }): RateLimitStore {
  const vals = new Map<string, string>();
  const exp = new Map<string, number>();
  const alive = (key: string): boolean => {
    const e = exp.get(key);
    if (e !== undefined && e <= clock.now) {
      vals.delete(key);
      exp.delete(key);
      return false;
    }
    return vals.has(key);
  };
  return {
    async pttl(key) {
      if (!alive(key)) return -2;
      const e = exp.get(key);
      return e === undefined ? -1 : e - clock.now;
    },
    async incr(key) {
      const n = (alive(key) ? Number(vals.get(key)) : 0) + 1;
      vals.set(key, String(n));
      return n;
    },
    async pexpire(key, ms) {
      if (alive(key)) exp.set(key, clock.now + ms);
    },
    async set(key, value, opts) {
      if (opts.nx && alive(key)) return null;
      vals.set(key, value);
      exp.set(key, clock.now + opts.px);
      return "OK";
    },
    async del(...keys) {
      for (const key of keys) {
        vals.delete(key);
        exp.delete(key);
      }
    },
  };
}
