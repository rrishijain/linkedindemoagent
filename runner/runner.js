#!/usr/bin/env node
/**
 * ARGUS Runner — background skill executor for the ARGUS console.
 *
 * Watches `<vault>/system/queue/<uuid>.json`, processes intents, shells
 * `claude -p "<prompt>"`, writes `system/runs/<uuid>.json` + `<uuid>.md`.
 * The console writes intents (buttons + voice); this daemon does the work.
 *
 * Run it: `node runner/runner.js` (or start-runner.vbs hidden at login).
 * Crash-safe: logs uncaught exceptions. No external deps — Node 20+.
 *
 * ADDING A SKILL: add a case to deliverablePathFor() + buildPrompt(), then
 * add the same name to ALLOWED_SKILLS in lib/skills.ts (the console refuses
 * skills it doesn't know). Keep the SPOKEN SUMMARY CONTRACT preamble — the
 * first line of the claude reply is read aloud by the voice layer.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  appendFileSync,
  appendFile,
  renameSync,
  statSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs/promises";
import { creativeBriefContext, creativeGeminiEnvironment } from "./creative-brief.js";

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

// --- Config — env vars first (shell or ~/.claude/.env), then defaults that
// work on a fresh clone (the bundled starter vault next to this folder).
function loadEnvFile() {
  const envPath = join(homedir(), ".claude", ".env");
  if (!existsSync(envPath)) return {};
  const out = {};
  try {
    for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      out[k] = v;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const _env = loadEnvFile();
const env = (k) => process.env[k] || _env[k];

const VAULT_ROOT =
  env("VAULT_ROOT") || env("AGENTIC_OS_VAULT") || join(RUNNER_DIR, "..", "starter-vault");
// MUST match CONSOLE_TZ in lib/config.ts — "today" has to mean the same day in
// both places or daily notes split across two dates near midnight UTC.
const CONSOLE_TZ = env("CONSOLE_TZ") || env("HUD_TZ") || "America/Chicago";
const QUEUE_DIR = join(VAULT_ROOT, "system", "queue");
// Claimed intents live here while a child runs — the atomic rename OUT of
// QUEUE_DIR is the claim, so a second runner (or a restart) can never
// double-execute the same intent. Abandoned files are reconciled at boot.
const PROCESSING_DIR = join(QUEUE_DIR, "processing");
const PENDING_DIR = join(QUEUE_DIR, "pending-approval");
// Invalid or abandoned intents are quarantined here with a .note.txt.
const FAILED_DIR = join(QUEUE_DIR, "failed");
const RUNS_DIR = join(VAULT_ROOT, "system", "runs");
const STATUS_FILE = join(VAULT_ROOT, "system", "runner-status.json");
const RUNNER_LOG = join(RUNNER_DIR, "runner.log");

const IS_WINDOWS = platform() === "win32";
const CLAUDE_BIN = IS_WINDOWS ? "claude.exe" : "claude";
// Pin the model for ALL headless spawns — never inherit the interactive CLI
// default. Defaults to opus for the best skill output; set AGENTIC_OS_MODEL in
// ~/.claude/.env to a cheaper model (claude-sonnet-4-6 / claude-haiku-4-5-...)
// if you'd rather trade quality for cost. Onboarding asks which you want.
const CLAUDE_MODEL = env("AGENTIC_OS_MODEL") || "claude-opus-4-8";
// Per-run override — voice asks may carry args.model ("use opus" spoken in
// the ask). Allowlist only; anything else falls back to CLAUDE_MODEL.
const MODEL_ALLOWLIST = new Set([
  "claude-opus-4-8",
  "claude-fable-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);

// Report args — the queue route and router already whitelist these; the
// runner re-validates because intents can also be dropped into system/queue
// by hand or by launchd (scripts/enqueue-intent.mjs).
const SCOPES = new Set(["meta", "google", "seo", "blended"]);
const RANGES = new Set([7, 30, 90]);
const argScope = (args) => (SCOPES.has(args?.scope) ? args.scope : "blended");
const argRange = (args) => (RANGES.has(Number(args?.range)) ? Number(args.range) : 7);
const CONSOLE_PUBLIC_URL = env("CONSOLE_PUBLIC_URL") || env("HUD_PUBLIC_URL") || "http://localhost:3107";

// --- publishing skills run INSIDE their own Claude Code project -------------
// ds-blog-publish / news-carousel need that project's CLAUDE.md, rules,
// skills and .env, so the runner spawns `claude -p` with cwd = the project
// dir (exactly what happens when Rishi runs them by hand). Deliverables are
// still written into the VAULT by absolute path.
const AGENTS_ROOT =
  env("AGENTS_ROOT") ||
  join(homedir(), "Desktop", "Ai Resources - Most Important", "Ai Agents", "Rendered Ai Agents");
const SKILL_CWD = {
  "ds-blog-publish": env("DS_SEO_AGENT_DIR") || join(AGENTS_ROOT, "ds-seo-agent"),
  // The breaking-AI-news carousel — the only carousel agent ARGUS drives,
  // publishing to @rrishijain from its own node/Gemini pipeline.
  "news-carousel":
    env("NEWS_CAROUSEL_AGENT_DIR") ||
    join(AGENTS_ROOT, "CarouselsAgents", "rrishijainxCarousel-Final"),
  // Competitor X-Ray — Meta-funnel teardown project (BYO Apify/Firecrawl keys;
  // the prompt degrades to connector/web research when keys are absent).
  "competitor-intel":
    env("COMPETITOR_XRAY_DIR") || join(AGENTS_ROOT, "..", "Zip Files", "competitor-xray"),
  // Bulk static-ads pipeline (tools/build_ads.py + the ad skills; Gemini key
  // lives in the kit's own .env).
  "bulk-creatives": env("ADS_KIT_DIR") || join(AGENTS_ROOT, "ads-generator-kit"),
};
function cwdFor(skill) {
  const dir = SKILL_CWD[skill];
  return dir && existsSync(dir) ? dir : VAULT_ROOT;
}
// Publishing is long-form + opus: a 2,500-word post in Rishi's voice fails
// the content rules on haiku; per-ask "use X" still overrides.
const SKILL_MODEL = {
  "ds-blog-publish": "claude-opus-4-8",
  "news-carousel": "claude-opus-4-8",
  "competitor-intel": "claude-opus-4-8",
  "bulk-creatives": "claude-opus-4-8",
};
// Hard timeouts (minutes). Blog pipeline (topical check → write → images →
// publish) is 22–44 min by the skill's own estimate.
const TIMEOUT_MIN = {
  "morning-report": 20,
  "ds-blog-publish": 50,
  // scan → verify → write → render 8-10 images → vision QA → upload → publish
  "news-carousel": 45,
  // pull ads → rank → decode top 5 → context → gallery (or fallback research)
  "competitor-intel": 45,
  // copy for N angles → brief → render N×2 images via Gemini → note
  "bulk-creatives": 60,
};
// Live-publish caps per CONSOLE_TZ day, enforced here (a prompt can be talked
// around; the runner can't). dry_run intents don't count.
const DAILY_CAP = { "ds-blog-publish": 2, "news-carousel": 1 };
const PUBLISH_APPROVAL = ["1", "true"].includes(env("PUBLISH_APPROVAL"));
const LEDGER_FILE = join(VAULT_ROOT, "system", "publish-ledger.json");
const LEDGER_KIND = { "ds-blog-publish": "blog", "news-carousel": "news-carousel" };

// Returns the count of live publishes today, or null when the ledger cannot
// be trusted. ONLY a missing file (ENOENT) counts as an empty ledger —
// malformed JSON, permission errors etc. must BLOCK publishing (fail closed),
// otherwise a corrupt ledger silently disables the daily cap.
function publishedToday(kind) {
  let data;
  try {
    data = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return 0;
    log(
      `LEDGER ERROR: cannot read/parse ${LEDGER_FILE} (${e.message}) — ` +
        `publish cap unverifiable, BLOCKING publish jobs until the ledger is fixed`
    );
    return null;
  }
  try {
    const today = todayDate();
    return (data.entries || []).filter(
      (e) => e.kind === kind && !e.dry_run &&
        new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(new Date(e.ts)) === today
    ).length;
  } catch (e) {
    log(`LEDGER ERROR: unreadable entries in ${LEDGER_FILE} (${e.message}) — BLOCKING publish jobs`);
    return null;
  }
}

function modelFor(intent) {
  const m = intent?.args?.model;
  if (typeof m === "string" && MODEL_ALLOWLIST.has(m)) return m;
  return SKILL_MODEL[intent?.skill] || CLAUDE_MODEL;
}

// Atomic write — tmp file + rename in the same dir, so readers (the console polls
// these JSON files) never see a truncated half-write.
function writeFileAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

let heartbeatFailures = 0;
function writeHeartbeat() {
  try {
    writeFileAtomic(
      STATUS_FILE,
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          pid: process.pid,
          version: "1.0.1",
          busy: active > 0,
          active,
          max_concurrent: MAX_CONCURRENT,
          pending: pending.length,
          in_flight: [...inFlight],
        },
        null,
        2
      ) + "\n"
    );
    heartbeatFailures = 0;
  } catch (e) {
    // Don't swallow silently — a dead heartbeat looks like a dead runner to
    // the console. Log the first failure and then every 20th to avoid spam.
    heartbeatFailures++;
    if (heartbeatFailures === 1 || heartbeatFailures % 20 === 0) {
      log(`heartbeat write failed x${heartbeatFailures}: ${e.message}`);
    }
  }
}

// runner.log rotation — rotate at 5MB, keep one .old.
const LOG_MAX_BYTES = 5 * 1024 * 1024;
function rotateLogIfNeeded() {
  try {
    if (statSync(RUNNER_LOG).size >= LOG_MAX_BYTES) {
      renameSync(RUNNER_LOG, `${RUNNER_LOG}.old`);
    }
  } catch {
    /* ENOENT / racing rotation — ignore */
  }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  rotateLogIfNeeded();
  // async append — keep log I/O off the event loop's critical path
  appendFile(RUNNER_LOG, line, "utf8", () => {});
  console.log(line.trimEnd());
}

