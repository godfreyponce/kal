// Scores the tool calls a model made against a case's expectations. Never looks at prose.

/** Exact value, an inclusive [min, max] number range, or a predicate (gets undefined for a missing arg). */
export type ArgCheck =
  | string
  | number
  | boolean
  | readonly [min: number, max: number]
  | ((value: unknown) => boolean);

/** `turn` is 0-based; with no `turn` the spec matches a call on any turn. */
export type CallSpec = { tool: string; args?: Record<string, ArgCheck>; turn?: number; label?: string };
export type RecordedCall = { turn: number; tool: string; input: Record<string, unknown> };
export type Expectations = { must: CallSpec[]; mustNot: CallSpec[]; ordered?: boolean };

function checkArg(value: unknown, check: ArgCheck): boolean {
  if (typeof check === "function") return check(value);
  if (Array.isArray(check)) {
    const [min, max] = check;
    return typeof value === "number" && value >= min && value <= max;
  }
  return value === check;
}

export function matchesCall(call: RecordedCall, spec: CallSpec): boolean {
  if (call.tool !== spec.tool) return false;
  if (spec.turn !== undefined && call.turn !== spec.turn) return false;
  return Object.entries(spec.args ?? {}).every(([key, check]) => checkArg(call.input[key], check));
}

function describeSpec(spec: CallSpec): string {
  if (spec.label) return spec.label;
  const args = spec.args
    ? JSON.stringify(spec.args, (_k, v) => (typeof v === "function" ? "<check>" : v))
    : "";
  const turn = spec.turn === undefined ? "" : ` (turn ${spec.turn})`;
  return `${spec.tool}${args ? ` ${args}` : ""}${turn}`;
}

/** Specs left unmatched by the best assignment of distinct calls to specs. */
function unmatchedUnordered(calls: RecordedCall[], specs: CallSpec[]): CallSpec[] {
  let best: CallSpec[] = specs;
  const used = new Set<number>();
  const missed: CallSpec[] = [];
  const search = (i: number) => {
    if (missed.length >= best.length) return;
    if (i === specs.length) {
      best = [...missed];
      return;
    }
    for (let c = 0; c < calls.length; c++) {
      if (used.has(c) || !matchesCall(calls[c], specs[i])) continue;
      used.add(c);
      search(i + 1);
      used.delete(c);
      if (best.length === 0) return;
    }
    missed.push(specs[i]);
    search(i + 1);
    missed.pop();
  };
  search(0);
  return best;
}

/** Specs left unmatched when they must match an increasing run of calls; earliest match wins. */
function unmatchedOrdered(calls: RecordedCall[], specs: CallSpec[]): CallSpec[] {
  let next = 0;
  const missed: CallSpec[] = [];
  for (const spec of specs) {
    const at = calls.findIndex((c, i) => i >= next && matchesCall(c, spec));
    if (at === -1) missed.push(spec);
    else next = at + 1;
  }
  return missed;
}

export function scoreCase(
  calls: RecordedCall[],
  exp: Expectations,
  error?: string,
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (error !== undefined) failures.push(`error: ${error}`);
  const missed = exp.ordered ? unmatchedOrdered(calls, exp.must) : unmatchedUnordered(calls, exp.must);
  for (const spec of missed) failures.push(`missing: ${describeSpec(spec)}`);
  for (const c of calls) {
    if (exp.mustNot.some((spec) => matchesCall(c, spec))) {
      failures.push(`forbidden: ${c.tool} ${JSON.stringify(c.input)}`);
    }
  }
  return { pass: failures.length === 0, failures };
}
