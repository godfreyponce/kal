// DB-free: imports only ./score.
import { describe, expect, it } from "vitest";
import { matchesCall, scoreCase, type RecordedCall } from "./score";

const call = (tool: string, input: Record<string, unknown> = {}, turn = 0): RecordedCall => ({ turn, tool, input });

describe("matchesCall", () => {
  it("checks exact strings, numbers and booleans", () => {
    const c = call("log_food", { name: "Rice", food_id: 2, one_off: true });
    expect(matchesCall(c, { tool: "log_food", args: { name: "Rice", food_id: 2, one_off: true } })).toBe(true);
    expect(matchesCall(c, { tool: "log_food", args: { name: "rice" } })).toBe(false);
    expect(matchesCall(c, { tool: "log_food", args: { food_id: 3 } })).toBe(false);
    expect(matchesCall(c, { tool: "log_food", args: { one_off: false } })).toBe(false);
    expect(matchesCall(c, { tool: "search_foods" })).toBe(false);
  });

  it("checks an inclusive number range and refuses numeric strings", () => {
    const spec = { tool: "log_food", args: { grams: [110, 116] as const } };
    expect(matchesCall(call("log_food", { grams: 113 }), spec)).toBe(true);
    expect(matchesCall(call("log_food", { grams: 110 }), spec)).toBe(true);
    expect(matchesCall(call("log_food", { grams: 116 }), spec)).toBe(true);
    expect(matchesCall(call("log_food", { grams: 117 }), spec)).toBe(false);
    expect(matchesCall(call("log_food", { grams: "113" }), spec)).toBe(false);
  });

  it("gives a predicate undefined for a missing arg, and fails other checks on it", () => {
    expect(matchesCall(call("log_food", {}), { tool: "log_food", args: { name: (v) => v === undefined } })).toBe(true);
    expect(matchesCall(call("log_food", {}), { tool: "log_food", args: { food_id: 1 } })).toBe(false);
  });

  it("matches a turn only when the spec names that turn", () => {
    expect(matchesCall(call("log_food", {}, 0), { tool: "log_food", turn: 1 })).toBe(false);
    expect(matchesCall(call("log_food", {}, 1), { tool: "log_food", turn: 1 })).toBe(true);
    expect(matchesCall(call("log_food", {}, 1), { tool: "log_food" })).toBe(true);
  });
});

describe("scoreCase", () => {
  it("assigns distinct calls to unordered specs, beyond the first greedy match", () => {
    const calls = [call("log_food", { food_id: 2 }), call("log_food", { food_id: 1 })];
    const must = [{ tool: "log_food" }, { tool: "log_food", args: { food_id: 2 } }];
    expect(scoreCase(calls, { must, mustNot: [] })).toEqual({ pass: true, failures: [] });
  });

  it("fails when two specs share one call", () => {
    const out = scoreCase([call("log_food")], { must: [{ tool: "log_food" }, { tool: "log_food" }], mustNot: [] });
    expect(out.pass).toBe(false);
    expect(out.failures.filter((f) => f.startsWith("missing:"))).toHaveLength(1);
  });

  it("checks order only when the case says so", () => {
    const must = [{ tool: "a" }, { tool: "b" }];
    expect(scoreCase([call("a"), call("x"), call("b")], { must, mustNot: [], ordered: true }).pass).toBe(true);
    expect(scoreCase([call("b"), call("a")], { must, mustNot: [], ordered: true }).pass).toBe(false);
    expect(scoreCase([call("b"), call("a")], { must, mustNot: [] }).pass).toBe(true);
  });

  it("does not fail on extra calls that match no spec", () => {
    const out = scoreCase([call("get_day_summary"), call("log_food")], { must: [{ tool: "log_food" }], mustNot: [] });
    expect(out.pass).toBe(true);
  });

  it("fails a call that matches a must-not spec", () => {
    const out = scoreCase([call("add_grocery", { name: "Yogurt" })], { must: [], mustNot: [{ tool: "add_grocery" }] });
    expect(out).toEqual({ pass: false, failures: ['forbidden: add_grocery {"name":"Yogurt"}'] });
  });

  it("fails a run that errored", () => {
    expect(scoreCase([], { must: [], mustNot: [] }, "400 bad request")).toEqual({
      pass: false,
      failures: ["error: 400 bad request"],
    });
  });
});
