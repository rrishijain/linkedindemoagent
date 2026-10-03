import { homeEnv } from "./homeEnv";
import { CONSOLE_TZ } from "./config";
import { ALLOWED_SKILLS } from "./skills";
import { readMorningReport, readVaultState, type VaultState, type Metric } from "./vault";
import { spokenINR, spokenAge } from "./format";
import { recentExchanges } from "./voiceMemory";

// ---------------------------------------------------------------------------
// route(transcript) → {tier, skill?, reply}. Tier 1 = dispatch a skill to the
// queue, tier 2 = answer from the vault snapshot, tier 3 = needs real
// thinking (not wired yet — honest about it).
// Two engines: Haiku when ANTHROPIC_API_KEY exists (~/.claude/.env), else a
// rule matcher that covers the known commands and dashboard questions.
// Haiku failure falls back to rules — the PTT loop never dies on a 4xx.
// ---------------------------------------------------------------------------

export interface RouteResult {
  tier: 1 | 2 | 3;
  skill?: string;
  reply: string;
  engine: "haiku" | "rules" | "local";
  /** console panels the reply talks about — P3 choreography highlights them */
  panels?: PanelId[];
  /** vault-relative md the reply references — console offers it via the reveal chip */
  deliverable?: string;
  /** "open" = pop the deliverable overlay immediately instead of offering a chip */
  reveal?: "open";
  /** callouts sequenced to the speech — `at` = char offset into the reply
   *  where the relevant sentence starts; the client converts to time */
  reveals?: Reveal[];
  /** rules engine matched nothing concrete — a smarter engine may retry */
  fallthrough?: boolean;
  /** intent args carried into the queue (scope/range for reports, topic for publishing) */
  args?: Record<string, unknown>;
}

export interface Reveal {
  kind: "doc" | "link";
  /** vault-relative md (doc) or full URL (link) */
  target: string;
  label: string;
  at: number;
}

