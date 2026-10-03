import fs from "fs";
import path from "path";
import { VAULT_ROOT, CONSOLE_TZ } from "./config";
import { ALLOWED_SKILLS } from "./skills";
import { currentPullHealth } from "./freshness";
import { readEngagement, type Engagement } from "./engagement";

export type {
  Engagement,
  Streaks,
  StreakState,
  Quests,
  QuestItem,
  Momentum,
  RecordEntry,
} from "./engagement";

// ---------------------------------------------------------------------------
// ARGUS data layer — reads the SAME files the vault cockpit reads.
// Zero new plumbing: metrics.csv, runner-status.json, marketing-latest.json,
// system/runs/*.json, daily-notes/YYYY-MM-DD.md.
// ---------------------------------------------------------------------------

export interface MetricPoint {
  timestamp: string;
  value: number;
  status: string;
}

export interface Metric {
  source: string;
  metric: string;
  value: number;
  status: string; // ok | stale | error | mock
  timestamp: string;
  history: MetricPoint[]; // oldest → newest, capped
  delta: number | null; // vs previous reading
  deltaWeek: number | null; // vs oldest point in history window (~6 days at 6h pulls)
}

export interface RunEntry {
  id: string;
  skill: string;
  /** topic tag for voice-asks ("fable 5 news") — null for named skills */
  label: string | null;
  /** external URL when the run's REAL output lives elsewhere (Gmail draft,
   *  video) — parsed from `link:` in the deliverable's frontmatter */
  link: string | null;
  status: string;
  summary: string;
  ts_completed: string | null;
  ts_started: string | null;
  duration_s: number | null;
  deliverable_path: string | null; // vault-relative md the run produced
}

export interface QueueEntry {
  id: string;
  skill: string;
  label: string | null;
  ts: string;
}

export interface RunnerStatus {
  ts: string;
  pid: number;
  version: string;
  busy: boolean;
  active: number;
  max_concurrent: number;
  pending: number;
  heartbeat_age_s: number | null;
  alive: boolean;
}

// --- marketing-latest.json ----------------------------------------------------
// Written by ~/.claude/skills/metrics-pull/scripts/marketing_context.py after
// every pull. It is the single source of truth for verdicts, pacing and flags —
// the console only renders; it never recomputes a threshold.
export type Verdict = "green" | "amber" | "red" | "na";
export type CampaignVerdict = "SCALE" | "WATCH" | "FIX" | "KILL" | "NA";
export type PullStatus = "ok" | "partial" | "stale" | "error" | "skipped" | "mock";

export interface Targets {
  currency: string;
  breakeven_roas: number;
  target_roas: number;
  target_cpa: number;
  max_cpa: number;
  target_cpl: number;
  monthly_ad_budget: number;
  max_frequency: number;
  min_ctr: number;
  aeo_min_score: number;
  ig_posts_per_week: number;
  ig_min_er_pct: number;
}

export interface Campaign {
  campaign: string;
  campaign_id: string | null;
  account_id?: string;
  spend: number;
  revenue?: number;
  results?: number;
  purchases?: number;
  leads?: number;
  roas: number | null;
  cpa: number | null;
  cpl?: number | null;
  ctr: number | null;
  cpm?: number | null;
  frequency?: number | null;
  spend_share?: number;
  verdict: CampaignVerdict;
  reasons: string[];
}

export interface ChannelWindow {
  days: number;
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  note?: string;
}

export interface PaidTotals {
  spend: number;
  revenue?: number;
  results?: number;
  purchases?: number;
  leads?: number;
  roas: number | null;
  cpa: number | null;
  cpl?: number | null;
  ctr: number | null;
  cpm?: number | null;
  cpc?: number | null;
  frequency?: number | null;
  impressions?: number;
  clicks?: number;
  impression_share?: number | null;
}

export interface PaidChannel {
  status: PullStatus;
  ts: string | null;
  error: string;
  accounts_ok?: number;
  accounts_total?: number;
  currency: string | null;
  window: ChannelWindow | null;
  totals: PaidTotals | null;
  prev_totals: PaidTotals | null;
  deltas: Record<string, number | null>;
  verdicts: Record<string, Verdict>;
  spark: Record<string, (number | null)[]>;
  campaigns: Campaign[];
  flags: MarketingFlag[];
}

