"use client";

import { memo } from "react";
import type { Economics, Marketing, PaidChannel, Targets } from "@/lib/vault";
import { deltaGood, fmtAge, fmtDelta, fmtINR, fmtINRShort, fmtPct, fmtRoas } from "@/lib/format";
import { CountUp, NumberRoll, PanelLoading, SectionTitle, Sparkline, verdictCls } from "./shared";

/** colour-blind backup for the verdict tints — read by screen readers too */
const VERDICT_WORD: Record<string, string> = { ok: "good", warn: "watch", bad: "bad" };

// ---------------------------------------------------------------------------
// Paid Media — the money panel. Spend hero + four KPI tiles coloured against
// ops/targets.md. Every number comes pre-verdicted from marketing-latest.json;
// this component only renders. Meta first; Google rows appear once that
// channel reports.
// ---------------------------------------------------------------------------

function Tile({
  label,
  value,
  verdict,
  delta,
  invert,
  target,
  spark,
}: {
  label: string;
  value: string;
  verdict?: string;
  delta?: number | null;
  invert?: boolean;
  target?: string;
  spark?: (number | null)[];
}) {
  const good = deltaGood(delta, invert);
  const cls = verdictCls(verdict);
  return (
    <div className={`kpi ${cls}`}>
      <span className="kpi-label">
        {label}
        {VERDICT_WORD[cls] && <span className="kpi-verdict"> · {VERDICT_WORD[cls]}</span>}
      </span>
      <span className="kpi-value">
        <NumberRoll text={value} />
      </span>
      <span className={`kpi-delta ${good === null ? "zero" : good ? "" : "neg"}`}>{fmtDelta(delta)}</span>
      {target && <span className="kpi-target">{target}</span>}
      {spark && spark.length > 1 && <Sparkline points={spark} className="kpi-spark" />}
    </div>
  );
}

function channelTick(ch: PaidChannel, name: string): { text: string; cls: string } {
  const age = fmtAge(ch.ts);
  if (ch.status === "skipped") return { text: `${name} · NOT WIRED`, cls: "dim" };
  if (ch.status === "error") return { text: `${name} · ERROR`, cls: "bad" };
  const accts =
    ch.accounts_total && ch.accounts_total > 1 ? ` · ${ch.accounts_ok}/${ch.accounts_total} ACCTS` : "";
  const st = ch.status === "partial" ? " · PARTIAL" : age.stale ? " · STALE" : "";
  return { text: `${name}${accts}${st} · ${age.label}`, cls: ch.status === "partial" || age.stale ? "warn" : "" };
}

const CHANNEL_LABEL: Record<string, string> = { meta: "META", google: "GOOGLE" };

/**
 * Blended band — the altitude a marketing lead actually works at. Only drawn
 * once a second paid channel reports; with one channel it would restate the
 * hero numbers directly below it.
 */
