import fs from "fs";
import path from "path";
import crypto from "crypto";
import { VAULT_ROOT } from "./config";

// ---------------------------------------------------------------------------
// Queue intent contract — shared by /api/queue (deck buttons) and /api/voice
// (spoken commands). ALLOWED_SKILLS must match runner.js buildPrompt() cases.
// ---------------------------------------------------------------------------

const LEGACY_SKILLS = [
  "morning-report",
  "inbox-brief",
  "plan-today",
  "plan-tomorrow",
  "vault-cleanup",
  "voice-ask", // tier-3 open-ended asks → headless claude -p via runner
  // Skills installed in ~/.claude/skills — the runner prompt just invokes
  // the slash-skill and pins the deliverable path.
  "today",
  "close-day",
  "morning-intel",
  "metrics-pull",
  "ads-dashboard",
  // marketing audits (installed skills, AI-driven; write to inbox/reports/{ads,seo,ig})
  "meta-ads-audit",
  "google-ads-audit",
  "seo-audit",
  "aeo-audit",
  "ig-content-strategy",
  // reporting — args {scope, range}; perf-report is AI, report-deck is direct-exec
  "perf-report",
  "report-deck",
  // publishing — runner spawns these with cwd = the agent project (SKILL_CWD)
  "ds-blog-publish",
  "news-carousel", // rrishijainxCarousel-Final → @rrishijain
  // competitive intelligence — runner spawns with cwd = the competitor-xray
  // project; args {brand}. Report lands in inbox/reports/competitors/.
  "competitor-intel",
  // bulk static-ad creatives — cwd = the ads-generator-kit project; args
  // {topic, count, dry_run}. PNGs render via tools/build_ads.py (Gemini).
  "bulk-creatives",
] as const;

// A fresh Jarvis setup uses the personal planner. Claude-dependent and
// publishing commands stay disabled until they are intentionally rebuilt.
export const ALLOWED_SKILLS = new Set<string>(
  process.env.JARVIS_DISABLE_LEGACY_SKILLS === "1" ? [] : LEGACY_SKILLS
);

export function writeIntent(
  skill: string,
  source: string,
  args: Record<string, unknown> = {}
): string {
  if (!ALLOWED_SKILLS.has(skill)) throw new Error(`skill disabled: ${skill}`);
  const id = crypto.randomUUID();
  const intent = { id, skill, args, ts: new Date().toISOString(), source };
  const queueDir = path.join(VAULT_ROOT, "system", "queue");
  fs.mkdirSync(queueDir, { recursive: true });
  fs.writeFileSync(path.join(queueDir, `${id}.json`), JSON.stringify(intent, null, 2), "utf-8");
  return id;
}
