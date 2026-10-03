"use client";

import { memo } from "react";
import type { Campaign, Marketing } from "@/lib/vault";
import { fmtINR, fmtINRShort, fmtRoas } from "@/lib/format";
import { SectionTitle, pressable } from "./shared";

// ---------------------------------------------------------------------------
// Decision Queue — the top campaign verdicts (KILL → FIX → SCALE) from
// marketing-latest.json, computed against ops/targets.md. Click opens the
// full dashboard note. "all clear" when nothing needs a decision.
// ---------------------------------------------------------------------------

const ORDER: Record<string, number> = { KILL: 0, FIX: 1, SCALE: 2, WATCH: 3, NA: 4 };

function why(c: Campaign): string {
  const bits: string[] = [];
  if (c.roas !== null) bits.push(`ROAS ${fmtRoas(c.roas)}`);
  else if (c.cpl) bits.push(`CPL ₹${fmtINR(c.cpl)}`);
  if (c.reasons.includes("fatigue")) bits.push("fatigue");
  if (c.reasons.includes("ctr")) bits.push("ctr low");
  if (c.reasons.includes("cpa")) bits.push("cpa high");
  return bits.join(" · ");
}

const DecisionQueue = memo(function DecisionQueue({
  m,
  hot,
  onOpen,
}: {
  m: Marketing | null;
  hot?: boolean;
  onOpen: (path: string) => void;
}) {
  const all = [...(m?.channels.meta.campaigns ?? []), ...(m?.channels.google.campaigns ?? [])];
  const flagged = all
    .filter((c) => c.verdict === "KILL" || c.verdict === "FIX" || c.verdict === "SCALE")
    .sort((a, b) => (ORDER[a.verdict] ?? 9) - (ORDER[b.verdict] ?? 9) || b.spend - a.spend)
    .slice(0, 3);
  const kills = all.filter((c) => c.verdict === "KILL").length;
  const fixes = all.filter((c) => c.verdict === "FIX").length;
  const dash = m?.latest_reports.dashboard ?? "ops/ads-dashboard.md";
  const tick = !m ? "—" : flagged.length ? `${kills} KILL · ${fixes} FIX` : "ALL CLEAR";
  return (
    <section
      className={`block decisions boot-stagger ${hot ? "voice-hot" : ""}`}
      style={{ animationDelay: "0.66s" }}
      title="open the marketing dashboard"
      {...pressable(() => onOpen(dash))}
    >
      <SectionTitle title="Decision Queue" tick={tick} tickCls={kills ? "bad" : fixes ? "warn" : ""} />
      {!m ? (
        <div className="prio dim">waiting on the first metrics pull</div>
      ) : flagged.length === 0 ? (
        <div className="prio dim">no campaigns need a decision</div>
      ) : (
        flagged.map((c) => (
          <div className="verdict-row" key={`${c.account_id ?? ""}:${c.campaign_id ?? c.campaign}`}>
            <span className={`verdict v-${c.verdict.toLowerCase()}`}>{c.verdict}</span>
            <span className="verdict-name" title={c.campaign}>{c.campaign}</span>
            <span className="verdict-why">{why(c)}</span>
            <span className="verdict-spend">{fmtINRShort(c.spend)}</span>
          </div>
        ))
      )}
    </section>
  );
});

export default DecisionQueue;