export interface SeoTotals {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface SeoChannel {
  status: PullStatus;
  ts: string | null;
  error: string;
  property: string | null;
  window: ChannelWindow | null;
  totals: SeoTotals | null;
  prev_totals: SeoTotals | null;
  deltas: Record<string, number | null>;
  spark: Record<string, (number | null)[]>;
  top_queries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  striking_distance: { query: string; clicks: number; impressions: number; position: number }[];
}

export interface AeoSnapshot {
  status: PullStatus;
  ts?: string;
  domain?: string;
  score: number | null;
  min_score?: number;
  verdict?: Verdict;
  ai_bots_allowed?: number;
  ai_bots_total?: number;
  llms_txt?: boolean;
  faq_schema?: boolean;
  org_schema?: boolean;
  sitemap?: boolean;
}

export interface InstagramSnapshot {
  status: PullStatus;
  ts?: string;
  handle?: string;
  followers?: number;
  er_pct?: number | null;
  cadence_per_week?: number | null;
  format_mix?: Record<string, number>;
  verdicts?: { er: Verdict; cadence: Verdict };
}

/** Contribution after ad spend, computed in marketing_context.py (never in TS). */
export interface Economics {
  gross_profit: number;
  contribution: number;
  gross_margin_pct: number;
  margin_pct: number | null;
  per_day: number | null;
  verdict: Verdict;
}

export interface Pacing {
  month: string;
  month_label: string;
  day: number;
  days_in_month: number;
  elapsed_days: number;
  spend_mtd: number;
  revenue_mtd: number;
  estimated: boolean;
  budget: number;
  expected_mtd: number;
  pace_pct: number | null;
  projected_eom: number;
  status: "over" | "under" | "on";
  blended_roas_mtd: number | null;
  breakeven_roas: number;
  /** added 2026-09-03 — absent in contexts written by an older pull */
  days_left?: number;
  contribution_mtd?: number | null;
  projected_revenue_eom?: number;
  projected_contribution_eom?: number | null;
}

export interface MarketingFlag {
  level: "red" | "amber" | "info";
  code: string;
  text: string;
  channel?: string;
}

export interface PullSource {
  source: string;
  status: PullStatus;
  ts: string | null;
  age_s: number | null;
  error: string;
  core: boolean;
}

export interface PullHealth {
  max_age_s?: number;
  sources: PullSource[];
  overall: "fresh" | "partial" | "stale" | "unknown";
  newest_age_s: number | null;
}

export interface Blended {
  channels: string[];
  currency: string;
  mixed_currency: boolean;
  totals: PaidTotals;
  prev_totals: PaidTotals | null;
  deltas: Record<string, number | null>;
  verdicts: Record<string, Verdict>;
  mix: Record<string, number>;
  economics?: Economics | null;
}

export interface Marketing {
  generated_at: string;
  range_days: number;
  currency: string;
  targets: Targets;
  blended: Blended | null;
  channels: { meta: PaidChannel; google: PaidChannel; seo: SeoChannel };
  aeo: AeoSnapshot;
  instagram: InstagramSnapshot;
  pacing: Pacing;
  flags: MarketingFlag[];
  pull: PullHealth;
  latest_reports: Record<string, string>;
}

/** A run whose deliverable is something the user can open — the Shipped panel. */
export interface ShippedEntry {
  id: string;
  skill: string;
  label: string | null;
  link: string | null;
  deliverable_path: string;
  ts: string | null;
}

export interface DailyNote {
  date: string;
  isToday: boolean;
  top3: { text: string; done: boolean }[];
  schedule: { time: string; item: string }[];
  focus: string;
}

export interface VaultState {
  generated_at: string;
  vault_root: string;
  metrics: Metric[];
  runner: RunnerStatus | null;
  daily: DailyNote | null;
  runs: RunEntry[];
  queue: QueueEntry[];
  morning: MorningReport | null;
  etas: Record<string, number>; // skill → median duration_s of past ok runs
  /** marketing-latest.json — null until the first metrics pull has run */
  marketing: Marketing | null;
  shipped: ShippedEntry[];
  /** skills /api/queue accepts right now — the deck greys out the rest */
  allowed_skills: string[];
  /** streaks / quests / momentum / records — null only if the engine failed */
  engagement: Engagement | null;
}

const HISTORY_CAP = 24;

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function safeJson<T>(p: string): T | null {
  const raw = safeRead(p);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- metrics.csv ------------------------------------------------------------
// schema: timestamp,source,metric,value,status,error  (append-only)
export function readMetrics(): Metric[] {
  const raw = safeRead(path.join(VAULT_ROOT, "system", "metrics", "metrics.csv"));
  if (!raw) return [];

  const byKey = new Map<string, { source: string; metric: string; points: MetricPoint[] }>();

  const lines = raw.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 5) continue;
    const [timestamp, source, metric, valueStr, status] = cols;
    const value = parseFloat(valueStr);
    if (Number.isNaN(value)) continue;
    const key = `${source}:${metric}`;
    if (!byKey.has(key)) byKey.set(key, { source, metric, points: [] });
    const bucket = byKey.get(key)!;
    bucket.points.push({ timestamp, value, status });
    if (bucket.points.length > HISTORY_CAP * 4) bucket.points.splice(0, bucket.points.length - HISTORY_CAP * 4);
  }

