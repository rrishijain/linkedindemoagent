"use client";

import { memo } from "react";
import type { Marketing, PullSource } from "@/lib/vault";
import { fmtAgeSeconds } from "@/lib/format";
import { PanelLoading, SectionTitle, pressable } from "./shared";

// ---------------------------------------------------------------------------
// Sources — "can I trust this number?" in one glance. One chip per data
// source from last-pull.json; core (money) sources first. Click opens the
// latest metrics-pull run report when one exists.
// ---------------------------------------------------------------------------

const NAMES: Record<string, string> = {
  meta_ads: "META", google_ads: "GADS", gsc: "GSC", aeo: "AEO",
  instagram: "IG", youtube: "YT", tiktok: "TT", claude_code: "CLAUDE",
};

function glyph(s: PullSource): string {
  switch (s.status) {
    case "ok": return "●";
    case "partial": return "◐";
    case "stale": return "◔";
    case "mock": return "○";
    case "skipped": return "—";
    default: return "✕";
  }
}

const Sources = memo(function Sources({ m, hot, loading, onOpen }: { m: Marketing | null; hot?: boolean; loading?: boolean; onOpen?: (p: string) => void }) {
  if (!m) {
    return (
      <section className={`block accent-sky boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.34s" }}>
        <SectionTitle title="Sources" tick={loading ? "LOADING" : "NO PULL YET"} tickCls="dim" />
        {loading ? <PanelLoading /> : <div className="prio dim">waiting on the first metrics pull</div>}
      </section>
    );
  }
  const ORDER = ["meta_ads", "google_ads", "gsc", "aeo", "instagram", "youtube", "tiktok", "claude_code"];
  const srcs = [...m.pull.sources].sort(
    (a, b) => (ORDER.indexOf(a.source) + 1 || 99) - (ORDER.indexOf(b.source) + 1 || 99)
  );
  const overall = m.pull.overall;
  const latest = m.latest_reports.metrics;
  return (
    <section
      className={`block accent-sky boot-stagger ${hot ? "voice-hot" : ""}`}
      style={{ animationDelay: "0.34s" }}
      title={latest && onOpen ? "open the latest metrics-pull report" : undefined}
      {...(latest && onOpen ? pressable(() => onOpen(latest)) : {})}
    >
      <SectionTitle
        title="Sources"
        tick={`DATA · ${overall.toUpperCase()} · CHECK ${fmtAgeSeconds(m.pull.newest_age_s)}`}
        tickCls={overall === "fresh" ? "" : overall === "partial" ? "warn" : "bad"}
      />
      <div className="src-strip">
        {srcs.map((s) => (
          <span
            key={s.source}
            className={`src-chip st-${s.status} ${s.core ? "core" : ""}`}
            title={`${s.status}${s.error ? `: ${s.error}` : ""} · Last check: ${s.ts ?? "unknown"}. Check time is not the date range of the underlying data.`}
          >
            <i>{glyph(s)}</i>
            {NAMES[s.source] ?? s.source.toUpperCase()}
            <em>{s.status === "skipped" ? "" : fmtAgeSeconds(s.age_s)}</em>
          </span>
        ))}
      </div>
    </section>
  );
});

export default Sources;
