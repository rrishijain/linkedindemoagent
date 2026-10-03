import fs from "fs";
import path from "path";
import { VAULT_ROOT, CONSOLE_TZ } from "./config";
import type { Metric } from "./vault";

// ---------------------------------------------------------------------------
// Engagement engine — streaks, quests, momentum, records. Pure console-domain
// gamification over files the vault already writes: system/runs/*.json,
// system/publish-ledger.json, daily-notes/*.md frontmatter + Daily Drivers,
// system/metrics/history/meta-daily.csv.
//
// BOUNDARY (CLAUDE.md): marketing verdicts/pacing/thresholds live in
// marketing_context.py — nothing here judges a marketing number against a
// target. best_cpl_day is raw min() arithmetic; if a "good CPL" threshold is
// ever wanted, it goes to Python, not here.
//
// Called from readVaultState() on every 5s poll, so every file is behind a
// per-file mtime memo: steady state is a readdir + stat sweep, zero reads
// (run JSONs are immutable once terminal; the runner rewrites them in place
// on completion, which is why the memo keys on file mtime, not dir mtime).
// ---------------------------------------------------------------------------

export interface StreakState {
  current: number;
  best: number;
  todayFilled: boolean;
  /** evening (>= ATRISK_HOUR local) with a live chain and today unfilled */
  atRisk: boolean;
  /** oldest → newest, index 6 = today — the dot matrix */
  last7: boolean[];
}

export interface Streaks {
  ship: StreakState; // ≥1 ok run OR ≥1 live publish that day
  close: StreakState; // daily note closed (/close-day wrote effort)
  perfect: StreakState; // closed + all top3 + all Daily Drivers
}

export interface QuestItem {
  label: string;
  done: boolean;
}

export interface Quests {
  top3: { done: number; goal: number };
  drivers: { items: QuestItem[]; done: number; goal: number };
  publishes: {
    blog: { done: number; goal: number };
    carousel: { done: number; goal: number };
  };
  /** all top3 done (≥1 real item) AND all drivers done — the tier-B moment */
  allComplete: boolean;
}

export interface Momentum {
  /** 0–1000, 14-day exponentially-decayed activity × streak multiplier */
  score: number;
  /** today's raw points before decay */
  today: number;
}

export type RecordId =
  | "most_runs_day"
  | "best_revenue_day"
  | "longest_ship_streak"
  | "ig_followers"
  | "yt_subscribers";

export interface RecordEntry {
  id: RecordId;
  label: string;
  value: number;
  unit: string;
  /** the day the record was set (data date) */
  date: string;
  /** today's figure for the same measure, when meaningful */
  today: number | null;
  /** within reach of the record today — the near-miss line */
  nearMiss: boolean;
  /** record was broken today (first noticed today) — the tier-C moment */
  brokenToday: boolean;
}

export interface Engagement {
  /** CONSOLE_TZ day this snapshot describes — the client's rollover guard */
  date: string;
  streaks: Streaks;
  quests: Quests;
  momentum: Momentum;
  records: RecordEntry[];
  today: { runs_ok: number; runs_err: number; blog: number; carousel: number };
}

const ATRISK_HOUR = 20; // 8pm local — "your chain dies tonight"
const DAY_MS = 86_400_000;
const RECORDS_FILE = path.join(VAULT_ROOT, "system", "engagement-records.json");

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ });
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: CONSOLE_TZ,
  hour: "2-digit",
  hourCycle: "h23",
});

function localDay(d: Date): string {
  return DAY_FMT.format(d);
}

/** day arithmetic on YYYY-MM-DD strings — TZ-free (anchored at UTC noon) */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// mtime-memoized readers
// ---------------------------------------------------------------------------

interface RunFacts {
  day: string | null; // completion day in CONSOLE_TZ
  ok: boolean;
  terminal: boolean;
}
const runCache = new Map<string, { mtime: number; facts: RunFacts | null }>();