  const out: Metric[] = [];
  for (const { source, metric, points } of byKey.values()) {
    const history = points.slice(-HISTORY_CAP);
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;
    // weekly delta needs enough window to mean something (≥6 pulls ≈ 1.5 days)
    const oldest = history.length >= 6 ? history[0] : null;
    out.push({
      source,
      metric,
      value: latest.value,
      status: latest.status,
      timestamp: latest.timestamp,
      history,
      delta: prev ? latest.value - prev.value : null,
      deltaWeek: oldest ? latest.value - oldest.value : null,
    });
  }
  return out;
}

// --- runner-status.json -------------------------------------------------------
export function readRunnerStatus(): RunnerStatus | null {
  const j = safeJson<Record<string, unknown>>(path.join(VAULT_ROOT, "system", "runner-status.json"));
  if (!j) return null;
  const ts = String(j.ts ?? "");
  let age: number | null = null;
  const parsed = Date.parse(ts);
  if (!Number.isNaN(parsed)) age = Math.round((Date.now() - parsed) / 1000);
  return {
    ts,
    pid: Number(j.pid ?? 0),
    version: String(j.version ?? "?"),
    busy: Boolean(j.busy),
    active: Number(j.active ?? 0),
    max_concurrent: Number(j.max_concurrent ?? 0),
    pending: Number(j.pending ?? 0),
    heartbeat_age_s: age,
    alive: age !== null && age < 120, // heartbeat every ~30s; 2min = dead
  };
}

// --- marketing-latest.json ------------------------------------------------------
// Trust-but-shape: the file is produced by our own script, so we only guard the
// top-level keys the panels destructure; a half-written file yields null and the
// panels fall back to their "waiting on data" states.
export function readMarketing(): Marketing | null {
  const j = safeJson<Marketing>(path.join(VAULT_ROOT, "system", "metrics", "marketing-latest.json"));
  if (!j || !j.targets || !j.channels || !j.pacing || !j.pull) return null;
  return {
    ...j,
    pull: currentPullHealth(j.pull),
    flags: Array.isArray(j.flags) ? j.flags : [],
    latest_reports: j.latest_reports ?? {},
    channels: {
      meta: j.channels.meta ?? emptyPaid(),
      google: j.channels.google ?? emptyPaid(),
      seo: j.channels.seo ?? emptySeo(),
    },
    aeo: j.aeo ?? { status: "skipped", score: null },
    instagram: j.instagram ?? { status: "skipped" },
  };
}

function emptyPaid(): PaidChannel {
  return { status: "skipped", ts: null, error: "", currency: null, window: null, totals: null,
    prev_totals: null, deltas: {}, verdicts: {}, spark: {}, campaigns: [], flags: [] };
}
function emptySeo(): SeoChannel {
  return { status: "skipped", ts: null, error: "", property: null, window: null, totals: null,
    prev_totals: null, deltas: {}, spark: {}, top_queries: [], striking_distance: [] };
}

