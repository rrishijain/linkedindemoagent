// ---------------------------------------------------------------------------
// Celebration detector — a PURE diff between two engagement snapshots, so it
// can be swept by tests like the router. The console primes the first snapshot
// silently (runsPrimedRef pattern) and re-primes on date rollover; this
// module only ever sees consecutive same-day snapshots.
//
// Tier discipline (engineered rarity — rare is what makes it precious):
//   minor  → panel shimmer + tick chime, never the orb
//   major  → orb bloom + short gold swing + one ambient line
//   record → the full-wall moment; at most ONE per poll
// A bigger moment swallows the smaller ones from the same poll.
// ---------------------------------------------------------------------------

import type { Engagement, RecordEntry } from "./engagement";
import type { CelebrateTier } from "../components/coreTypes";

export interface CelebrationEvent {
  tier: CelebrateTier;
  /** tier-A shimmer target */
  panel?: "priorities" | "shipped";
  /** spoken (ambient) — tier B/C only */
  line?: string;
  /** tier-C NEW RECORD callout */
  callout?: { target: string; label: string };
}

function spokenValue(r: RecordEntry): string {
  const v = r.value.toLocaleString("en-US");
  if (r.unit === "₹") return `${v} rupees`;
  return r.unit ? `${v} ${r.unit}` : v;
}

export function diffEngagement(
  prev: Engagement,
  next: Engagement,
  dashboardRel: string
): CelebrationEvent[] {
  const records: CelebrationEvent[] = [];
  const majors: CelebrationEvent[] = [];
  const minors: CelebrationEvent[] = [];

  // --- tier C: a record fell ------------------------------------------------
  for (const r of next.records) {
    if (!r.brokenToday) continue;
    const was = prev.records.find((p) => p.id === r.id);
    if (was?.brokenToday) continue; // already celebrated this record today
    records.push({
      tier: "record",
      line: `New record. ${r.label} — ${spokenValue(r)}.`,
      callout: { target: `${dashboardRel}#record-${r.id}`, label: `NEW RECORD · ${r.label}` },
    });
  }

  // --- tier B ---------------------------------------------------------------
  if (next.quests.allComplete && !prev.quests.allComplete) {
    majors.push({ tier: "major", panel: "priorities", line: "All directives clear. Good day." });
  }
  const pb = { prev: prev.quests.publishes, next: next.quests.publishes };
  if (pb.next.blog.done >= pb.next.blog.goal && pb.prev.blog.done < pb.prev.blog.goal) {
    majors.push({ tier: "major", panel: "shipped", line: "Blog cap filled — two live today." });
  }
  if (
    pb.next.carousel.done >= pb.next.carousel.goal &&
    pb.prev.carousel.done < pb.prev.carousel.goal
  ) {
    majors.push({ tier: "major", panel: "shipped", line: "Carousel is live. Cap filled." });
  }
  if (next.streaks.ship.todayFilled && !prev.streaks.ship.todayFilled) {
    majors.push({
      tier: "major",
      panel: "shipped",
      line:
        next.streaks.ship.current > 1
          ? `Chain extended — day ${next.streaks.ship.current}.`
          : "First ship of a new chain.",
    });
  }

  // --- tier A ---------------------------------------------------------------
  if (next.quests.top3.done > prev.quests.top3.done) {
    minors.push({ tier: "minor", panel: "priorities" });
  }
  if (next.quests.drivers.done > prev.quests.drivers.done) {
    minors.push({ tier: "minor", panel: "priorities" });
  }
  if (
    pb.next.blog.done > pb.prev.blog.done ||
    pb.next.carousel.done > pb.prev.carousel.done
  ) {
    minors.push({ tier: "minor", panel: "shipped" });
  }

  // the biggest moment of the poll owns the poll
  if (records.length > 0) return records.slice(0, 1);
  if (majors.length > 0) return majors.slice(0, 2);
  // dedupe minor shimmer per panel
  const seen = new Set<string>();
  return minors.filter((m) => !seen.has(m.panel!) && seen.add(m.panel!)).slice(0, 2);
}
