"use client";

import { useEffect, useRef, useState } from "react";
import type { VaultState } from "@/lib/vault";
import { SectionTitle } from "./shared";

// ---------------------------------------------------------------------------
// Command Deck — buttons drop REAL intents into system/queue/. Grouped by
// what a marketing operator is trying to do. Every skill here must exist in
// ALLOWED_SKILLS (lib/skills.ts) ⟷ runner.js buildPrompt() ⟷ router aliases;
// `enabled` lets a button ship before its runner case does (greyed, no 400s).
// ---------------------------------------------------------------------------

export interface DeckItem {
  skill: string;
  label: string;
  /** default intent args sent with the button (voice can override) */
  args?: Record<string, unknown>;
  /** ask the user ONE thing on click; blank keeps the skill's fallback,
   *  cancel queues nothing */
  ask?: { key: string; label: string };
  enabled?: boolean;
}

export const DECK_GROUPS: { group: string; items: DeckItem[] }[] = [
  {
    group: "Pull",
    items: [
      { skill: "metrics-pull", label: "Pull Data" },
      { skill: "ads-dashboard", label: "Rebuild Board" },
    ],
  },
  {
    group: "Audit",
    items: [
      { skill: "meta-ads-audit", label: "Meta Audit" },
      { skill: "google-ads-audit", label: "Google Audit" },
      { skill: "seo-audit", label: "SEO Audit" },
      { skill: "aeo-audit", label: "AEO Audit" },
    ],
  },
  {
    group: "Report",
    items: [
      { skill: "perf-report", label: "Perf Report", args: { scope: "blended", range: 7 } },
      { skill: "report-deck", label: "Weekly Deck", args: { scope: "blended", range: 7 } },
      { skill: "morning-intel", label: "AI Intel" },
    ],
  },
  {
    group: "Publish",
    items: [
      { skill: "ds-blog-publish", label: "Publish Blog" },
      { skill: "news-carousel", label: "News Carousel" },
      {
        skill: "competitor-intel",
        label: "Competitor Intel",
        ask: { key: "brand", label: "Which competitor? Brand name or website.\n(Leave blank to rotate through ops/competitors.md)" },
      },
      {
        skill: "bulk-creatives",
        label: "Bulk Creatives",
        ask: { key: "topic", label: "Ads for which offer / product?\n(Leave blank to reuse the newest brief in the kit)" },
      },
    ],
  },
  {
    group: "Day",
    items: [
      { skill: "today", label: "Today" },
      { skill: "close-day", label: "Close Day" },
    ],
  },
];

export default function CommandDeck({
  state,
  hot,
  allowed,
  onQueued,
  onCreativeIntelligence,
}: {
  state: VaultState | null;
  hot?: boolean;
  /** skills the API will accept right now (from /api/queue's ALLOWED_SKILLS) */
  allowed: Set<string>;
  onQueued: (skill: string, ok: boolean) => void;
  onCreativeIntelligence?: () => void;
}) {
  // per-skill button state: "queued" holds the 15s dedupe cooldown; "failed"
  // shows immediately on error and clears fast so a retry isn't blocked
  const [fired, setFired] = useState<Record<string, "queued" | "failed" | undefined>>({});
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
    },
    []
  );

  const fire = async (item: DeckItem) => {
    if (fired[item.skill]) return;
    const args: Record<string, unknown> = { ...(item.args ?? {}) };
    if (item.ask) {
      const v = window.prompt(item.ask.label, "");
      if (v === null) return; // cancelled — queue nothing
      if (v.trim()) args[item.ask.key] = v.trim();
    }
    setFired((c) => ({ ...c, [item.skill]: "queued" }));
    let ok = false;
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: item.skill, args }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    onQueued(item.skill, ok);
    if (!ok) setFired((c) => ({ ...c, [item.skill]: "failed" }));
    timersRef.current.push(
      setTimeout(
        () => setFired((c) => ({ ...c, [item.skill]: undefined })),
        ok ? 15000 : 4000
      )
    );
  };

  const r = state?.runner;
  return (
    <section className={`block accent-pink boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.26s" }}>
      <SectionTitle
        title="Command Deck"
        tick={r ? `${r.busy ? "ENGAGED" : "IDLE"} · ${r.active}/${r.max_concurrent} ACTIVE · ${r.pending} QUEUED` : "RUNNER OFFLINE"}
        tickCls={r?.alive ? "" : "bad"}
      />
      {state && state.queue.length > 0 && (
        <div className="queue-list">
          {state.queue.slice(0, 3).map((q) => (
            <span key={q.id}>▸ {q.label ?? q.skill}</span>
          ))}
          {state.queue.length > 3 && <span className="dim">+{state.queue.length - 3} more</span>}
        </div>
      )}
      <div className="deck">
        {DECK_GROUPS.map((g) => (
          <div className="deck-group" key={g.group}>
            <div className="deck-group-label">{g.group}</div>
            {g.items.map((d) => {
              const on = allowed.has(d.skill) && d.enabled !== false;
              const st = fired[d.skill];
              return (
                <button
                  key={d.skill}
                  className={`deck-btn ${st === "queued" ? "fired" : ""} ${st === "failed" ? "failed" : ""} ${on ? "" : "soon"}`}
                  onClick={() => fire(d)}
                  disabled={!on || !!st}
                  title={on ? d.skill : `${d.skill} — not wired yet`}
                >
                  <span className="deck-dot" />
                  <span className="deck-label">
                    {st === "queued" ? "QUEUED" : st === "failed" ? "FAILED" : d.label}
                  </span>
                  <span className="deck-arrow">→</span>
                </button>
              );
            })}
            {g.group === "Report" && onCreativeIntelligence && (
              <button className="deck-btn" onClick={onCreativeIntelligence} title="Inspect ad creative performance, Gemini observations and creative briefs">
                <span className="deck-dot" />
                <span className="deck-label">Creative Intel</span>
                <span className="deck-arrow">→</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="deck-hint">intents write to system/queue — runner executes</div>
    </section>
  );
}