// Shipped = ok runs with something to open, newest first, deduped by target.
export function shippedFrom(runs: RunEntry[], limit = 6): ShippedEntry[] {
  const seen = new Set<string>();
  const out: ShippedEntry[] = [];
  for (const r of runs) {
    if (r.status !== "ok" || !r.deliverable_path) continue;
    const key = r.link ?? r.deliverable_path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.id, skill: r.skill, label: r.label, link: r.link,
      deliverable_path: r.deliverable_path, ts: r.ts_completed });
    if (out.length >= limit) break;
  }
  return out;
}

// --- system/runs/*.json --------------------------------------------------------
// short topic tag for a voice-ask — every ask shows as "voice ask" otherwise,
// which is useless when two are in flight ("fable 5 news" vs "gmail thing").
// First 3 content words of the prompt.
const ASK_STOP = new Set([
  "a", "an", "the", "me", "my", "i", "you", "your", "please", "jarvis", "argus", "hey",
  "ok", "okay", "can", "could", "would", "tell", "about", "like", "little",
  "bit", "more", "just", "that", "this", "what", "whats", "is", "are", "do",
  "does", "of", "for", "to", "in", "on", "and", "or", "so", "um", "uh",
  "once", "when", "after", "with", "go", "run", "really", "actually", "know",
  "want", "wanted", "give", "get", "out", "up", "some", "any", "how",
  "ahead", "also", "then", "now", "again", "came", "thing", "things", "stuff",
]);
function askLabel(args: unknown): string | null {
  const prompt = (args as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string") return null;
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ASK_STOP.has(w));
  return words.length ? words.slice(0, 3).join(" ") : null;
}

// peek a deliverable's frontmatter for `link: <url>` — when present, the
// run's real output lives at that URL and callouts open it instead of the md
function deliverableLink(relPath: unknown): string | null {
  if (typeof relPath !== "string" || !relPath) return null;
  // same guard as readVaultMarkdown — deliverable_path comes from runner-written
  // run JSON, and runs process untrusted content (emails, web); never follow it
  // outside the dirs runs write to
  const clean = relPath.replace(/\\/g, "/");
  if (!READABLE_PREFIXES.some((p) => clean.startsWith(p))) return null;
  const abs = path.resolve(VAULT_ROOT, clean);
  if (!abs.startsWith(path.resolve(VAULT_ROOT) + path.sep)) return null;
  try {
    const raw = fs.readFileSync(abs, "utf-8").slice(0, 800);
    if (!raw.startsWith("---")) return null;
    const fm = raw.split(/\r?\n---/)[0];
    const m = fm.match(/^link:\s*["']?(https?:\/\/\S+?)["']?\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function readRecentRuns(limit = 8): RunEntry[] {
  const dir = path.join(VAULT_ROOT, "system", "runs");
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, limit);
  } catch {
    return [];
  }
  const out: RunEntry[] = [];
  for (const f of files) {
    const j = safeJson<Record<string, unknown>>(f);
    if (!j) continue;
    const started = j.ts_started ? Date.parse(String(j.ts_started)) : NaN;
    const completed = j.ts_completed ? Date.parse(String(j.ts_completed)) : NaN;
    const duration =
      !Number.isNaN(started) && !Number.isNaN(completed)
        ? Math.max(0, Math.round((completed - started) / 1000))
        : null;
    out.push({
      id: String(j.id ?? path.basename(f, ".json")),
      skill: String(j.skill ?? "?"),
      label: String(j.skill) === "voice-ask" ? askLabel(j.args) : null,
      link: String(j.status) === "ok" ? deliverableLink(j.deliverable_path) : null,
      status: String(j.status ?? "?"),
      summary: String(j.summary ?? ""),
      ts_completed: j.ts_completed ? String(j.ts_completed) : null,
      ts_started: j.ts_started ? String(j.ts_started) : null,
      duration_s: duration,
      deliverable_path: j.deliverable_path ? String(j.deliverable_path) : null,
    });
  }
  return out;
}

// median past runtime per skill — feeds the task callout's progress estimate.
// Only ok runs count (errors die early and would drag the estimate down).
export function readSkillEtas(): Record<string, number> {
  const dir = path.join(VAULT_ROOT, "system", "runs");
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 200);
  } catch {
    return {};
  }
  const bySkill: Record<string, number[]> = {};
  for (const f of files) {
    const j = safeJson<Record<string, unknown>>(f);
    if (!j || j.status !== "ok") continue;
    const started = j.ts_started ? Date.parse(String(j.ts_started)) : NaN;
    const completed = j.ts_completed ? Date.parse(String(j.ts_completed)) : NaN;
    if (Number.isNaN(started) || Number.isNaN(completed)) continue;
    const d = Math.max(1, Math.round((completed - started) / 1000));
    (bySkill[String(j.skill ?? "?")] ??= []).push(d);
  }
  const out: Record<string, number> = {};
  for (const [skill, ds] of Object.entries(bySkill)) {
    ds.sort((a, b) => a - b);
    out[skill] = ds[Math.floor(ds.length / 2)];
  }
  return out;
}

