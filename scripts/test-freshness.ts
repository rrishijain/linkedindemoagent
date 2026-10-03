import assert from "node:assert/strict";
import { currentPullHealth } from "../lib/freshness";
import { syncAlertCallouts } from "../lib/alertCallouts";
import type { PullHealth, PullSource } from "../lib/vault";

const now = Date.parse("2026-09-05T16:30:00Z");
const source = (overrides: Partial<PullSource> = {}): PullSource => ({
  source: "meta_ads", core: true, status: "ok", ts: "2026-09-05T16:29:00Z", age_s: 2, error: "", ...overrides,
});
const health = (sources: PullSource[]): PullHealth => ({ sources, overall: "fresh", newest_age_s: 2 });
const old = health([source({ ts: "2026-09-03T16:30:00Z" })]);
assert.equal(currentPullHealth(old, now).sources[0].age_s, 172800);
assert.equal(currentPullHealth(old, now).overall, "stale");
assert.equal(old.sources[0].status, "ok", "does not mutate saved data");
assert.equal(currentPullHealth(health([source()]), now).newest_age_s, 60);
assert.equal(currentPullHealth(health([source({ status: "partial" })]), now).overall, "partial");
assert.equal(currentPullHealth(health([source({ status: "error" })]), now).overall, "stale");
assert.equal(currentPullHealth(health([source({ ts: "invalid" })]), now).overall, "unknown");
assert.equal(currentPullHealth(health([source({ ts: "2027-01-01T00:00:00Z" })]), now).sources[0].age_s, null);
assert.equal(currentPullHealth(health([source({ status: "skipped" })]), now).overall, "unknown");
assert.equal(currentPullHealth(health([source(), source({ source: "instagram", core: false, status: "error" })]), now).overall, "fresh");
assert.equal(currentPullHealth({ ...health([source()]), max_age_s: 30 }, now).overall, "stale");
console.log("11 freshness checks passed: advancing age, expiry, partial/error, invalid clocks, skipped sources and immutability.");

const cards = [{ kind: "doc", target: "ops/ads-dashboard.md#frequency", label: "Frequency 2.46" }, { kind: "task", target: "run:1", label: "Working" }];
const synced = syncAlertCallouts(cards, [{ code: "frequency", text: "Frequency 4.05", level: "red" }], "ops/ads-dashboard.md");
assert.equal(synced[0].label, "Frequency 4.05");
assert.equal(synced[1], cards[1]);
assert.deepEqual(syncAlertCallouts(cards, [], "ops/ads-dashboard.md"), [cards[1]]);
assert.equal(syncAlertCallouts(synced, [{ code: "frequency", text: "Frequency 4.05", level: "red" }], "ops/ads-dashboard.md"), synced);
console.log("4 alert checks passed: refresh text, remove resolved alerts and preserve unrelated cards.");
