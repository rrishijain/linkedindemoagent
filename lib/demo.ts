import type { Marketing, ShippedEntry, VaultState } from "./vault";

// ---------------------------------------------------------------------------
// ?demo=marketing — a fully populated marketing slice so every panel can be
// checked (and filmed) without a single real API call. Numbers are shaped
// like the real Digital Scholar account but are fiction.
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const marketing: Marketing = {
  generated_at: now(),
  range_days: 7,
  currency: "INR",
  targets: {
    currency: "₹", breakeven_roas: 1.35, target_roas: 2.0, target_cpa: 1600, max_cpa: 2400,
    target_cpl: 350, monthly_ad_budget: 2_200_000, max_frequency: 2.5, min_ctr: 1.0,
    aeo_min_score: 70, ig_posts_per_week: 5, ig_min_er_pct: 1.0,
  },
  blended: {
    channels: ["meta", "google"], currency: "INR", mixed_currency: false,
    totals: { spend: 512_400, revenue: 891_000, results: 318, roas: 1.74, cpa: 1611, ctr: 1.21 },
    prev_totals: { spend: 468_000, revenue: 702_000, results: 262, roas: 1.5, cpa: 1786, ctr: 1.1 },
    deltas: { spend: 0.095, revenue: 0.27, results: 0.21, roas: 0.16, cpa: -0.098 },
    verdicts: { roas: "amber", cpa: "amber" },
    mix: { meta: 0.82, google: 0.18 },
  },
  channels: {
    meta: {
      status: "partial", ts: now(), error: "act_1: 403", accounts_ok: 4, accounts_total: 5, currency: "INR",
      window: { days: 7, from: "2026-08-14", to: "2026-08-20", prev_from: "2026-08-07", prev_to: "2026-08-13" },
      totals: { spend: 420_100, revenue: 762_000, results: 262, purchases: 262, leads: 0, roas: 1.81, cpa: 1603, cpl: null, ctr: 1.18, cpm: 312, frequency: 2.31, impressions: 1_346_000, clicks: 15_900 },
      prev_totals: { spend: 390_000, revenue: 590_000, results: 221, roas: 1.51, cpa: 1765, ctr: 1.07, cpm: 298, frequency: 2.1 },
      deltas: { spend: 0.077, revenue: 0.29, results: 0.185, roas: 0.2, cpa: -0.092, ctr: 0.1, cpm: 0.047 },
      verdicts: { roas: "amber", cpa: "amber", cpl: "na", ctr: "green", frequency: "green" },
      spark: {
        spend: [52_000, 58_000, 61_000, 55_000, 63_000, 66_000, 65_100],
        purchases: [31, 36, 40, 34, 41, 42, 38],
        revenue: [88_000, 101_000, 117_000, 96_000, 121_000, 125_000, 114_000],
        clicks: [2000, 2200, 2400, 2100, 2500, 2400, 2300],
      },
      campaigns: [
        { campaign: "30_Days_Ai_Courses_Testing", campaign_id: "c1", account_id: "a", spend: 185_000, revenue: 146_000, results: 73, roas: 0.79, cpa: 2534, ctr: 0.92, cpm: 340, frequency: 2.7, spend_share: 0.44, verdict: "KILL", reasons: ["ctr", "fatigue", "cpa"] },
        { campaign: "CCF_Course_New", campaign_id: "c2", account_id: "a", spend: 215_000, revenue: 271_000, results: 107, roas: 1.26, cpa: 2009, ctr: 1.31, cpm: 290, frequency: 2.1, spend_share: 0.51, verdict: "FIX", reasons: [] },
        { campaign: "CCF_Retargeting_Warm", campaign_id: "c3", account_id: "a", spend: 20_100, revenue: 345_000, results: 82, roas: 17.2, cpa: 245, ctr: 2.4, cpm: 210, frequency: 1.4, spend_share: 0.05, verdict: "SCALE", reasons: [] },
      ],
      flags: [],
    },
    google: {
      status: "ok", ts: now(), error: "", currency: "INR",
      window: { days: 7, from: "2026-08-14", to: "2026-08-20", prev_from: "2026-08-07", prev_to: "2026-08-13" },
      totals: { spend: 92_300, revenue: 129_000, results: 56, roas: 1.4, cpa: 1648, ctr: 3.8, cpc: 41, impression_share: 0.62, impressions: 59_000, clicks: 2250 },
      prev_totals: { spend: 78_000, revenue: 112_000, results: 41, roas: 1.44, cpa: 1902, ctr: 3.5 },
      deltas: { spend: 0.18, results: 0.37, cpa: -0.13, ctr: 0.086 },
      verdicts: { cpa: "amber", ctr: "green" },
      spark: { spend: [11_000, 12_500, 13_000, 12_800, 14_500, 14_000, 14_500], conversions: [6, 7, 9, 8, 9, 9, 8], clicks: [290, 310, 330, 320, 340, 335, 325] },
      campaigns: [
        { campaign: "Search_Brand_DS", campaign_id: "g1", spend: 24_000, revenue: 88_000, results: 31, roas: 3.67, cpa: 774, ctr: 8.1, verdict: "SCALE", reasons: [] },
        { campaign: "Search_Generic_PerfMarketing", campaign_id: "g2", spend: 68_300, revenue: 41_000, results: 25, roas: 0.6, cpa: 2732, ctr: 2.4, verdict: "KILL", reasons: ["cpa"] },
      ],
      flags: [],
    },
    seo: {
      status: "ok", ts: now(), error: "", property: "sc-domain:digitalscholar.in",
      window: { days: 7, from: "2026-08-11", to: "2026-08-17", prev_from: "2026-08-04", prev_to: "2026-08-10", note: "GSC lags ~3 days" },
      totals: { clicks: 4820, impressions: 212_000, ctr: 2.27, position: 14.2 },
      prev_totals: { clicks: 4410, impressions: 198_000, ctr: 2.23, position: 14.9 },
      deltas: { clicks: 0.093, impressions: 0.07, ctr: 0.018, position: -0.047 },
      spark: { clicks: [640, 690, 720, 650, 710, 730, 680], impressions: [29_000, 30_000, 31_000, 29_500, 31_500, 31_000, 30_000] },
      top_queries: [
        { query: "performance marketing course", clicks: 412, impressions: 9800, ctr: 4.2, position: 6.1 },
        { query: "digital marketing course chennai", clicks: 388, impressions: 12_100, ctr: 3.2, position: 8.4 },
      ],
      striking_distance: [
        { query: "digital marketing course chennai", clicks: 388, impressions: 12_100, position: 8.4 },
        { query: "meta ads course", clicks: 92, impressions: 6200, position: 11.3 },
        { query: "how to learn performance marketing", clicks: 61, impressions: 4100, position: 12.8 },
      ],
    },
  },
  aeo: { status: "ok", ts: now(), domain: "digitalscholar.in", score: 65, min_score: 70, verdict: "amber", ai_bots_allowed: 10, ai_bots_total: 10, llms_txt: true, faq_schema: false, org_schema: false, sitemap: true },
  instagram: { status: "stale", ts: now(), handle: "digitalscholar", followers: 260_000, er_pct: 0.061, cadence_per_week: 14, format_mix: { reel: 11, carousel: 1 }, verdicts: { er: "red", cadence: "green" } },
  pacing: {
    month: "2026-08", month_label: "AUG", day: 21, days_in_month: 31, elapsed_days: 20,
    spend_mtd: 1_875_000, revenue_mtd: 2_690_000, estimated: false, budget: 2_200_000,
    expected_mtd: 1_419_000, pace_pct: 132, projected_eom: 2_906_000, status: "over",
    blended_roas_mtd: 1.43, breakeven_roas: 1.35,
  },
  flags: [
    { level: "red", channel: "meta", code: "campaign_kill", text: "30_Days_Ai_Courses_Testing ROAS 0.79 — kill candidate" },
    { level: "amber", channel: "paid", code: "pacing_over", text: "Projected ₹29.1L vs ₹22.0L budget" },
    { level: "amber", channel: "meta", code: "partial_accounts", text: "Meta partial — 4/5 accounts answered" },
    { level: "amber", channel: "seo", code: "aeo_below_min", text: "AEO readiness 65 below 70" },
  ],
  pull: {
    overall: "partial",
    newest_age_s: 7200,
    sources: [
      { source: "meta_ads", status: "partial", ts: now(), age_s: 7200, error: "act_1: 403", core: true },
      { source: "google_ads", status: "ok", ts: now(), age_s: 7300, error: "", core: true },
      { source: "gsc", status: "ok", ts: now(), age_s: 7400, error: "", core: true },
      { source: "aeo", status: "ok", ts: now(), age_s: 7400, error: "", core: true },
      { source: "instagram", status: "stale", ts: now(), age_s: 90_000, error: "playwright_missing", core: false },
      { source: "claude_code", status: "ok", ts: now(), age_s: 7200, error: "", core: false },
    ],
  },
  latest_reports: { dashboard: "ops/ads-dashboard.md" },
};

const shipped: ShippedEntry[] = [
  { id: "d1", skill: "ds-blog-publish", label: null, link: "https://digitalscholar.in/blog/break-even-roas-d2c", deliverable_path: "inbox/reports/publish/demo-blog.md", ts: new Date(Date.now() - 3 * 3600e3).toISOString() },
  { id: "d2", skill: "report-deck", label: null, link: "http://localhost:3107/api/file?path=inbox/reports/decks/demo.html", deliverable_path: "inbox/reports/decks/demo.md", ts: new Date(Date.now() - 26 * 3600e3).toISOString() },
  { id: "d3", skill: "news-carousel", label: null, link: "https://www.instagram.com/p/DEMO123/", deliverable_path: "inbox/reports/publish/demo-news-carousel.md", ts: new Date(Date.now() - 2 * 86400e3).toISOString() },
  { id: "d4", skill: "perf-report", label: null, link: null, deliverable_path: "inbox/reports/perf/demo.md", ts: new Date(Date.now() - 3 * 86400e3).toISOString() },
];

export const DEMO_MARKETING: Partial<VaultState> = { marketing, shipped };
