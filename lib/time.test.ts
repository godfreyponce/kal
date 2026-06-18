import { describe, it, expect } from "vitest";
import { todayInAppTz } from "./time";

// America/Chicago is the app's day boundary. These instants pin down two things:
// (1) the civil date is computed in Chicago time, not UTC; and
// (2) it stays correct across the CST/CDT (DST) offset change.
describe("todayInAppTz", () => {
  it("returns the Chicago civil date for a midday instant", () => {
    // 2025-07-15 12:00 CDT (UTC-5)
    expect(todayInAppTz(new Date("2025-07-15T17:00:00Z"))).toBe("2025-07-15");
  });

  it("uses the previous day late at night during CDT (summer rollover)", () => {
    // 2025-07-15 21:00 CDT, even though UTC has ticked to the 16th
    expect(todayInAppTz(new Date("2025-07-16T02:00:00Z"))).toBe("2025-07-15");
  });

  it("uses the previous day late at night during CST (winter rollover)", () => {
    // 2025-01-15 23:30 CST (UTC-6), even though UTC has ticked to the 16th
    expect(todayInAppTz(new Date("2025-01-16T05:30:00Z"))).toBe("2025-01-15");
  });
});
