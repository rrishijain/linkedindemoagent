import type { Engagement } from "./engagement";
import { fmtCount, fmtINRShort, fmtPct, fmtRoas } from "./format";
import type { Marketing, PullStatus, VaultState, Verdict } from "./vault";

// ---------------------------------------------------------------------------
// Strands — the centerpiece's data feed. Each ring in the reactor IS a channel
// of the wall, so the wave is a live picture of the business rather than
// decoration.
//
// RULE (mirrors CLAUDE.md): nothing here judges a marketing number against a
// target. Health comes verbatim from the verdicts marketing_context.py already
// wrote; trend comes from the deltas it already computed. This module only
// maps those into visual state, and formats the numbers the ring already owns.
// ---------------------------------------------------------------------------

export type StrandHealth = "good" | "warn" | "bad" | "none";

export interface Strand {
  id: string;
  /** short legend label — lowercase, the wall's register */
  label: string;
  /** identity colour, one of the DAYBREAK crayons (#rrggbb) */
  color: string;
  /** verdict from Python; "none" = this channel has no verdict to give */
  health: StrandHealth;
  /** the source isn't reporting — the ring greys out and goes dashed */
  stale: boolean;
  /** period-over-period movement, −1…1 → ring thickness */
  trend: number;
  /** live doing-ness, 0…1 → light travelling the ring */
  activity: number;
  /** the channel's own headline number, already formatted ("2.41×", "₹4.2L") */
  value: string;
  /** raw period-over-period delta for the chip's arrow — null when unknown */
  delta: number | null;
}

/** the number the middle of the reactor holds — the wall's one big figure */
export interface CoreReadout {
  big: string;
  bigLabel: string;
  bigHealth: StrandHealth;
  sub: { label: string; value: string; health: StrandHealth }[];
}

const LABELS: Record<string, string> = {
  meta: "meta",
  google: "google",
  seo: "search",
  aeo: "aeo",
  social: "instagram",
  money: "contribution",
  pace: "pace",
  ships: "shipped",
};

const COLORS = {
  meta: "#ff6b5e", // coral
  google: "#ffaf1f", // sun
  seo: "#12b886", // mint
  aeo: "#2e9bef", // sky
  social: "#f45b9f", // pink
  money: "#7c5cff", // violet
  pace: "#ff8f3e", // tangerine
  ships: "#a78bfa", // lavender
} as const;

/** ±25% period-over-period reads as a full-thickness swing */
const TREND_FULL = 0.25;

const DASH = "—";

function clamp(n: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, n));
}

function trendOf(delta: number | null | undefined): number {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return 0;
  return clamp(delta / TREND_FULL);
}

function healthOf(v: Verdict | string | null | undefined): StrandHealth {
  return v === "green" ? "good" : v === "amber" ? "warn" : v === "red" ? "bad" : "none";
}

/** anything that isn't currently reporting fresh — includes "not wired yet" */
function isStale(status: PullStatus | undefined | null): boolean {
  return status !== "ok" && status !== "partial";
}

function num(n: number | null | undefined): boolean {
  return n !== null && n !== undefined && !Number.isNaN(n);
}

/** the neutral bundle: what the wall weaves before the first pull lands */
export function idleStrands(): Strand[] {
  return (Object.keys(COLORS) as (keyof typeof COLORS)[]).map((id) => ({
    id,
    label: LABELS[id] ?? id,
    color: COLORS[id],
    health: "none" as StrandHealth,
    stale: false,
    trend: 0,
    activity: 0,
    value: DASH,
    delta: null,
  }));
}

function marketingStrands(m: Marketing): Strand[] {
  const meta = m.channels?.meta;
  const google = m.channels?.google;
  const seo = m.channels?.seo;
  const b = m.blended;
  const p = m.pacing;

  // a paid channel shows the number its own verdict is about: ROAS when the
  // account reports revenue, cost-per-result when it doesn't
  const paid = (c: typeof meta) => {
    const t = c?.totals;
    if (num(t?.roas)) return fmtRoas(t?.roas);
    if (num(t?.cpa)) return fmtINRShort(t?.cpa);
    if (num(t?.spend)) return fmtINRShort(t?.spend);
    return DASH;
  };

  return [
    {
      id: "meta",
      label: "meta",
      color: COLORS.meta,
      health: healthOf(meta?.verdicts?.roas ?? meta?.verdicts?.cpa),
      stale: isStale(meta?.status),
      trend: trendOf(meta?.deltas?.roas ?? meta?.deltas?.results),
      activity: 0,
      value: paid(meta),
      delta: meta?.deltas?.roas ?? meta?.deltas?.results ?? null,
    },
    {
      id: "google",
      label: "google",
      color: COLORS.google,
      health: healthOf(google?.verdicts?.roas ?? google?.verdicts?.cpa),
      stale: isStale(google?.status),
      trend: trendOf(google?.deltas?.roas ?? google?.deltas?.results),
      activity: 0,
      value: paid(google),
      delta: google?.deltas?.roas ?? google?.deltas?.results ?? null,
    },
    {
      // GSC ships no verdict — the ring carries its movement, not a judgement
      id: "seo",
      label: "search",
      color: COLORS.seo,
      health: "none",
      stale: isStale(seo?.status),
      trend: trendOf(seo?.deltas?.clicks),
      activity: 0,
      value: num(seo?.totals?.clicks) ? fmtCount(seo?.totals?.clicks) : DASH,
      delta: seo?.deltas?.clicks ?? null,
    },
    {
      id: "aeo",
      label: "aeo",
      color: COLORS.aeo,
      health: healthOf(m.aeo?.verdict),
      stale: isStale(m.aeo?.status),
      trend: 0,
      activity: 0,
      value: num(m.aeo?.score) ? String(Math.round(m.aeo!.score as number)) : DASH,
      delta: null,
    },
    {
      id: "social",
      label: "instagram",
      color: COLORS.social,
      health: healthOf(m.instagram?.verdicts?.er),
      stale: isStale(m.instagram?.status),
      trend: 0,
      activity: 0,
      value: num(m.instagram?.er_pct)
        ? fmtPct(m.instagram?.er_pct)
        : num(m.instagram?.followers)
          ? fmtCount(m.instagram?.followers)
          : DASH,
      delta: null,
    },
    {
      id: "money",
      label: "contribution",
      color: COLORS.money,
      health: healthOf(b?.economics?.verdict),
      stale: !b || !b.economics,
      trend: trendOf(b?.deltas?.revenue),
      activity: 0,
      value: num(b?.economics?.contribution) ? fmtINRShort(b?.economics?.contribution) : DASH,
      delta: b?.deltas?.revenue ?? null,
    },
    {
      id: "pace",
      label: "pace",
      color: COLORS.pace,
      // status is Python's call against the month budget — "on" is the only green
      health: !p ? "none" : p.status === "on" ? "good" : "warn",
      stale: !p,
      trend: p && num(p.pace_pct) ? clamp(((p.pace_pct as number) - 100) / 40) : 0,
      activity: 0,
      value: p && num(p.pace_pct) ? `${Math.round(p.pace_pct as number)}%` : DASH,
      delta: null,
    },
  ];
}

