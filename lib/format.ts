// ---------------------------------------------------------------------------
// Client-safe number/date formatters shared by the console panels and the voice
// router. No fs, no config imports — this file is bundled into the browser.
// Indian grouping throughout: 4,02,927 · ₹4.0L · ₹2.2Cr.
// ---------------------------------------------------------------------------

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Full Indian-grouped integer: 402927 → "4,02,927" */
export function fmtINR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return INR.format(Math.round(n));
}

/** Short rupee: ₹402 · ₹22K · ₹4.0L · ₹2.2Cr */
export function fmtINRShort(n: number | null | undefined, sym = "₹"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}${sym}${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${sign}${sym}${Math.round(a)}`;
}

/** Spoken rupee for TTS: "about 4 lakh", "about 22 lakh", "about 1.7 crore" */
export function spokenINR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "an unknown amount";
  const a = Math.abs(n);
  if (a >= 1e7) return `about ${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, "")} crore`;
  if (a >= 1e5) return `about ${Math.round(a / 1e5)} lakh`;
  if (a >= 1e3) return `about ${Math.round(a / 1e3)} thousand`;
  return `${Math.round(a)} rupees`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Fractional delta (0.12) → "▲12%" / "▼12%" / "—" */
export function fmtDelta(d: number | null | undefined): string {
  if (d === null || d === undefined || Number.isNaN(d)) return "—";
  const pct = Math.abs(d * 100);
  const arrow = d > 0.005 ? "▲" : d < -0.005 ? "▼" : "·";
  return `${arrow}${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** Is this delta good news? Cost metrics invert. */
export function deltaGood(d: number | null | undefined, invert = false): boolean | null {
  if (d === null || d === undefined || Math.abs(d) < 0.005) return null;
  return invert ? d < 0 : d > 0;
}

export function fmtRoas(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}×`;
}

/** Compact count: 1226629 → "12.3L" (Indian), 13856 → "13.9K" */
export function fmtCount(n: number | null | undefined): string {
  return fmtINRShort(n, "");
}

/** Relative age from an ISO timestamp: "2h", "3d"; stale past 13h. */
export function fmtAge(ts: string | null | undefined): { label: string; stale: boolean } {
  if (!ts) return { label: "—", stale: true };
  const ms = Date.now() - Date.parse(ts);
  if (Number.isNaN(ms)) return { label: "—", stale: true };
  const h = ms / 3.6e6;
  if (h < 1) return { label: `${Math.max(1, Math.round(ms / 6e4))}m`, stale: false };
  if (h < 48) return { label: `${Math.round(h)}h`, stale: h > 13 };
  return { label: `${Math.round(h / 24)}d`, stale: true };
}

export function fmtAgeSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Spoken age: "two hours ago", "about a day ago" */
export function spokenAge(s: number | null | undefined): string {
  if (s === null || s === undefined) return "at an unknown time";
  if (s < 120) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "about a day ago" : `${d} days ago`;
}
