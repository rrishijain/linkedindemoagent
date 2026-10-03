"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Engagement, RunEntry, VaultState } from "@/lib/vault";
import { voice } from "@/lib/voiceClient";
import { sound } from "@/lib/sound";
import { diffEngagement, type CelebrationEvent } from "@/lib/celebrate";
import { scrubRunSummary, humanizeFailure } from "@/lib/spokenText";
import AiNews from "@/components/panels/AiNews";
import { DEMO_MARKETING } from "@/lib/demo";
import { deriveReadout, deriveStrands } from "@/lib/strands";
import type { CelebrateSignal, CoreMode } from "./coreTypes";
import ReportOverlay from "./ReportOverlay";
import Signals from "./panels/Signals";
import PaidMedia from "./panels/PaidMedia";
import SearchAeo from "./panels/SearchAeo";
import Sources from "./panels/Sources";
import Shipped from "./panels/Shipped";
import Pacing from "./panels/Pacing";
import DecisionQueue from "./panels/DecisionQueue";
import CommandDeck from "./panels/CommandDeck";
import { syncAlertCallouts } from "@/lib/alertCallouts";
import { NumberRoll, SectionTitle, pressable } from "./panels/shared";

const Core = dynamic(() => import("./ui/CityCore"), { ssr: false });
const PaidDetailOverlay = dynamic(() => import("./PaidDetailOverlay"), { ssr: false });
const CreativeIntelligenceOverlay = dynamic(() => import("./CreativeIntelligenceOverlay"), { ssr: false });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function useVaultState(intervalMs = 5000) {
  const [state, setState] = useState<VaultState | null>(null);
  const [error, setError] = useState(false);
  const inflightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const pull = useCallback(async () => {
    if (inflightRef.current) return; // never stack a poll on a slow response
    inflightRef.current = true;
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await fetch("/api/state", { cache: "no-store", signal: ctl.signal });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as VaultState;
      // ?demo=marketing — render every marketing panel populated without
      // touching the vault (layout checks, filming)
      setState(window.location.search.includes("demo=marketing") ? { ...j, ...DEMO_MARKETING } : j);
      setError(false);
    } catch {
      if (!ctl.signal.aborted) setError(true);
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [pull, intervalMs]);

  return { state, error, refresh: pull };
}

function useClock(tickMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

/** true when a key event started on something that handles keys itself */
function onInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("button, a, input, textarea, select, [role='button'], [role='checkbox'], [contenteditable='true']")
  );
}