/** publishes shipped today against the caps the runner actually enforces */
function shipStrand(e: Engagement | null, working: boolean): Strand {
  const pub = e?.quests?.publishes;
  const done = (pub?.blog.done ?? 0) + (pub?.carousel.done ?? 0);
  const goal = (pub?.blog.goal ?? 0) + (pub?.carousel.goal ?? 0);
  const fill = goal > 0 ? done / goal : 0;
  const runs = e?.today?.runs_ok ?? 0;
  return {
    id: "ships",
    label: "shipped",
    color: COLORS.ships,
    health: "none",
    stale: !e,
    trend: goal > 0 ? clamp(fill * 2 - 1) : 0,
    // the ring lights up as the day's work lands; a live run keeps it running
    activity: Math.min(1, (working ? 0.5 : 0) + Math.min(runs, 6) / 8 + fill * 0.3),
    value: e ? (goal > 0 ? `${done}/${goal}` : String(done)) : DASH,
    delta: null,
  };
}

/**
 * One strand per channel of the wall. `working` (the runner is mid-run) lifts
 * every live ring so the reactor visibly quickens while ARGUS is thinking.
 */
export function deriveStrands(state: VaultState | null, working = false): Strand[] {
  if (!state) return idleStrands();
  const base = state.marketing ? marketingStrands(state.marketing) : idleStrands().slice(0, 7);
  const strands = [...base, shipStrand(state.engagement ?? null, working)];
  if (!working) return strands;
  return strands.map((s) => (s.stale ? s : { ...s, activity: Math.max(s.activity, 0.55) }));
}

/**
 * The figure at the middle of the reactor. Money first — contribution is the
 * number the month is actually judged on — with the blended ROAS, the spend
 * behind it and the month's pace beside it. Every verdict here is Python's.
 */
export function deriveReadout(state: VaultState | null): CoreReadout {
  const idle: CoreReadout = {
    big: DASH,
    bigLabel: "contribution",
    bigHealth: "none",
    sub: [
      { label: "roas", value: DASH, health: "none" },
      { label: "spend mtd", value: DASH, health: "none" },
      { label: "pace", value: DASH, health: "none" },
    ],
  };
  const m = state?.marketing;
  if (!m) return idle;

  const p = m.pacing;
  const b = m.blended;
  const econ = b?.economics ?? null;

  const contribution = num(p?.contribution_mtd) ? p.contribution_mtd : econ?.contribution;
  const big = num(contribution)
    ? fmtINRShort(contribution)
    : num(b?.totals?.revenue)
      ? fmtINRShort(b?.totals?.revenue)
      : DASH;
  const bigLabel = num(contribution)
    ? p && num(p.contribution_mtd)
      ? "contribution mtd"
      : `contribution · ${m.range_days}d`
    : "revenue";

  return {
    big,
    bigLabel,
    bigHealth: healthOf(econ?.verdict),
    sub: [
      {
        label: "roas",
        value: num(b?.totals?.roas) ? fmtRoas(b?.totals?.roas) : DASH,
        health: healthOf(b?.verdicts?.roas),
      },
      {
        label: "spend mtd",
        value: p && num(p.spend_mtd) ? fmtINRShort(p.spend_mtd) : DASH,
        health: "none",
      },
      {
        label: p && num(p.days_left) ? `pace · ${p.days_left}d left` : "pace",
        value: p && num(p.pace_pct) ? `${Math.round(p.pace_pct as number)}%` : DASH,
        health: !p ? "none" : p.status === "on" ? "good" : "warn",
      },
    ],
  };
}
