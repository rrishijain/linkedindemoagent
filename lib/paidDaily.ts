import fs from "fs";
import path from "path";
import { VAULT_ROOT } from "./config";

// ---------------------------------------------------------------------------
// Day-wise paid history — the detail behind the Paid Media panel.
//
// Reads the per-campaign daily CSVs the metrics pull already writes (90-day
// upsert): system/metrics/history/meta-daily.csv and google-daily.csv. Nothing
// here is on the wall's 5s poll — the console fetches it only when the Paid
// Media detail overlay is opened.
//
// RULE (same as lib/strands.ts): no verdicts are invented here. This module
// sums and divides what the platforms reported. Whether a number is good is
// decided against the targets marketing_context.py already resolved, and the
// console does that comparison at render time.
// ---------------------------------------------------------------------------

export type PaidChannelKey = "meta" | "google";

/** one campaign's numbers on one day */
export interface DailyCampaign {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  revenue: number;
  /** Meta only — Google reports no reach/frequency */
  reach?: number;
  frequency?: number;
}

/** one channel's numbers on one day, with the campaigns that made them */
export interface DailyPoint {
  date: string;
  channel: PaidChannelKey;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  revenue: number;
  reach?: number;
  /** impression-weighted, so a big campaign moves it more than a tiny one */
  frequency?: number;
  campaigns: DailyCampaign[];
}

export interface PaidDaily {
  /** newest first — the table reads top-down as "today backwards" */
  days: DailyPoint[];
  /** oldest and newest dates actually present, per channel */
  coverage: Record<PaidChannelKey, { from: string; to: string; rows: number } | null>;
  currency: string;
  generated_at: string;
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

const num = (v: string | undefined): number => {
  const n = Number.parseFloat((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Split one CSV line on commas that are not inside double quotes — campaign
 * names routinely contain commas ("30 Days, AI"), and a naive split silently
 * shifts every column after the name.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface ParsedCsv {
  header: string[];
  rows: string[][];
}

function parseCsv(raw: string): ParsedCsv | null {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(splitCsvLine);
  return { header, rows };
}

/** column index by name, so a reordered CSV doesn't silently mis-read */
function indexer(header: string[]) {
  const map = new Map(header.map((h, i) => [h, i]));
  return (name: string): number => map.get(name) ?? -1;
}

function readChannel(file: string, channel: PaidChannelKey): DailyPoint[] {
  const raw = safeRead(path.join(VAULT_ROOT, "system", "metrics", "history", file));
  if (!raw) return [];
  const parsed = parseCsv(raw);
  if (!parsed) return [];
  const at = indexer(parsed.header);

  const iDate = at("date");
  const iCampaign = at("campaign");
  const iCampaignId = at("campaign_id");
  const iSpend = at("spend");
  const iImpr = at("impressions");
  const iClicks = at("clicks");
  const iRevenue = channel === "meta" ? at("revenue") : at("conversions_value");
  const iResults = channel === "meta" ? at("purchases") : at("conversions");
  const iReach = at("reach");
  const iFreq = at("frequency");
  if (iDate < 0 || iSpend < 0) return [];

  const byDate = new Map<string, DailyPoint>();
  for (const cols of parsed.rows) {
    const date = (cols[iDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const c: DailyCampaign = {
      id: iCampaignId >= 0 ? (cols[iCampaignId] ?? "").trim() : "",
      name: iCampaign >= 0 ? (cols[iCampaign] ?? "").trim() || "—" : "—",
      spend: num(cols[iSpend]),
      impressions: iImpr >= 0 ? num(cols[iImpr]) : 0,
      clicks: iClicks >= 0 ? num(cols[iClicks]) : 0,
      results: iResults >= 0 ? num(cols[iResults]) : 0,
      revenue: iRevenue >= 0 ? num(cols[iRevenue]) : 0,
    };
    if (iReach >= 0) c.reach = num(cols[iReach]);
    if (iFreq >= 0) c.frequency = num(cols[iFreq]);

    let day = byDate.get(date);
    if (!day) {
      day = {
        date,
        channel,
        spend: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        revenue: 0,
        campaigns: [],
      };
      if (iReach >= 0) day.reach = 0;
      byDate.set(date, day);
    }
    day.spend += c.spend;
    day.impressions += c.impressions;
    day.clicks += c.clicks;
    day.results += c.results;
    day.revenue += c.revenue;
    if (day.reach !== undefined) day.reach += c.reach ?? 0;
    day.campaigns.push(c);
  }

  for (const day of byDate.values()) {
    // frequency is a ratio, so it is impression-weighted rather than summed —
    // adding two campaigns' frequencies would be meaningless
    if (iFreq >= 0) {
      const weighted = day.campaigns.reduce((a, c) => a + (c.frequency ?? 0) * c.impressions, 0);
      day.frequency = day.impressions > 0 ? weighted / day.impressions : 0;
    }
    day.campaigns.sort((a, b) => b.spend - a.spend);
  }
  return [...byDate.values()];
}

/**
 * Every day the pull has history for, newest first, both channels interleaved.
 * `days` caps how far back to read (the CSVs hold ~90).
 */
export function readPaidDaily(days = 90): PaidDaily {
  const meta = readChannel("meta-daily.csv", "meta");
  const google = readChannel("google-daily.csv", "google");

  const cover = (rows: DailyPoint[]) => {
    if (!rows.length) return null;
    const dates = rows.map((r) => r.date).sort();
    return { from: dates[0], to: dates[dates.length - 1], rows: rows.length };
  };
  const coverage = { meta: cover(meta), google: cover(google) };

  // clip to the window BEFORE merging so a channel with deeper history doesn't
  // drag stale dates into the table
  const all = [...meta, ...google].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const cutoff = new Set(
    [...new Set(all.map((d) => d.date))].sort().reverse().slice(0, Math.max(1, days))
  );

  return {
    days: all.filter((d) => cutoff.has(d.date)),
    coverage,
    currency: "₹",
    generated_at: new Date().toISOString(),
  };
}