function ensureDirs() {
  for (const d of [QUEUE_DIR, PROCESSING_DIR, PENDING_DIR, FAILED_DIR, RUNS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
  writeFileAtomic(path, JSON.stringify(obj, null, 2) + "\n");
}

function slugify(s, max = 48) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max) || "untitled";
}

function todayDate() {
  // Local (CONSOLE_TZ) YYYY-MM-DD. toISOString() returns UTC, which flips to
  // tomorrow's date in the evening for western timezones — wrong for "today".
  return new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(new Date());
}

function tomorrowDate() {
  const todayLocal = todayDate();
  const [y, m, d] = todayLocal.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(next);
}

/**
 * Per-skill deliverable path inside the vault — where the user-facing
 * artifact lands. The console's Documents panel + doc callouts deep-link here.
 */
function deliverablePathFor(intent) {
  const id8 = (intent.id || "x").slice(0, 8);
  const date = todayDate();
  const args = intent.args || {};
  switch (intent.skill) {
    case "plan-today":
      return `daily-notes/${date}.md`;
    case "plan-tomorrow":
      return `daily-notes/${tomorrowDate()}.md`;
    case "morning-report":
      return `inbox/reports/morning/${date}-morning-report-${id8}.md`;
    case "inbox-brief":
      return `inbox/reports/inbox-briefs/${date}-${id8}.md`;
    case "vault-cleanup":
      return `inbox/reports/vault-cleanup/${date}-cleanup-${id8}.md`;
    case "voice-ask":
      return `inbox/voice/${date}-${slugify(args.prompt || "ask")}-${id8}.md`;
    // --- installed skills (~/.claude/skills) --------------------------------
    // today/close-day own the daily note itself; the rest write a run report
    // the Documents panel can open.
    case "today":
    case "close-day":
      return `daily-notes/${date}.md`;
    case "morning-intel":
      return `inbox/reports/intel/${date}-morning-intel-${id8}.md`;
    case "metrics-pull":
      return `inbox/reports/metrics/${date}-metrics-pull-${id8}.md`;
    case "ads-dashboard":
      return `inbox/reports/ads/${date}-ads-dashboard-${id8}.md`;
    // marketing audits — same folders the skills already use interactively
    case "meta-ads-audit":
      return `inbox/reports/ads/${date}-meta-audit-${id8}.md`;
    case "google-ads-audit":
      return `inbox/reports/ads/${date}-google-ads-audit-${id8}.md`;
    case "seo-audit":
      return `inbox/reports/seo/${date}-seo-audit-${id8}.md`;
    case "aeo-audit":
      return `inbox/reports/seo/${date}-aeo-audit-${id8}.md`;
    case "ig-content-strategy":
      return `inbox/reports/ig/${date}-ig-strategy-${id8}.md`;
    // reporting
    case "perf-report":
      return `inbox/reports/perf/${date}-${argScope(args)}-${argRange(args)}d-${id8}.md`;
    case "report-deck":
      return `inbox/reports/decks/${date}-${argScope(args)}-${argRange(args)}d-${id8}.md`;
    // publishing (inbox/ prefix is required for the console to honour `link:`)
    case "ds-blog-publish":
      return `inbox/reports/publish/${date}-blog-${slugify(args.topic || "next-from-backlog", 40)}-${id8}.md`;
    case "news-carousel":
      return `inbox/reports/publish/${date}-news-carousel-${slugify(args.topic || "todays-story", 40)}-${id8}.md`;
    case "competitor-intel":
      return `inbox/reports/competitors/${date}-${slugify(args.brand || args.topic || "competitor", 40)}-${id8}.md`;
    case "bulk-creatives":
      return `inbox/reports/creatives/${date}-bulk-ads-${slugify(args.topic || "latest-brief", 40)}-${id8}.md`;
    default:
      return null;
  }
}

// Standard headless preamble. Blocks AskUserQuestion (which stalls skills in
// non-interactive -p mode) and carries the SPOKEN SUMMARY CONTRACT — the
// first line of every reply is read aloud verbatim by the voice layer.
const AUTONOMOUS_PREFIX =
  "Execute the requested task autonomously in headless mode. Do not ask the user for confirmation. Do not call AskUserQuestion. Continue until the deliverable is written.\n\nSPOKEN SUMMARY CONTRACT: the FIRST line of your final reply is read aloud to the user by a voice assistant. Make it ONE conversational sentence (max ~140 chars) the way a sharp friend would text you - warm, casual, first person, contractions ('it's live', 'we're at'), zero corporate stiffness - lead with the outcome PLUS two or three concrete highlights from what you produced (names, titles, the numbers that matter) — 'the report is done' with no specifics is useless, round big numbers to clean magnitudes (say 'about 13 thousand', never '13,206'). Never mention: headless, autonomous, task, deliverable, file paths, markdown, or process narration ('waiting for', 'running'). Every other detail belongs in the written deliverable, not the spoken line.";

/**
 * Map intent.skill → the prompt passed to `claude -p`. Every prompt is
 * SELF-CONTAINED — no dependency on locally installed slash-skills — and
 * must instruct the model to write the deliverable at the exact path.
 *
 * Two prompts use Anthropic MCP connectors when present (Google Calendar in
 * plan-today/plan-tomorrow, Gmail in inbox-brief); without the connector the
 * model degrades gracefully and says so in the note.
 */
