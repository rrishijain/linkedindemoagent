"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyCampaign, DailyPoint, PaidDaily } from "@/lib/paidDaily";
import type { Targets } from "@/lib/vault";
import { fmtCount, fmtINR, fmtINRShort, fmtPct, fmtRoas } from "@/lib/format";

// ---------------------------------------------------------------------------
// Paid Media detail — the day-wise numbers that deliberately do NOT live on the
// wall. Opened from the Paid Media panel's "day-wise" button, fetched on open.
//
// Everything here is arithmetic on what the platforms reported (lib/paidDaily)
// judged against the targets marketing_context.py resolved (breakeven ROAS,
// target CPA, gross margin). No verdict is invented in this file — a cell is
// green or red because it sits above or below a target that already existed.
// ---------------------------------------------------------------------------

type ChannelTab = "all" | "meta" | "google";
type RangeDays = 7 | 30 | 90;

interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  revenue: number;
  days: number;
}

const EMPTY: Totals = { spend: 0, impressions: 0, clicks: 0, results: 0, revenue: 0, days: 0 };

function add(t: Totals, d: { spend: number; impressions: number; clicks: number; results: number; revenue: number }): Totals {
  return {
    spend: t.spend + d.spend,
    impressions: t.impressions + d.impressions,
    clicks: t.clicks + d.clicks,
    results: t.results + d.results,
    revenue: t.revenue + d.revenue,
    days: t.days,
  };
}

const roasOf = (t: { revenue: number; spend: number }) => (t.spend > 0 ? t.revenue / t.spend : null);
const cpaOf = (t: { spend: number; results: number }) => (t.results > 0 ? t.spend / t.results : null);
const ctrOf = (t: { clicks: number; impressions: number }) =>
  t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null;

/** Contribution = revenue × gross margin − spend. Margin comes from the
 *  breakeven ROAS that ops/targets.md already sets: at breakeven, revenue ×
 *  margin exactly equals spend, so margin = 1 / breakeven_roas. */
const marginOf = (T?: Targets) => (T && T.breakeven_roas > 0 ? 1 / T.breakeven_roas : null);

function contributionOf(t: { revenue: number; spend: number }, T?: Targets): number | null {
  const m = marginOf(T);
  return m === null ? null : t.revenue * m - t.spend;
}

/** ISO date → "Tue 02 Sep" */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

const cls = (ok: boolean | null) => (ok === null ? "" : ok ? "ok" : "bad");

/** cost per result against both targets: at/under target is good, between
 *  target and the ceiling is a warning, above the ceiling is bad */
function cpaCls(cpa: number | null, T?: Targets): string {
  if (!T || cpa === null) return "";
  if (cpa <= T.target_cpa) return "ok";
  return cpa <= T.max_cpa ? "warn" : "bad";
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`pd-tile ${tone ?? ""}`}>
      <span className="pd-tile-label">{label}</span>
      <span className="pd-tile-value">{value}</span>
      {sub && <span className="pd-tile-sub">{sub}</span>}
    </div>
  );
}

/** Day-wise spend bars with the ROAS verdict encoded in the fill, so the
 *  shape of the month reads before any number does. */
function SpendBars({ days, max, T }: { days: DailyPoint[]; max: number; T?: Targets }) {
  const be = T?.breakeven_roas ?? null;
  return (
    <div className="pd-bars" aria-hidden="true">
      {days.map((d) => {
        const r = roasOf(d);
        const tone = be === null || r === null ? "" : r >= be ? "ok" : "bad";
        return (
          <i
            key={`${d.date}-${d.channel}`}
            className={tone}
            style={{ height: `${Math.max(2, (d.spend / max) * 100)}%` }}
            title={`${d.date} · ${fmtINRShort(d.spend)}`}
          />
        );
      })}
    </div>
  );
}

