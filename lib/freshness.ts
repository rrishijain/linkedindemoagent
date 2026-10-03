import type { PullHealth } from "./vault";

// Transport health only. Business KPIs and their verdicts remain Python's.
// Saved relative ages must never be reused as if the snapshot were live.
export function currentPullHealth(pull: PullHealth, now = Date.now()): PullHealth {
  const limit = pull.max_age_s ?? 13 * 3600;
  const sources = (pull.sources ?? []).map(source => {
    const parsed = source.ts ? Date.parse(source.ts) : NaN;
    const age = Number.isFinite(parsed) && parsed <= now ? Math.floor((now - parsed) / 1000) : null;
    const expired = age === null || age > limit;
    return {
      ...source,
      age_s: age,
      status: expired && (source.status === "ok" || source.status === "partial") ? "stale" as const : source.status,
    };
  });
  const core = sources.filter(source => source.core && !["skipped", "mock"].includes(source.status));
  const ages = core.flatMap(source => source.age_s === null ? [] : [source.age_s]);
  const overall = !core.length || !ages.length ? "unknown"
    : core.some(source => source.status === "error" || source.status === "stale" || source.age_s === null) ? "stale"
    : core.some(source => source.status === "partial") ? "partial" : "fresh";
  return { ...pull, sources, overall, newest_age_s: ages.length ? Math.min(...ages) : null };
}