export const PANEL_IDS = [
  // ARGUS panels
  "signals",
  "paid",
  "search",
  "sources",
  "shipped",
  "pacing",
  "decisions",
  "deck",
  "priorities",
  "schedule",
  "news", // AI Newsdesk (left column, live feeds)
  // legacy ids — still emitted by older prompts / memory; console maps them
  "vitals",
  "pipeline",
  "diagnostics",
  "objective",
  "documents",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// alias → skill; order matters when aliases could substring-shadow each other
const SKILL_ALIASES: [RegExp, string][] = [
  [/morning report|am report/, "morning-report"],
  [/inbox/, "inbox-brief"],
  [/clean ?up/, "vault-cleanup"],
  [/plan today|plan the day|plan my day/, "plan-today"],
  [/plan tomorrow/, "plan-tomorrow"],
  // Installed skills. Every pattern here is a deliberate multi-word phrase —
  // never a bare common word. A loose /today/ would swallow half of normal
  // speech ("what's on today") and queue a real run for it.
  [/morning intel|intel sweep|intel brief|ai intel/, "morning-intel"],
  [/close (?:out )?(?:the |my )?day|end of day|wrap up (?:the |my )?day/, "close-day"],
  [/start (?:the |my )?day|open today'?s note|today'?s note|daily note/, "today"],
  [/pull metrics|refresh metrics|metrics pull|refresh the cockpit|pull (?:the )?data|refresh (?:the )?data/, "metrics-pull"],
  [/ads dashboard|ads board|marketing dashboard|rebuild (?:the )?board/, "ads-dashboard"],
  // marketing audits / reports (installed skills)
  [/meta (?:ads )?audit|audit (?:my |the )?meta|facebook ads audit/, "meta-ads-audit"],
  [/google (?:ads )?audit|ppc audit|audit (?:my |the )?google/, "google-ads-audit"],
  [/seo audit|search console audit|audit (?:my |the )?seo/, "seo-audit"],
  [/aeo audit|answer engine audit|ai visibility audit/, "aeo-audit"],
  [/ig strategy|instagram strategy|content strategy/, "ig-content-strategy"],
  [/perf(?:ormance)? report|marketing report|(?:meta|google|seo|ads) report|blended report/, "perf-report"],
  [/(?:weekly|monthly|client|blended|report|meta|google|seo) deck|build (?:the |a )?deck|monday deck/, "report-deck"],
  // publishing — bare forms; topic-carrying sentences go through TOPIC_COMMANDS
  [/publish (?:a |the )?blog|blog post|seo article/, "ds-blog-publish"],
  [/carousel|break(?:ing)? (?:the )?news|news drop/, "news-carousel"],
  [/competitor (?:intel(?:ligence)?|analysis|report|x ?ray|teardown|scan)|competitive intel(?:ligence)?/, "competitor-intel"],
  [/bulk (?:ads|creatives?)|batch of (?:ads|creatives?)|ad batch|static ads|ad variants|creative batch/, "bulk-creatives"],
];

// --- intent args ---------------------------------------------------------------
// Reports take a channel scope + a day range spoken in the same breath
// ("blended deck for the last 30 days"). Publishing takes a topic. Both are
// extracted by rules here and re-validated by the runner (argScope/argRange).
const ARG_SKILLS = new Set(["perf-report", "report-deck"]);

export function marketingArgs(t: string): { scope: string; range: number } {
  const scope = /\bmeta\b|facebook|instagram ads/.test(t)
    ? "meta"
    : /google ads|\bppc\b|search ads|\bgoogle\b/.test(t)
      ? "google"
      : /\bseo\b|search console|organic|\bgsc\b/.test(t)
        ? "seo"
        : "blended";
  const range = /\b(30|thirty) days?\b|this month|monthly|last month/.test(t)
    ? 30
    : /\b(90|ninety) days?\b|quarter/.test(t)
      ? 90
      : 7;
  return { scope, range };
}

// command-with-topic — anchored to the whole utterance so questions about a
// blog post ("what did the last blog post say") never publish one
const TOPIC_COMMANDS: [RegExp, string][] = [
  [
    /^(?:hey |ok |okay )?(?:(?:jarvis|argus),? )?(?:please )?(?:publish|write(?: and publish)?|ship|post|create|draft)\s+(?:a |an |the |another )?(?:new )?(?:seo )?(?:blog(?: post)?|article|post)(?:\s+(?:about|on|for|titled|called)\s+(?<topic>.+))?$/,
    "ds-blog-publish",
  ],
  [
    /^(?:hey |ok |okay )?(?:(?:jarvis|argus),? )?(?:please )?(?:build|make|create|publish|post|ship|generate|render|break|cover)\s+(?:a |an |the )?(?:new )?(?:breaking[- ]?)?(?:ai[- ]?)?news(?:[- ]carousel)?(?:\s+(?:about|on|for|titled|called)\s+(?<topic>.+))?$/,
    "news-carousel",
  ],
  [
    /^(?:hey |ok |okay )?(?:(?:jarvis|argus),? )?(?:please )?(?:build|make|create|publish|post|ship|generate|render)\s+(?:a |an |the )?(?:new )?(?:instagram |ig |insta )?carousel(?:\s+(?:about|on|for|titled|called)\s+(?<topic>.+))?$/,
    "news-carousel",
  ],
  [
    /^(?:hey |ok |okay )?(?:(?:jarvis|argus),? )?(?:please )?(?:run|do|pull|build|make|create|generate|get|start)\s+(?:a |an |the )?(?:full |fresh |new )?(?:competitor|competitive|competition)\s+(?:intel(?:ligence)?|analysis|report|x ?ray|teardown|scan)(?:\s+report)?(?:\s+(?:on|for|about|against)\s+(?<topic>.+))?$/,
    "competitor-intel",
  ],
  [
    /^(?:hey |ok |okay )?(?:(?:jarvis|argus),? )?(?:please )?(?:make|generate|create|build|render|write)\s+(?:me\s+)?(?:(?<count>\d{1,2})\s+)?(?:a\s+|an\s+|the\s+)?(?:bulk\s+|static\s+|new\s+)?(?:ads?|creatives?|ad\s+creatives?|ad\s+variants?)(?:\s+(?:for|about|on|promoting)\s+(?<topic>.+))?$/,
    "bulk-creatives",
  ],
];
const DRY_RUN_RE = /\b(as a draft|draft only|dry run|don'?t publish|do not publish|without publishing)\b/;

function topicCommand(t: string): { skill: string; args: Record<string, unknown> } | null {
  const dry = DRY_RUN_RE.test(t);
  const clean = t.replace(DRY_RUN_RE, " ").replace(/\s+/g, " ").replace(/\s+(please|jarvis|argus)$/g, "").trim();
  for (const [re, skill] of TOPIC_COMMANDS) {
    const m = clean.match(re);
    if (!m || !ALLOWED_SKILLS.has(skill)) continue;
    const topic = m.groups?.topic?.replace(/\s+(please|jarvis|argus)$/g, "").trim().slice(0, 200);
    const args: Record<string, unknown> = {};
    // competitor-intel takes the subject as `brand`; everything else `topic`
    if (topic) args[skill === "competitor-intel" ? "brand" : "topic"] = topic;
    const count = Number(m.groups?.count);
    if (skill === "bulk-creatives" && Number.isInteger(count) && count >= 1 && count <= 30) args.count = count;
    if (dry) args.dry_run = true;
    return { skill, args };
  }
  return null;
}

const QUESTION_START = /^(what|how|is|are|was|did|when|who|where|why|any|do i|does|tell me)\b/;
// The full ~25s rundown fires ONLY on deliberate whole-utterance triggers —
// "give me the rundown", "brief me", "good morning". The old wide net (~20
// loose phrasings) hijacked specific questions ("what's going on with the
// github trending report today" got the whole daily spiel). Specific asks
// now fall through to the model engines, which answer about the THING asked.
const BRIEFING_RE =
  /^(?:hey |ok |okay |so )*(?:(?:jarvis|argus),? )?(?:(?:can you |could you |what'?s |whats )?(?:give me |read me |run )?(?:the |my )?(?:daily |morning |full )?(?:rundown|briefing)|brief me|catch me up|good morning|morning,? (?:jarvis|argus))(?: for today| on today| today)?(?: please)?(?:,? (?:jarvis|argus))?$/;

// Engine order (VOICE_ROUTER=auto, the default): rules answer everything they
// recognize at ~0ms; only an unrecognized utterance pays for a model call —
// Haiku if the key exists, else the local Ollama model, else the generic
// tier-3 fallthrough (voice-ask dispatch). VOICE_ROUTER=local|haiku|rules
// forces one engine first (model engines still degrade to rules on error).
export async function route(transcript: string, convo = ""): Promise<RouteResult> {
  warmHaiku(); // no-op when already warmed — retries a failed module-load ping
  const state = readVaultState();
  const result = await pickEngine(transcript, state, convo);
  return inFlightGuard(result, transcript, state);
}

async function pickEngine(
  transcript: string,
  state: VaultState,
  convo: string
): Promise<RouteResult> {
  const pref = (homeEnv("VOICE_ROUTER") || "auto").toLowerCase();

  if (pref === "haiku") {
    const r = await haikuRoute(transcript, state, convo).catch(() => null);
    return r ?? rulesRoute(transcript, state);
  }
  if (pref === "local") {
    const r = await localRoute(transcript, state, convo).catch(() => null);
    return r ?? rulesRoute(transcript, state);
  }
  if (pref === "rules") return rulesRoute(transcript, state);

  // auto — rules first, smarter engine only for the generic fallthrough
  const viaRules = rulesRoute(transcript, state);
  if (!viaRules.fallthrough) return viaRules;
  if (homeEnv("ANTHROPIC_API_KEY")) {
    const viaHaiku = await haikuRoute(transcript, state, convo).catch(() => null);
    if (viaHaiku) return viaHaiku;
  }
  const viaLocal = await localRoute(transcript, state, convo).catch(() => null);
  return viaLocal ?? viaRules;
}

// --- in-flight guard ----------------------------------------------------------
// A skill mention isn't always a dispatch: "once you're done with that inbox
// brief, tell me about Fable 5" REFERENCES the running brief — it doesn't
// order a second one. When any engine routes tier 1 for a skill that's
// already queued or running (and the user didn't explicitly ask for a
// repeat), reroute: substantial residue beyond the alias → tier-3 background
// ask with the full sentence; bare re-dispatch → "already running".

const RERUN_RE = /\b(again|another|re-?run|one more|fresh|new one)\b/;
// dispatch verbs, temporal connectives, and politeness — NOT content words
const RESIDUE_FILLER =
  /\b(once|when|after|while|you'?re?|are|is|it'?s?|done|finished|finish(es)?|complete(s|d)?|with|that|the|a|an|and|then|can|could|would|you|please|jarvis|argus|hey|ok|okay|so|also|me|my|run|pull|do|start|fire|kick|queue|launch|scan|fetch|refresh|get|brief|report|audit)\b/g;

function skillInFlight(skill: string, state: VaultState): boolean {
  return (
    state.queue.some((q) => q.skill === skill) ||
    state.runs.some((r) => r.skill === skill && r.status === "running")
  );
}

// exported for tests — route() applies it internally
export function inFlightGuard(r: RouteResult, transcript: string, state: VaultState): RouteResult {
  if (r.tier !== 1 || !r.skill || !skillInFlight(r.skill, state)) return r;
  const t = transcript.toLowerCase();
  if (RERUN_RE.test(t)) return r; // explicit repeat — let it through
  const name = r.skill.replace(/-/g, " ");
  const alias = SKILL_ALIASES.find(([re]) => re.test(t))?.[0];
  const residue = t
    .replace(alias ?? /$^/, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(RESIDUE_FILLER, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (residue.length >= 3) {
    // there's a real ask riding along with the reference — background it
    return {
      tier: 3,
      reply: `The ${name} is already in the works — I'll dig into the rest of that and get back to you.`,
      engine: r.engine,
      panels: ["pipeline"],
    };
  }
  return {
    tier: 2,
    reply: `The ${name} is already running — I'll let you know the moment it lands.`,
    engine: r.engine,
    panels: ["pipeline"],
  };
}

// --- rules engine -----------------------------------------------------------

// --- offer follow-through ----------------------------------------------------
// The kickoff brief ends with "Want me to run the inbox audit?" — a bare "yes"
// must dispatch that skill. The offer is recovered from the LAST exchange in
// convo memory (fresh within 3 min), so this stays stateless per-request.

const AFFIRM_RE =
  /^(yes|yeah|yep|sure|absolutely|go ahead|do it|let'?s do it|please do|yes please|go for it|sounds good)( please)?,?( (?:jarvis|argus))?$/;
const DECLINE_RE =
  /^(no|nope|nah|not (right )?now|not yet|later|maybe later|hold off|skip it)( thanks| thank you)?,?( (?:jarvis|argus))?$/;
const OFFER_SKILLS: Record<string, string> = {
  "morning report": "morning-report",
  "inbox audit": "inbox-brief",
  "meta ads audit": "meta-ads-audit",
};

function pendingOffer(): string | null {
  const last = recentExchanges(1)[0];
  if (!last || Date.now() - Date.parse(last.ts) > 3 * 60 * 1000) return null;
  const m = last.argus
    .toLowerCase()
    .match(/want me to (?:run|pull) (?:the )?(?:daily )?(morning report|inbox audit|meta ads audit)/);
  return m ? OFFER_SKILLS[m[1]] ?? null : null;
}

// dispatch acks must not lie: the intent always queues, but if the runner
// daemon's heartbeat is gone it won't START until someone restarts it —
// say so instead of a cheery "On it"
function runnerDownNote(state: VaultState): string | null {
  return state.runner?.alive
    ? null
    : "but heads up — the runner daemon looks down, so it'll sit in the queue until that's restarted.";
}

// exported for tests — route() applies it internally
export function rulesRoute(transcript: string, state: VaultState): RouteResult {
  const t = transcript.toLowerCase().replace(/[^a-z0-9$:'\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { tier: 3, reply: "I didn't catch that.", engine: "rules" };

  // answer to a standing offer beats everything else
  if (AFFIRM_RE.test(t) || DECLINE_RE.test(t)) {
    const offered = pendingOffer();
    if (offered && AFFIRM_RE.test(t)) {
      return {
        tier: 1,
        skill: offered,
        reply: `On it — ${offered.replace(/-/g, " ")} ${runnerDownNote(state) ?? "running now."}`,
        engine: "rules",
        panels: ["deck"],
      };
    }
    if (offered) return { tier: 2, reply: "Standing by.", engine: "rules" };
  }

  const isQuestion = QUESTION_START.test(t) || transcript.includes("?");

  // open-verbs preempt skill dispatch — "show me the trend scan" means the
  // DOCUMENT from the last run, not "run a fresh scan"
  const doc = openDocAnswer(t, state);
  if (doc) {
    return {
      tier: 2,
      reply: doc.text,
      engine: "rules",
      panels: doc.panels,
      deliverable: doc.deliverable,
      reveal: doc.reveal,
    };
  }

  // NO verb-based dispatch here. A command-verb-anywhere + alias-anywhere
  // rule misfired twice on questions that merely mention a skill ("…do you
  // have any you think we should video?" — interrogative "do" counted as a
  // verb and re-ran github-trending). Sentence-level intent is the model
  // engines' job; rules dispatch ONLY the bare-alias short utterances below.

  // command-with-topic ("publish a blog post about break-even ROAS") — a
  // full sentence, but unambiguous because it is anchored start to end. Must
  // run BEFORE stateAnswer: the topic may contain "roas"/"budget" and would
  // otherwise be answered as a question about the wall
  const topic = !isQuestion ? topicCommand(t) : null;
  if (topic) {
    const ack: Record<string, [string, string, string]> = {
      "ds-blog-publish": ["writing and publishing", "the blog post", "I'll read you the link when it's up."],
      "news-carousel": ["building and posting", "the news carousel", "I'll read you the link when it's up."],
      "competitor-intel": ["digging into", "the competitor teardown", "I'll tell you what's worth stealing when it's done."],
      "bulk-creatives": ["writing and rendering", "the ad batch", "I'll shout when the creatives are ready."],
    };
    const [verb, what, tail] = ack[topic.skill] ?? ["running", topic.skill.replace(/-/g, " "), "coming up."];
    const subject = (topic.args.topic ?? topic.args.brand) as string | undefined;
    const on = subject ? ` on ${subject}` : "";
    const mode = topic.args.dry_run ? " as a draft" : "";
    return {
      tier: 1,
      skill: topic.skill,
      args: topic.args,
      reply: `On it — ${verb} ${what}${on}${mode}. ${runnerDownNote(state) ?? tail}`,
      engine: "rules",
      panels: ["deck", "shipped"],
    };
  }

  const answer = stateAnswer(t, state);
  if (answer) {
    return {
      tier: 2,
      reply: answer.text,
      engine: "rules",
      panels: answer.panels,
      deliverable: answer.deliverable,
      reveal: answer.reveal,
      reveals: answer.reveals,
    };
  }

  // chitchat — instant tier-2 reply; without this, "hey what's up" fell
  // through to tier 3 and burned a 30s+ background run on a greeting
  const chat = smalltalk(t, state);
  if (chat) return { tier: 2, reply: chat, engine: "rules" };

  // bare alias, short utterance ("trend scan", "the inbox brief please") —
  // clear-cut dispatch. Longer sentences that name-drop a skill without a
  // command verb are ambiguous: defer to the model engines (when in doubt,
  // let something that can read decide).
  const skill = matchSkill(t);
  // report skills carry scope/range words, so they get a longer leash
  const maxWords = skill && ARG_SKILLS.has(skill) ? 10 : 5;
  if (skill && !isQuestion && t.split(/\s+/).length <= maxWords) {
    const args = ARG_SKILLS.has(skill) ? marketingArgs(t) : undefined;
    const scopeNote = args ? ` — ${args.scope}, last ${args.range} days` : "";
    return {
      tier: 1,
      skill,
      args,
      reply: `On it — ${skill.replace(/-/g, " ")}${scopeNote} ${runnerDownNote(state) ?? "coming up."}`,
      engine: "rules",
      panels: ["deck"],
    };
  }

  return {
    tier: 3,
    reply: runnerDownNote(state)
      ? "I've queued that, but heads up — the runner daemon looks down, so it'll wait until that's restarted."
      : "Working on it — I'll speak up when it lands.",
    engine: "rules",
    fallthrough: true,
  };
}

// --- smalltalk -----------------------------------------------------------
// Greetings, acks, mic checks — answered instantly, NEVER dispatched to the
// runner. Note: `t` is already lowercased with ?!. stripped (apostrophes kept).

function smalltalk(t: string, state: VaultState): string | null {
  if (/\b(can you hear me|are you there|you there|you up|mic check|testing testing|test test)\b/.test(t)) {
    return "Loud and clear.";
  }
  if (/\b(thank you|thanks|appreciate it|appreciate you)\b/.test(t)) {
    return "Anytime, man.";
  }
  if (/\b(good ?night|i'?m off|heading to bed|signing off|see you tomorrow)\b/.test(t)) {
    return "Goodnight — I've got things covered here. Sleep well.";
  }
  // bare acks in any short combo: "ok", "okay cool", "nice one argus"
  if (/^((ok(ay)?|cool|nice|got it|sounds good|great|perfect|alright|sweet|then|one|man|jarvis|argus)\s*){1,4}$/.test(t)) {
    return "Standing by.";
  }
  if (/\b(how are you|how'?s it going|how you doing|you good|you doing ok)\b/.test(t)) {
    return "I'm good — everything's humming along here. What's up?";
  }
  if (
    /\b(what'?s up|whats up|wassup|what is up)\b/.test(t) ||
    /^(hey|hi|hello|yo|sup|hey there|good (morning|afternoon|evening))( there)?( (?:jarvis|argus))?$/.test(t)
  ) {
    return greetingReply(state);
  }
  return null;
}

// greeting gets a one-breath status so "what's up" actually answers the
// question — and points at the briefing for the long version
function greetingReply(state: VaultState): string {
  const bits: string[] = [];
  if (state.runner?.busy) bits.push("the runner's mid-job");
  const open = state.daily?.isToday ? state.daily.top3.filter((p) => !p.done).length : 0;
  if (open > 0) bits.push(`${open === 1 ? "one directive" : `${open} directives`} still open`);
  const status = bits.length > 0 ? bits.join(" and ") : "all quiet on my end";
  return `Not much — ${status}. Say brief me if you want the rundown.`;
}

function matchSkill(t: string): string | null {
  for (const [re, skill] of SKILL_ALIASES) {
    if (re.test(t) && ALLOWED_SKILLS.has(skill)) return skill;
  }
  return null;
}

function metric(state: VaultState, source: string, name: string): Metric | null {
  return state.metrics.find((m) => m.source === source && m.metric === name) ?? null;
}

// --- spoken-friendly formatting ----------------------------------------------
// Raw digits ("13,913") make TTS stumble; rounded magnitudes ("about 14
// thousand") flow like a person talking — and that's the register we want.

function spokenNum(v: number): string {
  const x = Math.round(Math.abs(v));
  if (x >= 1_000_000) {
    const m = x / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10} million`;
  }
  // whole thousands only — "4.7 thousand" makes TTS stumble ("four…seven");
  // the demo register is clean wave-tops, precision lives on screen
  if (x >= 1_000) return `${Math.round(x / 1000)} thousand`;
  return String(x);
}

function spokenRoas(v: number | null | undefined): string {
  if (v === null || v === undefined) return "unknown";
  return `${v.toFixed(2).replace(/\.?0+$/, "")}`;
}

function spokenTime(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const h24 = parseInt(m[1], 10);
  const h = h24 % 12 || 12;
  const ap = h24 >= 12 ? "PM" : "AM";
  return m[2] === "00" ? `${h} ${ap}` : `${h}:${m[2]} ${ap}`;
}

// --- daily briefing ----------------------------------------------------------

function localHour(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CONSOLE_TZ,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
}

// `## Headlines` mining lives in lib/vault.ts (readMorningReport) — shared
// with the AI Wire panel; the briefing speaks the top two

function nextScheduleItem(state: VaultState): { time: string; item: string } | null {
  const d = state.daily;
  if (!d?.isToday || d.schedule.length === 0) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    d.schedule.find((s) => {
      const m = s.time.match(/^(\d{1,2}):(\d{2})$/);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) > nowMin : false;
    }) ?? null
  );
}

// parentheticals read terribly out loud — "(PTT loop + barge-in on camera)"
function stripParens(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, "").trim();
}

// one headline, parentheticals stripped, cut at a CLAUSE boundary — a dangling
// "beating X by 10%+ on some." reads worse than stopping a clause early
function trimHead(h: string): string {
  let s = stripParens(h);
  if (s.length > 120) {
    const head = s.slice(0, 120);
    const clause = Math.max(head.lastIndexOf(","), head.lastIndexOf(" — "), head.lastIndexOf("; "));
    s = clause > 60 ? head.slice(0, clause) : head.slice(0, head.lastIndexOf(" "));
    s = s.replace(/[,;:—–-]\s*$/, "").trim();
  }
  return s;
}

// "wave-top" headline — first clause only, the kind of thing you'd expand on
// if asked ("Claude released Fable"), not the whole paragraph
function waveTop(h: string): string {
  const s = stripParens(h);
  const dash = s.indexOf(" — ");
  const comma = s.indexOf(", ");
  const cuts = [dash, comma].filter((i) => i > 25);
  const cut = cuts.length > 0 ? Math.min(...cuts) : -1;
  return (cut > 0 ? s.slice(0, cut) : trimHead(s)).slice(0, 90);
}

// Morning-kickoff template — the shape, not a script. Every slot fills from
// live state at ask-time:
//   paid media pulse (spend + ROAS vs breakeven) → decision queue → budget
//   pacing → data freshness (only if not fresh) → ONE AI headline → today's
//   mission → a concrete offer. Wave tops only; ~60 words.
function briefing(state: VaultState): {
  text: string;
  deliverable?: string;
  reveals: Reveal[];
} {
  const parts: string[] = [];
  const reveals: Reveal[] = [];
  const mark = () => parts.join(" ").length + (parts.length > 0 ? 1 : 0);
  const d = state.daily;
  const mk = state.marketing;
  const meta = mk?.channels.meta;
  const t = meta?.totals;

  const h = localHour();
  const opener =
    h < 5 ? "Burning the midnight oil." : h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.";

  if (mk && t && mk.latest_reports.dashboard) {
    reveals.push({ kind: "doc", target: mk.latest_reports.dashboard, label: "dashboard", at: mark() });
  }
  if (t) {
    const be = mk!.targets.breakeven_roas;
    const vs = t.roas === null ? "" : t.roas < be ? ` — under your ${spokenRoas(be)} breakeven` : t.roas >= mk!.targets.target_roas ? " — on target" : " — above breakeven, under target";
    const partial = meta!.status === "partial" ? ` That's ${meta!.accounts_ok} of ${meta!.accounts_total} Meta accounts, so treat it as partial.` : "";
    parts.push(`${opener} Meta spent ${spokenINR(t.spend)} over the last ${meta!.window?.days ?? 7} days at a ROAS of ${spokenRoas(t.roas)}${vs}.${partial}`);
  } else {
    parts.push(`${opener} No paid-media numbers yet — say pull data and I'll fetch them.`);
  }

  if (mk) {
    const camps = [...mk.channels.meta.campaigns, ...mk.channels.google.campaigns];
    const kills = camps.filter((c) => c.verdict === "KILL");
    const fixes = camps.filter((c) => c.verdict === "FIX");
    if (kills.length || fixes.length) {
      const bits: string[] = [];
      if (kills.length) bits.push(`${kills.length === 1 ? "one campaign" : `${kills.length} campaigns`} to kill — ${listOut(kills.slice(0, 2).map((c) => c.campaign.replace(/_/g, " ")))}`);
      if (fixes.length) bits.push(`${fixes.length} to fix`);
      parts.push(`Decision queue: ${bits.join(", and ")}.`);
    }
    const p = mk.pacing;
    if (p && p.spend_mtd > 0) {
      const est = p.estimated ? " by run-rate" : "";
      const pace = p.status === "over" ? `over pace — projecting ${spokenINR(p.projected_eom)} against a ${spokenINR(p.budget)} budget` : p.status === "under" ? `under pace at ${Math.round(p.pace_pct ?? 0)} percent` : "on pace";
      parts.push(`Month to date you're at ${spokenINR(p.spend_mtd)}${est}, ${pace}.`);
    }
    if (mk.pull.overall !== "fresh") {
      const bad = mk.pull.sources.filter((x) => x.core && !["ok", "skipped", "mock"].includes(x.status)).map((x) => x.source.replace(/_/g, " "));
      const skipped = mk.pull.sources.filter((x) => x.core && x.status === "skipped").map((x) => x.source.replace(/_/g, " "));
      const note = [bad.length ? `${listOut(bad)} ${bad.length === 1 ? "is" : "are"} ${mk.pull.overall}` : "", skipped.length ? `${listOut(skipped)} not wired yet` : ""].filter(Boolean).join("; ");
      if (note) parts.push(`Data check: ${note}.`);
    }
  }

  const report = readMorningReport(2);
  const heads = report?.heads ?? [];
  if (heads[0]) {
    if (report?.rel) reveals.push({ kind: "doc", target: report.rel, label: "morning report", at: mark() });
    const src = report?.links?.[0];
    if (src) reveals.push({ kind: "link", target: src, label: "source", at: mark() });
    parts.push(`Big story in AI today: ${waveTop(heads[0])}.`);
  }

  if (d?.isToday) {
    const open = d.top3.filter((p) => !p.done);
    if (open.length > 0) {
      parts.push(`Biggest thing on today's board: ${stripParens(open[0].text).slice(0, 80)}.`);
    } else if (d.top3.length > 0) {
      parts.push("The board's clear — all three directives done.");
    }
  } else {
    parts.push("No daily note yet — say start my day and I'll set one up.");
  }

  const r = state.runner;
  if (r && !r.alive) parts.push("Heads-up — the background runner looks offline.");

  // hand the mic back with a CONCRETE offer — "yes" dispatches it (see
  // pendingOffer / AFFIRM_RE). Phrasing must match OFFER_SKILLS keys.
  const offer = briefingOffer(state, heads.length > 0);
  if (/inbox audit/.test(offer)) {
    reveals.push({ kind: "link", target: "https://mail.google.com", label: "inbox", at: mark() });
  }
  parts.push(offer);

  // safety cap — drop whole sentences, never chop mid-word
  let text = parts.join(" ");
  if (text.length > 800) {
    text = text.slice(0, 800);
    const cut = text.lastIndexOf(". ");
    if (cut > 200) text = text.slice(0, cut + 1);
  }
  return {
    text,
    deliverable: state.marketing?.latest_reports.dashboard ?? report?.rel,
    reveals: reveals.filter((r) => r.at < text.length),
  };
}

// state-picked closing offer — wording is load-bearing: pendingOffer() parses
// it back out of convo memory when the user answers "yes"
function briefingOffer(state: VaultState, hasReport: boolean): string {
  // the offer phrase must stay verbatim-matchable by pendingOffer()'s regex;
  // the open-ended tail rides AFTER it and never reaches the capture group
  const TAIL = ", or do you have anything else in mind?";
  const camps = [...(state.marketing?.channels.meta.campaigns ?? []), ...(state.marketing?.channels.google.campaigns ?? [])];
  const needsAudit = camps.some((c) => c.verdict === "KILL" || c.verdict === "FIX");
  if (needsAudit && ALLOWED_SKILLS.has("meta-ads-audit")) return `Want me to run the meta ads audit${TAIL}`;
  const h = localHour();
  if (!hasReport && h < 16) return `Want me to run the morning report${TAIL}`;
  return `Want me to run the daily inbox audit${TAIL}`;
}

interface StateAnswer {
  text: string;
  panels: PanelId[];
  deliverable?: string;
  reveal?: "open";
  reveals?: Reveal[];
}

// "bring up the html" / "open that report" — find the deliverable a recent
// run produced and pop it on screen NOW. Without this, asking to see a doc
// burned a whole background claude session just to open a file.
const OPEN_VERB = /\b(bring up|pull up|open|show me|show us|put up|display)\b/;
const DOC_WORD = /\b(that|it|html|page|explainer|doc|document|report|file|deliverable|note|results?)\b/;
const OPEN_STOPWORDS =
  /\b(bring|pull|up|open|show|me|us|put|display|the|that|it|for|can|you|please|jarvis|argus|again|back|one|thing|doc|document|file|note|report|reports|today|todays|dashboard)\b/g;

function openDocAnswer(t: string, state: VaultState): StateAnswer | null {
  if (!OPEN_VERB.test(t)) return null;
  // "give me the rundown"-style asks stay with the briefing
  if (/\brundown|briefing|brief me|catch me up\b/.test(t)) return null;
  const cands = state.runs.filter((r) => r.status === "ok" && r.deliverable_path);
  const words = t.replace(OPEN_STOPWORDS, " ").split(/\s+/).filter((w) => w.length > 2);
  // newest first; keyword overlap against skill + summary + filename promotes
  // an older doc only when the ask clearly names it ("the trend scan")
  let best = cands[0] ?? null;
  let bestScore = 0;
  for (const r of cands) {
    // skill + label + summary + FILENAME only — full paths poisoned scoring
    // (every inbox-brief lives under inbox/reports/, which substring-matched
    // "repo" and "report" and outscored the doc actually being asked for)
    const file = r.deliverable_path?.split("/").pop() ?? "";
    const hay = `${r.skill} ${r.label ?? ""} ${r.summary} ${file}`.toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  // open intent needs either a generic doc word ("that"/"report"/"html") or a
  // keyword hit on an actual run ("the trend scan") — otherwise it's not ours
  if (!DOC_WORD.test(t) && bestScore === 0) return null;
  // the morning report lives outside the runs list — resolve it directly
  if (bestScore === 0 && /\bmorning\b/.test(t) && state.morning) {
    return {
      text: "Here's this morning's report. On screen now.",
      panels: ["shipped"],
      deliverable: state.morning.rel,
      reveal: "open",
    };
  }
  // specific words but nothing matched — opening whatever's newest is a lie
  if (bestScore === 0 && words.length > 0) {
    return {
      text: "I don't see a recent document matching that — the Documents panel has the last five.",
      panels: ["shipped"],
    };
  }
  if (!best) {
    return { text: "I don't have any documents on file yet.", panels: ["shipped"] };
  }
  return {
    text: `Here it is — the ${best.skill.replace(/-/g, " ")} from earlier. On screen now.`,
    panels: ["shipped"],
    deliverable: best.deliverable_path!,
    reveal: "open",
  };
}

function stateAnswer(t: string, state: VaultState): StateAnswer | null {
  const doc = openDocAnswer(t, state);
  if (doc) return doc;
  if (BRIEFING_RE.test(t)) {
    const b = briefing(state);
    return {
      text: b.text,
      panels: ["paid", "decisions", "pacing", "priorities"],
      deliverable: b.deliverable,
      reveals: b.reveals,
    };
  }
  const ma = marketingAnswer(t, state);
  if (ma) return ma;
  if (/runner|daemon/.test(t)) {
    const r = state.runner;
    if (!r) return { text: "The runner looks down — I'm not seeing a status file.", panels: ["deck"] };
    return {
      text: r.alive
        ? `Runner's alive and ${r.busy ? `working — ${r.active} job${r.active === 1 ? "" : "s"} active` : "idle"}${r.pending > 0 ? `, ${r.pending} waiting in the queue` : ""}.`
        : "The runner's heartbeat has gone stale — it looks down.",
      panels: ["deck"],
    };
  }
  if (/token|claude usage/.test(t)) {
    const m = metric(state, "claude_code", "tokens_5h");
    return {
      text: m
        ? `You've used ${spokenNum(m.value)} Claude tokens in the current five-hour window.`
        : "I don't have a token reading.",
      panels: ["sources"],
    };
  }
  if (/queue/.test(t)) {
    if (state.queue.length === 0) return { text: "The queue's empty.", panels: ["deck"] };
    const names = state.queue.map((q) => q.skill.replace(/-/g, " ")).join(", ");
    return {
      text: `${state.queue.length === 1 ? "One thing" : `${state.queue.length} things`} in the queue: ${names}.`,
      panels: ["deck"],
    };
  }
  if (/top 3|top three|priorit|directive/.test(t)) {
    const d = state.daily;
    if (!d || d.top3.length === 0) return { text: "Nothing's on the board yet.", panels: ["priorities"] };
    const open = d.top3.filter((p) => !p.done);
    return {
      text:
        open.length === 0
          ? "You've cleared all three priorities. Strong day."
          : `${open.length === 1 ? "One left" : `${open.length} still open`}: ${listOut(open.map((p) => p.text))}.`,
      panels: ["priorities"],
    };
  }
  if (/schedule|next today|what s next|whats next|next up/.test(t)) {
    const d = state.daily;
    if (!d || d.schedule.length === 0) return { text: "Nothing's on the schedule.", panels: ["schedule"] };
    const next = d.isToday ? nextScheduleItem(state) : null;
    return {
      text: next
        ? `Coming up at ${spokenTime(next.time)} — ${next.item}.`
        : d.isToday
          ? "You're clear for the rest of the day."
          : "No schedule for today yet — say plan today and I'll set one up.",
      panels: ["schedule"],
    };
  }
  if (/focus/.test(t)) {
    const d = state.daily;
    return {
      text: d?.focus ? `Today's focus is ${d.focus}.` : "No focus set for today.",
      panels: ["schedule"],
    };
  }
  if (/last run|last fail|recent run/.test(t)) {
    const r = state.runs.find((x) => x.status === "ok" || x.status === "error");
    if (!r) return { text: "No recent runs.", panels: ["shipped"] };
    return {
      text: `The last run was ${r.skill.replace(/-/g, " ")} — it ${r.status === "ok" ? "finished fine" : "failed"}. ${r.summary.slice(0, 120)}`,
      panels: ["shipped", "deck"],
    };
  }
  return null;
}

// --- marketing answers ---------------------------------------------------------
// Instant tier-2 replies straight from marketing-latest.json. Every number is
// pre-verdicted there; here we only choose words. `t` is lowercased/stripped.
function marketingAnswer(t: string, state: VaultState): StateAnswer | null {
  const mk = state.marketing;
  const none = (what: string): StateAnswer => ({
    text: `I don't have ${what} yet — say pull data and I'll fetch it.`,
    panels: ["sources"],
  });
  const meta = mk?.channels.meta;
  const tot = meta?.totals;
  const T = mk?.targets;
  const partial = meta?.status === "partial" ? ` Mind that Meta is partial — ${meta.accounts_ok} of ${meta.accounts_total} accounts.` : "";

  if (/\broas\b|\br o a s\b|return on ad spend|return on adspend/.test(t)) {
    if (!tot || tot.roas === null) return none("a ROAS reading");
    const be = T!.breakeven_roas;
    const tg = T!.target_roas;
    const vs = tot.roas < be ? `below your ${spokenRoas(be)} breakeven` : tot.roas >= tg ? `above the ${spokenRoas(tg)} target` : `above breakeven but short of the ${spokenRoas(tg)} target`;
    const mtd = mk!.pacing.blended_roas_mtd !== null ? ` Month to date it's ${spokenRoas(mk!.pacing.blended_roas_mtd)}.` : "";
    return { text: `ROAS is ${spokenRoas(tot.roas)} over the last ${meta!.window?.days ?? 7} days — ${vs}.${mtd}${partial}`, panels: ["paid", "pacing"] };
  }
  if (/how much (?:have we|did we|have i|did i) spen|spend this month|spent this month|month to date|\bmtd\b|budget|pacing|on pace/.test(t)) {
    const p = mk?.pacing;
    if (!p || !p.spend_mtd) return none("a month-to-date spend figure");
    const est = p.estimated ? " — that's an estimate from the seven-day run rate" : "";
    const pace = p.status === "over" ? "over" : p.status === "under" ? "under" : "on";
    return {
      text: `You've spent ${spokenINR(p.spend_mtd)} this month${est}. That's ${Math.round(p.pace_pct ?? 0)} percent of where the ${spokenINR(p.budget)} budget should be on day ${p.day}, so you're ${pace} pace, projecting ${spokenINR(p.projected_eom)} by month end.`,
      panels: ["pacing"],
    };
  }
  if (/ad ?spend|spend (?:last|this) week|seven day spend|7 day spend|how much (?:are we|am i) spending|what did we spend/.test(t)) {
    if (!tot) return none("a spend figure");
    const rev = tot.revenue ? ` for ${spokenINR(tot.revenue)} in revenue` : "";
    return { text: `Meta spent ${spokenINR(tot.spend)} over the last ${meta!.window?.days ?? 7} days${rev}.${partial}`, panels: ["paid"] };
  }
  if (/\bcpa\b|cost per (?:acquisition|sale|purchase|result)|\bcpl\b|cost per lead/.test(t)) {
    if (!tot || (tot.cpa === null && !tot.cpl)) return none("a cost-per-result reading");
    if (tot.cpa !== null && tot.cpa !== undefined) {
      const over = tot.cpa > T!.max_cpa ? " — over the ceiling" : tot.cpa > T!.target_cpa ? " — above target but under the ceiling" : " — on target";
      return { text: `CPA is ${spokenINR(tot.cpa)} against a ${spokenINR(T!.target_cpa)} target and ${spokenINR(T!.max_cpa)} ceiling${over}.`, panels: ["paid"] };
    }
    return { text: `Cost per lead is ${spokenINR(tot.cpl)} against a ${spokenINR(T!.target_cpl)} target.`, panels: ["paid"] };
  }
  if (/\bctr\b|click.?through/.test(t)) {
    if (!tot || tot.ctr === null) return none("a CTR reading");
    return { text: `CTR's at ${tot.ctr.toFixed(2)} percent — ${tot.ctr >= T!.min_ctr ? "above" : "below"} the ${T!.min_ctr.toFixed(1)} percent floor.`, panels: ["paid"] };
  }
  if (/campaigns? to (?:kill|cut|pause|stop)|what should (?:i|we) (?:kill|cut|pause|scale)|decision queue|any (?:losers|winners)|which campaigns|kill list/.test(t)) {
    if (!mk) return none("campaign verdicts");
    const camps = [...mk.channels.meta.campaigns, ...mk.channels.google.campaigns];
    const kills = camps.filter((c) => c.verdict === "KILL").map((c) => c.campaign.replace(/_/g, " "));
    const fixes = camps.filter((c) => c.verdict === "FIX").map((c) => c.campaign.replace(/_/g, " "));
    const scale = camps.filter((c) => c.verdict === "SCALE").map((c) => c.campaign.replace(/_/g, " "));
    if (!kills.length && !fixes.length) return { text: `Nothing's flagged — ${camps.length ? "every campaign is above breakeven" : "no campaign data yet"}.${scale.length ? ` ${listOut(scale.slice(0, 2))} ${scale.length === 1 ? "is" : "are"} clear to scale.` : ""}`, panels: ["decisions"] };
    const bits: string[] = [];
    if (kills.length) bits.push(`kill ${listOut(kills.slice(0, 3))}`);
    if (fixes.length) bits.push(`fix ${listOut(fixes.slice(0, 3))}`);
    if (scale.length) bits.push(`${listOut(scale.slice(0, 2))} ${scale.length === 1 ? "is" : "are"} clear to scale`);
    return { text: `${kills.length + fixes.length} flagged: ${bits.join("; ")}. The dashboard has the why.`, panels: ["decisions"], deliverable: mk.latest_reports.dashboard };
  }
  if (/is the data fresh|how (?:old|fresh) is the data|data fresh|last pull|when did (?:you|we) last pull|can i trust|data (?:ok|okay|good)/.test(t)) {
    if (!mk) return none("a pull record");
    const pull = mk.pull;
    const bad = pull.sources.filter((x) => x.core && !["ok", "skipped", "mock"].includes(x.status)).map((x) => `${x.source.replace(/_/g, " ")} is ${x.status}`);
    const skipped = pull.sources.filter((x) => x.core && x.status === "skipped").map((x) => x.source.replace(/_/g, " "));
    const tail = [bad.length ? listOut(bad) : "", skipped.length ? `${listOut(skipped)} ${skipped.length === 1 ? "isn't" : "aren't"} wired yet` : ""].filter(Boolean).join("; ");
    return { text: `Last pull was ${spokenAge(pull.newest_age_s)}. ${tail ? `${tail}.` : "Everything came back clean."}`, panels: ["sources"] };
  }
  if (/\baeo\b|answer engine|ai visibility|chatgpt|perplexity|ai search/.test(t)) {
    const a = mk?.aeo;
    if (!a || a.score === null || a.score === undefined) return none("an AEO reading");
    const gaps: string[] = [];
    if (a.faq_schema === false) gaps.push("FAQ schema");
    if (a.org_schema === false) gaps.push("organization schema");
    if (a.llms_txt === false) gaps.push("an llms dot txt");
    return { text: `AEO readiness is ${Math.round(a.score)} out of 100 against a ${Math.round(a.min_score ?? 70)} floor${gaps.length ? ` — you're missing ${listOut(gaps)}` : ""}.`, panels: ["search"] };
  }
  if (/\bseo\b|organic|search console|\bgsc\b|organic clicks|google clicks/.test(t)) {
    const seo = mk?.channels.seo;
    if (!seo?.totals) return { text: seo?.status === "skipped" ? "Search Console isn't wired yet — it needs the Google OAuth step in the setup doc." : "I don't have Search Console numbers yet.", panels: ["search"] };
    const d = seo.deltas.clicks;
    const dir = d === null || d === undefined ? "" : d >= 0 ? `, up ${Math.round(d * 100)} percent versus the week before` : `, down ${Math.round(-d * 100)} percent versus the week before`;
    return { text: `Organic clicks were ${spokenNum(seo.totals.clicks)} last week${dir}, average position ${seo.totals.position ?? "unknown"}.`, panels: ["search"] };
  }
  if (/instagram|\big\b|engagement/.test(t)) {
    const ig = mk?.instagram;
    if (!ig?.followers) return none("an Instagram reading");
    const er = ig.er_pct !== null && ig.er_pct !== undefined ? ` Engagement's ${ig.er_pct.toFixed(2)} percent against a ${T?.ig_min_er_pct ?? 1} percent floor` : "";
    const cad = ig.cadence_per_week ? `, posting about ${Math.round(ig.cadence_per_week)} times a week` : "";
    return { text: `Instagram's at ${spokenNum(ig.followers)} followers.${er}${cad}.`, panels: ["search"] };
  }
  if (/what (?:did|have) we (?:ship|publish)|what'?s shipped|shipped|published (?:today|this week|recently)|last blog|last carousel|last deck/.test(t)) {
    const items = state.shipped;
    if (!items.length) return { text: "Nothing's shipped yet.", panels: ["shipped"] };
    const week = items.filter((x) => x.ts && Date.now() - Date.parse(x.ts) < 7 * 86_400_000);
    const latest = items[0];
    const host = latest.link ? ` — it's live at ${latest.link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}` : "";
    return { text: `${week.length || items.length} ${week.length === 1 ? "thing" : "things"} shipped this week. Latest is the ${latest.skill.replace(/^ds-/, "").replace(/-/g, " ")}${host}.`, panels: ["shipped"], deliverable: latest.link ? undefined : latest.deliverable_path };
  }
  if (/deck ready|is the deck|weekly deck ready|monday deck ready|do we have a deck/.test(t)) {
    const deck = state.shipped.find((x) => x.skill === "report-deck");
    const fresh = deck?.ts && Date.now() - Date.parse(deck.ts) < 7 * 86_400_000;
    return fresh
      ? { text: `This week's deck landed ${spokenAge((Date.now() - Date.parse(deck!.ts!)) / 1000)} — it's in Shipped, say open the deck and I'll put it up.`, panels: ["shipped"] }
      : { text: "No deck yet this week — say weekly deck and I'll build it.", panels: ["deck"] };
  }
  return null;
}

// "A, B, and C" — spoken list with a natural and-join
function listOut(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// --- Haiku engine -----------------------------------------------------------

function stateSummary(state: VaultState): string {
  const lines: string[] = [];
  for (const m of state.metrics) {
    lines.push(`${m.source}.${m.metric} = ${m.value} (${m.status}${m.deltaWeek !== null ? `, week delta ${m.deltaWeek}` : ""})`);
  }
  const r = state.runner;
  lines.push(r ? `runner: ${r.alive ? "alive" : "down"}, busy=${r.busy}, pending=${r.pending}` : "runner: no status");
  const mk = state.marketing;
  if (mk) {
    const T = mk.targets;
    lines.push(`targets: breakeven_roas=${T.breakeven_roas} target_roas=${T.target_roas} target_cpa=${T.target_cpa} max_cpa=${T.max_cpa} monthly_budget=${T.monthly_ad_budget} (INR)`);
    const m = mk.channels.meta;
    if (m.totals) lines.push(`meta ${m.window?.days ?? 7}d [${m.status}, ${m.accounts_ok}/${m.accounts_total} accts]: spend=${m.totals.spend} revenue=${m.totals.revenue} roas=${m.totals.roas} cpa=${m.totals.cpa} ctr=${m.totals.ctr} freq=${m.totals.frequency} results=${m.totals.results}`);
    const g = mk.channels.google;
    if (g.totals) lines.push(`google ${g.window?.days ?? 7}d [${g.status}]: spend=${g.totals.spend} conv=${g.totals.results} cpa=${g.totals.cpa} ctr=${g.totals.ctr}`);
    else lines.push(`google ads: ${g.status}${g.error ? ` (${g.error})` : ""}`);
    const sseo = mk.channels.seo;
    if (sseo.totals) lines.push(`gsc ${sseo.window?.days ?? 7}d: clicks=${sseo.totals.clicks} impressions=${sseo.totals.impressions} ctr=${sseo.totals.ctr} position=${sseo.totals.position}`);
    else lines.push(`search console: ${sseo.status}`);
    if (mk.aeo.score !== null) lines.push(`aeo readiness: ${mk.aeo.score}/100 (floor ${mk.aeo.min_score})`);
    const p = mk.pacing;
    lines.push(`pacing ${p.month}: spend_mtd=${p.spend_mtd}${p.estimated ? " (estimated)" : ""} expected=${p.expected_mtd} projected_eom=${p.projected_eom} status=${p.status} roas_mtd=${p.blended_roas_mtd}`);
    const camps = [...m.campaigns, ...g.campaigns].filter((c) => c.verdict !== "NA").slice(0, 8);
    if (camps.length) lines.push(`campaign verdicts: ${camps.map((c) => `${c.verdict} ${c.campaign} (spend ${c.spend}, roas ${c.roas ?? "n/a"})`).join("; ")}`);
    lines.push(`data freshness: ${mk.pull.overall}; ${mk.pull.sources.filter((x) => x.core).map((x) => `${x.source}=${x.status}`).join(", ")}`);
    if (mk.flags.length) lines.push(`flags: ${mk.flags.map((f) => f.text).join("; ")}`);
  }
  if (state.shipped.length) lines.push(`shipped: ${state.shipped.slice(0, 4).map((x) => `${x.skill}${x.link ? ` → ${x.link}` : ""}`).join("; ")}`);
  if (state.daily) {
    lines.push(`top3: ${state.daily.top3.map((p) => `${p.done ? "[x]" : "[ ]"} ${p.text}`).join("; ")}`);
    lines.push(`schedule: ${state.daily.schedule.map((s) => `${s.time} ${s.item}`).join("; ")}`);
    if (state.daily.focus) lines.push(`focus: ${state.daily.focus}`);
  }
  if (state.queue.length) lines.push(`queue: ${state.queue.map((q) => q.label ?? q.skill).join(", ")}`);
  // summaries included — without them the model can't answer "what did the
  // trending report find?" and conflates reports with each other
  if (state.runs.length) {
    lines.push("recent runs (newest first):");
    for (const x of state.runs.slice(0, 6)) {
      const name = x.label ? `${x.skill} "${x.label}"` : x.skill;
      const sum = x.summary ? ` — ${x.summary.slice(0, 140)}` : "";
      lines.push(`  ${name} [${x.status}]${sum}`);
    }
  }
  return lines.join("\n");
}

function routerSystem(state: VaultState, convo: string): string {
  return `You are the intent router for a voice-controlled personal dashboard. Classify the user's utterance and reply in strict JSON only:
{"tier": 1|2|3, "skill": "<skill-name or omit>", "reply": "<short spoken response, max 2 sentences, plain text>", "panels": ["<dashboard panels the reply references, from: ${PANEL_IDS.join(", ")}>"], "args": {<optional intent args, see below>}}

The dashboard is ARGUS, a marketing operating system for Digital Scholar (Indian edtech; currency INR — say "lakh"/"crore", never dollars). The user is a performance-marketing and SEO operator.
Voice: ARGUS talks like a close, sharp friend — warm, casual, first person, contractions, plain words. Think "hey, spend's at nineteen eighty already" not "the expenditure currently stands at". Never butler-formal, never corporate, no "certainly/shall I/as requested".
Args: for perf-report and report-deck return "args": {"scope": "meta|google|seo|blended", "range": 7|30|90} inferred from the ask (default blended, 7). For ds-blog-publish and news-carousel return "args": {"topic": "<the subject, verbatim minus the command>"}; add "dry_run": true if they say draft/dry run. For competitor-intel return "args": {"brand": "<the competitor's name>"}. For bulk-creatives return "args": {"topic": "<the offer/product>", "count": <number of ads if they said one>}; add "dry_run": true for copy-only without rendering. Omit args otherwise.

Tier 1: user wants to RUN one of these skills: ${[...ALLOWED_SKILLS].join(", ")}. Set "skill". Reply = brief ack. ONLY when they want it run or refreshed — asking what's IN a report / what it said / its highlights is tier 2: answer from the recent-runs summaries in the snapshot, do NOT re-run the skill.
Tier 2: user asks about dashboard state. Answer ONLY from the snapshot below — NEVER invent specifics that aren't in it. If they ask for detail beyond what the snapshot holds (e.g. "which three sponsor emails?" when only a count is listed), that is tier 3: the background session can read the full report. If they ask for the daily briefing / "what's going on today", compose a tight rundown: spend and ROAS vs breakeven, decision queue, budget pacing, open directives.
Tier 3: anything needing real reasoning, outside data, or report contents beyond the snapshot summaries. It will be dispatched to a background Claude session automatically. Reply = a brief "working on it" style ack.

Greetings and chitchat ("hey", "what's up", "how are you", "thanks", "can you hear me") are tier 2 — reply conversationally in one or two short sentences, optionally flavored with the snapshot. NEVER send chitchat to tier 3; a background session for a greeting wastes half a minute.

Dashboard snapshot:
${stateSummary(state)}${
    convo
      ? `

Recent conversation (use it to resolve follow-ups and pronouns — "that", "the second one", "make it shorter" refer to this):
${convo}`
      : ""
  }`;
}

interface RoutedJson {
  tier?: number;
  skill?: string;
  reply?: string;
  panels?: unknown;
  args?: unknown;
}

// model-supplied args are untrusted — keep only known keys with sane shapes
function sanitizeArgs(raw: unknown, skill: string | undefined): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || !skill) return undefined;
  const a = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (ARG_SKILLS.has(skill)) {
    if (typeof a.scope === "string" && ["meta", "google", "seo", "blended"].includes(a.scope)) out.scope = a.scope;
    if ([7, 30, 90].includes(Number(a.range))) out.range = Number(a.range);
  }
  if (skill === "ds-blog-publish" || skill === "news-carousel") {
    if (typeof a.topic === "string" && a.topic.trim()) out.topic = a.topic.trim().slice(0, 200);
    if (a.dry_run === true) out.dry_run = true;
  }
  if (skill === "competitor-intel") {
    const b = a.brand ?? a.topic;
    if (typeof b === "string" && b.trim()) out.brand = b.trim().slice(0, 120);
  }
  if (skill === "bulk-creatives") {
    if (typeof a.topic === "string" && a.topic.trim()) out.topic = a.topic.trim().slice(0, 200);
    const n = Number(a.count);
    if (Number.isInteger(n) && n >= 1 && n <= 30) out.count = n;
    if (a.dry_run === true) out.dry_run = true;
  }
  return Object.keys(out).length ? out : undefined;
}

// shared sanity layer for model engines — skill must be real, panels must be
// real, tier-1 without a valid skill bounces back to the caller's fallback
function validateRouted(parsed: RoutedJson, engine: "haiku" | "local"): RouteResult | null {
  const tier = parsed.tier === 1 || parsed.tier === 2 ? parsed.tier : 3;
  const skill =
    tier === 1 && parsed.skill && ALLOWED_SKILLS.has(parsed.skill) ? parsed.skill : undefined;
  if (tier === 1 && !skill) return null;
  const panels = Array.isArray(parsed.panels)
    ? (parsed.panels.filter((p) => (PANEL_IDS as readonly string[]).includes(String(p))) as PanelId[])
    : undefined;
  return { tier, skill, reply: String(parsed.reply ?? "Done."), engine, panels, args: sanitizeArgs(parsed.args, skill) };
}

// fire-and-forget warmup — the first HTTPS call to api.anthropic.com pays
// ~7s of TLS/connection setup per server process; a 1-token ping at module
// load moves that cost off the user's first real ask. Mirrors warmLocal().
let haikuWarmed = false;
function warmHaiku() {
  const key = homeEnv("ANTHROPIC_API_KEY");
  // VOICE_NO_WARMUP: tests import this module — they must not ping the API
  if (haikuWarmed || !key || process.env.VOICE_NO_WARMUP) return;
  haikuWarmed = true;
  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  }).catch(() => {
    haikuWarmed = false; // network blip — retry on a later call
  });
}
warmHaiku(); // module load = first voice API hit — warm while rules still answer

async function haikuRoute(
  transcript: string,
  state: VaultState,
  convo = ""
): Promise<RouteResult | null> {
  const key = homeEnv("ANTHROPIC_API_KEY");
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: routerSystem(state, convo),
      messages: [{ role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new Error(`haiku ${res.status}`);

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return validateRouted(JSON.parse(m[0]) as RoutedJson, "haiku");
}

// --- local engine -----------------------------------------------------------
// qwen3.5:4b via Ollama — picked by bench (scripts/bench-router-model.mjs):
// 15/16 tier accuracy, 16/16 JSON + skill discipline, p50 ~600ms / p90 ~800ms
// warm on the 5090. Grammar-enforced JSON via Ollama's `format` schema, so
// parsing never fails — validateRouted only has to police the VALUES.

const OLLAMA_URL = () => homeEnv("OLLAMA_URL") || "http://127.0.0.1:11434";
const LOCAL_ROUTER_MODEL = () => homeEnv("VOICE_ROUTER_MODEL") || "qwen3.5:4b";
const LOCAL_TIMEOUT_MS = 6000; // covers a cold model load; warm calls ~600ms

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    tier: { type: "integer", enum: [1, 2, 3] },
    skill: { type: "string" },
    reply: { type: "string" },
    panels: { type: "array", items: { type: "string", enum: [...PANEL_IDS] } },
  },
  required: ["tier", "reply"],
};

// fire-and-forget warmup so the first real utterance doesn't pay the model
// load; keep_alive 24h keeps the 3.4GB resident after that
let localWarmed = false;
function warmLocal() {
  if (localWarmed) return;
  localWarmed = true;
  fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOCAL_ROUTER_MODEL(),
      stream: false,
      think: false,
      keep_alive: "24h",
      options: { num_predict: 1 },
      messages: [{ role: "user", content: "hi" }],
    }),
  }).catch(() => {
    localWarmed = false; // ollama down — retry the warmup on a later call
  });
}

async function localRoute(
  transcript: string,
  state: VaultState,
  convo = ""
): Promise<RouteResult | null> {
  warmLocal();
  const res = await fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    body: JSON.stringify({
      model: LOCAL_ROUTER_MODEL(),
      stream: false,
      think: false, // qwen3.5 small ships thinking-off, but be explicit
      keep_alive: "24h",
      format: ROUTE_SCHEMA,
      options: { temperature: 0.2, num_predict: 200 },
      messages: [
        { role: "system", content: routerSystem(state, convo) },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  const text = json.message?.content ?? "";
  if (!text) return null;
  return validateRouted(JSON.parse(text) as RoutedJson, "local");
}