function buildPrompt(intent, deliverable) {
  const skill = intent.skill;
  const args = intent.args || {};

  switch (skill) {
    case "plan-today":
      return `${AUTONOMOUS_PREFIX}\n\nTask: plan today's daily note at exactly ${deliverable}.\n\nSteps:\n1. Read the last 3 daily notes under daily-notes/ for incomplete Top 3 priorities and reflections (carryover candidates).\n2. If a Google Calendar MCP connector is available, pull today's events (timeZone=${CONSOLE_TZ}, sorted by start time). If not, skip the schedule.\n3. Scan projects/*.md (if the folder exists) for active or due items.\n4. Pick the 3 highest-leverage priorities: carryover from yesterday beats new, due-today beats someday.\n5. Write the daily note following the schema at system/schemas/daily-note.md — exact section order. If the note already exists, MERGE: fill only empty Top 3 slots and replace ## Schedule; never overwrite user-set text.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "plan-tomorrow":
      return `${AUTONOMOUS_PREFIX}\n\nTask: draft tomorrow's daily note at exactly ${deliverable}.\n\nSteps:\n1. Read today's daily note for unfinished Top 3 priorities (carryover).\n2. If a Google Calendar MCP connector is available, pull tomorrow's events (timeZone=${CONSOLE_TZ}).\n3. Suggest 3 priorities for tomorrow.\n4. Write the note following the schema at system/schemas/daily-note.md.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "morning-report":
      return `${AUTONOMOUS_PREFIX}\n\nTask: produce today's AI/tech morning briefing and save it at exactly ${deliverable}.\n\nResearch the last ~24 hours via web search (model releases, agent tooling, dev-tool launches, the conversation on X/HN). Structure the note: top-level "# Morning Report" + "**Date:** <today>", then "## Headlines" (3-5 bullets ranked by impact; each bullet MUST end with a markdown link to its primary source, e.g. [source](https://...)), "## Web — News & Articles", "## X / Twitter — The Conversation", "## GitHub — Builder Activity", "## Sources". YAML frontmatter: \`date\`, \`skill: morning-report\`, \`tags: [morning, briefing]\`.\n\nThe console's AI Wire panel and the spoken daily brief both read the ## Headlines section — keep those bullets tight.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "inbox-brief":
      return `${AUTONOMOUS_PREFIX}\n\nTask: triage the Gmail inbox and save the brief at exactly ${deliverable}.\n\nSteps:\n1. Pull the last 24h via the Anthropic Gmail MCP connector — mcp__claude_ai_Gmail__search_threads with query "in:inbox newer_than:1d", pageSize 50. If the connector is unavailable, write a short note saying so and stop.\n2. Classify each thread: urgent (deadlines, money, blocked people) / warm (real humans worth replying to) / opportunities (sponsorships, partnerships) / meetings / noise.\n3. Save the triage at ${deliverable}. YAML frontmatter \`date\`, \`skill: inbox-brief\`, \`tags: [inbox, triage]\`. Body groups messages by category, most urgent first.\n4. Do NOT send anything — drafting and sending stay manual.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "vault-cleanup":
      return `${AUTONOMOUS_PREFIX}\n\nTask: tidy the vault and report at exactly ${deliverable}.\n\nScan the vault for stale files (untouched > 7 days, outside system/ and archive/). Move them into archive/ subfolders mirroring their source folder. Write a one-page report at ${deliverable} — YAML frontmatter \`date\`, \`skill: vault-cleanup\`, \`tags: [cleanup, ops]\`; body lists what moved and what was skipped.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "voice-ask": {
      const ask = (args.prompt || "").trim();
      if (!ask) return null;
      const convo = (args.context || "").trim();
      const convoBlock = convo
        ? `\n\nRecent voice conversation (context — the ask may refer back to it):\n${convo}`
        : "";
      return `${AUTONOMOUS_PREFIX}\n\nVoice request from the user (spoken via push-to-talk, machine-transcribed — minor transcription errors possible): ${JSON.stringify(ask)}${convoBlock}\n\nDo the task fully. Write the complete result as a markdown note at exactly ${deliverable} — YAML frontmatter \`date\`, \`skill: voice-ask\`, \`prompt: ${JSON.stringify(ask)}\`, \`tags: [voice]\`. If the REAL output of the task lives at a URL — a Gmail draft you created (the create_draft response includes the draft's message id — deep-link it: https://mail.google.com/mail/u/0/#drafts?compose=<message id>; only if no id came back, fall back to https://mail.google.com/mail/#drafts), a video, a doc, a page — ALSO add \`link: <that url>\` to the frontmatter; the dashboard will send the user there directly instead of to this note.\n\nIMPORTANT: the FIRST LINE of your final reply is read aloud to the user by text-to-speech. Make it ONE conversational sentence (under 200 characters) that directly answers the ask or states the outcome — no markdown, no file paths in it. After that line, end with: SAVED ${deliverable}`;
    }
    // --- installed skills (~/.claude/skills) --------------------------------
    // These delegate to the user's own slash-skills — headless `claude -p`
    // can invoke them. Each prompt still pins the deliverable path so the
    // Documents panel and the spoken summary have something to open.
    case "today":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /today skill — Rishi's start-of-day routine — for ${todayDate()} (timezone ${CONSOLE_TZ}).\n\nThe skill creates today's daily note from the frozen schema, carries over yesterday's unchecked Top 3, and pulls Google Calendar events via the Anthropic connector. It is idempotent: if the note already exists, MERGE — fill only empty slots and refresh the schedule, never overwrite text the user wrote. If the Calendar connector is unavailable, skip the schedule and say so in the note.\n\nThe daily note is at exactly ${deliverable}.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "close-day":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /close-day skill — Rishi's end-of-day routine — for ${todayDate()} (timezone ${CONSOLE_TZ}), updating the daily note at exactly ${deliverable}.\n\nIMPORTANT: this skill normally interviews the user for a reflection (effort score, focus blocks, posts shipped). You are headless and CANNOT ask. Do NOT invent numbers. Instead: derive what you can from evidence in the vault (today's note, files written today, metrics.csv rows, run logs), append the "## EOD Reflection" section with what the evidence supports, and leave any frontmatter field you cannot evidence exactly as it already is. Mark unknown fields in the reflection body as "not logged".\n\nMerge into the existing note — never duplicate the section or clobber user-set text.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "morning-intel":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /morning-intel skill — the full AI-sphere intelligence sweep — and save the brief at exactly ${deliverable}.\n\nThe skill sweeps the last 24h (AI news, X/Twitter announcements, trending YouTube in the Claude Code/Codex sphere, GitHub trending, Gmail triage) and synthesizes one vault brief ending in a "So What" content plan. Any source that is unavailable (missing connector, failed fetch) should be noted as unavailable and skipped — do not stall and do not fabricate its contents.\n\nInclude a "## Headlines" section of 3-5 bullets, each ending in a markdown link to its primary source — the console's AI Wire panel reads that section. YAML frontmatter: \`date\`, \`skill: morning-intel\`, \`tags: [intel, briefing]\`.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "metrics-pull":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /metrics-pull skill, then write a short run report at exactly ${deliverable}.\n\nThe skill is direct-exec: it runs its own scripts to pull current metric values and append rows to the vault metrics CSV (system/metrics/metrics.csv). Each source writes its own status (ok/stale/error/mock).\n\nAfter it runs, report per source: the metric, the value written, its status, and the error text for anything that did not come back ok. Report failures plainly — do not present a stale or mock row as a fresh pull. YAML frontmatter: \`date\`, \`skill: metrics-pull\`, \`tags: [metrics, ops]\`.\n\nEnd your reply with: SAVED ${deliverable}`;
    case "ads-dashboard":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /ads-dashboard skill, then write a short run report at exactly ${deliverable}.\n\nThe skill is direct-exec: build_dashboard.py rebuilds the marketing dashboard note (ops/ads-dashboard.md) with 7-day KPIs, trend deltas, sparklines, top campaigns, and top organic queries from the latest pulled data.\n\nIn the report, summarize the headline 7-day KPIs and their deltas, and state plainly how fresh the underlying pulled data is — if the dashboard rebuilt from stale data, say that rather than presenting the numbers as current. YAML frontmatter: \`date\`, \`skill: ads-dashboard\`, \`tags: [ads, dashboard]\`.\n\nEnd your reply with: SAVED ${deliverable}`;
    // --- marketing audits (installed skills) ---------------------------------
    // Headless caveat baked into every prompt: the claude.ai MCP connectors
    // (Meta Ads, Semrush, Apify) are NOT available under `claude -p`. The
    // skills already degrade to REST/env-key paths; the prompt says so
    // explicitly so a run never stalls hunting for a connector.
    case "meta-ads-audit":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /meta-ads-audit skill and save the report at exactly ${deliverable}.\n\nHEADLESS: the Meta Ads MCP connector is not available in this session. Use the Graph API directly with META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS from ~/.claude/.env (same calls as ~/.claude/skills/metrics-pull/scripts/pull_meta_ads.py), and the daily history at system/metrics/history/meta-daily.csv plus system/metrics/ads-latest.json. Accounts that 403 are listed under "## Data Quality" — never invent their numbers. Apply the skill's full framework against the targets in ops/targets.md.\n\nFrontmatter: \`date\`, \`skill: meta-ads-audit\`, \`tags: [ads, meta, audit]\`. End your reply with: SAVED ${deliverable}`;
    case "google-ads-audit":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /google-ads-audit skill and save the report at exactly ${deliverable}.\n\nHEADLESS: call the Google Ads REST API with the GOOGLE_ADS_* keys in ~/.claude/.env (pattern in ~/.claude/skills/metrics-pull/scripts/pull_google_ads.py) and use system/metrics/history/google-daily.csv. If the refresh token or customer id is blank, write a short note at the deliverable saying Google Ads is not wired (see docs/marketing-setup.md §1) and stop — do not fabricate. Frontmatter: \`date\`, \`skill: google-ads-audit\`, \`tags: [ads, google, audit]\`. End your reply with: SAVED ${deliverable}`;
    case "seo-audit":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /seo-audit skill and save the report at exactly ${deliverable}.\n\nHEADLESS: use Search Console via the OAuth/service-account keys in ~/.claude/.env (pattern in ~/.claude/skills/metrics-pull/scripts/pull_gsc.py), system/metrics/seo-latest.json and system/metrics/history/gsc-daily.csv. If no Google credentials are configured, write a short note saying so (docs/marketing-setup.md §2) and stop. Frontmatter: \`date\`, \`skill: seo-audit\`, \`tags: [seo, audit]\`. End your reply with: SAVED ${deliverable}`;
    case "aeo-audit":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /aeo-audit skill and save the report at exactly ${deliverable}.\n\nHEADLESS: run the pull_aeo.py step with /usr/bin/python3; the Semrush MCP connector is unavailable — skip the Semrush section silently. Frontmatter: \`date\`, \`skill: aeo-audit\`, \`tags: [seo, aeo, audit]\`. End your reply with: SAVED ${deliverable}`;
    case "ig-content-strategy":
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /ig-content-strategy skill and save the report at exactly ${deliverable}.\n\nHEADLESS: the Apify and Meta MCP connectors are unavailable — analyse the existing system/metrics/ig-latest.json as-is and state its age in the report instead of refreshing. Frontmatter: \`date\`, \`skill: ig-content-strategy\`, \`tags: [instagram, strategy]\`. End your reply with: SAVED ${deliverable}`;
    // --- reporting ---------------------------------------------------------
    case "perf-report": {
      const scope = argScope(args), range = argRange(args);
      return `${AUTONOMOUS_PREFIX}\n\nTask: run the /perf-report skill with scope=${scope} and range=${range} days, and save the report at exactly ${deliverable}.\n\nFollow the skill exactly: first run \`/usr/bin/python3 ~/.claude/skills/metrics-pull/scripts/marketing_context.py --scope ${scope} --range ${range} --write\`, then analyse ONLY system/metrics/context/${scope}-${range}d.json. Currency is INR (₹, lakh/crore). If the scoped channel is not wired (status skipped, totals null), write the short not-wired note and stop — never invent numbers.\n\nEnd your reply with: SAVED ${deliverable}`;
    }
    case "report-deck": {
      const scope = argScope(args), range = argRange(args);
      const id8 = (intent.id || "manual").slice(0, 8);
      return `${AUTONOMOUS_PREFIX}\n\nTask: build the ${scope} performance deck for the last ${range} days and write the deliverable note at exactly ${deliverable}.\n\nSteps:\n1. Run: HUD_PUBLIC_URL=${CONSOLE_PUBLIC_URL} /usr/bin/python3 ~/.claude/skills/report-deck/scripts/build_deck.py --scope ${scope} --range ${range} --id ${id8}\n2. Parse the JSON manifest it prints (keys: pptx, html, html_url, pptx_url, slides, narrative, kpis, summary). Exit code 2 means mixed currencies — write a note explaining that and stop.\n3. Write ${deliverable} with YAML frontmatter \`date\`, \`skill: report-deck\`, \`scope: ${scope}\`, \`range_days: ${range}\`, \`pptx: <manifest.pptx>\`, \`html: <manifest.html>\`, \`link: <manifest.html_url>\`, \`narrative: <manifest.narrative>\`, \`tags: [marketing, deck, ${scope}]\`; body = slide count, the summary bullets, and Download links to pptx_url and html_url.\n\nDo not run any other analysis. The spoken first line names the slide count plus one KPI and one decision from the summary.\n\nEnd your reply with: SAVED ${deliverable}`;
    }
    // --- publishing (cwd = the agent project; deliverable by ABSOLUTE path) --
    case "ds-blog-publish": {
      const abs = join(VAULT_ROOT, deliverable);
      const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
      const dry = args.dry_run === true;
      const ledger = LEDGER_FILE;
      return `${AUTONOMOUS_PREFIX}\n\nYou are running inside the Digital Scholar SEO Publishing Agent project (your cwd). Run the /publish-workflow skill end to end ${topic ? `for this topic: ${JSON.stringify(topic)}` : "for the NEXT topic from the backlog: the highest-priority entry in output/clusters/*/cluster-plan.json not already in output/blog-registry.md; if no cluster plan exists, run topical-authority-check in suggest mode against the registry and take its top gap. State the chosen topic in your spoken line."}.\n\nHEADLESS RULES (override anything interactive in the skills):\n- Topical-authority score 4–7: proceed with the best recommended angle, never stop to ask. Score 0–3: do NOT publish; write the deliverable explaining why with 3 alternative topics.\n- No Chrome MCP / screenshots. Semrush: prefer the claude.ai Semrush connector tools if present, else Tavily/WebSearch, else skip.\n- Stage 7 quality layer: run only seo-audit if time allows; skip cluster-planner and link-orchestrator.\n- Run distribution-publisher for the LinkedIn post ONLY and paste that draft into the deliverable under "## LinkedIn draft".\n- WordPress status: ${dry ? "DRAFT (this is a dry run — override DEFAULT_PUBLISH_STATUS; skip live verification; the link is the wp-admin edit URL)" : "PUBLISH (live)"}. Author ID 270. Zero em dashes. Browser User-Agent on every REST call.\n- Before writing a word: check the slug against output/blog-registry.md AND the ledger at ${ledger} (entries[].kind==="blog"). If it exists, stop and say so.\n- IMMEDIATELY after the WordPress create call succeeds — before any verification — write the deliverable below and append to the ledger: {"kind":"blog","slug","url","title","ts":<full ISO-8601 UTC, e.g. 2026-08-21T08:45:12Z — never a bare date>,"run_id":"${intent.id}","dry_run":${dry}} (read-modify-write the JSON; create it with {"entries":[]} if missing). Then append the registry row.\n\nDeliverable at exactly ${abs} (absolute path — the vault, not this project): YAML frontmatter \`date\`, \`skill: ds-blog-publish\`, \`topic\`, \`title\`, \`slug\`, \`post_id\`, \`status: publish|draft\`, \`link: <live URL or wp-admin edit URL>\`, \`word_count\`, \`tags: [publish, blog, digital-scholar]\`; body = the Stage 6 report block plus "## LinkedIn draft".\n\nSpoken first line: ${dry ? "Drafted \"<title>\" on WordPress for your review, about <N> words." : "Published \"<title>\", about <N> words, live at digitalscholar.in/<slug>."} On a block: "I held off publishing <topic> — <reason in six words>; details are in the note."\n\nEnd your reply with: SAVED ${abs}`;
    }
    case "news-carousel": {
      const abs = join(VAULT_ROOT, deliverable);
      const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
      const dry = args.dry_run === true;
      return `${AUTONOMOUS_PREFIX}\n\nYou are running inside the Breaking AI News Carousel project (your cwd) — this publishes to Rishi's personal Instagram @rrishijain, NOT Digital Scholar. Run the /news-carousel-publish skill (the HEADLESS one — not /break-news, which stops for approval) ${topic ? `for this story: ${JSON.stringify(topic)}` : "with no topic: scan the sources across the full freshness window (today plus the previous two days in Asia/Kolkata) and take the highest-scoring story that clears the three gates, preferring the freshest"}${dry ? ", dry_run=true (render, host and build containers, never post)" : ""}.\n\nHEADLESS RULES (override anything interactive in that project's skills):\n- Never ask. Shipping nothing is a valid, non-failing outcome — if no story clears story-selection, or verification fails, write the note with status: no-story and stop. Do not lower the bar to fill the slot.
- Freshness is a rolling 3-day window, not a single day. On a thin day reach BACK through the window for a big story before you reach DOWN into a niche one. A story over a day old is a catch-up: it needs Reach >= 4 and score >= 150, must be dated honestly in the copy, and never carries a BREAKING tag or the word "today". When nothing ships, the note must say how many days were scanned and how many candidates each day held.\n- Render in two steps: \`node scripts/generate_portrait.mjs content/queue/<slug>\` (styled cut-out of the host for slides 1 and 8 — each needs a \`portrait_prompt\` naming attire, a story-relevant accessory, the hand gesture and the expression; aim the cover gesture toward the viewer's LEFT and slide 8's downward, and never describe his face), then \`node scripts/render_slides_html.mjs content/queue/<slug>\` (real text in system Chrome, no image API, no cost, cannot garble). If the renderer warns it fell back to a raw reference frame, the portrait step did not run — fix it rather than shipping a pasted headshot. Only reach for the generative renderers (generate_slides.mjs / generate_slides_gemini.mjs) if the deck genuinely needs illustration rather than layout.\n- The vision QA gate applies to GENERATIVELY rendered decks: after \`node scripts/verify_slides.mjs content/queue/<slug> --fix --attempts 2\`, any slide still failing means do NOT publish — write the note with status: blocked naming the slide. Skip that gate for an HTML-rendered deck: the copy is composited from text_strings, not drawn, so there is nothing to misspell and no likeness to judge.\n- Host slides with \`node scripts/upload_wp.mjs content/queue/<slug>\` before publishing — Instagram cannot fetch a local file.\n- Publish with \`node scripts/publish_instagram.mjs content/queue/<slug>${dry ? " --dry-run" : ""}\`. The ledger is ${LEDGER_FILE} (HUD_VAULT_ROOT is set, so the script finds it on its own). Exit 3 = account guard (wrong or dead token) and exit 4 = this slug already went live: in both cases write the note with status: blocked and say so plainly. Never edit the guard, the token or IG_EXPECTED_USERNAME to get past it.\n${dry ? "" : `- After a successful live post: \`node scripts/ledger_add.mjs content/published/<slug> --status published --url <permalink>\`, then \`node scripts/upload_wp.mjs content/published/<slug> --cleanup\` to take the slides back out of the media library.\n`}\nDeliverable at exactly ${abs} (absolute path — the vault, not this project): YAML frontmatter \`date\`, \`skill: news-carousel\`, \`slug\`, \`headline\`, \`status: published|dry-run|no-story|blocked\`, \`link\` (the Instagram permalink, ONLY when live), \`slides\`, \`story_date\`, \`story_age_days\`, \`tags: [publish, carousel, ai-news]\`; body = the hook, one line on the story, the angle, the full caption, and both source URLs.\n\nSpoken first line: ${dry ? 'Rendered "<hook>", <N> slides, ready to post but nothing went live.' : 'The carousel "<hook>" is live on Instagram, <N> slides.'} If nothing shipped: "Nothing cleared the bar today — <reason in six words>." If blocked: "I held the carousel back — <reason in six words>; details are in the note."\n\nEnd your reply with: SAVED ${abs}`;
    }
    case "competitor-intel": {
      const abs = join(VAULT_ROOT, deliverable);
      const brandArg = typeof args.brand === "string" && args.brand.trim() ? args.brand.trim()
        : typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
      const compFile = join(VAULT_ROOT, "ops", "competitors.md");
      const compDir = join(VAULT_ROOT, "inbox", "reports", "competitors");
      return `${AUTONOMOUS_PREFIX}\n\nYou are running inside the Competitor X-Ray project (your cwd — its CLAUDE.md and /xray skill apply). Produce a FULL competitive intelligence report on ${brandArg ? JSON.stringify(brandArg) : `no named brand: read ${compFile} (one competitor per line, # comments ignored) and pick the one whose newest report under ${compDir}/ is oldest or missing; if the file is missing, use "upGrad" and create it seeded with that line. Name your pick in the spoken line.`}\n\nHEADLESS RULES:\n- Never ask. No Chrome MCP. Every number needs a source; a blank source is written as "data unavailable" — never fabricated. SimilarWeb-style traffic figures are modelled estimates and the report must say so.\n- PATH A (preferred): if APIFY_TOKEN and FIRECRAWL_API_KEY resolve (env → ./.env → ~/.competitor-xray/.env), run the /xray pipeline stage by stage — cost levers ~150 ads pulled, --top 5 decoded — into competitor-xray-runs/<slug>-<date>/.\n- PATH B (keys missing): research directly — the brand's Meta Ad Library via an Apify MCP connector actor if available, else WebSearch; site tech from the public builtwith.com/<domain> page (WebFetch); traffic from the public similarweb.com/website/<domain> page; top ~20 organic + paid keywords via the claude.ai Semrush connector (organic_research / keyword_research) if present, else mark unavailable. Say plainly in the report which path ran and which sources came up dry.\n\nBOTH paths must cover: total active ads, video vs image split, partnership vs brand ads; the messages they repeat; personas inferred from the ads alone; top 10 longest-running ads; creative velocity (launches and dates); tech stack (analytics, pixels, email platform, CRO tools); traffic scale, channel split, top keywords and referrers; and "## 5 moves to steal or counter" — five specific numbered moves for Digital Scholar.\n\nDeliverables:\n1. Self-contained HTML report with inline charts at ${compDir}/<date>-<brand-slug>/report.html (copy gallery.html there too if PATH A produced one).\n2. A PDF of the same report at ${compDir}/<date>-<brand-slug>/report.pdf — render it from report.html with headless Chrome: try "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --print-to-pdf=<pdf path> --no-pdf-header-footer file://<report.html>, falling back to chrome/chromium/msedge on PATH. If no Chrome-family browser exists, skip the PDF and say so in the note — never fail the run over it.\n3. The note at exactly ${abs}: YAML frontmatter \`date\`, \`skill: competitor-intel\`, \`brand\`, \`path: xray|fallback\`, \`html: <vault-relative path to report.html>\`, \`pdf: <vault-relative path to report.pdf, omit if skipped>\`, \`tags: [competitor, intel]\`; body = executive summary, the 5 moves, key numbers with sources, what was unavailable.\n\nSpoken first line: "The <brand> teardown's done — they're running about <N> ads, <sharpest finding>, and there's <one move worth stealing>."\n\nEnd your reply with: SAVED ${abs}`;
    }
    case "bulk-creatives": {
      const abs = join(VAULT_ROOT, deliverable);
      const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
      const n = Number(args.count);
      const count = Number.isInteger(n) && n >= 1 && n <= 30 ? n : 6;
      const dry = args.dry_run === true;
      const shipDir = join(VAULT_ROOT, "inbox", "reports", "creatives");
      let evidence = "";
      try { evidence = creativeBriefContext(args, VAULT_ROOT); }
      catch (error) {
        log(`Rejected creative brief: ${error.message}`);
        return null; // never silently fall back to an unrelated latest brief
      }
      return `${AUTONOMOUS_PREFIX}${evidence}\n\nYou are running inside the Ads Generator Kit project (your cwd — its CLAUDE.md, brand files and the ad skills under .claude/skills apply). Produce a batch of ${count} static ad creatives ${topic ? `for: ${JSON.stringify(topic)}` : "for the most recent real offer in briefs/ads/ (newest yaml that is not an _example or _smoketest); name it in your spoken line"}.\n\nHEADLESS RULES (override the ad-campaign-architect interview):\n- Never ask. Infer product, audience and offer from the topic plus the brand/ files; state every inference in the note.\n- Pick ONE render skill by fit: sophisticated-ads (courses/upskilling, premium real-photo), coursib-style-ads (one offer, many wildly different looks), best-performing-ads (30-day AI Mastery locked layout), isaac-workshop-ads (live workshop, instructor-led). Vels MBA content: read VelsMBS/anti-vels.md FIRST — its rules beat everything, including this prompt.\n- Copy before pixels: ${count} variants. ${evidence ? "Follow the saved experiment: change only its chosen variable, hold the verified offer and other variables constant, and label the control versus each test." : "Each commits to ONE distinct persuasion angle (no two share an angle)."} Headline under 9 words, single CTA, no em-dashes, never a hex code inside an image prompt.\n- Write the campaign brief at briefs/ads/<slug>.yaml (schema in the tools/build_ads.py docstring), ratios 1:1 and 9:16.\n- ${dry ? "DRY RUN: \`python3 tools/build_ads.py briefs/ads/<slug>.yaml --dry-run\` — prompts only, no images, no API spend." : "Render: \`python3 tools/build_ads.py briefs/ads/<slug>.yaml\`. A variant that errors gets ONE retry via --only <id>; report anything still failing rather than re-rolling forever."}\n- Outputs land in deliverables/content/ads/<slug>/. ${dry ? "" : `Copy the 3 strongest PNGs (your judgment) to ${shipDir}/<date>-<slug>/ so the dashboard side has them.`}\n\nDeliverable at exactly ${abs} (absolute path — the vault, not this project): YAML frontmatter \`date\`, \`skill: bulk-creatives\`, \`topic\`, \`count: ${count}\`, \`render_skill\`, \`brief: briefs/ads/<slug>.yaml\`, \`status: rendered|dry-run|partial\`, \`tags: [creative, ads]\`; body = the angle table (variant id → angle → headline → CTA), the render log (rendered/failed per ratio), and every output file path.\n\nSpoken first line: ${dry ? `"I wrote ${count} ad concepts for <topic> — <two angle names> and more; nothing rendered, it was a dry run."` : `"<N> creatives are done for <topic> — angles like <two angle names>; the best three are on the board."`}\n\nEnd your reply with: SAVED ${abs}`;
    }
    // --- EXAMPLE: adding your own skill -----------------------------------
    // case "my-skill":
    //   return `${AUTONOMOUS_PREFIX}\n\nTask: <what to do>. Save the result
    //   at exactly ${deliverable} with YAML frontmatter \`date\`,
    //   \`skill: my-skill\`. End your reply with: SAVED ${deliverable}`;
    // (also add a path in deliverablePathFor() and the name to
    //  ALLOWED_SKILLS in lib/skills.ts)
    default:
      return null;
  }
}

