"use client";

import { memo } from "react";
import type { Marketing } from "@/lib/vault";
import { fmtINR, fmtINRShort, fmtRoas } from "@/lib/format";
import { CountUp, NumberRoll } from "./shared";

// ---------------------------------------------------------------------------
// Primary Directive · Budget Pacing — the one number a founder asks every
// morning. Month-to-date spend against the pro-rated monthly budget, with a
// "should-be-here" marker and the projected month-end. EST badge while the
// daily history is still filling (run-rate estimate).
// ---------------------------------------------------------------------------

const Pacing = memo(function Pacing({ m, hot }: { m: Marketing | null; hot?: boolean }) {
  const p = m?.pacing;
  if (!p) {
    return (
      <section className={`objective boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.58s" }}>
        <div className="obj-label">Primary Directive · Budget Pacing</div>
        <div className="big">—</div>
        <div className="sub"><span>waiting on the first metrics pull</span></div>
      </section>
    );
  }
  const spendPct = p.budget ? Math.min((p.spend_mtd / p.budget) * 100, 100) : 0;
  const markPct = p.budget ? Math.min((p.expected_mtd / p.budget) * 100, 100) : 0;
  const over = p.status === "over";
  const under = p.status === "under";
  const roasBad = p.blended_roas_mtd !== null && p.blended_roas_mtd < p.breakeven_roas;
  return (
    <section className={`objective pacing ${over ? "over" : ""} boot-stagger ${hot ? "voice-hot" : ""}`} style={{ animationDelay: "0.58s" }}>
      <div className="obj-label">
        Primary Directive · Budget Pacing · {p.month_label}
        {p.estimated && <span className="est-tag">EST</span>}
      </div>
      <div className="big">
        <span className="currency">₹</span>
        <CountUp value={p.spend_mtd} format={fmtINR} />
        <span className="unit">MTD</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="month-to-date spend against monthly budget"
        aria-valuemin={0}
        aria-valuemax={Math.max(p.budget, 1)}
        aria-valuenow={Math.round(p.spend_mtd)}
      >
        <i style={{ width: `${spendPct}%` }} />
        <b className="pace-mark" style={{ left: `${markPct}%` }} title="where spend should be today" />
      </div>
      <div className="sub">
        <span>
          budget <b>{fmtINRShort(p.budget)}</b>
        </span>
        <span>
          day <b>{p.day}/{p.days_in_month}</b>
        </span>
        <span className={over ? "bad" : under ? "warn" : ""}>
          pace <b><NumberRoll text={p.pace_pct !== null ? `${Math.round(p.pace_pct)}%` : "—"} /></b>
        </span>
        <span className={over ? "bad" : ""}>
          projected <b><NumberRoll text={fmtINRShort(p.projected_eom)} /></b>
        </span>
        <span className={roasBad ? "bad" : ""}>
          roas mtd <b><NumberRoll text={fmtRoas(p.blended_roas_mtd)} /></b> vs be {p.breakeven_roas.toFixed(2)}
        </span>
      </div>
      {(p.contribution_mtd !== null && p.contribution_mtd !== undefined) && (
        <div className="sub contribution-line">
          <span className={p.contribution_mtd < 0 ? "bad" : "good"}>
            contribution mtd{" "}
            <b>
              {p.contribution_mtd < 0 ? "−" : "+"}₹<NumberRoll text={fmtINR(Math.abs(p.contribution_mtd))} />
            </b>
          </span>
          <span>
            revenue <b>{fmtINRShort(p.revenue_mtd)}</b>
          </span>
          {p.projected_contribution_eom !== null && p.projected_contribution_eom !== undefined && (
            <span className={p.projected_contribution_eom < 0 ? "bad" : ""}>
              projected{" "}
              <b>
                {p.projected_contribution_eom < 0 ? "−" : "+"}
                {fmtINRShort(Math.abs(p.projected_contribution_eom))}
              </b>{" "}
              by month end
            </span>
          )}
          {p.days_left !== undefined && (
            <span>
              <b>{p.days_left}</b> days left
            </span>
          )}
        </div>
      )}
    </section>
  );
});

export default Pacing;