function BlendedBand({ b, T }: { b: NonNullable<Marketing["blended"]>; T?: Targets }) {
  const t = b.totals;
  const mix = Object.entries(b.mix).sort((x, y) => y[1] - x[1]);
  return (
    <div className="blended-band">
      <span className="label">Blended · {b.channels.length} channels</span>
      <span className="blended-nums">
        <b>₹<NumberRoll text={fmtINR(t.spend)} /></b> spend
        <em className={verdictCls(b.verdicts.roas)}>ROAS <NumberRoll text={fmtRoas(t.roas)} /></em>
        <em className={verdictCls(b.verdicts.cpa)}>
          CPA <NumberRoll text={t.cpa ? `₹${fmtINR(t.cpa)}` : "—"} />
        </em>
        {T && <em className="dim">BE {T.breakeven_roas.toFixed(2)}</em>}
      </span>
      <span className="mix-bar" aria-label="spend mix by channel">
        {mix.map(([k, v]) => (
          <i key={k} className={`mix-${k}`} style={{ width: `${Math.max(v * 100, 2)}%` }} title={`${CHANNEL_LABEL[k] ?? k} ${Math.round(v * 100)}%`} />
        ))}
      </span>
      <span className="mix-legend">
        {mix.map(([k, v]) => (
          <span key={k}>
            <i className={`mix-${k}`} />
            {CHANNEL_LABEL[k] ?? k.toUpperCase()} {Math.round(v * 100)}%
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Contribution — revenue that survives ad spend, at the gross margin implied
 * by the breakeven ROAS in ops/targets.md. Computed in marketing_context.py;
 * this only renders it. The one line that answers "are we making money".
 */
function Contribution({ e, days }: { e: Economics; days: number }) {
  const good = e.contribution > 0;
  return (
    <div className={`contribution ${good ? "ok" : "bad"}`}>
      <span className="label">Contribution · {days}d</span>
      <span className="value">
        {good ? "+" : "−"}₹<NumberRoll text={fmtINR(Math.abs(e.contribution))} />
      </span>
      <span className="sub">
        {e.gross_margin_pct.toFixed(0)}% gross margin
        {e.per_day !== null && ` · ${good ? "+" : "−"}₹${fmtINR(Math.abs(e.per_day))}/day`}
        {e.margin_pct !== null && ` · ${e.margin_pct.toFixed(1)}% of revenue`}
      </span>
    </div>
  );
}

const PaidMedia = memo(function PaidMedia({
  m,
  hot,
  loading,
  onDetail,
}: {
  m: Marketing | null;
  hot?: boolean;
  loading?: boolean;
  /** opens the day-wise detail overlay — the deep numbers stay off the wall */
  onDetail?: () => void;
}) {
  const meta = m?.channels.meta;
  const google = m?.channels.google;
  const T = m?.targets;
  const t = meta?.totals;
  const tick = loading && !m ? { text: "LOADING", cls: "dim" } : meta ? channelTick(meta, "META") : { text: "WAITING ON PULL", cls: "dim" };
  const leadGen = !!t && (t.leads ?? 0) > 0 && !(t.purchases ?? 0);
  const days = meta?.window?.days ?? 7;

  return (
    <section className={`block accent-coral boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.18s" }}>
      <SectionTitle title="Paid Media" tick={tick.text} tickCls={tick.cls} />
      {loading && !m ? (
        <PanelLoading lines={3} />
      ) : !m || !t ? (
        <div className="prio dim">
          {m?.channels.meta.status === "skipped"
            ? "Meta not wired — see docs/marketing-setup.md"
            : "no paid data yet — run Pull Data"}
        </div>
      ) : (
        <>
          {m.blended && m.blended.channels.length > 1 && <BlendedBand b={m.blended} T={T} />}

          <div className="vital spend-hero">
            <span className="label">
              <i className={`status-dot ${meta!.status !== "ok" ? (meta!.status === "partial" ? "stale" : meta!.status) : ""}`} />
              Spend · {days}d
            </span>
            <span className="value">
              <span className="currency">₹</span>
              <CountUp value={t.spend} />
            </span>
            <span className={`delta ${deltaGood(meta!.deltas.spend) === null ? "zero" : ""}`}>
              {fmtDelta(meta!.deltas.spend)} vs prior · rev {fmtINRShort(t.revenue)}
            </span>
            <div className="spark-row">
              <Sparkline points={meta!.spark.spend ?? []} />
            </div>
          </div>

          <div className="kpi-grid">
            <Tile
              label="ROAS"
              value={fmtRoas(t.roas)}
              verdict={meta!.verdicts.roas}
              delta={meta!.deltas.roas}
              target={T ? `BE ${T.breakeven_roas.toFixed(2)} · TGT ${T.target_roas.toFixed(1)}` : undefined}
              spark={meta!.spark.revenue}
            />
            {leadGen ? (
              <Tile
                label="CPL"
                value={t.cpl ? `₹${fmtINR(t.cpl)}` : "—"}
                verdict={meta!.verdicts.cpl}
                delta={meta!.deltas.cpl}
                invert
                target={T ? `TGT ₹${fmtINR(T.target_cpl)}` : undefined}
              />
            ) : (
              <Tile
                label="CPA"
                value={t.cpa ? `₹${fmtINR(t.cpa)}` : "—"}
                verdict={meta!.verdicts.cpa}
                delta={meta!.deltas.cpa}
                invert
                target={T ? `TGT ₹${fmtINR(T.target_cpa)} · MAX ₹${fmtINR(T.max_cpa)}` : undefined}
              />
            )}
            <Tile
              label="CTR"
              value={fmtPct(t.ctr, 2)}
              verdict={meta!.verdicts.ctr}
              delta={meta!.deltas.ctr}
              target={T ? `FLOOR ${T.min_ctr.toFixed(1)}%` : undefined}
              spark={meta!.spark.clicks}
            />
            <Tile
              label={leadGen ? "Leads" : "Sales"}
              value={fmtINR(t.results ?? 0)}
              delta={meta!.deltas.results}
              target={t.frequency ? `FREQ ${t.frequency.toFixed(2)}${T ? ` / ${T.max_frequency.toFixed(1)}` : ""}` : undefined}
              verdict={t.frequency && T && t.frequency > T.max_frequency ? "red" : undefined}
              spark={meta!.spark.purchases}
            />
          </div>

          {m.blended?.economics && <Contribution e={m.blended.economics} days={days} />}

          {google && google.totals && (
            <div className="vital google-row">
              <span className="label">
                <i className={`status-dot ${google.status !== "ok" ? google.status : ""}`} />
                Google · {google.window?.days ?? days}d
              </span>
              <span className="value sm">
                <span className="currency">₹</span>
                <NumberRoll text={fmtINR(google.totals.spend)} />
              </span>
              <span className="delta zero">
                CPA {google.totals.cpa ? `₹${fmtINR(google.totals.cpa)}` : "—"} · CTR {fmtPct(google.totals.ctr, 2)}
                {google.totals.impression_share != null ? ` · IS ${fmtPct(google.totals.impression_share * 100, 0)}` : ""}
              </span>
              {google.spark.spend && google.spark.spend.length > 1 && (
                <div className="spark-row">
                  <Sparkline points={google.spark.spend} />
                </div>
              )}
            </div>
          )}
          {google && google.status === "skipped" && (
            <div className="wire-note">Google Ads · waiting on OAuth — docs/marketing-setup.md §1</div>
          )}

          {onDetail && (
            <button className="panel-more" onClick={onDetail}>
              day by day · campaigns ↗
            </button>
          )}
        </>
      )}
    </section>
  );
});

export default PaidMedia;