// Worker pool — parallel execution gated by category.
// MAX_CONCURRENT caps total in-flight claude -p subprocesses. SERIAL_SKILLS
// share one slot among themselves (they write the same shared file — the
// daily note). DEDUPE_SKILLS reject a new intent while the same skill is
// already in-flight.
const MAX_CONCURRENT = 3;
const SERIAL_SKILLS = new Set([
  "plan-today",
  "plan-tomorrow",
  "ds-blog-publish",
  "news-carousel",
]);
const DEDUPE_SKILLS = new Set([
  "morning-report",
  "inbox-brief",
  "ds-blog-publish",
  "news-carousel",
  "competitor-intel",
  "bulk-creatives",
]);
// Skills with real external side effects (they publish / spend API credits).
// An abandoned claim on one of these is NEVER auto-rerun — the side effect
// may already have happened before the crash.
const SIDE_EFFECT_SKILLS = new Set([
  "ds-blog-publish",
  "news-carousel",
  "competitor-intel",
  "bulk-creatives",
]);
// (hard timeouts live in TIMEOUT_MIN above; default 10 min)

let active = 0;
const activeChildren = new Set(); // live claude -p child processes
const inFlight = new Set(); // intent.skill values currently running
const pending = []; // queue filenames awaiting a slot
const processing = new Set(); // queue filenames currently being processed