// --- system/queue/*.json — intents waiting for the runner ----------------------
export function readQueue(): QueueEntry[] {
  const dir = path.join(VAULT_ROOT, "system", "queue");
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  } catch {
    return [];
  }
  const out: QueueEntry[] = [];
  for (const f of files) {
    const j = safeJson<Record<string, unknown>>(f);
    if (!j) continue;
    out.push({
      id: String(j.id ?? path.basename(f, ".json")),
      skill: String(j.skill ?? "?"),
      label: String(j.skill) === "voice-ask" ? askLabel(j.args) : null,
      ts: String(j.ts ?? ""),
    });
  }
  return out;
}

// --- daily note -----------------------------------------------------------------
// Today's note if present, else the most recent. Parser contract: frozen v1
// schema — `## Top 3 Priorities` numbered checkboxes + `## Schedule` bullets.
export function readDailyNote(): DailyNote | null {
  const dir = path.join(VAULT_ROOT, "daily-notes");
  // local (CONSOLE_TZ) date — toISOString() is UTC and flips to
  // tomorrow after ~7pm CT, which made evening sessions claim today's
  // note didn't exist (same fix as runner.js todayDate())
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(
    new Date()
  );
  let file = path.join(dir, `${today}.md`);
  let isToday = true;
  let date = today;

  if (!fs.existsSync(file)) {
    isToday = false;
    let names: string[];
    try {
      names = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse();
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    file = path.join(dir, names[0]);
    date = names[0].replace(".md", "");
  }

  const raw = safeRead(file);
  if (!raw) return null;

  const top3: { text: string; done: boolean }[] = [];
  const schedule: { time: string; item: string }[] = [];
  let focus = "";

  let section = "";
  for (const line of raw.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    if (section === "Top 3 Priorities") {
      const m = line.match(/^\d+\.\s+\[( |x)\]\s+(.*)/);
      if (m) top3.push({ text: m[2].trim(), done: m[1] === "x" });
    } else if (section === "Schedule") {
      const m = line.match(/^-\s+(\d{1,2}:\d{2})\s*[—–-]+\s*(.*)/);
      if (m) schedule.push({ time: m[1], item: m[2].trim() });
    } else if (section === "Current Focus") {
      if (line.trim() && !focus) focus = line.trim();
    }
  }

  return { date, isToday, top3, schedule, focus };
}

// --- daily note write — flip a Top 3 checkbox -----------------------------------
// Only today's note is writable (stale notes are history). Index = nth
// checkbox under `## Top 3 Priorities`, matching the parser above.
export function toggleTop3(index: number, done: boolean): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(
    new Date()
  );
  const file = path.join(VAULT_ROOT, "daily-notes", `${today}.md`);
  const raw = safeRead(file);
  if (!raw) return false;

  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  let section = "";
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.*)/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    if (section !== "Top 3 Priorities") continue;
    const m = lines[i].match(/^(\d+\.\s+)\[( |x)\](\s+.*)/);
    if (!m) continue;
    seen++;
    if (seen === index) {
      lines[i] = `${m[1]}[${done ? "x" : " "}]${m[3]}`;
      fs.writeFileSync(file, lines.join(eol), "utf-8");
      return true;
    }
  }
  return false;
}

