// Rules-engine sweep — dispatch-vs-reference, question hijack, in-flight
// guard, rundown anchoring. Pure rulesRoute/inFlightGuard against synthetic
// state: no network, no Haiku spend, nothing written to the real queue.
// Run: npx -y tsx scripts/test-router.ts
import type { RouteResult } from "../lib/router";
import type { VaultState } from "../lib/vault";
import { DEMO_MARKETING } from "../lib/demo";

process.env.VOICE_NO_WARMUP = "1"; // must be set BEFORE the module loads
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rulesRoute, inFlightGuard } = require("../lib/router") as typeof import("../lib/router");

function state(over: Partial<VaultState> = {}): VaultState {
  return {
    generated_at: new Date().toISOString(),
    vault_root: "",
    metrics: [],
    runner: {
      ts: "",
      pid: 0,
      version: "",
      busy: false,
      active: 0,
      max_concurrent: 3,
      pending: 0,
      heartbeat_age_s: 1,
      alive: true,
    },
    daily: null,
    runs: [],
    queue: [],
    morning: null,
    etas: {},
    marketing: null,
    shipped: [],
    allowed_skills: [],
    engagement: null,
    ...over,
  };
}

// fully populated marketing slice (same fixture the ?demo=marketing console uses)
const withMarketing = state(DEMO_MARKETING);

const briefRunning = state({
  runs: [
    {
      id: "r1",
      skill: "inbox-brief",
      label: null,
      link: null,
      status: "running",
      summary: "",
      ts_completed: null,
      ts_started: new Date().toISOString(),
      duration_s: null,
      deliverable_path: null,
    },
  ],
});

interface Case {
  name: string;
  transcript: string;
  state?: VaultState;
  expect: (r: RouteResult) => boolean;
  want: string;
}

const dispatched = (skill: string) => (r: RouteResult) => r.tier === 1 && r.skill === skill;
const fallsThrough = (r: RouteResult) => r.fallthrough === true;

