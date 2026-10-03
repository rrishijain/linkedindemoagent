// ---------------------------------------------------------------------------
// Tiny request-body guards shared by the /api routes. Zero dependencies.
// Each require* helper returns a Result: {ok:true, value} with the value
// properly narrowed, or {ok:false, error} with a field-specific message the
// route can hand straight back as a 400. No coercion anywhere — a null,
// "" or false never sneaks through as 0.
// ---------------------------------------------------------------------------

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** True for plain JSON objects only — rejects null, arrays, primitives. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Requires an actual string; optionally non-empty after trimming. */
export function requireString(
  v: unknown,
  field: string,
  opts: { nonEmpty?: boolean } = {}
): Result<string> {
  if (typeof v !== "string") return fail(`${field} must be a string`);
  if (opts.nonEmpty && v.trim() === "") return fail(`${field} must not be empty`);
  return { ok: true, value: v };
}

/** Requires an actual integer (no Number() coercion); optional min/max. */
export function requireInt(
  v: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): Result<number> {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return fail(`${field} must be an integer`);
  }
  if (opts.min !== undefined && v < opts.min) {
    return fail(`${field} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && v > opts.max) {
    return fail(`${field} must be <= ${opts.max}`);
  }
  return { ok: true, value: v };
}

/** Requires an actual boolean (true/false, not truthiness). */
export function requireBoolean(v: unknown, field: string): Result<boolean> {
  if (typeof v !== "boolean") return fail(`${field} must be a boolean`);
  return { ok: true, value: v };
}