function fmtClock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function noteAgeDays(date: string): number {
  const ms = Date.now() - Date.parse(`${date}T12:00:00`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

// spoken line for a finished run — short, no markdown, summary clamped.
// Summaries pass through scrubRunSummary so prompt-contract violations
// ("(headless)", SAVED-path tails) never reach the speakers.
function runAnnouncement(skill: string, status: string, summary: string, label?: string | null): string {
  const name = label ? `${label} ask` : skill.replace(/-/g, " ");
  if (status !== "ok") {
    const why = summary ? humanizeFailure(summary) : "";
    return `${name} hit a snag${why ? ` — ${why.slice(0, 120)}` : "."}`;
  }
  const clean = scrubRunSummary(summary);
  // voice-ask runs put the spoken answer in line 1 of output (= summary) —
  // speak it directly instead of "voice ask complete"
  if (skill === "voice-ask" && clean) {
    return clean.slice(0, 220);
  }
  // "plan today is done. Done." — a summary that only says done adds nothing
  const redundant = /^(done|complete|completed|finished|all done|ok)[.!]?$/i.test(clean);
  return `${name} is done.${clean && !redundant ? ` ${clean.slice(0, 160)}` : ""}`;
}

const COUNT_WORD = ["", "one", "two", "three", "four", "five", "six"];
function runName(r: RunEntry): string {
  return r.label ? `${r.label} ask` : r.skill.replace(/-/g, " ");
}
function listOut(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Several runs finishing together used to mean several announcements back to
// back — the wall talking at you for a minute. One line covers the batch; the
// callout cards carry the detail.
function batchAnnouncement(runs: RunEntry[]): string {
  const ok = runs.filter((r) => r.status === "ok");
  const bad = runs.filter((r) => r.status !== "ok");
  const parts: string[] = [];
  if (ok.length > 0) {
    const n = COUNT_WORD[ok.length] ?? String(ok.length);
    parts.push(`${n} ${ok.length === 1 ? "run is" : "runs are"} done — ${listOut(ok.map(runName))}.`);
  }
  if (bad.length > 0) {
    parts.push(`${listOut(bad.map(runName))} hit a snag.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// panels (memoized — only re-render when their slice of state changes)
// ---------------------------------------------------------------------------

const AudioIO = memo(function AudioIO({ mode }: { mode: CoreMode }) {
  const live = mode === "speaking" || mode === "listening";
  return (
    <section className="block accent-violet boot-stagger" style={{ animationDelay: "0.42s" }}>
      <SectionTitle title="Audio I/O" tick={live ? "TTS.LIVE" : "TTS.STANDBY"} />
      <div className={`wave ${live ? "live" : "idle"} ${mode === "listening" ? "cobalt" : ""}`}>
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="audio-meta">
        <span>hold SPACE to talk · ESC to stop</span>
      </div>
    </section>
  );
});

// AI Wire — today's morning-report headlines, click → full report overlay
const Wire = memo(function Wire({
  state,
  onOpen,
}: {
  state: VaultState;
  onOpen: (path: string) => void;
}) {
  const m = state.morning;
  if (!m || m.heads.length === 0) return null;
  return (
    <section className="block accent-coral boot-stagger" style={{ animationDelay: "0.5s" }}>
      <SectionTitle title="AI Wire" tick="MORNING.INTEL" />
      {/* two only — the right column is full; more would push the deck off-row */}
      {m.heads.slice(0, 2).map((h, i) => (
        <div className="wire-row" key={i} {...pressable(() => onOpen(m.rel))}>
          <span className="wire-bullet" aria-hidden="true">▸</span>
          <span>{h}</span>
        </div>
      ))}
    </section>
  );
});

function parseHHMM(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
}

const Schedule = memo(function Schedule({ state, hot }: { state: VaultState; hot?: boolean }) {
  const d = state.daily;
  const now = useClock(30_000); // minute precision is enough for the block list
  if (!d || d.schedule.length === 0) return null;
  const nowMin = now && d.isToday ? now.getHours() * 60 + now.getMinutes() : -1;
  const items = d.schedule.map((s) => ({ ...s, min: parseHHMM(s.time) }));
  // current block = latest item that has started
  let currentIdx = -1;
  if (nowMin >= 0) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].min >= 0 && items[i].min <= nowMin) currentIdx = i;
    }
  }
  const ageDays = d.isToday ? 0 : noteAgeDays(d.date);
  return (
    <section
      className={`block accent-sky boot-stagger ${d.isToday ? "" : "note-stale"} ${hot ? "voice-hot" : ""}`}
      style={{ animationDelay: "0.3s" }}
    >
      <SectionTitle
        title="Schedule"
        tick={d.isToday ? "TODAY" : `${ageDays}D OLD`}
        href="https://calendar.google.com/calendar/u/0/r/day"
      />
      <div className="sched">
        {items.map((s, i) => (
          <div
            key={`${s.time}-${i}`}
            className={`sched-row ${i === currentIdx ? "now" : ""} ${
              currentIdx >= 0 && i < currentIdx ? "past" : ""
            }`}
          >
            <span className="t">{s.time}</span>
            <span className="i">{s.item}</span>
            {i === currentIdx && <span className="now-tag">NOW</span>}
          </div>
        ))}
      </div>
      {d.focus && <div className="focus-line">focus · {d.focus}</div>}
    </section>
  );
});

function greeting(h: number): string {
  if (h < 5) return "Burning the midnight oil 🌙";
  if (h < 12) return "Good morning ☀️";
  if (h < 17) return "Good afternoon 🌤️";
  if (h < 21) return "Good evening 🌅";
  return "Good night 🌙";
}

function TopBar({ state }: { state: VaultState | null }) {
  const now = useClock();
  const e = state?.engagement;
  return (
    <header className="topbar console-top boot-stagger" style={{ animationDelay: "0.05s" }}>
      <div className="wordmark">
        <span className="name">JARVIS</span>
        <span className="expansion">Marketing command center · <a href="/">Personal home</a></span>
      </div>
      <div className="greeting" suppressHydrationWarning>
        {now ? greeting(now.getHours()) : ""}
      </div>
      <div className="clock-wrap">
        <div className="clock" suppressHydrationWarning>
          {/* HH:MM rolls over like a station clock; seconds stay plain so the
              bar never carries constant motion */}
          {now ? (
            <NumberRoll
              text={`${String(now.getHours()).padStart(2, "0")}:${String(
                now.getMinutes()
              ).padStart(2, "0")}`}
            />
          ) : (
            "--:--"
          )}
          <span className="sec" suppressHydrationWarning>
            {now ? `:${String(now.getSeconds()).padStart(2, "0")}` : ""}
          </span>
        </div>
        <div className="clock-date" suppressHydrationWarning>
          {now
            ? `${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getDay()]} · ${
                ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
                  now.getMonth()
                ]
              } ${now.getDate()}`
            : ""}
        </div>
        {/* THE STREAK — 7-day ship dots + flame count. The today-dot pulses
            amber only when the streak would die tonight. */}
        {e && e.streaks.ship.last7.some(Boolean) && (
          <div
            className="chain-row"
            title="7-day streak — one finished run or live publish per day keeps the flame alive"
          >
            <span className="chain-dots">
              {e.streaks.ship.last7.map((on, i) => (
                <i key={i} className={on ? "on" : i === 6 && e.streaks.ship.atRisk ? "risk" : ""} />
              ))}
            </span>
            <span className="chain-n">🔥 <NumberRoll text={String(e.streaks.ship.current)} /></span>
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

const MODE_KEYS: Record<string, CoreMode> = {
  "1": "idle",
  "2": "working",
  "3": "listening",
  "4": "speaking",
  "5": "error",
};

// "since you left" digest — last-seen stamp, refreshed every poll (≤5s stale)
const LAST_SEEN_KEY = "argus.lastSeen.v1";
const DIGEST_AFTER_MS = 4 * 3_600_000; // away ≥4h earns a digest

export default function Console() {
  const { state, error } = useVaultState(5000);
  const [modeOverride, setModeOverride] = useState<CoreMode | null>(null);
  // day-wise paid detail — off the wall by design, opened from the panel button
  const [paidDetail, setPaidDetail] = useState(false);
  const [creativeDetail, setCreativeDetail] = useState(false);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);
  const [hotPanels, setHotPanels] = useState<string[]>([]);
  // report reveal: callouts = cards branching off the core (max 4 anchor
  // slots around the orb — same hairline language). kind "doc" opens the
  // overlay, kind "link" opens the source in a new tab, kind "task" is a
  // live run (elapsed / ~eta progress) that morphs into its doc card on
  // completion — target stays `run:<id>` until the morph swaps it.
  const [callouts, setCallouts] = useState<
    {
      id: number;
      kind: "doc" | "link" | "task";
      target: string;
      label: string;
      slot: number;
      startedAt?: number;
      etaS?: number | null;
      phase?: "working" | "done" | "failed";
    }[]
  >([]);
  const calloutSeq = useRef(0);
  const addCallout = useCallback(
    (target: string, label: string, kind: "doc" | "link" = "doc") => {
      setCallouts((cur) => {
        if (cur.some((c) => c.target === target)) return cur; // already on screen
        const used = new Set(cur.map((c) => c.slot));
        const free = [0, 1, 2, 3].find((s) => !used.has(s));
        const entry = { id: ++calloutSeq.current, kind, target, label };
        // all four slots taken → oldest card yields its slot, but never a
        // live task (its run is still going — evicting it hides real work)
        if (free === undefined) {
          const victim = cur.find((c) => !(c.kind === "task" && c.phase === "working")) ?? cur[0];
          return [...cur.filter((c) => c !== victim), { ...entry, slot: victim.slot }];
        }
        return [...cur, { ...entry, slot: free }];
      });
    },
    []
  );
  const [report, setReport] = useState<{ path: string; content: string } | null>(null);
  const reportOpenRef = useRef(false);
  reportOpenRef.current = report !== null;
  // the Esc handler is bound once — it reads open-state through refs
  const paidDetailRef = useRef(false);
  paidDetailRef.current = paidDetail;
  const spokenRunsRef = useRef<Set<string>>(new Set());
  const seenAlertsRef = useRef<Set<string>>(new Set());
  const calloutsRef = useRef<typeof callouts>([]);
  calloutsRef.current = callouts;

  // celebrations — orb impulse + per-panel gold shimmer + chime state
  const [celebrate, setCelebrate] = useState<CelebrateSignal | null>(null);
  const celebSeqRef = useRef(0);
  const [flashPanels, setFlashPanels] = useState<string[]>([]);
  const [chimesMuted, setChimesMuted] = useState(false);
  const engPrimedRef = useRef(false);
  const prevEngRef = useRef<Engagement | null>(null);
  const lastSeenDoneRef = useRef(false);

  // the old telemetry feed is gone from the wall; keep a console trail so voice
  // + runner events are still debuggable from devtools
  const pushLine = useCallback((cls: string, text: string) => {
    if (cls === "err") console.warn(`[argus] ${text}`);
    else console.debug(`[argus:${cls}] ${text}`);
  }, []);

  // small visible toast (bottom-left, above the button rail) for failures
  // that would otherwise vanish into the console
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // screen-reader announcements for task callouts finishing (visually the
  // card morphs/colors — this is the non-visual channel)
  const [liveMsg, setLiveMsg] = useState("");

  const openReport = useCallback(
    async (path: string) => {
      try {
        const res = await fetch(`/api/report?path=${encodeURIComponent(path.split("#")[0])}`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { path: string; content: string };
        setReport(j);
      } catch {
        pushLine("err", `couldn't open ${path}`);
      }
    },
    [pushLine]
  );

  // bottom-left TRANSCRIPT button — the voice conversation so far, rendered
  // in the same overlay as reports (memory.jsonl survives reloads, so this
  // shows exchanges from before the page opened too)
  const openTranscript = useCallback(async () => {
    try {
      const res = await fetch("/api/transcript", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setReport((await res.json()) as { path: string; content: string });
    } catch {
      pushLine("err", "couldn't load transcript");
    }
  }, [pushLine]);

  // ?demo=callouts — seed the doc callouts on demand (filming + layout checks)
  useEffect(() => {
    if (!window.location.search.includes("demo=callouts")) return;
    const seeds: [string, string][] = [
      ["inbox/reports/morning/demo-morning.md", "morning report"],
      ["inbox/voice/demo-voice-ask.md", "voice ask"],
      ["inbox/reports/trend-scan/demo-scan.md", "trend scan"],
      ["inbox/reports/inbox-briefs/demo-inbox.md", "inbox brief"],
    ];
    const timers = seeds.map(([p, l], i) => setTimeout(() => addCallout(p, l), 800 + i * 1400));
    return () => timers.forEach(clearTimeout);
  }, [addCallout]);

  // ?demo=taskwork — full task-callout lifecycle without queueing real runs:
  // two tasks spawn (one with eta, one indeterminate). First fills toward its
  // 10s median, runs OVERDUE at 10s (bar degrades to sweep), completes at 16s
  // and morphs into its doc card; the second fails at 22s
  useEffect(() => {
    if (!window.location.search.includes("demo=taskwork")) return;
    const seed = (label: string, etaS: number | null, slot: number) => ({
      id: ++calloutSeq.current,
      kind: "task" as const,
      target: `run:demo-${slot}`,
      label,
      startedAt: Date.now(),
      etaS,
      phase: "working" as const,
      slot,
    });
    const timers = [
      setTimeout(() => setCallouts((c) => [...c, seed("ai trend scan", 10, 0)]), 800),
      setTimeout(() => setCallouts((c) => [...c, seed("inbox brief", null, 1)]), 2600),
      setTimeout(
        () =>
          setCallouts((cur) =>
            cur.map((c) =>
              c.target === "run:demo-0"
                ? {
                    ...c,
                    kind: "doc" as const,
                    target: "inbox/reports/trend-scan/demo-scan.md",
                    phase: undefined,
                  }
                : c
            )
          ),
        16000
      ),
      setTimeout(
        () =>
          setCallouts((cur) =>
            cur.map((c) =>
              c.target === "run:demo-1" ? { ...c, phase: "failed" as const } : c
            )
          ),
        22000
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // voice link — P1: ARGUS speaks, no mic
  useEffect(() => {
    voice.init();
    sound.init();
    setChimesMuted(sound.muted);
    voice.onLog(pushLine);
    voice.onPanels(setHotPanels);
    voice.onDeliverable((path, label) => addCallout(path, label));
    voice.onReveal((r) => addCallout(r.target, r.label, r.kind)); // sequenced to speech
    voice.onOpenDoc((path) => void openReport(path)); // "bring up the html" → overlay now
    voice.onListening(setWakeListening); // P4: hands-free wake window
    return voice.onSpeaking(setVoiceSpeaking);
  }, [pushLine, openReport, addCallout]);

  // P3 choreography — highlights arrive with the reply and live for the
  // duration of speech; the grace window covers the response→playback gap
  // (and ends the glow if TTS never starts)
  useEffect(() => {
    if (voiceSpeaking || hotPanels.length === 0) return;
    const id = setTimeout(() => setHotPanels([]), 2000);
    return () => clearTimeout(id);
  }, [voiceSpeaking, hotPanels]);

  // P2 — push-to-talk: hold Space to record, release to send. Space on a
  // focused button/link/row keeps its normal meaning — no hijacking.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || onInteractive(e.target)) return;
      e.preventDefault();
      void voice.startCapture().then((ok) => {
        if (ok) setPtt(true);
      });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || onInteractive(e.target)) return;
      e.preventDefault();
      setPtt(false);
      void voice.finishCapture();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // demo mode keys: 1 idle / 2 working / 3 listening / 4 speaking / 5 error, 0|Esc auto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key in MODE_KEYS) {
        setModeOverride(MODE_KEYS[e.key]);
        pushLine("sys", `core mode override → ${MODE_KEYS[e.key].toUpperCase()}`);
      } else if (e.key === "Escape") {
        // overlay open → Esc closes it and does nothing else. The paid detail
        // sits above the report overlay, so it unwinds first.
        if (paidDetailRef.current) {
          setPaidDetail(false);
          return;
        }
        if (reportOpenRef.current) {
          setReport(null);
          return;
        }
        if (voice.stopAll()) pushLine("sys", "voice — stopped");
        setModeOverride(null);
      } else if (e.key === "0") {
        setModeOverride(null);
        pushLine("sys", "core mode → AUTO");
      } else if (e.key === "6" || e.key === "7") {
        // celebration demo/tuning — 6 major, 7 record
        const tier = e.key === "6" ? ("major" as const) : ("record" as const);
        setCelebrate({ seq: ++celebSeqRef.current, tier });
        sound.play(tier === "record" ? "record" : "quest");
        pushLine("sys", `celebration demo → ${tier.toUpperCase()}`);
      } else if (e.key === "m" || e.key === "M") {
        const muted = sound.toggleMute();
        setChimesMuted(muted);
        pushLine("sys", `chimes → ${muted ? "MUTED" : "ON"}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushLine]);

  // marketing alerts → callouts. Ids are deterministic (flag codes) so a
  // flag that persists across polls shows once, not every 5s; at most two on
  // screen so the orb and live tasks keep their room.
  useEffect(() => {
    const flags = state?.marketing?.flags ?? [];
    const dash = state?.marketing?.latest_reports.dashboard ?? "ops/ads-dashboard.md";
    if (!state?.marketing) return;
    setCallouts(cards => syncAlertCallouts(cards, flags, dash));
    // alerts on screen right now (their targets carry a #code anchor)
    let onScreen = syncAlertCallouts(calloutsRef.current, flags, dash).filter((c) => c.kind === "doc" && c.target.includes("#")).length;
    for (const f of flags) {
      if (f.level === "info" || seenAlertsRef.current.has(f.code)) continue;
      if (onScreen >= 2) break;
      seenAlertsRef.current.add(f.code);
      onScreen++;
      addCallout(`${dash}#${f.code}`, f.text, "doc");
    }
  }, [state, addCallout]);

  // task callouts — active runs branch off the core like doc reveals: skill
  // name + elapsed / ~eta bar while the runner works. On completion the card
  // morphs IN PLACE into the deliverable card (same slot, no jump) — this
  // effect must stay ABOVE the speak-completions effect so the morph happens
  // before addCallout's target dedupe sees the deliverable path.
  useEffect(() => {
    if (!state) return;
    setCallouts((cur) => {
      let next = cur;
      for (const r of state.runs) {
        const existing = next.find((c) => c.kind === "task" && c.target === `run:${r.id}`);
        if (r.status === "running" && !existing) {
          const used = new Set(next.map((c) => c.slot));
          const free = [0, 1, 2, 3].find((s) => !used.has(s));
          const entry = {
            id: ++calloutSeq.current,
            kind: "task" as const,
            target: `run:${r.id}`,
            label: r.label ?? r.skill.replace(/-/g, " "),
            startedAt: r.ts_started ? Date.parse(r.ts_started) : Date.now(),
            etaS: state.etas[r.skill] ?? null,
            phase: "working" as const,
            slot: 0,
          };
          if (free === undefined) {
            // same eviction rule as addCallout: oldest non-working card yields
            const victim =
              next.find((c) => !(c.kind === "task" && c.phase === "working")) ?? next[0];
            next = [...next.filter((c) => c !== victim), { ...entry, slot: victim.slot }];
          } else {
            next = [...next, { ...entry, slot: free }];
          }
        } else if (existing && existing.phase === "working" && r.status !== "running") {
          next =
            r.status === "ok" && r.deliverable_path
              ? next.map((c) =>
                  c === existing
                    ? {
                        ...c,
                        kind: (r.link ? "link" : "doc") as "link" | "doc",
                        target: r.link ?? r.deliverable_path!,
                        phase: undefined,
                      }
                    : c
                )
              : next.map((c) =>
                  c === existing
                    ? { ...c, phase: r.status === "ok" ? ("done" as const) : ("failed" as const) }
                    : c
                );
        }
      }
      return next;
    });
  }, [state]);

  // announce task status changes politely — working → done/failed, or the
  // morph into a doc/link card ("ready")
  const prevTaskPhasesRef = useRef<Map<number, string | undefined>>(new Map());
  useEffect(() => {
    const prev = prevTaskPhasesRef.current;
    const next = new Map<number, string | undefined>();
    const msgs: string[] = [];
    for (const c of callouts) {
      if (c.kind === "task") {
        next.set(c.id, c.phase);
        if (prev.get(c.id) === "working" && c.phase === "failed") msgs.push(`${c.label} failed`);
        else if (prev.get(c.id) === "working" && c.phase === "done") msgs.push(`${c.label} complete`);
      } else if (prev.get(c.id) === "working") {
        msgs.push(`${c.label} ready`);
      }
    }
    prevTaskPhasesRef.current = next;
    if (msgs.length > 0) setLiveMsg(msgs.join(". "));
  }, [callouts]);

  // ok-but-no-deliverable tasks flash COMPLETE, then clear themselves
  useEffect(() => {
    if (!callouts.some((c) => c.phase === "done")) return;
    const id = setTimeout(
      () => setCallouts((cur) => cur.filter((c) => c.phase !== "done")),
      6000
    );
    return () => clearTimeout(id);
  }, [callouts]);

  // 1s re-render while a task works — elapsed + bar width derive from Date.now()
  const taskWorking = callouts.some((c) => c.kind === "task" && c.phase === "working");
  const [, setTaskTick] = useState(0);
  useEffect(() => {
    if (!taskWorking) return;
    const id = setInterval(() => setTaskTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [taskWorking]);

  // speak completions — separate from the feed diff: a run can first appear
  // as "running" (id lands in seenRunsRef), so completion is tracked by id
  // here, only once it reaches a terminal status. First snapshot seeds
  // silently — no replaying history out loud on page load.
  const runsPrimedRef = useRef(false);
  useEffect(() => {
    if (!state) return;
    const done = state.runs.filter(
      (r) => (r.status === "ok" || r.status === "error") && !spokenRunsRef.current.has(r.id)
    );
    if (!runsPrimedRef.current) {
      runsPrimedRef.current = true;
      done.forEach((r) => spokenRunsRef.current.add(r.id));
      return;
    }
    // cards pop per run — it's the SPEECH that gets coalesced below
    done.forEach((r) => {
      spokenRunsRef.current.add(r.id);
      // finished run left a document → offer it via the reveal chip. When
      // the run's REAL output lives at a URL (Gmail draft, video), the
      // callout sends you THERE — the md stays in the Documents trail.
      if (r.status === "ok" && r.deliverable_path) {
        addCallout(
          r.link ?? r.deliverable_path,
          r.label ?? r.skill.replace(/-/g, " "),
          r.link ? "link" : "doc"
        );
      }
    });

    // a voice-ask summary IS the answer to something you asked out loud, so
    // each one is spoken in full and ranks as a reply. Every other completion
    // is background news: one landing speaks normally, three landing together
    // speak once.
    const asks = done.filter((r) => r.skill === "voice-ask" && r.status === "ok");
    const news = done.filter((r) => !(r.skill === "voice-ask" && r.status === "ok"));
    asks.forEach((r) =>
      voice.speak(runAnnouncement(r.skill, r.status, r.summary ?? "", r.label), { kind: "reply" })
    );
    if (news.length === 1) {
      const r = news[0];
      voice.speak(runAnnouncement(r.skill, r.status, r.summary ?? "", r.label), { kind: "ambient" });
    } else if (news.length > 1) {
      voice.speak(batchAnnouncement(news), { kind: "ambient" });
    }
  }, [state]);

  // fire one celebration: minor = panel shimmer + tick; major/record also
  // pulse the orb (gold swing runs through IrisCore, never CSS), speak one
  // ambient line, and — for records — pop the NEW RECORD callout
  const fireCelebration = useCallback(
    (ev: CelebrationEvent) => {
      if (ev.panel) {
        setFlashPanels((cur) => (cur.includes(ev.panel!) ? cur : [...cur, ev.panel!]));
      }
      sound.play(ev.tier === "record" ? "record" : ev.tier === "major" ? "quest" : "tick");
      if (ev.tier !== "minor") {
        setCelebrate({ seq: ++celebSeqRef.current, tier: ev.tier });
        if (ev.line) voice.speak(ev.line, { kind: "ambient" });
        if (ev.callout) addCallout(ev.callout.target, ev.callout.label);
      }
    },
    [addCallout]
  );

  // one-shot shimmer lifecycle — same shape as the voice-hot grace timer
  useEffect(() => {
    if (flashPanels.length === 0) return;
    const id = setTimeout(() => setFlashPanels([]), 1400);
    return () => clearTimeout(id);
  }, [flashPanels]);

  // celebrations — pure diff between consecutive SAME-DAY engagement
  // snapshots. First snapshot primes silently (runsPrimedRef pattern); a
  // date rollover re-primes, so the midnight quest reset can never fire as
  // a "win". The chain-at-risk chime rides the evening transition, once.
  useEffect(() => {
    const eng = state?.engagement;
    if (!eng) return;
    const prev = prevEngRef.current;
    prevEngRef.current = eng;
    if (!engPrimedRef.current || !prev || prev.date !== eng.date) {
      engPrimedRef.current = true;
      return;
    }
    if (eng.streaks.ship.atRisk && !prev.streaks.ship.atRisk) sound.play("risk");
    const dash = state?.marketing?.latest_reports.dashboard ?? "ops/ads-dashboard.md";
    diffEngagement(prev, eng, dash).forEach(fireCelebration);
  }, [state, fireCelebration]);

  // "since you left" — the open dopamine hit: one digest callout when you
  // return after ≥4h away, different every time. First-ever visit stamps
  // silently. state.runs holds only the last 8 — plenty for a digest line.
  useEffect(() => {
    if (!state) return;
    if (!lastSeenDoneRef.current) {
      lastSeenDoneRef.current = true;
      try {
        const raw = localStorage.getItem(LAST_SEEN_KEY);
        const last = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(last) && Date.now() - last > DIGEST_AFTER_MS) {
          const runsDone = state.runs.filter(
            (r) => r.status === "ok" && r.ts_completed && Date.parse(r.ts_completed) > last
          ).length;
          const shipped = state.shipped.filter((s) => s.ts && Date.parse(s.ts) > last).length;
          if (runsDone > 0) {
            const bits = [`${runsDone} ${runsDone === 1 ? "run" : "runs"}`];
            if (shipped > 0) bits.push(`${shipped} shipped`);
            const dash = state.marketing?.latest_reports.dashboard ?? "ops/ads-dashboard.md";
            addCallout(`${dash}#while-you-were-out`, `while you were out · ${bits.join(" · ")}`);
            voice.speak(`While you were out: ${bits.join(", ")}.`, { kind: "ambient" });
          }
        }
      } catch {}
    }
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {}
  }, [state, addCallout]);

  const onQueued = useCallback(
    (skill: string, ok: boolean) => {
      pushLine(ok ? "sys" : "err", ok ? `intent queued → ${skill}` : `queue write FAILED → ${skill}`);
    },
    [pushLine]
  );

  // auto mode: fetch error → error; PTT held or wake window open → listening;
  // voice playing → speaking (orb mouths it, even mid-work); runner busy →
  // working; else idle
  const autoMode: CoreMode = error
    ? "error"
    : ptt || wakeListening
      ? "listening"
      : voiceSpeaking
        ? "speaking"
        : state?.runner?.busy
          ? "working"
          : "idle";
  const mode = modeOverride ?? autoMode;
  // one wire per channel of the wall — the centerpiece renders live data,
  // never an invented composite (see lib/strands.ts)
  const strands = useMemo(
    () => deriveStrands(state, mode === "working"),
    [state, mode]
  );
  // the one figure the nucleus holds — money first, all verdicts Python's
  const readout = useMemo(() => deriveReadout(state), [state]);
  const allowed = useMemo(() => new Set(state?.allowed_skills ?? []), [state?.allowed_skills]);
  // connection health for the banner: first load vs lost-with-old-data vs down
  const loading = state === null;
  const conn: "ok" | "connecting" | "stale" | "down" = error
    ? state
      ? "stale"
      : "down"
    : state
      ? "ok"
      : "connecting";

  return (
    <main className="stage">
      {conn !== "ok" && (
        <div className={`conn-banner ${conn === "connecting" ? "" : "err"}`} role="status">
          {conn === "connecting"
            ? "connecting to ARGUS…"
            : conn === "stale"
              ? "connection lost — showing last data, retrying every 5s"
              : "can't reach the ARGUS server — retrying every 5s"}
        </div>
      )}
      <div className="vh" role="status" aria-live="polite">
        {liveMsg}
      </div>
      {toast && (
        <div className="console-toast" role="status">
          {toast}
        </div>
      )}

      <div className="console">
        <TopBar state={state} />
        <Core mode={mode} strands={strands} readout={readout} getLevel={voice.getLevel} celebrate={celebrate} />

        <div className="console-left">
          <AiNews hot={hotPanels.includes("news")} />
          <Signals
            m={state?.marketing ?? null}
            loading={loading}
            hot={hotPanels.includes("signals") || hotPanels.includes("alerts")}
            onOpen={openReport}
          />
          <PaidMedia
            m={state?.marketing ?? null}
            loading={loading}
            hot={hotPanels.includes("paid") || hotPanels.includes("vitals")}
            onDetail={() => setPaidDetail(true)}
          />
          <SearchAeo m={state?.marketing ?? null} loading={loading} hot={hotPanels.includes("search")} />
          {state && <Schedule state={state} hot={hotPanels.includes("schedule")} />}
        </div>

        <div className="console-center">
          {callouts.map((c) => {
            const isTask = c.kind === "task";
            const elapsed =
              isTask && c.startedAt ? Math.max(0, Math.floor((Date.now() - c.startedAt) / 1000)) : 0;
            // ETA is silent: bar fills toward the median (capped at 95 — never
            // claim done before the run lands), and once elapsed passes it the
            // bar degrades to the indeterminate sweep instead of parking at a
            // number it promised. Text never states the estimate.
            const overdue = c.etaS != null && elapsed >= c.etaS;
            const pct = isTask && c.etaS && !overdue ? Math.min(95, (elapsed / c.etaS) * 100) : null;
            return (
              <div key={c.id} className={`callout slot-${c.slot}`}>
                <i className="br br-a" aria-hidden="true" />
                <i className="br br-b" aria-hidden="true" />
                <div
                  className={`callout-box${isTask ? ` task ${c.phase ?? ""}` : ""}`}
                  {...(!isTask &&
                    pressable(() =>
                      c.kind === "link"
                        ? window.open(c.target, "_blank", "noopener")
                        : void openReport(c.target)
                    ))}
                >
                  <span className="callout-dot" />
                  <span className="callout-text">
                    <span className="callout-label">{c.label}</span>
                    {isTask ? (
                      <span className="task-meta">
                        <span className={`task-bar${pct === null && c.phase === "working" ? " indet" : ""}`}>
                          <i
                            style={
                              c.phase !== "working"
                                ? { width: "100%" }
                                : pct !== null
                                  ? { width: `${pct}%` }
                                  : undefined
                            }
                          />
                        </span>
                        <span className="task-time">
                          {c.phase === "working"
                            ? `${fmtClock(elapsed)} · working`
                            : c.phase === "failed"
                              ? `failed · ${fmtClock(elapsed)}`
                              : `complete · ${fmtClock(elapsed)}`}
                        </span>
                      </span>
                    ) : (
                      <span className="callout-file">
                        {c.kind === "link"
                          ? c.target.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] + " ↗"
                          : c.target.split("#")[0].split("/").pop()}
                      </span>
                    )}
                  </span>
                  <button
                    className="callout-x"
                    aria-label="dismiss"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCallouts((cur) => cur.filter((x) => x.id !== c.id));
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
          {callouts.length > 1 && (
            <button className="callout-clear" onClick={() => setCallouts([])}>
              clear all ×{callouts.length}
            </button>
          )}
        </div>

        <div className="console-right">
          <CommandDeck
            state={state}
            allowed={allowed}
            hot={hotPanels.includes("deck") || hotPanels.includes("pipeline") || hotPanels.includes("diagnostics")}
            onQueued={onQueued}
            onCreativeIntelligence={() => setCreativeDetail(true)}
          />
          <Sources m={state?.marketing ?? null} loading={loading} hot={hotPanels.includes("sources")} onOpen={openReport} />
          <Shipped
            loading={loading}
            items={state?.shipped ?? []}
            quests={state?.engagement?.quests ?? null}
            record={
              state?.engagement?.records.find((r) => r.brokenToday) ??
              state?.engagement?.records.find((r) => r.nearMiss) ??
              null
            }
            hot={hotPanels.includes("shipped") || hotPanels.includes("documents")}
            flash={flashPanels.includes("shipped")}
            onOpen={openReport}
          />
          <AudioIO mode={mode} />
          {state && <Wire state={state} onOpen={openReport} />}
        </div>

        <div className="console-bottom directive-bar">
          <Pacing m={state?.marketing ?? null} hot={hotPanels.includes("pacing") || hotPanels.includes("objective")} />
          <DecisionQueue m={state?.marketing ?? null} hot={hotPanels.includes("decisions")} onOpen={openReport} />
        </div>

        <button className="transcript-btn" onClick={() => void openTranscript()}>
          Transcript
        </button>
        <button
          className={`voice-stop-btn ${voiceSpeaking ? "talking" : ""}`}
          title="Stop all speech, every tab (Esc)"
          onClick={() => {
            voice.stopAll();
            pushLine("sys", "voice — stopped");
          }}
        >
          ■ Stop Voice
        </button>
        <button
          className={`sound-btn ${chimesMuted ? "muted" : ""}`}
          title="Celebration chimes on/off (M)"
          onClick={() => setChimesMuted(sound.toggleMute())}
        >
          {chimesMuted ? "♪ off" : "♪ on"}
        </button>
      </div>

      {paidDetail && (
        <PaidDetailOverlay targets={state?.marketing?.targets} onClose={() => setPaidDetail(false)} />
      )}

      {creativeDetail && (
        <CreativeIntelligenceOverlay
          onClose={() => setCreativeDetail(false)}
          demo={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "marketing"}
        />
      )}

      {report && (
        <ReportOverlay
          report={report}
          onClose={() => setReport(null)}
          action={
            report.path === "system/voice/transcript"
              ? {
                  label: "reset transcript ×",
                  onClick: () => {
                    void fetch("/api/transcript", { method: "DELETE" })
                      .then((res) => {
                        if (!res.ok) throw new Error(String(res.status));
                        setReport(null);
                        pushLine("sys", "voice transcript cleared");
                      })
                      .catch(() => {
                        setToast("couldn't clear the transcript — try again");
                        pushLine("err", "transcript reset failed");
                      });
                  },
                }
              : undefined
          }
        />
      )}

    </main>
  );
}