function enqueueNew() {
  if (!existsSync(QUEUE_DIR)) return;
  const files = readdirSync(QUEUE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    // processing guard — claimed files are renamed into processing/, but this
    // keeps a name from being queued twice within one poll cycle
    if (!pending.includes(f) && !processing.has(f)) pending.push(f);
  }
}

function peekSkill(fileName, dir = QUEUE_DIR) {
  try {
    const intent = readJson(join(dir, fileName));
    return intent.skill || null;
  } catch {
    return null;
  }
}

// THE claim: atomically rename the intent out of the queue dir. rename(2) is
// atomic on the same filesystem, so exactly one runner wins; a failed rename
// means another worker (or instance) owns the file — never execute it.
function claimIntent(fileName) {
  try {
    renameSync(join(QUEUE_DIR, fileName), join(PROCESSING_DIR, fileName));
    return true;
  } catch {
    return false;
  }
}

// Move a claimed intent to failed/ with a human-readable note. Never rerun.
function quarantine(fileName, reason) {
  const dest = join(FAILED_DIR, fileName);
  try {
    renameSync(join(PROCESSING_DIR, fileName), dest);
  } catch {
    /* already gone */
  }
  try {
    writeFileSync(`${dest}.note.txt`, `[${new Date().toISOString()}] ${reason}\n`, "utf8");
  } catch {
    /* ignore */
  }
  log(`quarantined ${fileName} -> failed/: ${reason}`);
}

