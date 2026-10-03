#!/usr/bin/env node
// enqueue-intent.mjs <skill> ['{"scope":"blended","range":7}'] [source]
// Drops an intent into <vault>/system/queue exactly like lib/skills.ts
// writeIntent(), so launchd/cron jobs show up on the wall and get spoken like
// any other run. No deps — reads VAULT_ROOT from ~/.claude/.env.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Mirror of ALLOWED_SKILLS in lib/skills.ts (TS — not importable from a plain
// .mjs cron script) ⟷ buildPrompt() cases in runner/runner.js. Keep in sync.
const ALLOWED_SKILLS = new Set([
  "morning-report",
  "inbox-brief",
  "plan-today",
  "plan-tomorrow",
  "vault-cleanup",
  "voice-ask",
  "today",
  "close-day",
  "morning-intel",
  "metrics-pull",
  "ads-dashboard",
  "meta-ads-audit",
  "google-ads-audit",
  "seo-audit",
  "aeo-audit",
  "ig-content-strategy",
  "perf-report",
  "report-deck",
  "ds-blog-publish",
  "news-carousel",
  "competitor-intel",
  "bulk-creatives",
]);

const [, , skill, argsJson = "{}", source = "launchd"] = process.argv;
if (!skill) {
  console.error("usage: enqueue-intent.mjs <skill> [argsJSON] [source]");
  process.exit(1);
}
if (!ALLOWED_SKILLS.has(skill)) {
  console.error(`unknown skill "${skill}" — allowed: ${[...ALLOWED_SKILLS].join(", ")}`);
  process.exit(1);
}
let vault = process.env.VAULT_ROOT || process.env.AGENTIC_OS_VAULT;
const envPath = join(homedir(), ".claude", ".env");
if (!vault && existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^(VAULT_ROOT|AGENTIC_OS_VAULT)=(.+)$/);
    if (m && !vault) vault = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
if (!vault) {
  console.error("VAULT_ROOT not set");
  process.exit(1);
}
let args;
try {
  args = JSON.parse(argsJson);
} catch (e) {
  console.error(`argsJSON is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (args === null || typeof args !== "object" || Array.isArray(args)) {
  console.error("argsJSON must be a JSON object, e.g. '{\"scope\":\"blended\",\"range\":7}'");
  process.exit(1);
}
const id = randomUUID();
const dir = join(vault, "system", "queue");
mkdirSync(dir, { recursive: true });
// Atomic drop — write a tmp name the runner ignores (no .json suffix), then
// rename into place so the poller can never read a half-written intent.
const finalPath = join(dir, `${id}.json`);
const tmpPath = join(dir, `.${id}.json.tmp`);
writeFileSync(tmpPath, JSON.stringify({ id, skill, args, ts: new Date().toISOString(), source }, null, 2) + "\n");
renameSync(tmpPath, finalPath);
console.log(JSON.stringify({ ok: true, id, skill, args }));
