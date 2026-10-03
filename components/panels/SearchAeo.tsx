"use client";

import { memo } from "react";
import type { Marketing } from "@/lib/vault";
import { deltaGood, fmtAge, fmtCount, fmtDelta, fmtPct } from "@/lib/format";
import { NumberRoll, PanelLoading, SectionTitle, Sparkline, verdictCls } from "./shared";

const VERDICT_WORD: Record<string, string> = { ok: "good", warn: "watch", bad: "bad" };

// ---------------------------------------------------------------------------
// Search & AEO — organic truth. AEO readiness (exists today) on top; GSC rows
// once Search Console is wired. Never returns null while either exists, and
// says plainly what is missing instead of hiding the row.
// ---------------------------------------------------------------------------

function Row({
  label,
  value,
  delta,
  invert,
  verdict,
  sub,
}: {
  label: string;
  value: string;
  delta?: number | null;
  invert?: boolean;
  verdict?: string;
  sub?: string;
}) {
  const good = deltaGood(delta, invert);
  const cls = verdictCls(verdict);
  return (
    <div className={`kv-row ${cls}`}>
      <span className="kv-label">
        {label}
        {VERDICT_WORD[cls] && <span className="kpi-verdict"> · {VERDICT_WORD[cls]}</span>}
      </span>
      <span className="kv-value">
        <NumberRoll text={value} />
      </span>
      <span className={`kv-delta ${good === null ? "zero" : good ? "" : "neg"}`}>{delta === undefined ? sub ?? "" : fmtDelta(delta)}</span>
    </div>
  );
}

const SearchAeo = memo(function SearchAeo({ m, hot, loading }: { m: Marketing | null; hot?: boolean; loading?: boolean }) {
  const seo = m?.channels.seo;
  const aeo = m?.aeo;
  const ig = m?.instagram;
  const T = m?.targets;
  if (loading && !m) {
    return (
      <section className={`block accent-violet boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.24s" }}>
        <SectionTitle title="Search & AEO" tick="LOADING" tickCls="dim" />
        <PanelLoading lines={3} />
      </section>
    );
  }
  if (!m || (!seo?.totals && (aeo?.score === null || aeo?.score === undefined) && !ig?.followers)) {
    return (
      <section className={`block accent-violet boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.24s" }}>
        <SectionTitle title="Search & AEO" tick="WAITING ON PULL" tickCls="dim" />
        <div className="prio dim">no organic data yet — run Pull Data</div>
      </section>
    );
  }
  const st = seo?.totals;
  const age = fmtAge(seo?.ts ?? aeo?.ts ?? null);
  const tick = st
    ? `GSC · ${seo!.window?.days ?? 7}D · ${age.label}`
    : `AEO · ${fmtAge(aeo?.ts ?? null).label}`;

  return (
    <section className={`block accent-violet boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.24s" }}>
      <SectionTitle title="Search & AEO" tick={tick} tickCls={age.stale ? "warn" : ""} />

      {st ? (
        <>
          <Row label="Clicks" value={fmtCount(st.clicks)} delta={seo!.deltas.clicks} />
          <Row label="Impressions" value={fmtCount(st.impressions)} delta={seo!.deltas.impressions} />
          <Row label="CTR" value={fmtPct(st.ctr, 2)} delta={seo!.deltas.ctr} />
          <Row
            label="Avg position"
            value={st.position != null ? st.position.toFixed(1) : "—"}
            delta={seo!.deltas.position}
            invert
          />
          {seo!.spark.clicks && seo!.spark.clicks.length > 1 && (
            <div className="spark-row">
              {seo!.spark.impressions && seo!.spark.impressions.length > 1 && (
                <Sparkline points={seo!.spark.impressions} className="spark-dim" />
              )}
              <Sparkline points={seo!.spark.clicks} />
            </div>
          )}
          {seo!.striking_distance.length > 0 && (
            <div className="striking">
              <div className="striking-head">
                {seo!.striking_distance.length} queries in striking distance · pos 8–20
              </div>
              {seo!.striking_distance.slice(0, 3).map((q) => (
                <div className="striking-row" key={q.query}>
                  <span className="sq-query" title={q.query}>
                    {q.query}
                  </span>
                  <span className="sq-pos">pos {q.position.toFixed(1)}</span>
                  <span className="sq-impr">{fmtCount(q.impressions)} impr</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="wire-note">
          GSC · {seo?.status === "skipped" ? "waiting on Google OAuth — docs/marketing-setup.md §2" : seo?.error || "no data"}
        </div>
      )}

      {ig && ig.status !== "skipped" && ig.followers !== undefined && (
        <Row
          label={`Instagram${ig.handle ? ` · @${ig.handle}` : ""}`}
          value={fmtCount(ig.followers)}
          verdict={ig.verdicts?.er}
          sub={`ER ${ig.er_pct !== null && ig.er_pct !== undefined ? fmtPct(ig.er_pct, 2) : "—"} / ${
            T ? T.ig_min_er_pct.toFixed(1) : "1.0"
          }% · ${ig.cadence_per_week ?? "—"} posts/wk${ig.status === "stale" ? " · STALE" : ""}`}
        />
      )}

      {aeo && aeo.score !== null && aeo.score !== undefined && (
        <Row
          label="AEO readiness"
          value={`${Math.round(aeo.score)}/100`}
          verdict={aeo.verdict}
          sub={`FLOOR ${T ? Math.round(T.aeo_min_score) : 70} · ${aeo.ai_bots_allowed ?? "?"}/${aeo.ai_bots_total ?? "?"} BOTS${
            aeo.faq_schema === false ? " · NO FAQ SCHEMA" : ""
          }`}
        />
      )}
    </section>
  );
});

export default SearchAeo;