// Boot reconcile — files left in processing/ mean a previous runner died
// mid-run. Skills WITHOUT external side effects are safe to re-queue; anything
// that publishes or spends credits goes to failed/ for a human to decide.
function reconcileProcessing() {
  let files = [];
  try {
    files = readdirSync(PROCESSING_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of files) {
    let skill = null;
    try {
      skill = readJson(join(PROCESSING_DIR, f)).skill || null;
    } catch {
      /* unreadable — quarantine below */
    }
    if (skill && !SIDE_EFFECT_SKILLS.has(skill)) {
      try {
        renameSync(join(PROCESSING_DIR, f), join(QUEUE_DIR, f));
        log(`recovered abandoned intent ${f} (skill=${skill}) — re-queued`);
        continue;
      } catch {
        /* fall through to quarantine */
      }
    }
    quarantine(
      f,
      `abandoned in processing/ at startup (previous runner died mid-run); skill=${skill || "(unreadable)"}` +
        (skill && SIDE_EFFECT_SKILLS.has(skill)
          ? " has external side effects — NOT re-run automatically; the side effect may already have happened. Re-enqueue by hand only after checking the publish ledger / platform."
          : " — could not be re-queued.")
    );
  }
}

// Intent shape validation — the queue FILENAME is the canonical id. A forged
// intent.id ("../../evil") must never steer where run files are written.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_SKILL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function validateIntent(intent, canonicalId) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
    return "intent is not an object";
  }
  if (intent.id !== undefined && intent.id !== canonicalId) {
    return `embedded id ${JSON.stringify(intent.id)} does not match queue filename ${canonicalId}`;
  }
  if (typeof intent.skill !== "string" || !SAFE_SKILL_RE.test(intent.skill)) {
    return `invalid skill: ${JSON.stringify(intent.skill)}`;
  }
  if (intent.args !== undefined && (typeof intent.args !== "object" || intent.args === null || Array.isArray(intent.args))) {
    return "args is not an object";
  }
  if (intent.approved !== undefined && typeof intent.approved !== "boolean") {
    return `invalid approved: ${JSON.stringify(intent.approved)}`;
  }
  if (intent.args?.creative_brief_id !== undefined && intent.skill !== "bulk-creatives") {
    return "creative_brief_id is only supported by bulk-creatives";
  }
  if (intent.ts !== undefined && (typeof intent.ts !== "string" || Number.isNaN(Date.parse(intent.ts)))) {
    return `invalid ts: ${JSON.stringify(intent.ts)}`;
  }
  return null;
}

function pickNext() {
  const serialBusy = [...inFlight].some((s) => SERIAL_SKILLS.has(s));
  for (let i = 0; i < pending.length; i++) {
    const skill = peekSkill(pending[i]);
    if (!skill) continue; // unreadable yet (write race) — try later
    if (DEDUPE_SKILLS.has(skill) && inFlight.has(skill)) continue;
    if (SERIAL_SKILLS.has(skill) && serialBusy) continue;
    return i;
  }
  return -1;
}