function readRunFacts(): RunFacts[] {
  const dir = path.join(VAULT_ROOT, "system", "runs");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const live = new Set<string>();
  const out: RunFacts[] = [];
  for (const name of names) {
    live.add(name);
    const p = path.join(dir, name);
    let mtime: number;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      continue;
    }
    let entry = runCache.get(name);
    if (!entry || entry.mtime !== mtime) {
      let facts: RunFacts | null = null;
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
        const status = String(j.status ?? "");
        const done = j.ts_completed ? Date.parse(String(j.ts_completed)) : NaN;
        facts = {
          day: Number.isNaN(done) ? null : localDay(new Date(done)),
          ok: status === "ok",
          terminal: status === "ok" || status === "error",
        };
      } catch {
        facts = null;
      }
      entry = { mtime, facts };
      runCache.set(name, entry);
    }
    if (entry.facts) out.push(entry.facts);
  }
  // a pruned/renamed file must not haunt the streaks
  if (runCache.size > live.size) {
    for (const k of runCache.keys()) if (!live.has(k)) runCache.delete(k);
  }
  return out;
}

interface DayFacts {
  effort: number | null;
  top3: { done: number; total: number };
  drivers: QuestItem[];
}
const noteCache = new Map<string, { mtime: number; facts: DayFacts | null }>();

// Hand-rolled reader for what readDailyNote() deliberately ignores: the
// frontmatter (effort) and the Daily Drivers checkboxes. Kept separate —
// readDailyNote's v1 body contract serves display; this serves history.
function parseDayFacts(raw: string): DayFacts {
  let effort: number | null = null;
  if (raw.startsWith("---")) {
    const fm = raw.slice(3).split(/\r?\n---/)[0];
    const m = fm.match(/^effort:\s*(\d+)\s*$/m);
    if (m) effort = parseInt(m[1], 10);
  }
  const top3 = { done: 0, total: 0 };
  const drivers: QuestItem[] = [];
  let section = "";
  for (const line of raw.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    if (section === "Top 3 Priorities") {
      const m = line.match(/^\d+\.\s+\[( |x)\]\s+(.*)/);
      if (m && m[2].trim()) {
        top3.total++;
        if (m[1] === "x") top3.done++;
      }
    } else if (section === "Daily Drivers") {
      const m = line.match(/^-\s+\[( |x)\]\s+(.*)/);
      if (m && m[2].trim()) drivers.push({ label: m[2].trim(), done: m[1] === "x" });
    }
  }
  return { effort, top3, drivers };
}

function readNoteFacts(): Map<string, DayFacts> {
  const dir = path.join(VAULT_ROOT, "daily-notes");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  } catch {
    return new Map();
  }
  const out = new Map<string, DayFacts>();
  for (const name of names) {
    const p = path.join(dir, name);
    let mtime: number;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      continue;
    }
    let entry = noteCache.get(name);
    if (!entry || entry.mtime !== mtime) {
      let facts: DayFacts | null = null;
      try {
        facts = parseDayFacts(fs.readFileSync(p, "utf-8"));
      } catch {
        facts = null;
      }
      entry = { mtime, facts };
      noteCache.set(name, entry);
    }
    if (entry.facts) out.set(name.replace(".md", ""), entry.facts);
  }
  return out;
}

let ledgerCache: { mtime: number; days: Map<string, { blog: number; carousel: number }> } | null =
  null;

// Mirrors publishedToday() in runner/runner.js — same Date parse, same
// formatter, so the console's cap chips can never disagree with the enforcer.
function readLedgerDays(): Map<string, { blog: number; carousel: number }> {
  const p = path.join(VAULT_ROOT, "system", "publish-ledger.json");
  let mtime: number;
  try {
    mtime = fs.statSync(p).mtimeMs;
  } catch {
    return new Map();
  }
  if (ledgerCache && ledgerCache.mtime === mtime) return ledgerCache.days;
  const days = new Map<string, { blog: number; carousel: number }>();
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      entries?: { kind?: string; ts?: string; dry_run?: boolean }[];
    };
    for (const e of j.entries ?? []) {
      if (e.dry_run || !e.ts) continue;
      const day = localDay(new Date(e.ts));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const d = days.get(day) ?? { blog: 0, carousel: 0 };
      if (e.kind === "blog") d.blog++;
      else if (e.kind === "news-carousel") d.carousel++;
      days.set(day, d);
    }
  } catch {
    return new Map();
  }
  ledgerCache = { mtime, days };
  return days;
}

