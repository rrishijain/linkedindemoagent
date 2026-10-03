"use client";

import { memo } from "react";
import type { Quests, RecordEntry, ShippedEntry } from "@/lib/vault";
import { fmtAge } from "@/lib/format";
import { PanelLoading, SectionTitle, pressable } from "./shared";

// ---------------------------------------------------------------------------
// Shipped — everything the system produced that you can open: reports in the
// vault, decks, live blog posts and carousels (rows with a `link:` jump out).
// The header tick carries today's publish caps (mirrors DAILY_CAP in the
// runner); the foot carries at most ONE record / near-miss line — quiet
// unless there is something to chase.
// ---------------------------------------------------------------------------

function recVal(r: RecordEntry): string {
  const v = r.value.toLocaleString("en-IN");
  return r.unit === "₹" ? `₹${v}` : r.unit ? `${v} ${r.unit}` : v;
}

const Shipped = memo(function Shipped({
  items,
  quests,
  record,
  hot,
  flash,
  loading,
  onOpen,
}: {
  items: ShippedEntry[];
  quests?: Quests | null;
  record?: RecordEntry | null;
  hot?: boolean;
  flash?: boolean;
  loading?: boolean;
  onOpen: (path: string) => void;
}) {
  if (loading) {
    return (
      <section className={`block accent-mint boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.42s" }}>
        <SectionTitle title="Shipped" tick="LOADING" tickCls="dim" />
        <PanelLoading />
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section className={`block accent-mint boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.42s" }}>
        <SectionTitle title="Shipped" tick="0 · 7D" tickCls="dim" />
        <div className="prio dim">nothing shipped yet — finished runs land here</div>
      </section>
    );
  }
  const week = items.filter((s) => s.ts && Date.now() - Date.parse(s.ts) < 7 * 86_400_000).length;
  const pub = quests?.publishes ?? null;
  const capsFull = pub
    ? pub.blog.done >= pub.blog.goal && pub.carousel.done >= pub.carousel.goal
    : false;
  const tick = pub
    ? `BLOG ${pub.blog.done}/${pub.blog.goal} · CARO ${pub.carousel.done}/${pub.carousel.goal}`
    : `${week} · 7D`;
  return (
    <section
      className={`block accent-mint boot-stagger ${hot ? "voice-hot" : ""} ${flash ? "quest-flash" : ""}`}
      style={{ animationDelay: "0.42s" }}
    >
      <SectionTitle title="Shipped" tick={tick} tickCls={capsFull ? "cap-full" : ""} />
      {items.slice(0, 5).map((s) => {
        const name = (s.label ?? s.skill).replace(/-/g, " ").replace(/^ds /, "");
        const host = s.link ? s.link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : null;
        return (
          <div
            className="doc-row"
            key={s.id}
            title={s.link ?? s.deliverable_path}
            {...pressable(() =>
              s.link ? window.open(s.link, "_blank", "noopener") : onOpen(s.deliverable_path)
            )}
          >
            <span className="doc-skill">
              {name}
              {host && <span className="ext"> · {host} ↗</span>}
            </span>
            <span className="doc-age">{fmtAge(s.ts).label}</span>
          </div>
        );
      })}
      {record && (
        <div className={`record-row ${record.brokenToday ? "broken" : ""}`}>
          <span className="rec-bullet">▸</span>
          {record.brokenToday
            ? `new record · ${record.label} · ${recVal(record)}`
            : `${record.value - (record.today ?? 0)} from the record · ${record.label} ${record.today}/${record.value}`}
        </div>
      )}
    </section>
  );
});

export default Shipped;