// fileName has already been CLAIMED — it lives in PROCESSING_DIR now.
async function processOne(fileName) {
  const queuePath = join(PROCESSING_DIR, fileName);
  if (!existsSync(queuePath)) return;

  // The queue filename is the canonical run id — intent.id is never trusted
  // for path construction (a forged id could write outside RUNS_DIR).
  const runId = basename(fileName, ".json");
  if (!SAFE_ID_RE.test(runId)) {
    quarantine(fileName, `unsafe queue filename ${JSON.stringify(fileName)}`);
    return;
  }

  let intent;
  let lastErr = null;
  // Retry with backoff — covers the race where the intent file exists but
  // hasn't flushed content yet.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      intent = readJson(queuePath);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  if (lastErr || !intent) {
    const ts = new Date().toISOString();
    writeJson(join(RUNS_DIR, `${runId}.json`), {
      id: runId,
      skill: "(unknown)",
      args: {},
      ts_queued: ts,
      ts_started: ts,
      ts_completed: ts,
      status: "error",
      exit_code: -3,
      summary: `bad intent json after 5 retries: ${lastErr?.message || "empty"}`.slice(0, 200),
      md_path: `system/runs/${runId}.md`,
      log_path: `system/runs/${runId}.md`,
      deliverable_path: null,
    });
    quarantine(fileName, `bad intent json after 5 retries: ${lastErr?.message || "empty"}`);
    return;
  }

  const invalid = validateIntent(intent, runId);
  if (invalid) {
    const ts = new Date().toISOString();
    writeJson(join(RUNS_DIR, `${runId}.json`), {
      id: runId,
      skill: typeof intent.skill === "string" ? intent.skill.slice(0, 64) : "(invalid)",
      args: {},
      ts_queued: ts,
      ts_started: ts,
      ts_completed: ts,
      status: "error",
      exit_code: -3,
      summary: `invalid intent: ${invalid}`.slice(0, 200),
      md_path: `system/runs/${runId}.md`,
      log_path: `system/runs/${runId}.md`,
      deliverable_path: null,
    });
    quarantine(fileName, `invalid intent: ${invalid}`);
    return;
  }

  const runJsonPath = join(RUNS_DIR, `${runId}.json`);
  const runMdPath = join(RUNS_DIR, `${runId}.md`);
  const deliverable = deliverablePathFor({ ...intent, id: runId });

  const tsStarted = new Date().toISOString();
  const status = {
    id: runId,
    skill: intent.skill,
    args: intent.args || {},
    ts_queued: intent.ts || tsStarted,
    ts_started: tsStarted,
    ts_completed: null,
    status: "running",
    exit_code: null,
    summary: "",
    md_path: `system/runs/${runId}.md`,
    log_path: `system/runs/${runId}.md`,
    deliverable_path: deliverable,
    deliverable_verified: null,
  };
  writeJson(runJsonPath, status);

  const prompt = buildPrompt({ ...intent, id: runId }, deliverable);
  if (!prompt) {
    status.status = "error";
    status.exit_code = -1;
    status.summary = `unknown or invalid intent: ${intent.skill}`;
    status.ts_completed = new Date().toISOString();
    writeJson(runJsonPath, status);
    quarantine(fileName, status.summary);
    return;
  }

  if (
    PUBLISH_APPROVAL &&
    DAILY_CAP[intent.skill] &&
    !intent.args?.dry_run &&
    intent.approved !== true
  ) {
    renameSync(queuePath, join(PENDING_DIR, fileName));
    status.status = "pending-approval";
    status.exit_code = null;
    status.summary =
      "live publish awaiting approval — approve from the Control Room or move the intent back to system/queue/";
    status.ts_completed = null;
    writeJson(runJsonPath, status);
    log(`${runId}: ${status.summary}`);
    return;
  }

  // publishing guards — fail loud BEFORE spending a claude session
  const reject = (code, summary) => {
    status.status = "error";
    status.exit_code = code;
    status.summary = summary;
    status.ts_completed = new Date().toISOString();
    writeJson(runJsonPath, status);
    try {
      unlinkSync(queuePath);
    } catch {
      /* ignore */
    }
    log(`${runId}: rejected — ${summary}`);
  };
  if (SKILL_CWD[intent.skill] && !existsSync(SKILL_CWD[intent.skill])) {
    return reject(-4, `agent project missing: ${SKILL_CWD[intent.skill]}`);
  }
  if (DAILY_CAP[intent.skill] && !intent.args?.dry_run) {
    const n = publishedToday(LEDGER_KIND[intent.skill]);
    if (n === null) {
      // fail CLOSED — an unreadable ledger must never disable the cap
      return reject(-6, `publish ledger unreadable (${LEDGER_FILE}) — refusing to publish until it is fixed; see runner.log`);
    }
    if (n >= DAILY_CAP[intent.skill]) {
      return reject(-5, `daily publish cap reached (${n}/${DAILY_CAP[intent.skill]} ${LEDGER_KIND[intent.skill]}s today) — say "as a draft" for a dry run`);
    }
  }

  const runModel = modelFor(intent);
  const cwd = cwdFor(intent.skill);
  log(
    `${runId}: running skill=${intent.skill}` +
      (runModel !== CLAUDE_MODEL ? ` model=${runModel}` : "") +
      (cwd !== VAULT_ROOT ? ` cwd=${cwd}` : "")
  );

  // Markdown run log with frontmatter so it renders as a note in the vault.
  const argsJson = JSON.stringify(intent.args || {});
  writeFileSync(
    runMdPath,
    `---
run_id: ${runId}
skill: ${intent.skill}
status: running
ts_queued: ${intent.ts || tsStarted}
ts_started: ${tsStarted}
args: ${argsJson}
---

# ${intent.skill} run

> in progress — output streams below.

\`\`\`
`,
    "utf8"
  );

  // Bounded in-memory capture — keep the head and tail of the output with a
  // truncation marker in between; a chatty child can no longer balloon RSS.
  const OUT_HEAD_MAX = 256 * 1024;
  const OUT_TAIL_MAX = 256 * 1024;
  const out = { head: [], headLen: 0, tail: [], tailLen: 0, dropped: 0 };
  const outPush = (s) => {
    if (out.headLen < OUT_HEAD_MAX) {
      out.head.push(s);
      out.headLen += s.length;
      return;
    }
    out.tail.push(s);
    out.tailLen += s.length;
    while (out.tailLen > OUT_TAIL_MAX && out.tail.length > 1) {
      out.dropped += out.tail[0].length;
      out.tailLen -= out.tail[0].length;
      out.tail.shift();
    }
  };
  const outJoin = () =>
    out.tail.length === 0
      ? out.head.join("")
      : out.head.join("") +
        `\n[runner: output truncated — ~${out.dropped} chars dropped]\n` +
        out.tail.join("");

  await new Promise((resolve) => {
    // --dangerously-skip-permissions: headless `claude -p` runs non-interactive,
    // so the default permission mode DENIES file writes (the deliverable never
    // lands) with no prompt to approve. A fresh install has no
    // permissions.defaultMode override, so this flag is required for ANY skill
    // to write its report. The runner only executes self-contained, dev-authored
    // skill prompts (and the user's own installed skills) against the user's own
    // vault on localhost — the same trust boundary as running the skill by hand.
    const proc = spawn(
      CLAUDE_BIN,
      ["-p", prompt, "--model", runModel, "--dangerously-skip-permissions"],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
        // Both spellings: the skills under ~/.claude/skills/ and the agent
        // projects still read the pre-rename HUD_* names (build_deck.py reads
        // HUD_PUBLIC_URL, metrics-pull reads HUD_TZ, publish_instagram.mjs
        // reads HUD_VAULT_ROOT), so those stay until those repos are updated.
        env: {
          ...process.env,
          ...(intent.skill === "bulk-creatives" ? creativeGeminiEnvironment(join(RUNNER_DIR, "..")) : {}),
          CONSOLE_VAULT_ROOT: VAULT_ROOT,
          CONSOLE_RUN_ID: runId,
          CONSOLE_TZ,
          CONSOLE_PUBLIC_URL,
          HUD_VAULT_ROOT: VAULT_ROOT,
          HUD_RUN_ID: runId,
          HUD_TZ: CONSOLE_TZ,
          HUD_PUBLIC_URL: CONSOLE_PUBLIC_URL,
        },
      }
    );
    activeChildren.add(proc);

    proc.stdout.on("data", (chunk) => {
      outPush(chunk.toString());
      appendFile(runMdPath, chunk, () => {});
    });
    proc.stderr.on("data", (chunk) => {
      outPush(chunk.toString());
      appendFile(runMdPath, chunk, () => {});
    });

    const HARD_TIMEOUT_MIN = TIMEOUT_MIN[intent.skill] ?? 10;
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      outPush(`\n[runner: hard timeout ${HARD_TIMEOUT_MIN}m — soft kill sent]\n`);
      try {
        proc.kill(); // SIGTERM — give the child a chance to clean up
      } catch {
        /* ignore */
      }
      // Escalate: a child that ignores the soft signal gets SIGKILLed after a
      // short grace period, so the worker slot can never be held forever.
      killTimer = setTimeout(() => {
        outPush(`\n[runner: SIGKILL after 10s grace]\n`);
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 10_000);
    }, 1000 * 60 * HARD_TIMEOUT_MIN);

    // SINGLE-USE finalizer — `error` and `close` can both fire for the same
    // child; every outcome funnels through here exactly once, and the worker
    // slot is released (resolve) in a finally even if a write throws.
    let settled = false;
    const finalize = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      activeChildren.delete(proc);
      try {
        const tsCompleted = new Date().toISOString();
        status.ts_completed = tsCompleted;
        status.deliverable_verified = null;
        if (outcome.kind === "spawn-error") {
          status.status = "error";
          status.exit_code = -2;
          status.summary = `spawn error: ${outcome.err.message}`.slice(0, 200);
          try {
            appendFileSync(runMdPath, `\n\`\`\`\n\n[runner spawn error] ${outcome.err.message}\n`);
          } catch {
            /* ignore */
          }
          log(`${runId}: spawn error ${outcome.err.message}`);
        } else {
          const code = outcome.code;
          const joined = outJoin().trim();
          const lines = joined.split(/\r?\n/);
          const firstLine =
            lines.find(
              (l) =>
                l.trim().length > 0 &&
                !l.startsWith("Warning:") &&
                !l.startsWith("warning:")
            ) ||
            lines.find((l) => l.trim().length > 0) ||
            "(no output)";
          status.status = timedOut ? "timeout" : code === 0 ? "ok" : "error";
          status.exit_code = code ?? -1;
          status.summary = timedOut
            ? `hard timeout after ${HARD_TIMEOUT_MIN}m — killed`.slice(0, 200)
            : firstLine.slice(0, 200);
          if (status.status === "ok" && deliverable !== null) {
            status.deliverable_verified = existsSync(join(VAULT_ROOT, deliverable));
            if (!status.deliverable_verified) {
              status.status = "ok-unverified";
              log(`${runId}: exit 0 but deliverable missing: ${deliverable}`);
            }
          }
          try {
            appendFileSync(
              runMdPath,
              `\n\`\`\`\n\n---\n*exit code=${code} · status=${status.status} · completed ${tsCompleted}*\n`
            );
          } catch {
            /* ignore */
          }
          log(`${runId}: completed exit=${code} status=${status.status}`);
        }
        writeJson(runJsonPath, status);
      } catch (e) {
        log(`${runId}: finalize failed: ${e.message}`);
      } finally {
        resolve();
      }
    };

    proc.on("close", (code) => finalize({ kind: "close", code }));
    proc.on("error", (err) => finalize({ kind: "spawn-error", err }));
  });

  try {
    unlinkSync(queuePath);
  } catch {
    /* ignore */
  }
}