let revenueCache: { mtime: number; byDay: Map<string, number> } | null = null;

/** daily blended ad revenue from history/meta-daily.csv — a raw sum only;
 *  verdicts about it stay in marketing_context.py */
function readDailyRevenue(): Map<string, number> {
  const p = path.join(VAULT_ROOT, "system", "metrics", "history", "meta-daily.csv");
  let mtime: number;
  try {
    mtime = fs.statSync(p).mtimeMs;
  } catch {
    return new Map();
  }
  if (revenueCache && revenueCache.mtime === mtime) return revenueCache.byDay;
  const byDay = new Map<string, number>();
  try {
    const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 13) continue;
      // campaign names are unquoted — index numeric columns from the END so a
      // stray comma in a name can't shift them (8 fixed cols after campaign)
      const date = cols[0];
      const revenue = parseFloat(cols[cols.length - 2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(revenue)) continue;
      byDay.set(date, (byDay.get(date) ?? 0) + revenue);
    }
  } catch {
    return new Map();
  }
  revenueCache = { mtime, byDay };
  return byDay;
}

// ---------------------------------------------------------------------------
// records — persisted bests. Live recompute is not durable (meta-daily.csv is
// a 90-day window, vault-cleanup archives old daily notes), so a best is
// written down the poll it is first seen. Single writer: this Next server
// process (the runner never touches this file). `seen` = the CONSOLE_TZ day the
// record was noticed — brokenToday survives reloads because it compares
// against the store, not client state.
// ---------------------------------------------------------------------------

interface StoredBest {
  value: number;
  date: string;
  seen: string;
}
interface RecordsStore {
  updated_at: string;
  best: Partial<Record<RecordId, StoredBest>>;
}

function readRecordsStore(): RecordsStore | null {
  try {
    return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8")) as RecordsStore;
  } catch {
    return null;
  }
}

