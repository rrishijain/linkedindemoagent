"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreativeAd, CreativeAsset, CreativeBrief, CreativePattern, CreativeState } from "@/lib/creativeTypes";
import "./creative-intelligence.css";

type View = "decisions" | "creatives" | "patterns" | "briefs";
type Filter = "all" | "leading" | "fatigue" | "unassessed";
const words = (value?: string) => value ? value.replace(/_/g, " ") : "Not observed";
const number = (n: number | null | undefined, digits = 1) => n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
const money = (n: number | null, currency: string) => {
  if (n == null) return "—";
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n); }
  catch { return `${currency} ${number(n)}`; }
};
const date = (iso?: string) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
const metricValue = (ad: CreativeAd, value = ad.performance.value) => ad.metric.unit === "ratio" ? value == null ? "—" : `${number(value, 2)}×` : money(value, ad.currency);
const assetUrl = (asset: CreativeAsset) => `/api/creative-intelligence/media?id=${asset.id}`;
const performanceLabel = (ad: CreativeAd) => ({ leading: "Leading in ad set", trailing: "Below ad-set peers", in_line: "In line with peers", insufficient: "More evidence needed", unsupported: "Outcome unavailable" })[ad.performance.status];

function Preview({ ad, large = false }: { ad: CreativeAd; large?: boolean }) {
  const image = ad.media.find(m => m.kind === "image");
  const video = ad.media.find(m => m.kind === "video");
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return <div className={`ci-preview ${large ? "ci-preview-large" : ""}`}>
    {large && video ? <video key={video.id} controls preload="metadata" poster={image ? assetUrl(image) : undefined} src={assetUrl(video)} aria-label={`${ad.name} creative video`} />
      : image && failedImage !== image.id ? <img src={assetUrl(image)} alt={`${ad.name} creative preview`} loading="lazy" onError={() => setFailedImage(image.id)} />
      : video ? <video key={video.id} muted preload="metadata" src={assetUrl(video)} aria-label={`${ad.name} video preview`} />
      : <span className="ci-no-media"><span aria-hidden="true">▧</span>Media unavailable</span>}
    {!large && <span className="ci-format">{video ? "▶ " : ""}{words(ad.format)}</span>}
  </div>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="ci-stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function CreativeIntelligenceOverlay({ onClose, demo = false }: { onClose: () => void; demo?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CreativeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const [view, setView] = useState<View>("decisions");
  const [campaign, setCampaign] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dimension, setDimension] = useState<CreativePattern["dimension"]>("hook_type");
  const [experiment, setExperiment] = useState("");
  const [briefId, setBriefId] = useState<string | null>(null);

  useEffect(() => { dialog.current?.querySelector(".ci-view")?.scrollTo({ top: 0 }); }, [view]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/creative-intelligence", { cache: "no-store", signal });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Could not load Creative Intelligence.");
      if (mounted.current) { setData(next); setError(null); }
    } catch (e) {
      if (mounted.current && !(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Could not load creatives.");
    } finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>(".ci-close")?.focus();
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      mounted.current = false; controller.abort(); element?.close(); previousFocus?.focus();
    };
  }, [refresh]);

  const running = data?.job?.status === "running";
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => void refresh(controller.signal), running ? 2500 : 15000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [data, running, refresh]);

  const perform = async (action: string, payload: Record<string, unknown> = {}) => {
    if (demo) { setNotice("Demo mode: live analysis and workflow actions are disabled."); return null; }
    if (actionLock.current) return null;
    actionLock.current = true; setPending(action); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/creative-intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The request failed.");
      if (mounted.current) await refresh();
      return result;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The request failed."); return null; }
    finally { actionLock.current = false; if (mounted.current) setPending(null); }
  };

  const snapshot = data?.snapshot;
  const ads = snapshot?.ads ?? [];
  const campaigns = useMemo(() => [...new Map(ads.map(a => [a.campaign_id, { id: a.campaign_id, name: a.campaign_name }])).values()], [ads]);
  const scoped = ads.filter(a => campaign === "all" || a.campaign_id === campaign);
  const visible = scoped.filter(a => {
    if (search && !`${a.name} ${a.campaign_name} ${a.adset_name} ${a.analysis.hook_text || ""} ${a.analysis.offer_text || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "leading") return a.performance.status === "leading";
    if (filter === "fatigue") return ["possible", "watch"].includes(a.fatigue.status);
    if (filter === "unassessed") return a.analysis.status !== "ready" || a.analysis.observation_schema !== data?.config.observation_schema || a.analysis.model !== data?.config.model;
    return true;
  }).sort((a, b) => b.current.spend - a.current.spend);
  const selected = visible.find(a => a.id === selectedId) || visible[0] || null;
  useEffect(() => { setExperiment(selected?.analysis.next_tests?.[0] || ""); }, [selected?.id, selected?.analysis.analyzed_at]);
  const assessed = ads.filter(a => a.analysis.status === "ready").length;
  const remaining = ads.filter(a => (a.analysis.status !== "ready" || a.analysis.model !== data?.config.model || a.analysis.observation_schema !== data?.config.observation_schema) && a.media.length).length;
  const activeBrief = data?.briefs.find(b => b.id === briefId) || data?.briefs[0] || null;
  const busy = !!pending || !!running;
  const snapshotAge = snapshot ? (Date.now() - Date.parse(snapshot.generated_at)) / 36e5 : 0;
  const stale = !Number.isFinite(snapshotAge) || snapshotAge > 30;
  const inspect = (id: string) => { setSelectedId(id); setFilter("all"); setSearch(""); setView("creatives"); };

  const createBrief = async () => {
    if (!selected) return;
    const result = await perform("brief", { ad_id: selected.id, experiment });
    if (result?.brief) { setBriefId(result.brief.id); setView("briefs"); setNotice("Brief saved. Review it before sending it to Bulk Creatives."); }
  };

  const queueBrief = async (brief: CreativeBrief) => {
    const result = await perform("queue_brief", { brief_id: brief.id });
    if (result) setNotice(result.already_queued ? "This brief is already in the Bulk Creatives queue." : "Queued: Bulk Creatives will draft three variants from this brief.");
  };

  const downloadBrief = (brief: CreativeBrief) => {
    const url = URL.createObjectURL(new Blob([brief.markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `creative-brief-${brief.id.slice(0, 8)}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <dialog ref={dialog} className="ci-dialog" aria-labelledby="ci-title" onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <div className="ci-shell">
      <header className="ci-header">
        <div><div className="ci-eyebrow"><i /> ARGUS · META ADS</div><h1 id="ci-title">Creative intelligence</h1><p>Hooks, offers and visuals connected to measured ad performance.</p></div>
        <button className="ci-close" onClick={onClose} aria-label="Close Creative Intelligence">×</button>
      </header>

      <div className="ci-topline">
        <div className="ci-tabs" role="tablist" aria-label="Creative Intelligence views">
          {(["decisions", "creatives", "patterns", "briefs"] as View[]).map((v, index, views) => <button key={v} id={`ci-tab-${v}`} role="tab" tabIndex={view === v ? 0 : -1} aria-selected={view === v} aria-controls="ci-view" onClick={() => setView(v)} onKeyDown={e => {
            const next = e.key === "ArrowRight" ? (index + 1) % views.length : e.key === "ArrowLeft" ? (index + views.length - 1) % views.length : e.key === "Home" ? 0 : e.key === "End" ? views.length - 1 : null;
            if (next !== null) { e.preventDefault(); setView(views[next]); dialog.current?.querySelector<HTMLButtonElement>(`#ci-tab-${views[next]}`)?.focus(); }
          }}>{v === "decisions" ? "Next moves" : v === "creatives" ? "Creatives" : v === "patterns" ? "Patterns" : "Saved briefs"}{v === "briefs" && !!data?.briefs.length && <span>{data.briefs.length}</span>}</button>)}
        </div>
        <div className="ci-actions"><button className="ci-button" disabled={busy || !data?.config.meta_configured || demo} onClick={() => void perform("refresh")}>{pending === "refresh" ? "Starting…" : "↻ Sync Meta"}</button><button className="ci-button ci-primary" disabled={busy || !data?.config.gemini_configured || !remaining || demo} onClick={() => void perform("analyze")}>{pending === "analyze" ? "Starting…" : remaining ? `✧ Analyze next ${Math.min(remaining, data?.config.batch_size || 8)}` : "All current ✓"}</button></div>
      </div>

      {error && <div className="ci-message ci-error" role="alert">{error}<button onClick={() => void refresh()}>Retry view</button></div>}
      {notice && <div className="ci-message" role="status">{notice}</div>}
      {demo && <div className="ci-message">Demo mode · this view shows saved creative intelligence; live actions are disabled.</div>}
      {data?.job && <div className={`ci-job ${data.job.status === "failed" || data.job.status === "interrupted" ? "ci-job-error" : ""}`} role="status" aria-live="polite">
        <span className={running ? "ci-pulse" : "ci-job-dot"} /> <span>{data.job.phase}</span>
        {running && data.job.total > 0 && <><progress max={data.job.total} value={data.job.completed} aria-label="Creative analysis progress" /><small>{data.job.completed}/{data.job.total}</small></>}
        {!!data.job.errors.length && <details><summary>{data.job.errors.length} issue{data.job.errors.length === 1 ? "" : "s"}</summary><ul>{data.job.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
      </div>}

      <div id="ci-view" className="ci-view" role="tabpanel" aria-labelledby={`ci-tab-${view}`}>
        {loading && <div className="ci-empty"><span className="ci-loader" /><h2>Opening creative intelligence…</h2></div>}
        {!loading && !snapshot && <div className="ci-empty ci-welcome">
          <span className="ci-welcome-mark" aria-hidden="true">✧</span><h2>Your creative evidence starts here.</h2><p>Sync your Meta ads, inspect their images and videos with Gemini, then turn a finding into a brief.</p>
          <div className="ci-connection-list"><span><i className={data?.config.meta_configured ? "ok" : ""} /> Meta {data?.config.meta_configured ? "configured" : "needs connection"}</span><span><i className={data?.config.gemini_configured ? "ok" : ""} /> Gemini {data?.config.gemini_configured ? "key configured" : "needs API key"}</span></div>
          <button className="ci-button ci-primary" disabled={busy || !data?.config.meta_configured || demo} onClick={() => void perform("refresh")}>{running ? "Syncing creatives…" : "Sync Meta creatives"}</button>
          <small>Last 14 complete days · up to {data?.config.max_ads || 40} ads per account · analysis runs when you request it</small>
          {!data?.config.gemini_configured && <p className="ci-setup">Add <code>GEMINI_API_KEY</code> to ARGUS’s <code>.env</code> file and save. The next request picks it up.</p>}
        </div>}

        {snapshot && <>
          {stale && <div className="ci-freshness" role="status"><b>Performance snapshot needs a refresh.</b> These results end on {date(snapshot.windows.current.to)}. Sync Meta before acting on the recommendations.</div>}
          <div className="ci-summary">
            <div><strong>{ads.length}</strong> creatives <span>·</span> <strong>{assessed}</strong> assessed <span>·</span> <strong>{ads.filter(a => a.fatigue.status === "possible").length}</strong> possible fatigue</div>
            <span>{date(snapshot.windows.current.from)}–{date(snapshot.windows.current.to)} <span className="ci-muted">vs previous 7 days</span></span>
          </div>
          <details className="ci-coverage"><summary><span className={snapshot.coverage.reporting_accounts < snapshot.coverage.configured_accounts ? "ci-warning-text" : ""}>{snapshot.coverage.reporting_accounts}/{snapshot.coverage.configured_accounts} Meta accounts reporting</span><span>Synced {new Date(snapshot.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · coverage & method</span></summary>
            <div className="ci-coverage-body">{snapshot.coverage.accounts.map(a => <p key={a.id}><b>{a.name}</b> — {a.status === "error" ? a.error : `${a.ads_loaded}/${a.ads_total} ads · ${number(a.spend_total ? (a.spend_loaded || 0) / a.spend_total * 100 : 0)}% of current spend · ${a.currency} · ${a.timezone}`}</p>)}<ul>{snapshot.notes.map(n => <li key={n}>{n}</li>)}</ul><p>Review rules: {snapshot.rules.min_impressions.toLocaleString()} impressions and {snapshot.rules.min_results} objective events; 20% relative performance movement. Fatigue also checks at least three delivery days per period and a 15% frequency rise above {snapshot.rules.frequency_floor}. These are screening rules, not statistical significance.</p><p>Gemini: {data?.config.model} · {data?.config.gemini_source} · up to {data?.config.batch_size} assessments per batch. Cached observations are reused.</p></div>
          </details>

          {view !== "briefs" && <div className="ci-filters"><label>Campaign<select value={campaign} onChange={e => { setCampaign(e.target.value); setSelectedId(null); }}><option value="all">All campaigns</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{view === "creatives" && <><label className="ci-search-label">Find a creative<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, hook or offer…" /></label><label>Show<select value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">All creatives</option><option value="leading">Leading in ad set</option><option value="fatigue">Fatigue reviews</option><option value="unassessed">Needs assessment or upgrade</option></select></label></>}{view === "patterns" && <label>Compare by<select value={dimension} onChange={e => setDimension(e.target.value as CreativePattern["dimension"])}><option value="hook_type">Hooks</option><option value="offer_type">Offers</option><option value="format">Formats</option><option value="visual_style">Visual approaches</option></select></label>}</div>}

          {view === "decisions" && <NextMoves ads={scoped} onInspect={inspect} />}
          {view === "creatives" && <div className="ci-workspace">
            <section className="ci-gallery-section" aria-label="Creative gallery"><div className="ci-section-label">{visible.length} creatives · highest spend first</div><div className="ci-gallery">
              {visible.map(ad => <button key={ad.id} className={`ci-card ${selected?.id === ad.id ? "selected" : ""}`} aria-pressed={selected?.id === ad.id} onClick={() => setSelectedId(ad.id)}>
                <Preview ad={ad} /><div className="ci-card-copy"><div className="ci-card-tags"><span className={`ci-badge ci-${ad.performance.status}`}>{performanceLabel(ad)}</span>{ad.fatigue.status === "possible" && <span className="ci-badge ci-fatigue">Fatigue?</span>}</div><h3>{ad.name}</h3><p>{ad.campaign_name}</p><div className="ci-card-metric"><strong>{metricValue(ad)}</strong><span>{ad.metric.label}</span><small>{money(ad.current.spend, ad.currency)} spent</small></div><div className="ci-card-observation">{ad.analysis.status === "ready" ? `✧ ${words(ad.analysis.hook_type)} · ${words(ad.analysis.visual_style)}` : ad.analysis.status === "error" ? "Assessment needs attention" : "Awaiting Gemini assessment"}</div></div>
              </button>)}
            </div>{!visible.length && <div className="ci-empty ci-empty-small"><h2>No matching creatives</h2><p>Try another campaign, filter or search.</p><button className="ci-button" onClick={() => { setCampaign("all"); setFilter("all"); setSearch(""); }}>Clear filters</button></div>}</section>

            {selected && <aside className="ci-detail" aria-label={`Creative details: ${selected.name}`}>
              <div className="ci-detail-heading"><span className="ci-section-label">CREATIVE EVIDENCE</span><span className="ci-muted">{words(selected.status).toLowerCase()}</span></div><h2>{selected.name}</h2><p className="ci-context">{selected.adset_name} · {selected.account_name}</p>
              <Preview key={selected.id} ad={selected} large />
              {selected.media.filter(m => m.kind === "image").length > 1 && <details className="ci-extra-media"><summary>View {selected.media.length} available assets</summary><div>{selected.media.filter(m => m.kind === "image").map(m => <a key={m.id} href={assetUrl(m)} target="_blank" rel="noreferrer"><img src={assetUrl(m)} alt={`${selected.name} ${m.role}`} loading="lazy" /></a>)}</div></details>}
              {selected.media_note && <p className="ci-media-note">{selected.media_note}</p>}
              <div className="ci-stats"><Stat label={selected.metric.label} value={metricValue(selected)} /><Stat label="Spend · current 7 days" value={money(selected.current.spend, selected.currency)} /><Stat label="Link CTR" value={selected.current.ctr == null ? "—" : `${number(selected.current.ctr, 2)}%`} /><Stat label="7-day frequency" value={number(selected.current.frequency, 2)} /></div>
              <details className="ci-evidence"><summary><span className={`ci-badge ci-${selected.performance.status}`}>{performanceLabel(selected)}</span> Comparison evidence</summary><p>{selected.performance.reason}</p><p>{selected.metric.label}: <b>{metricValue(selected)}</b> · peer aggregate: <b>{metricValue(selected, selected.performance.peer_value)}</b> · {selected.performance.peer_count} eligible peer ads.</p><p>{number(selected.current.impressions, 0)} impressions · {number(selected.current[selected.metric.result_key as keyof typeof selected.current] as number, 1)} objective events. {words(selected.objective)} / {words(selected.optimization_goal)}.</p></details>
              <section className={`ci-fatigue-note ci-fatigue-${selected.fatigue.status}`}><h3>{selected.fatigue.status === "possible" ? "Possible creative fatigue" : selected.fatigue.status === "watch" ? "Performance decline to review" : selected.fatigue.status === "stable" ? "No combined fatigue signal" : "Fatigue: more history needed"}</h3><ul>{selected.fatigue.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>

              {selected.decision && <section className="ci-decision-context"><h3>{selected.decision.label}</h3><p>{selected.decision.why}</p>{!!selected.decision.gaps.length && <details><summary>What is missing</summary><ul>{selected.decision.gaps.map(g => <li key={g}>{g}</li>)}</ul></details>}{selected.decision.diagnostics.map(d => <p key={d.code}>{d.text}</p>)}</section>}
              <section className="ci-vision"><div className="ci-detail-heading"><h3>✧ Observed by Gemini</h3>{selected.analysis.status === "ready" && <span className="ci-muted">{selected.analysis.confidence} confidence</span>}</div>
                {selected.analysis.status === "ready" ? <><p className="ci-muted">{selected.analysis.evidence_scope}</p>{(selected.analysis.observation_schema !== data?.config.observation_schema || selected.analysis.model !== data?.config.model) && <div className="ci-upgrade"><p>This assessment needs the new evidence and test format.</p>{selected.analysis.upgrade_error && <p>{selected.analysis.upgrade_error}</p>}<button className="ci-button" disabled={busy || !selected.media.length || !data?.config.gemini_configured || demo} onClick={() => void perform("analyze", { ad_id: selected.id })}>Upgrade this assessment</button></div>}<dl><div><dt>Hook</dt><dd><b>{words(selected.analysis.hook_type)}</b><p>{selected.analysis.hook_text}</p></dd></div><div><dt>Offer</dt><dd><b>{words(selected.analysis.offer_type)}</b><p>{selected.analysis.offer_text}</p></dd></div><div><dt>Visual</dt><dd><b>{words(selected.analysis.visual_style)}</b><p>{selected.analysis.visual_description}</p></dd></div><div><dt>CTA</dt><dd>{selected.analysis.cta || "Not observed"}</dd></div></dl><div className="ci-vision-columns"><div><h4>Keep exploring</h4><ul>{selected.analysis.strengths?.map(t => <li key={t}>{t}</li>)}</ul></div><div><h4>Check carefully</h4><ul>{selected.analysis.risks?.map(t => <li key={t}>{t}</li>)}</ul></div></div>{!!selected.analysis.limitations?.length && <p className="ci-media-note">{selected.analysis.limitations.join(" ")}</p>}{!!selected.analysis.evidence?.length && <div className="ci-evidence-ledger"><h4>Evidence behind the assessment</h4>{selected.analysis.evidence.map(e => <div key={e.id}><b>{e.id}</b><p>{e.observation}<small>{e.source === "ad_copy" ? "Ad copy" : `Asset ${e.asset_index}${e.at_seconds === null ? "" : ` · ${e.at_seconds}s`}`}</small></p></div>)}</div>}<p className="ci-model-note">{selected.analysis.model} · {date(selected.analysis.analyzed_at)} · confidence concerns observation, not performance</p></>
                  : <div className="ci-analysis-empty"><p>{selected.analysis.error || "Gemini will inspect the creative’s hook, offer, CTA and visual approach. Performance labels come from the ad data."}</p><button className="ci-button" disabled={busy || !selected.media.length || !data?.config.gemini_configured || demo} onClick={() => void perform("analyze", { ad_id: selected.id })}>{selected.analysis.status === "error" ? "Retry assessment" : "Assess this creative"}</button></div>}
              </section>

              {selected.analysis.status === "ready" && <section className="ci-brief-builder"><h3>Turn a finding into a brief</h3><p>Choose one change to test. Keep the source offer and remaining variables consistent.</p><div className="ci-test-choices">{selected.analysis.next_tests?.map((test, i) => <button key={test} aria-pressed={experiment === test} className={experiment === test ? "selected" : ""} onClick={() => setExperiment(test)}><span>0{i + 1}</span>{test}</button>)}</div>{selected.analysis.tests?.filter(t => t.change === experiment).map(t => <div className="ci-test-plan" key={t.change}><b>Test {words(t.variable)}</b><p>{t.hypothesis}</p><p><b>Keep constant:</b> {t.keep_constant}</p><p><b>Measure:</b> {selected.metric.label} · diagnostic: {words(t.diagnostic)}</p><small>Based on {t.evidence_ids.join(", ")} · hypothesis, not a promised lift</small></div>)}<label htmlFor="ci-experiment">Proposed experiment</label><textarea id="ci-experiment" value={experiment} maxLength={2000} rows={4} onChange={e => setExperiment(e.target.value)} /><button className="ci-button ci-primary" disabled={!!pending || !experiment.trim() || demo} onClick={() => void createBrief()}>{pending === "brief" ? "Saving brief…" : "Create brief →"}</button></section>}
            </aside>}
          </div>}

          {view === "patterns" && <Patterns patterns={snapshot.patterns} campaign={campaign} dimension={dimension} campaigns={campaigns} onInspect={inspect} />}

          {view === "briefs" && <div className="ci-briefs-workspace">
            <div className="ci-brief-list">{data?.briefs.map(b => <button key={b.id} className={activeBrief?.id === b.id ? "selected" : ""} onClick={() => setBriefId(b.id)}><small>{date(b.created_at)} · {b.queued_id ? "Sent to Bulk Creatives" : "Ready to review"}</small><strong>{b.title}</strong></button>)}{!data?.briefs.length && <div className="ci-empty ci-empty-small"><h2>No briefs yet</h2><p>Open an assessed creative and choose a change to test.</p><button className="ci-button" onClick={() => setView("creatives")}>Browse creatives</button></div>}</div>
            {activeBrief && <section className="ci-brief-preview"><div className="ci-brief-toolbar"><div><span className="ci-section-label">SAVED CREATIVE BRIEF</span><h2>{activeBrief.title}</h2></div><button className="ci-button" onClick={() => downloadBrief(activeBrief)}>Download .md</button></div><pre>{activeBrief.markdown}</pre><div className="ci-dispatch"><p><b>Continue with Bulk Creatives</b><span>Draft three static-ad variants with copy and visual directions for review.</span></p><button className="ci-button ci-primary" disabled={!!pending || !!activeBrief.queued_id || demo} onClick={() => void queueBrief(activeBrief)}>{activeBrief.queued_id ? "Sent to Bulk Creatives ✓" : pending === "queue_brief" ? "Sending…" : "Draft 3 variants →"}</button></div></section>}
          </div>}
        </>}
      </div>
      <footer className="ci-footer"><span>Vision describes the creative. Ad results measure its performance.</span><button onClick={onClose}>← Back to console</button></footer>
    </div>
  </dialog>;
}

function Patterns({ patterns, campaign, dimension, campaigns, onInspect }: { patterns: CreativePattern[]; campaign: string; dimension: CreativePattern["dimension"]; campaigns: { id: string; name: string }[]; onInspect: (id: string) => void }) {
  const rows = patterns.filter(p => p.dimension === dimension && (campaign === "all" || p.campaign_id === campaign));
  const groups = [...new Set(rows.map(p => `${p.account_id}:${p.campaign_id}:${p.metric_key}:${p.currency}:${p.attribution || ""}:${p.optimization_goal || ""}:${p.timezone || ""}`))];
  return <section className="ci-patterns"><p className="ci-pattern-note">Patterns are grouped by campaign, objective and currency. Results show an association, not proof that the hook or visual caused it. Fixed-media attributes can be compared at ad level; individual copy variants and assets inside flexible bundles cannot.</p>
    {!rows.length && <div className="ci-empty ci-empty-small"><h2>No comparable patterns yet</h2><p>Analyze more fixed creatives or try Formats. Flexible assets and unclear observations are excluded from this view.</p></div>}
    {groups.map(group => { const members = rows.filter(p => `${p.account_id}:${p.campaign_id}:${p.metric_key}:${p.currency}:${p.attribution || ""}:${p.optimization_goal || ""}:${p.timezone || ""}` === group).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.higher_is_better ? (b.value ?? -Infinity) - (a.value ?? -Infinity) : (a.value ?? Infinity) - (b.value ?? Infinity))); return <div className="ci-pattern-group" key={group}><h2>{campaigns.find(c => c.id === members[0].campaign_id)?.name}</h2><p className="ci-muted">{members[0].optimization_goal ? words(members[0].optimization_goal) : "Outcome settings unavailable"} · {members[0].currency} · {members[0].timezone || "Timezone unavailable"}</p><details className="ci-pattern-settings"><summary>Attribution settings</summary><p>{members[0].attribution || "Not recorded"}</p></details><div className="ci-table-scroll"><table><thead><tr><th>{words(dimension).replace(" type", "").replace(" style", "")}</th><th>Creatives</th><th>Spend</th><th>{members[0].metric_label}</th><th>Evidence</th></tr></thead><tbody>{members.map(row => <tr key={row.label}><td><button onClick={() => onInspect(row.examples[0])}>{words(row.label)} ↗</button></td><td>{row.ads}</td><td>{money(row.spend, row.currency)}</td><td><strong>{row.value === null ? "—" : row.higher_is_better ? `${number(row.value, 2)}×` : money(row.value, row.currency)}</strong></td><td><span className={`ci-badge ${row.eligible ? "ci-in_line" : "ci-insufficient"}`}>{row.eligible ? "Descriptive sample" : "Small sample"}</span><small>{number(row.impressions, 0)} impressions · {number(row.results)} events</small></td></tr>)}</tbody></table></div></div>; })}
    {!!rows.length && <p className="ci-pattern-note">Values use total outcomes and spend, rather than averaging ad-level ratios. A descriptive sample needs at least two distinct creatives, 1,000 impressions and 10 objective events. Audience and placement differences remain.</p>}
  </section>;
}

function NextMoves({ ads, onInspect }: { ads: CreativeAd[]; onInspect: (id: string) => void }) {
  const active = ads.filter(a => a.status === "ACTIVE");
  const supported = active.filter(a => ["leading", "trailing", "in_line"].includes(a.performance.status));
  const posters = ads.filter(a => a.decision?.media_scope === "poster");
  const grounded = ads.filter(a => !!a.analysis.evidence?.length);
  const decisions = active.filter(a => a.decision).sort((a, b) => a.decision!.priority - b.decision!.priority || a.account_id.localeCompare(b.account_id) || a.currency.localeCompare(b.currency) || b.current.spend - a.current.spend);
  return <section className="ci-next-moves">
    <div className="ci-readiness"><div><strong>{supported.length}<small> / {active.length}</small></strong><span>active ads can be compared</span></div><div><strong>{posters.length}</strong><span>have poster evidence only</span></div><div><strong>{grounded.length}<small> / {ads.length}</small></strong><span>have referenced observations</span></div></div>
    <div className="ci-next-intro"><h2>Decide what to test next</h2><p>Priority comes from campaign results and evidence gaps. Gemini supplies observations and hypotheses; it does not pick winners.</p></div>
    {posters.length > 0 && <div className="ci-media-gap"><b>The video evidence is incomplete.</b><p>{posters.length} creatives only have a poster. Their original media is needed to assess opening seconds, spoken message, pacing and delivery. Reassessing the same poster will not recover those details.</p></div>}
    <div className="ci-move-list">{decisions.slice(0, 12).map(ad => <button key={ad.id} onClick={() => onInspect(ad.id)} className={`ci-move ci-move-${ad.decision!.action}`}><div><span className="ci-move-label">{ad.decision!.label}</span><h3>{ad.name}</h3><p>{ad.decision!.why}</p><small>{ad.campaign_name} · {ad.analysis.tests?.[0] ? `Proposed test: ${ad.analysis.tests[0].change}` : ad.decision!.gaps[0] || "Open the creative evidence to draft a test."}</small></div><div className="ci-move-value"><strong>{metricValue(ad)}</strong><span>{ad.metric.label}</span><small>{money(ad.current.spend, ad.currency)} spent</small><span aria-hidden="true">↗</span></div></button>)}</div>
    {!decisions.length && <p className="ci-media-gap">No active ad decisions in this snapshot. Sync Meta or inspect the saved creatives as historical references.</p>}
    <p className="ci-pattern-note">Showing up to 12 active ads, ordered by review priority, then spend within each account and currency. Minimum samples are screening floors, not proof of statistical significance. No automatic ad or budget changes.</p>
  </section>;
}