const POLL_MS = 1500;
async function loop() {
  let delay = POLL_MS;
  while (true) {
    // One transient fs error must never kill scheduling forever — each
    // iteration is guarded, with bounded backoff on repeated failures.
    try {
      enqueueNew();
      // Greedy fill — grab runnable intents until the concurrency cap.
      let progress = true;
      while (progress && active < MAX_CONCURRENT && pending.length > 0) {
        const idx = pickNext();
        if (idx < 0) {
          progress = false;
          break;
        }
        const next = pending.splice(idx, 1)[0];
        const skill = peekSkill(next);
        // Atomic claim — rename into processing/. If it fails, another
        // runner instance owns this file (or it vanished): skip it.
        if (!claimIntent(next)) continue;
        active++;
        if (skill) inFlight.add(skill);
        processing.add(next);
        processOne(next)
          .catch((e) => log(`processOne crashed: ${e.message}`))
          .finally(() => {
            active--;
            if (skill) inFlight.delete(skill);
            processing.delete(next);
          });
      }
      delay = POLL_MS;
    } catch (e) {
      delay = Math.min(delay * 2, 60_000);
      log(`scheduler iteration failed: ${e.message} — backing off ${delay}ms`);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function watchLoop() {
  try {
    const watcher = watch(QUEUE_DIR, { persistent: true });
    for await (const ev of watcher) {
      if (ev.filename && ev.filename.endsWith(".json")) {
        enqueueNew();
      }
    }
  } catch (e) {
    log(`watcher error: ${e.message} — falling back to polling`);
  }
}

process.on("uncaughtException", (err) => {
  log(`uncaught: ${err.stack || err.message}`);
});

// --- Singleton lock — refuse to boot if another runner is alive.
const PIDFILE = join(RUNNER_DIR, "runner.pid");

function pidAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = liveness check, throws if dead
    return true;
  } catch {
    // Doesn't exist (ESRCH) or can't be signalled — either way it's not a
    // runner we could conflict with: treat as stale.
    return false;
  }
}

function readPidfile() {
  try {
    const raw = readFileSync(PIDFILE, "utf8").trim();
    // JSON {pid, started} since hardening; a bare integer is a legacy file.
    const parsed = raw.startsWith("{") ? JSON.parse(raw) : { pid: parseInt(raw, 10) };
    return Number.isInteger(parsed.pid) ? parsed : null;
  } catch {
    return null;
  }
}

// Exclusive create ('wx') closes the check-then-write race: exactly one of
// two concurrent starts wins the create; the loser inspects the winner.
function acquirePidLock() {
  const payload =
    JSON.stringify({ pid: process.pid, started: new Date().toISOString() }) + "\n";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(PIDFILE, payload, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (e) {
      if (e?.code !== "EEXIST") {
        log(`pidfile write failed: ${e.message}`);
        return false;
      }
      const other = readPidfile();
      if (other && other.pid !== process.pid && pidAlive(other.pid)) {
        log(`another runner alive at pid ${other.pid} — exiting this one (pid ${process.pid})`);
        process.exit(0);
      }
      // Stale (dead/recycled pid or unreadable) — remove and retry 'wx'.
      try {
        unlinkSync(PIDFILE);
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

if (!acquirePidLock()) {
  log("could not acquire pid lock — exiting");
  process.exit(1);
}
process.on("exit", () => {
  try {
    const cur = readPidfile();
    if (cur && cur.pid === process.pid) unlinkSync(PIDFILE);
  } catch {
    /* ignore */
  }
});

// Graceful shutdown — terminate active claude children before exiting so a
// stopped runner never leaves orphaned publish jobs running.
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${sig} — terminating ${activeChildren.size} active child(ren), exiting`);
  for (const p of activeChildren) {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }
  const code = sig === "SIGINT" ? 130 : 143;
  if (activeChildren.size === 0) process.exit(code);
  setTimeout(() => {
    for (const p of activeChildren) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    process.exit(code);
  }, 2000);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

ensureDirs();
reconcileProcessing();
const pendingApprovalCount = readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json")).length;
if (pendingApprovalCount > 0) {
  log(`${pendingApprovalCount} live publish(es) awaiting approval in system/queue/pending-approval/`);
}
log(`runner booted (pid ${process.pid}) vault=${VAULT_ROOT} model=${CLAUDE_MODEL}`);
writeHeartbeat();
setInterval(writeHeartbeat, 15_000);
watchLoop();
// A dead scheduler must not keep heartbeating as if alive — exit non-zero so
// a service manager (launchd/systemd/Task Scheduler) can restart the runner.
loop().catch((e) => {
  log(`FATAL: scheduler loop died: ${e.stack || e.message}`);
  process.exit(1);
});