const CASES: Case[] = [
  // --- clear-cut dispatch still instant (bare alias, ≤5 words, not a question)
  { name: "bare alias", transcript: "morning report", expect: dispatched("morning-report"), want: "tier 1 morning-report" },
  { name: "short command", transcript: "run the morning report", expect: dispatched("morning-report"), want: "tier 1 morning-report" },
  { name: "short audit", transcript: "run the inbox audit", expect: dispatched("inbox-brief"), want: "tier 1 inbox-brief" },
  { name: "polite alias", transcript: "the inbox brief please", expect: dispatched("inbox-brief"), want: "tier 1 inbox-brief" },

  // --- analytical question naming a skill must not re-run it
  {
    name: "question naming skill must NOT dispatch",
    transcript:
      "Based on this morning report, do you have any stories you think we should dig into? Maybe like three of them?",
    expect: fallsThrough,
    want: "fallthrough to model engines",
  },
  // interrogative "do" used to count as a command verb — keep it dead
  {
    name: "interrogative do + alias",
    transcript: "do you think the morning report stuff matters this week?",
    expect: fallsThrough,
    want: "fallthrough",
  },
  // long command phrasing now defers to the model engines (1-2s, still dispatches)
  {
    name: "long command sentence defers",
    transcript: "can you run the inbox audit for me when you get a chance",
    expect: fallsThrough,
    want: "fallthrough",
  },
  // skill reference inside a bigger ask — never a re-dispatch
  {
    name: "reference not order",
    transcript: "once you're done with that inbox brief tell me about fable 5",
    expect: fallsThrough,
    want: "fallthrough",
  },
  {
    name: "question about report content",
    transcript: "what's going on with the morning report today",
    expect: fallsThrough,
    want: "fallthrough",
  },

  // --- rundown stays anchored
  { name: "rundown trigger", transcript: "give me the rundown", expect: (r) => r.tier === 2 && /follow|board|morning|afternoon|evening|midnight/i.test(r.reply), want: "tier 2 briefing" },
  { name: "brief me", transcript: "hey argus brief me", expect: (r) => r.tier === 2, want: "tier 2 briefing" },

  // --- instant tier-2 lanes untouched
  { name: "mic check", transcript: "can you hear me", expect: (r) => r.tier === 2 && r.reply === "Loud and clear.", want: "Loud and clear." },
  { name: "queue", transcript: "what's in the queue", expect: (r) => r.tier === 2, want: "tier 2 queue answer" },

  // --- ARGUS: marketing answers straight from marketing-latest.json
  { name: "roas", transcript: "what's our roas", state: withMarketing, expect: (r) => r.tier === 2 && /ROAS is 1\.81/.test(r.reply) && (r.panels ?? []).includes("paid"), want: "tier 2 roas from snapshot" },
  { name: "roas no data", transcript: "what's our roas", expect: (r) => r.tier === 2 && /pull data/.test(r.reply), want: "tier 2 honest no-data" },
  { name: "month spend", transcript: "how much have we spent this month", state: withMarketing, expect: (r) => r.tier === 2 && /lakh/.test(r.reply) && /over pace/.test(r.reply), want: "tier 2 pacing" },
  { name: "kill list", transcript: "any campaigns to kill", state: withMarketing, expect: (r) => r.tier === 2 && /kill 30 Days Ai Courses Testing/.test(r.reply), want: "tier 2 names the KILL" },
  { name: "data fresh", transcript: "is the data fresh", state: withMarketing, expect: (r) => r.tier === 2 && /meta ads is partial/.test(r.reply), want: "tier 2 mentions partial" },
  { name: "aeo", transcript: "what's our aeo score", state: withMarketing, expect: (r) => r.tier === 2 && /65 out of 100/.test(r.reply), want: "tier 2 aeo" },
  { name: "argus brief", transcript: "hey argus brief me", state: withMarketing, expect: (r) => r.tier === 2 && /ROAS/.test(r.reply) && /Decision queue/.test(r.reply), want: "tier 2 marketing briefing" },
  { name: "brief offers meta audit", transcript: "brief me", state: withMarketing, expect: (r) => r.tier === 2 && /Want me to run the meta ads audit/.test(r.reply), want: "offer matches OFFER_SKILLS" },
  { name: "meta audit alias", transcript: "meta ads audit", expect: dispatched("meta-ads-audit"), want: "tier 1 meta-ads-audit" },
  { name: "audit question stays put", transcript: "what did the meta audit find", expect: fallsThrough, want: "fallthrough" },
  { name: "deck with args", transcript: "build the blended deck for the last 30 days", expect: (r) => r.tier === 1 && r.skill === "report-deck" && r.args?.scope === "blended" && r.args?.range === 30, want: "tier 1 report-deck {blended,30}" },
  { name: "meta report args", transcript: "meta ads report", expect: (r) => r.tier === 1 && r.skill === "perf-report" && r.args?.scope === "meta" && r.args?.range === 7, want: "tier 1 perf-report {meta,7}" },
  { name: "publish blog topic", transcript: "publish a blog post about break-even ROAS for D2C brands", expect: (r) => r.tier === 1 && r.skill === "ds-blog-publish" && r.args?.topic === "break even roas for d2c brands", want: "tier 1 ds-blog-publish + topic" },
  { name: "publish blog draft", transcript: "write a blog post on meta ads budgeting as a draft", expect: (r) => r.tier === 1 && r.skill === "ds-blog-publish" && r.args?.dry_run === true && r.args?.topic === "meta ads budgeting", want: "dry_run + topic" },
  { name: "carousel topic", transcript: "build a carousel on the 4 month program", expect: (r) => r.tier === 1 && r.skill === "news-carousel" && r.args?.topic === "the 4 month program", want: "tier 1 news-carousel + topic" },
  { name: "news carousel topic", transcript: "publish a news carousel about the gemini 3 launch", expect: (r) => r.tier === 1 && r.skill === "news-carousel" && r.args?.topic === "the gemini 3 launch", want: "tier 1 news-carousel + topic" },
  { name: "break the news bare", transcript: "break the news", expect: (r) => r.tier === 1 && r.skill === "news-carousel" && !r.args?.topic, want: "tier 1 news-carousel, no topic" },
  { name: "news carousel dry run", transcript: "build a news carousel as a draft", expect: (r) => r.tier === 1 && r.skill === "news-carousel" && r.args?.dry_run === true, want: "news-carousel dry_run" },
  { name: "bare carousel", transcript: "build a carousel", expect: (r) => r.tier === 1 && r.skill === "news-carousel", want: "the only carousel agent left" },
  { name: "news question not a command", transcript: "what is in the news today", expect: (r) => r.tier !== 1 || r.skill !== "news-carousel", want: "question does not publish" },
  { name: "blog question not publish", transcript: "what did the last blog post say", expect: (r) => r.tier !== 1, want: "not dispatched" },

  // --- competitor intel + bulk creatives (Publish deck additions)
  { name: "competitor intel bare", transcript: "competitor intel", expect: dispatched("competitor-intel"), want: "tier 1 competitor-intel" },
  { name: "competitor report with brand", transcript: "run a competitor report on upgrad", expect: (r) => r.tier === 1 && r.skill === "competitor-intel" && r.args?.brand === "upgrad", want: "tier 1 competitor-intel + brand" },
  { name: "competitor question stays put", transcript: "what did the upgrad competitor report find", expect: fallsThrough, want: "fallthrough" },
  { name: "bulk creatives bare", transcript: "bulk creatives", expect: dispatched("bulk-creatives"), want: "tier 1 bulk-creatives" },
  { name: "make N ads with topic", transcript: "make 10 ads for the 30 day ai course", expect: (r) => r.tier === 1 && r.skill === "bulk-creatives" && r.args?.topic === "the 30 day ai course" && r.args?.count === 10, want: "tier 1 bulk-creatives topic+count" },
  { name: "ads question not a render", transcript: "how are the ads doing this week", expect: (r) => !(r.tier === 1 && r.skill === "bulk-creatives"), want: "question does not render ads" },

  // --- in-flight guard on the surviving dispatch path
  {
    name: "in-flight bare re-ask",
    transcript: "run the inbox brief",
    state: briefRunning,
    expect: (r) => r.tier === 2 && /already running/.test(r.reply),
    want: "tier 2 already-running",
  },
  {
    name: "explicit re-run passes",
    transcript: "run inbox brief again",
    state: briefRunning,
    expect: dispatched("inbox-brief"),
    want: "tier 1 inbox-brief",
  },
];

let failed = 0;
for (const c of CASES) {
  const s = c.state ?? state();
  const r = inFlightGuard(rulesRoute(c.transcript, s), c.transcript, s);
  const ok = c.expect(r);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.name}\n      got: tier ${r.tier}${r.skill ? ` skill=${r.skill}` : ""}${r.fallthrough ? " (fallthrough)" : ""} — "${r.reply.slice(0, 80)}"${ok ? "" : `\n      want: ${c.want}`}`
  );
}
console.log(failed === 0 ? `\nAll ${CASES.length} cases pass.` : `\n${failed}/${CASES.length} FAILED`);
process.exit(failed ? 1 : 0);
