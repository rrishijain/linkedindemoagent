"use client";

import { memo } from "react";
import type { Marketing, MarketingFlag } from "@/lib/vault";
import { fmtAge } from "@/lib/format";
import { PanelLoading, SectionTitle, pressable } from "./shared";

// ---------------------------------------------------------------------------
// Signals — the exception feed. marketing_context.py already computes a flag
// list (breakeven breaches, fatigue, CPM spikes, partial accounts, stale data)
// and until now nothing on the wall read it. This panel is the "what changed
// that I should care about" line: red first, capped, never invented here.
// Click opens the latest performance report.
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = { red: 0, amber: 1, info: 2 };
const LEVEL_CLS: Record<string, string> = { red: "bad", amber: "warn", info: "" };
/** colour-blind backup — read aloud by screen readers too */
const LEVEL_WORD: Record<string, string> = { red: "act now", amber: "watch", info: "note" };

const MAX_ROWS = 4;

function rank(f: MarketingFlag): number {
  return LEVEL_ORDER[f.level] ?? 3;
}

const Signals = memo(function Signals({
  m,
  hot,
  loading,
  onOpen,
}: {
  m: Marketing | null;
  hot?: boolean;
  loading?: boolean;
  onOpen?: (path: string) => void;
}) {
  const flags = [...(m?.flags ?? [])].sort((a, b) => rank(a) - rank(b));
  const reds = flags.filter((f) => f.level === "red").length;
  const ambers = flags.filter((f) => f.level === "amber").length;
  const shown = flags.slice(0, MAX_ROWS);
  const hidden = flags.length - shown.length;
  const report = m?.latest_reports.perf;
  const age = fmtAge(m?.generated_at ?? null);

  const tick = !m
    ? loading
      ? "LOADING"
      : "WAITING ON PULL"
    : flags.length === 0
      ? `ALL CLEAR · ${age.label}`
      : `${reds ? `${reds} ACT NOW · ` : ""}${ambers} WATCH`;

  return (
    <section
      className={`block signals accent-coral boot-stagger ${hot ? "voice-hot" : ""}`}
      style={{ animationDelay: "0.12s" }}
      title={report && onOpen ? "open the latest performance report" : undefined}
      {...(report && onOpen ? pressable(() => onOpen(report)) : {})}
    >
      <SectionTitle
        title="Signals"
        tick={tick}
        tickCls={!m ? "dim" : reds ? "bad" : ambers ? "warn" : ""}
      />
      {loading && !m ? (
        <PanelLoading lines={2} />
      ) : !m ? (
        <div className="prio dim">waiting on the first metrics pull</div>
      ) : shown.length === 0 ? (
        <div className="prio dim">nothing breached a target — no action needed</div>
      ) : (
        <>
          {shown.map((f) => (
            <div className={`signal-row ${LEVEL_CLS[f.level] ?? ""}`} key={`${f.channel ?? ""}:${f.code}`}>
              <span className="signal-dot" aria-hidden="true" />
              <span className="signal-text">{f.text}</span>
              <span className="signal-meta">
                {f.channel ?? ""}
                <em> · {LEVEL_WORD[f.level] ?? f.level}</em>
              </span>
            </div>
          ))}
          {hidden > 0 && <div className="wire-note">+{hidden} more in the dashboard</div>}
        </>
      )}
    </section>
  );
});

export default Signals;