function writeRecordsStore(store: RecordsStore): void {
  try {
    const tmp = `${RECORDS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, RECORDS_FILE);
  } catch {
    // read-only vault — records simply stay live-computed this session
  }
}

// ---------------------------------------------------------------------------
// streak math
// ---------------------------------------------------------------------------

function buildStreak(filled: Set<string>, today: string, evening: boolean): StreakState {
  let current = 0;
  // an unbroken run ending yesterday is still alive today — that grace window
  // is exactly what atRisk warns about
  let d = filled.has(today) ? today : addDays(today, -1);
  while (filled.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  const sorted = [...filled].sort();
  let run = 0;
  let prev = "";
  for (const day of sorted) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  const todayFilled = filled.has(today);
  return {
    current,
    best,
    todayFilled,
    atRisk: evening && !todayFilled && current > 0,
    last7: Array.from({ length: 7 }, (_, i) => filled.has(addDays(today, i - 6))),
  };
}

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

export function readEngagement(metrics: Metric[]): Engagement | null {
  try {
    return computeEngagement(metrics);
  } catch {
    return null;
  }
}

function computeEngagement(metrics: Metric[]): Engagement {
  const now = new Date();
  const today = localDay(now);
  const evening = parseInt(HOUR_FMT.format(now), 10) >= ATRISK_HOUR;

  const runs = readRunFacts();
  const notes = readNoteFacts();
  const ledger = readLedgerDays();

  // per-day rollups
  const okRunsByDay = new Map<string, number>();
  let runsErrToday = 0;
  for (const r of runs) {
    if (!r.day || !r.terminal) continue;
    if (r.ok) okRunsByDay.set(r.day, (okRunsByDay.get(r.day) ?? 0) + 1);
    else if (r.day === today) runsErrToday++;
  }

  // --- streaks -------------------------------------------------------------
  const shipDays = new Set<string>(okRunsByDay.keys());
  for (const [day, d] of ledger) if (d.blog + d.carousel > 0) shipDays.add(day);

  const closeDays = new Set<string>();
  const perfectDays = new Set<string>();
  for (const [day, f] of notes) {
    if (f.effort === null) continue;
    closeDays.add(day);
    const driversDone = f.drivers.length > 0 && f.drivers.every((x) => x.done);
    const top3Done = f.top3.total > 0 && f.top3.done === f.top3.total;
    if (driversDone && top3Done) perfectDays.add(day);
  }

  const streaks: Streaks = {
    ship: buildStreak(shipDays, today, evening),
    close: buildStreak(closeDays, today, evening),
    perfect: buildStreak(perfectDays, today, evening),
  };

  // --- quests --------------------------------------------------------------
  const todayNote = notes.get(today) ?? null;
  const todayLedger = ledger.get(today) ?? { blog: 0, carousel: 0 };
  const top3 = todayNote?.top3 ?? { done: 0, total: 0 };
  const drivers = todayNote?.drivers ?? [];
  const driversDone = drivers.filter((x) => x.done).length;
  const quests: Quests = {
    top3: { done: top3.done, goal: Math.max(3, top3.total) },
    drivers: { items: drivers, done: driversDone, goal: drivers.length },
    // caps mirror DAILY_CAP in runner/runner.js
    publishes: {
      blog: { done: todayLedger.blog, goal: 2 },
      carousel: { done: todayLedger.carousel, goal: 1 },
    },
    allComplete:
      top3.total > 0 &&
      top3.done === top3.total &&
      drivers.length > 0 &&
      driversDone === drivers.length,
  };

  // --- momentum ------------------------------------------------------------
  // 14-day exponential window IS the weekly decay — idempotent, nothing stored
  let sum = 0;
  let todayRaw = 0;
  for (let d = 0; d < 14; d++) {
    const day = addDays(today, -d);
    const f = notes.get(day);
    const l = ledger.get(day) ?? { blog: 0, carousel: 0 };
    const raw =
      Math.min(okRunsByDay.get(day) ?? 0, 5) * 10 +
      l.blog * 60 +
      l.carousel * 40 +
      (f?.effort ?? 0) * 8 +
      (f?.top3.done ?? 0) * 15 +
      (f ? f.drivers.filter((x) => x.done).length : 0) * 10;
    if (d === 0) todayRaw = raw;
    sum += raw * Math.pow(0.85, d);
  }
  const momentum: Momentum = {
    score: Math.min(1000, Math.round(sum * (1 + Math.min(streaks.ship.current, 10) * 0.03))),
    today: todayRaw,
  };

  // --- records -------------------------------------------------------------
  const records = buildRecords({ okRunsByDay, streaks, metrics, today });

  return {
    date: today,
    streaks,
    quests,
    momentum,
    records,
    today: {
      runs_ok: okRunsByDay.get(today) ?? 0,
      runs_err: runsErrToday,
      blog: todayLedger.blog,
      carousel: todayLedger.carousel,
    },
  };
}

/** milestone step for follower/subscriber counts — round numbers scale with size */
function milestoneStep(v: number): number {
  return v >= 100_000 ? 5000 : v >= 10_000 ? 1000 : 500;
}

function buildRecords(ctx: {
  okRunsByDay: Map<string, number>;
  streaks: Streaks;
  metrics: Metric[];
  today: string;
}): RecordEntry[] {
  const { okRunsByDay, streaks, metrics, today } = ctx;
  const store = readRecordsStore();
  // first sight of the system: seed silently (seen: "") — installing the
  // engagement layer must not fire five NEW RECORD moments
  const seeding = store === null;
  const best: RecordsStore["best"] = store?.best ?? {};
  let dirty = seeding;

  // candidate = current value for each measure; higherBetter drives comparison
  const metric = (src: string, name: string) =>
    metrics.find((m) => m.source === src && m.metric === name) ?? null;
  const runsToday = okRunsByDay.get(today) ?? 0;
  let runsBestDay = "";
  let runsBestVal = 0;
  for (const [day, n] of okRunsByDay) {
    if (n > runsBestVal || (n === runsBestVal && day > runsBestDay)) {
      runsBestVal = n;
      runsBestDay = day;
    }
  }
  const revByDay = readDailyRevenue();
  let revBestDay = "";
  let revBestVal = 0;
  for (const [day, v] of revByDay) {
    if (day >= today) continue; // today's row is partial — complete days only
    if (v > revBestVal) {
      revBestVal = v;
      revBestDay = day;
    }
  }
  const ig = metric("instagram", "followers");
  const yt = metric("youtube", "subscribers");

  interface Candidate {
    id: RecordId;
    label: string;
    unit: string;
    value: number | null;
    date: string;
    today: number | null;
    /** count-like measures get the "N short of the record" near-miss line */
    countLike: boolean;
    milestone?: boolean; // followers celebrate on round-step crossings only
  }
  const candidates: Candidate[] = [
    {
      id: "most_runs_day",
      label: "most runs in a day",
      unit: "runs",
      value: runsBestVal > 0 ? runsBestVal : null,
      date: runsBestDay,
      today: runsToday,
      countLike: true,
    },
    {
      id: "best_revenue_day",
      label: "best revenue day",
      unit: "₹",
      value: revBestVal > 0 ? Math.round(revBestVal) : null,
      date: revBestDay,
      today: revByDay.get(today) != null ? Math.round(revByDay.get(today)!) : null,
      countLike: false,
    },
    {
      id: "longest_ship_streak",
      label: "longest ship chain",
      unit: "days",
      value: streaks.ship.best > 0 ? streaks.ship.best : null,
      date: today,
      today: streaks.ship.current,
      countLike: true,
    },
    {
      id: "ig_followers",
      label: "instagram followers",
      unit: "",
      value: ig ? Math.round(ig.value) : null,
      date: ig ? localDay(new Date(ig.timestamp)) : "",
      today: null,
      countLike: false,
      milestone: true,
    },
    {
      id: "yt_subscribers",
      label: "youtube subscribers",
      unit: "",
      value: yt ? Math.round(yt.value) : null,
      date: yt ? localDay(new Date(yt.timestamp)) : "",
      today: null,
      countLike: false,
      milestone: true,
    },
  ];

  const out: RecordEntry[] = [];
  for (const c of candidates) {
    if (c.value === null) continue;
    const prev = best[c.id];
    const improved = !prev || c.value > prev.value;
    if (improved) {
      // milestones only count when a round step is crossed — +3 followers is
      // drift, not a record
      const crossed =
        !c.milestone ||
        !prev ||
        Math.floor(c.value / milestoneStep(c.value)) >
          Math.floor(prev.value / milestoneStep(c.value));
      if (crossed) {
        // first sight of a measure (fresh store OR a source that just came
        // online) seeds silently — only beating a KNOWN prior celebrates
        best[c.id] = { value: c.value, date: c.date || today, seen: prev ? today : "" };
        dirty = true;
      } else if (prev && c.value !== prev.value) {
        // track drift silently so the next crossing measures from here
        best[c.id] = { ...prev, value: c.value, date: c.date || today };
        dirty = true;
      }
    }
    const b = best[c.id]!;
    const brokenToday = b.seen === today;
    out.push({
      id: c.id,
      label: c.label,
      value: b.value,
      unit: c.unit,
      date: b.date,
      today: c.today,
      brokenToday,
      nearMiss:
        !brokenToday &&
        c.countLike &&
        c.today !== null &&
        c.today > 0 &&
        b.value >= 3 &&
        b.value - c.today <= 2 &&
        b.value - c.today > 0,
    });
  }

  if (dirty) {
    writeRecordsStore({ updated_at: new Date().toISOString(), best });
  }
  return out;
}