export default function PaidDetailOverlay({
  targets,
  onClose,
}: {
  targets?: Targets;
  onClose: () => void;
}) {
  const [data, setData] = useState<PaidDaily | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<ChannelTab>("all");
  const [range, setRange] = useState<RangeDays>(30);
  const [open, setOpen] = useState<string | null>(null); // expanded day key

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/paid-daily")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: PaidDaily) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);

  // --- shape the window -----------------------------------------------------
  const view = useMemo(() => {
    if (!data) return null;
    const dates = [...new Set(data.days.map((d) => d.date))].sort().reverse().slice(0, range);
    const keep = new Set(dates);
    const rows = data.days.filter((d) => keep.has(d.date) && (tab === "all" || d.channel === tab));

    // one row per date — "all" merges the channels for that day
    const merged = new Map<string, DailyPoint>();
    for (const r of rows) {
      const key = tab === "all" ? r.date : `${r.date}-${r.channel}`;
      const cur = merged.get(key);
      if (!cur) {
        merged.set(key, { ...r, campaigns: [...r.campaigns] });
      } else {
        const sum = add(cur as unknown as Totals, r);
        cur.spend = sum.spend;
        cur.impressions = sum.impressions;
        cur.clicks = sum.clicks;
        cur.results = sum.results;
        cur.revenue = sum.revenue;
        cur.campaigns = [...cur.campaigns, ...r.campaigns];
        if (cur.reach !== undefined && r.reach !== undefined) cur.reach += r.reach;
      }
    }
    const days = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const d of days) d.campaigns.sort((a, b) => b.spend - a.spend);

    let totals: Totals = { ...EMPTY, days: days.length };
    for (const d of days) totals = add(totals, d);

    // campaign rollup across the whole window
    const byCampaign = new Map<string, DailyCampaign>();
    for (const d of days) {
      for (const c of d.campaigns) {
        const k = c.id || c.name;
        const cur = byCampaign.get(k);
        if (!cur) byCampaign.set(k, { ...c });
        else {
          cur.spend += c.spend;
          cur.impressions += c.impressions;
          cur.clicks += c.clicks;
          cur.results += c.results;
          cur.revenue += c.revenue;
        }
      }
    }
    const campaigns = [...byCampaign.values()].sort((a, b) => b.spend - a.spend);
    const maxSpend = days.reduce((m, d) => Math.max(m, d.spend), 0) || 1;
    // a channel that reports results but no revenue is a TRACKING gap, not a
    // ROAS of zero — say so rather than letting the column imply performance
    const noRevenue = totals.spend > 0 && totals.revenue === 0 && totals.results > 0;
    return { days, totals, campaigns, maxSpend, dates, noRevenue };
  }, [data, tab, range]);

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const T = targets;
  const be = T?.breakeven_roas ?? null;
  const tot = view?.totals;
  const totRoas = tot ? roasOf(tot) : null;
  const totCpa = tot ? cpaOf(tot) : null;
  const totContrib = tot ? contributionOf(tot, T) : null;
  const margin = marginOf(T);

  return (
    <div className="report-overlay" onClick={onClose}>
      <div
        className="report-panel pd-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="report-head">
          <h1 className="report-title" id="pd-title">Paid Media · day by day</h1>
          <span className="report-path">
            {data
              ? `${view?.dates.length ?? 0} days${data.coverage.meta ? ` · meta from ${data.coverage.meta.from}` : ""}${
                  data.coverage.google ? ` · google from ${data.coverage.google.from}` : ""
                }`
              : "system/metrics/history"}
          </span>
          <button className="report-close" ref={closeRef} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="pd-controls">
          <div className="pd-seg" role="group" aria-label="channel">
            {(["all", "meta", "google"] as ChannelTab[]).map((k) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} aria-pressed={tab === k}>
                {k === "all" ? "Blended" : k}
              </button>
            ))}
          </div>
          <div className="pd-seg" role="group" aria-label="range">
            {([7, 30, 90] as RangeDays[]).map((d) => (
              <button key={d} className={range === d ? "on" : ""} onClick={() => setRange(d)} aria-pressed={range === d}>
                {d}d
              </button>
            ))}
          </div>
          {margin !== null && (
            <span className="pd-note">
              contribution at {(margin * 100).toFixed(0)}% margin · breakeven ROAS {be?.toFixed(2)}
            </span>
          )}
        </div>

        <div className="report-body pd-body">
          {error && <div className="prio bad">couldn&apos;t read the daily history — is the metrics pull wired?</div>}
          {!data && !error && <div className="prio dim">reading system/metrics/history…</div>}

          {view && tot && (
            <>
              {view.days.length === 0 ? (
                <div className="prio dim">no {tab === "all" ? "" : `${tab} `}history in this window</div>
              ) : (
                <>
                  {view.noRevenue && (
                    <div className="pd-flag">
                      <b>No revenue reported</b> for this selection — {fmtCount(tot.results)} results, zero conversion
                      value. ROAS and contribution below read as 0 because the value is missing, not because the
                      spend earned nothing. Fix conversion-value tracking before acting on these columns.
                    </div>
                  )}

                  <div className="pd-tiles">
                    <Tile label={`Spend · ${view.days.length}d`} value={`₹${fmtINR(tot.spend)}`} sub={`${fmtINRShort(tot.revenue)} revenue`} />
                    <Tile
                      label="Contribution"
                      value={totContrib === null ? "—" : `${totContrib >= 0 ? "+" : "−"}₹${fmtINR(Math.abs(totContrib))}`}
                      sub={totContrib === null ? "no margin target" : `${fmtINRShort(totContrib / Math.max(1, view.days.length))}/day`}
                      tone={totContrib === null ? "" : totContrib >= 0 ? "ok" : "bad"}
                    />
                    <Tile
                      label="ROAS"
                      value={fmtRoas(totRoas)}
                      sub={be ? `breakeven ${be.toFixed(2)}` : undefined}
                      tone={be === null || totRoas === null ? "" : totRoas >= be ? "ok" : "bad"}
                    />
                    <Tile
                      label="Cost / result"
                      value={totCpa ? `₹${fmtINR(totCpa)}` : "—"}
                      sub={T ? `target ₹${fmtINR(T.target_cpa)}` : undefined}
                      tone={!T || totCpa === null ? "" : totCpa <= T.target_cpa ? "ok" : totCpa <= T.max_cpa ? "warn" : "bad"}
                    />
                    <Tile label="Results" value={fmtCount(tot.results)} sub={`${fmtCount(tot.clicks)} clicks`} />
                    <Tile
                      label="Click → result"
                      value={tot.clicks > 0 ? fmtPct((tot.results / tot.clicks) * 100, 2) : "—"}
                      sub={`CTR ${fmtPct(ctrOf(tot), 2)}`}
                    />
                  </div>

                  <SpendBars days={[...view.days].reverse()} max={view.maxSpend} T={T} />
                  <div className="pd-bars-legend">
                    <span>daily spend · {view.dates[view.dates.length - 1]}</span>
                    <span className="pd-bars-key">
                      <i className="ok" /> above breakeven <i className="bad" /> below
                    </span>
                    <span>{view.dates[0]}</span>
                  </div>

                  <h2 className="pd-h">Day by day</h2>
                  <div className="pd-scroll">
                    <table className="pd-table">
                      <thead>
                        <tr>
                          <th className="l">Day</th>
                          {tab === "all" && <th className="l">Camps</th>}
                          <th>Spend</th>
                          <th>Revenue</th>
                          <th>Contrib</th>
                          <th>ROAS</th>
                          <th>Results</th>
                          <th>Cost/res</th>
                          <th>CTR</th>
                          <th>Clicks</th>
                          <th>Impr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.days.map((d) => {
                          const key = `${d.date}-${d.channel}`;
                          const r = roasOf(d);
                          const c = cpaOf(d);
                          const contrib = contributionOf(d, T);
                          const isOpen = open === key;
                          return [
                            <tr
                              key={key}
                              className={`pd-row ${isOpen ? "open" : ""}`}
                              onClick={() => setOpen(isOpen ? null : key)}
                              tabIndex={0}
                              role="button"
                              aria-expanded={isOpen}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setOpen(isOpen ? null : key);
                                }
                              }}
                            >
                              <td className="l">
                                <i className={`pd-caret ${isOpen ? "on" : ""}`} aria-hidden="true">▸</i>
                                {dayLabel(d.date)}
                              </td>
                              {tab === "all" && <td className="l dim">{d.campaigns.length} camp</td>}
                              <td>₹{fmtINR(d.spend)}</td>
                              <td>{fmtINRShort(d.revenue)}</td>
                              <td className={contrib === null ? "" : contrib >= 0 ? "ok" : "bad"}>
                                {contrib === null ? "—" : `${contrib >= 0 ? "+" : "−"}${fmtINRShort(Math.abs(contrib))}`}
                              </td>
                              <td className={cls(be === null || r === null ? null : r >= be)}>{fmtRoas(r)}</td>
                              <td>{d.results ? fmtCount(d.results) : "—"}</td>
                              <td className={cpaCls(c, T)}>{c ? `₹${fmtINR(c)}` : "—"}</td>
                              <td>{fmtPct(ctrOf(d), 2)}</td>
                              <td className="dim">{fmtCount(d.clicks)}</td>
                              <td className="dim">{fmtCount(d.impressions)}</td>
                            </tr>,
                            isOpen ? (
                              <tr key={`${key}-x`} className="pd-expand">
                                <td colSpan={tab === "all" ? 11 : 10}>
                                  <table className="pd-sub">
                                    <tbody>
                                      {d.campaigns.map((c2, i) => {
                                        const r2 = roasOf(c2);
                                        const cp2 = cpaOf(c2);
                                        return (
                                          <tr key={`${c2.id || c2.name}-${i}`}>
                                            <td className="l">{c2.name}</td>
                                            <td>₹{fmtINR(c2.spend)}</td>
                                            <td>{fmtINRShort(c2.revenue)}</td>
                                            <td className={cls(be === null || r2 === null ? null : r2 >= be)}>{fmtRoas(r2)}</td>
                                            <td>{c2.results ? fmtCount(c2.results) : "—"}</td>
                                            <td>{cp2 ? `₹${fmtINR(cp2)}` : "—"}</td>
                                            <td className="dim">{fmtPct(ctrOf(c2), 2)}</td>
                                            <td className="dim">
                                              {c2.frequency ? `freq ${c2.frequency.toFixed(2)}` : ""}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            ) : null,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>

                  <h2 className="pd-h">By campaign · whole window</h2>
                  <div className="pd-scroll">
                    <table className="pd-table">
                      <thead>
                        <tr>
                          <th className="l">Campaign</th>
                          <th>Spend</th>
                          <th>Share</th>
                          <th>Revenue</th>
                          <th>Contrib</th>
                          <th>ROAS</th>
                          <th>Results</th>
                          <th>Cost/res</th>
                          <th>CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.campaigns.map((c, i) => {
                          const r = roasOf(c);
                          const cp = cpaOf(c);
                          const contrib = contributionOf(c, T);
                          return (
                            <tr key={`${c.id || c.name}-${i}`}>
                              <td className="l">{c.name}</td>
                              <td>₹{fmtINR(c.spend)}</td>
                              <td className="dim">{tot.spend > 0 ? `${Math.round((c.spend / tot.spend) * 100)}%` : "—"}</td>
                              <td>{fmtINRShort(c.revenue)}</td>
                              <td className={contrib === null ? "" : contrib >= 0 ? "ok" : "bad"}>
                                {contrib === null ? "—" : `${contrib >= 0 ? "+" : "−"}${fmtINRShort(Math.abs(contrib))}`}
                              </td>
                              <td className={cls(be === null || r === null ? null : r >= be)}>{fmtRoas(r)}</td>
                              <td>{c.results ? fmtCount(c.results) : "—"}</td>
                              <td className={cpaCls(cp, T)}>{cp ? `₹${fmtINR(cp)}` : "—"}</td>
                              <td className="dim">{fmtPct(ctrOf(c), 2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="pd-foot">
                    Daily rows come from <code>system/metrics/history/*-daily.csv</code>, written by the metrics pull.
                    Contribution applies the {margin === null ? "—" : `${(margin * 100).toFixed(0)}%`} gross margin implied
                    by the breakeven ROAS in <code>ops/targets.md</code>. Platform-restated days overwrite in place, so
                    the last ~3 days can still move.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