// --- read a vault markdown deliverable (report overlay) ---------------------------
// Path must stay inside the vault and under the dirs runs write to (plus the
// generated ops/ dashboard and daily notes, which the console opens read-only).
const READABLE_PREFIXES = ["inbox/", "system/runs/", "ops/", "daily-notes/"];

export function readVaultMarkdown(rel: string): string | null {
  const clean = rel.replace(/\\/g, "/");
  if (!clean.endsWith(".md")) return null;
  if (!READABLE_PREFIXES.some((p) => clean.startsWith(p))) return null;
  const abs = path.resolve(VAULT_ROOT, clean);
  if (!abs.startsWith(path.resolve(VAULT_ROOT) + path.sep)) return null; // no traversal
  return safeRead(abs);
}

// --- generated deck artifacts (html/pptx/png) — served by /api/file ----------------
const FILE_PREFIXES = ["inbox/reports/decks/"];
const FILE_EXTS = new Set(["html", "pptx", "png"]);

export function readVaultFile(rel: string): { buf: Buffer; ext: string } | null {
  const clean = rel.replace(/\\/g, "/");
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  if (!FILE_EXTS.has(ext)) return null;
  if (!FILE_PREFIXES.some((p) => clean.startsWith(p))) return null;
  const abs = path.resolve(VAULT_ROOT, clean);
  if (!abs.startsWith(path.resolve(VAULT_ROOT) + path.sep)) return null; // no traversal
  try {
    return { buf: fs.readFileSync(abs), ext };
  } catch {
    return null;
  }
}

// --- today's morning report headlines ---------------------------------------------
// `## Headlines` bullets, markdown stripped — feeds the AI Wire panel and the
// spoken briefing (lib/router.ts). rel = vault-relative path for the overlay.
export interface MorningReport {
  rel: string;
  heads: string[];
  /** first source URL per headline (parallel to heads; null = no link) */
  links: (string | null)[];
}

export function readMorningReport(max = 4): MorningReport | null {
  try {
    const dir = path.join(VAULT_ROOT, "inbox", "reports", "morning");
    const prefix = new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(
      new Date()
    );
    const file = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .sort()
      .pop();
    if (!file) return null;
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const heads: string[] = [];
    const links: (string | null)[] = [];
    let inHeads = false;
    for (const line of raw.split(/\r?\n/)) {
      if (/^##\s/.test(line)) {
        if (inHeads) break;
        inHeads = /^##\s+Headlines/i.test(line);
        continue;
      }
      if (inHeads && /^[-*]\s+/.test(line)) {
        // first http(s) URL on the bullet — markdown link or bare
        const url = line.match(/https?:\/\/[^\s)\]"']+/)?.[0] ?? null;
        const clean = line
          .replace(/^[-*]\s+/, "")
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
          .replace(/https?:\/\/[^\s)\]"']+/g, "")
          .replace(/[*_`]/g, "")
          .trim();
        if (clean) {
          heads.push(clean.slice(0, 160));
          links.push(url);
        }
        if (heads.length >= max) break;
      }
    }
    return { rel: `inbox/reports/morning/${file}`, heads, links };
  } catch {
    return null;
  }
}

// --- consolidated snapshot --------------------------------------------------------
export function readVaultState(): VaultState {
  const runs = readRecentRuns();
  const metrics = readMetrics();
  return {
    generated_at: new Date().toISOString(),
    vault_root: VAULT_ROOT,
    metrics,
    runner: readRunnerStatus(),
    daily: readDailyNote(),
    runs,
    queue: readQueue(),
    morning: readMorningReport(),
    etas: readSkillEtas(),
    marketing: readMarketing(),
    shipped: shippedFrom(runs),
    allowed_skills: [...ALLOWED_SKILLS],
    engagement: readEngagement(metrics),
  };
}
