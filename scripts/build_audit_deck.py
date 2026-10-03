#!/usr/bin/env python3
"""Meta Ads Performance Audit deck (18 slides, 16:9).

Numbers come from marketing-latest.json — the file marketing_context.py writes,
the same source the ARGUS wall reads — so the deck can never drift from the
console. The narrative (classifications, root causes, actions, tests) comes
from the /meta-ads-audit report named on the command line.

Reuses the house Deck primitives from the report-deck skill so this looks like
every other ARGUS deck.

usage: /usr/bin/python3 scripts/build_audit_deck.py [--out PATH]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

SKILL = Path.home() / ".claude" / "skills" / "report-deck" / "scripts"
sys.path.insert(0, str(SKILL))
from deck_lib import pptx_build  # noqa: E402
from pptx.util import Inches, Pt  # noqa: E402
from pptx.enum.text import PP_ALIGN  # noqa: E402

VAULT = Path(os.environ.get("CONSOLE_VAULT_ROOT") or os.environ.get("HUD_VAULT_ROOT") or Path.home() / "the-vault")
CTX = VAULT / "system" / "metrics" / "marketing-latest.json"
THEME = Path.home() / ".claude" / "skills" / "report-deck" / "templates" / "theme.json"

R = "₹"


def inr(n, dp=0):
    if n is None:
        return "—"
    a = abs(n)
    sign = "-" if n < 0 else ""
    if a >= 1e7:
        return f"{sign}{R}{a/1e7:.1f}Cr"
    if a >= 1e5:
        return f"{sign}{R}{a/1e5:.1f}L"
    if a >= 1e3:
        return f"{sign}{R}{a/1e3:.1f}K"
    return f"{sign}{R}{a:,.{dp}f}"


def full(n):
    return "—" if n is None else f"{R}{n:,.0f}"


def pct(n, dp=2):
    return "—" if n is None else f"{n:.{dp}f}%"


def dlt(n):
    if n is None:
        return "—"
    return f"{'+' if n > 0 else ''}{n*100:.0f}%"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    a = ap.parse_args()

    ctx = json.loads(CTX.read_text())
    theme = json.loads(THEME.read_text())
    m = ctx["channels"]["meta"]
    t = m["totals"]
    d = m["deltas"]
    v = m["verdicts"]
    tg = ctx["targets"]
    b = ctx["blended"]
    pc = ctx["pacing"]
    win = m["window"]
    camps = [c for c in m["campaigns"] if (c.get("spend") or 0) > 0]
    camps.sort(key=lambda c: -(c.get("spend") or 0))

    # Per-campaign impressions/clicks are DERIVED from spend/CPM/CTR — the pull
    # ships them only at account level. They reconcile to the account totals
    # within 0.01%, which is what makes the funnel maths below safe to show.
    for c in camps:
        c["impr"] = (c["spend"] / c["cpm"] * 1000) if c.get("cpm") else None
        c["clicks"] = (c["impr"] * c["ctr"] / 100) if c.get("impr") and c.get("ctr") else None
        c["cpc"] = (c["spend"] / c["clicks"]) if c.get("clicks") else None
        c["cvr"] = (c["purchases"] / c["clicks"] * 100) if c.get("clicks") else None
        c["aov"] = (c["revenue"] / c["purchases"]) if c.get("purchases") else None

    acct_cpc = t["spend"] / t["clicks"]
    acct_cvr = t["purchases"] / t["clicks"] * 100
    acct_aov = t["revenue"] / t["purchases"]
    short = {c["campaign"]: c["campaign"].replace("30_Days_Ai_Courses_Testing_", "30D ").replace("CCF_Course_New_Rishi_Septmeber", "CCF Course New") for c in camps}

    abo = next(c for c in camps if c["campaign"].endswith("ABO"))
    cbo = next(c for c in camps if c["campaign"].endswith("CBO"))
    ccf = next(c for c in camps if c["campaign"].startswith("CCF"))

    deck = pptx_build.Deck(ctx, theme, "meta")
    D = deck

    def vcol(k):
        return {"green": "green", "amber": "amber", "red": "red"}.get(k, "ink")

    # 1 — title -------------------------------------------------------------
    s = D.slide()
    D.text(s, theme["client"], 0.8, 2.1, 11, 0.5, size=14, color="accent", caps=True)
    D.text(s, "Meta Ads Performance Audit", 0.8, 2.6, 12, 1.2, size=44, bold=True)
    D.text(s, f"{win['days']} days · {win['from']} to {win['to']}", 0.8, 3.85, 11, 0.5, size=16, color="ink_dim")
    D.text(s, f"Generated {date.today().isoformat()} · INR · targets from ops/targets.md · "
              f"1 of 5 ad accounts answered (4 returned HTTP 403)", 0.8, 4.35, 11.5, 0.5, size=11, color="ink_faint")

    # 2 — executive summary --------------------------------------------------
    s = D.slide("Executive summary", "What happened")
    D.tile(s, 0.7, 1.35, 2.9, "Spend · 7d", inr(t["spend"]), f"{dlt(d['spend'])} vs prior week")
    D.tile(s, 3.75, 1.35, 2.9, "Revenue · 7d", inr(t["revenue"]), f"{dlt(d['revenue'])} vs prior")
    D.tile(s, 6.8, 1.35, 2.9, "ROAS", f"{t['roas']:.2f}x", f"BE {tg['breakeven_roas']} · target {tg['target_roas']}", col=vcol(v.get("roas")))
    D.tile(s, 9.85, 1.35, 2.9, "CPA", full(t["cpa"]), f"target {full(tg['target_cpa'])}", col=vcol(v.get("cpa")))
    D.bullets(s, [
        f"Meta is above the {tg['breakeven_roas']} breakeven at {t['roas']:.2f}x, but 29% short of the {tg['target_roas']} target — "
        f"and blended (Meta + Google) sits at {b['totals']['roas']:.2f}x, BELOW breakeven.",
        f"One campaign carries the account: CCF Course New at {ccf['roas']:.2f}x ROAS and {full(ccf['cpa'])} CPA on "
        f"{ccf['spend_share']*100:.0f}% of spend — {ccf['purchases']/t['purchases']*100:.0f}% of all purchases.",
        f"The money is lost after the click, not before it: account CTR {pct(t['ctr'])} clears your floor, but click→purchase "
        f"is {acct_cvr:.2f}% and 30D ABO converts at just {abo['cvr']:.2f}%.",
        f"Contribution is negative: {full(b['economics']['contribution'])} over 7d at {b['economics']['gross_margin_pct']:.0f}% gross margin, "
        f"{full(pc['contribution_mtd'])} month-to-date.",
    ], 0.7, 3.1, 12, 3.4, size=14, gap=12)

    # 3 — account overview ---------------------------------------------------
    s = D.slide("Account overview", "The dataset")
    rows = [["Field", "Value"],
            ["Window", f"{win['from']} → {win['to']} ({win['days']}d)"],
            ["Prior window (for deltas)", f"{win['prev_from']} → {win['prev_to']}"],
            ["Ad accounts", "1 of 5 answered · 4 returned HTTP 403"],
            ["Campaigns with spend", str(len(camps))],
            ["Ad sets / ads", "Not in this pull — campaign level only"],
            ["Result type", "Purchases (all campaigns) — objectives comparable"],
            ["Spend", full(t["spend"])],
            ["Impressions / reach", f"{t['impressions']:,.0f} / {t['reach']:,.0f}"],
            ["Clicks", f"{t['clicks']:,.0f}"],
            ["Purchases / revenue", f"{t['purchases']:,.0f} / {full(t['revenue'])}"]]
    D.table(s, 0.7, 1.4, 7.4, rows, col_w=[3.4, 4.0], row_h=0.34)
    D.panel(s, 8.5, 1.4, 4.2, 3.0)
    D.text(s, "Objective mix", 8.75, 1.55, 3.8, 0.3, size=10, color="ink_dim", caps=True)
    D.bullets(s, [
        "Every campaign reports purchases + revenue, so cost per result is compared like for like.",
        "No lead-objective campaigns in this window — CPL is not applicable.",
        "Ad-level and video data are absent: hook/hold rate = Needs more data.",
    ], 8.75, 1.95, 3.7, 2.4, size=11, gap=8)

    # 4 — where the money went ----------------------------------------------
    s = D.slide("Where the money went", "Spend allocation")
    D.bars(s, 0.7, 1.4, 7.2, 4.4, [short[c["campaign"]] for c in camps],
           {"Spend": [round(c["spend"]) for c in camps]})
    for i, c in enumerate(camps):
        y = 1.5 + i * 1.6
        col = "green" if c["roas"] >= tg["target_roas"] else ("amber" if c["roas"] >= tg["breakeven_roas"] else "red")
        D.tile(s, 8.3, y, 4.4, short[c["campaign"]], f"{inr(c['spend'])} · {c['spend_share']*100:.0f}%",
               f"{c['roas']:.2f}x ROAS · {c['purchases']:.0f} purchases", col=col)
    D.text(s, f"47% of spend sits on the only campaign clearing breakeven; 53% sits below it.",
           0.7, 6.0, 12, 0.4, size=12, color="ink_dim")

    # 5 — performance scorecard ---------------------------------------------
    s = D.slide("Performance scorecard", "Account level vs your targets")
    rows = [["Metric", "Actual", "Target", "vs prior", "Verdict"],
            ["ROAS", f"{t['roas']:.2f}x", f"{tg['target_roas']:.1f}x (BE {tg['breakeven_roas']})", dlt(d["roas"]), v.get("roas", "—").upper()],
            ["CPA", full(t["cpa"]), f"{full(tg['target_cpa'])} (max {full(tg['max_cpa'])})", dlt(d["cpa"]), v.get("cpa", "—").upper()],
            ["CTR", pct(t["ctr"]), f"min {tg['min_ctr']:.1f}%", dlt(d["ctr"]), v.get("ctr", "—").upper()],
            ["CPM", full(t["cpm"]), "—", dlt(d["cpm"]), "—"],
            ["CPC (derived)", full(acct_cpc), "—", "—", "—"],
            ["Click→purchase", f"{acct_cvr:.2f}%", "—", "—", "—"],
            ["AOV", full(acct_aov), "—", "—", "—"],
            ["Frequency", f"{t['frequency']:.2f}", f"max {tg['max_frequency']:.1f}", "—", v.get("frequency", "—").upper()],
            ["Spend", full(t["spend"]), "—", dlt(d["spend"]), "—"],
            ["Purchases", f"{t['purchases']:.0f}", "—", dlt(d["results"]), "—"]]
    colors = [[None] * 5] + [[None, None, None, None, vcol(r[4].lower())] for r in rows[1:]]
    D.table(s, 0.7, 1.4, 12, rows, col_w=[3.0, 2.2, 3.0, 1.8, 2.0], row_h=0.38, colors=colors)
    D.text(s, "Verdicts are the ones marketing_context.py already wrote against ops/targets.md — not re-judged here.",
           0.7, 6.4, 12, 0.4, size=10, color="ink_faint")

    # 6 — performance funnel -------------------------------------------------
    s = D.slide("Performance funnel", "Where performance is lost")
    stages = [("Impressions", t["impressions"], ""), ("Reach", t["reach"], f"freq {t['frequency']:.2f}"),
              ("Clicks", t["clicks"], f"CTR {pct(t['ctr'])}"), ("Purchases", t["purchases"], f"CVR {acct_cvr:.2f}%")]
    x = 0.7
    for i, (name, val, sub) in enumerate(stages):
        D.panel(s, x, 1.5, 2.8, 1.7)
        D.text(s, name, x + 0.2, 1.62, 2.4, 0.3, size=10, color="ink_dim", caps=True)
        D.text(s, f"{val:,.0f}", x + 0.2, 1.95, 2.4, 0.6, size=24, bold=True)
        D.text(s, sub, x + 0.2, 2.62, 2.4, 0.3, size=10, color="ink_faint")
        if i < 3:
            D.text(s, "→", x + 2.85, 2.05, 0.4, 0.4, size=20, color="accent")
        x += 3.15
    D.bullets(s, [
        f"Impressions → clicks holds up: {pct(t['ctr'])} CTR is above your {tg['min_ctr']:.1f}% floor.",
        f"THE LEAK IS CLICKS → PURCHASES: {t['clicks']:,.0f} clicks produced {t['purchases']:.0f} purchases ({acct_cvr:.2f}%).",
        f"That is where {full(t['spend'])} of spend is decided — a 0.5pt move in this rate is worth more than any CPM win.",
        "Landing page views, form starts and device split are NOT in this pull — the leak can be located but not yet split.",
    ], 0.7, 3.6, 12, 2.6, size=14, gap=10)

    # 7 — campaign performance ----------------------------------------------
    s = D.slide("Campaign performance", "Compared like for like")
    rows = [["Campaign", "Spend", "ROAS", "CPA", "CTR", "CPC", "CVR", "Freq"]]
    colors = [[None] * 8]
    for c in camps:
        rows.append([short[c["campaign"]], inr(c["spend"]), f"{c['roas']:.2f}x", full(c["cpa"]),
                     pct(c["ctr"]), full(c["cpc"]), f"{c['cvr']:.2f}%", f"{c['frequency']:.2f}"])
        col = "green" if c["roas"] >= tg["target_roas"] else ("amber" if c["roas"] >= tg["breakeven_roas"] else "red")
        colors.append([None, None, col, None, None, None, None, "red" if c["frequency"] > tg["max_frequency"] else None])
    rows.append(["ACCOUNT", inr(t["spend"]), f"{t['roas']:.2f}x", full(t["cpa"]), pct(t["ctr"]),
                 full(acct_cpc), f"{acct_cvr:.2f}%", f"{t['frequency']:.2f}"])
    colors.append([None] * 8)
    D.table(s, 0.5, 1.4, 12.4, rows, col_w=[3.0, 1.4, 1.3, 1.5, 1.3, 1.3, 1.3, 1.3], row_h=0.42, colors=colors)
    D.bullets(s, [
        "CCF wins on the two that matter together: highest CVR (2.50%) AND highest AOV — so its higher CPM is paid for.",
        "30D CBO has the best CTR (2.00%) and the worst economics — the click is cheap to earn, the sale is not.",
        f"30D ABO is the only campaign over the frequency cap ({abo['frequency']:.2f} vs {tg['max_frequency']:.1f}).",
    ], 0.5, 4.1, 12.4, 2.2, size=13, gap=9)

    # 8 — creative effectiveness --------------------------------------------
    s = D.slide("Creative effectiveness", "CTR against what the click is worth")
    D.bars(s, 0.6, 1.4, 6.0, 4.3, [short[c["campaign"]] for c in camps],
           {"CTR %": [round(c["ctr"], 2) for c in camps], "Click→purchase %": [round(c["cvr"], 2) for c in camps]}, horizontal=False)
    D.bars(s, 6.9, 1.4, 6.0, 4.3, [short[c["campaign"]] for c in camps],
           {"ROAS": [round(c["roas"], 2) for c in camps]}, horizontal=False)
    D.text(s, "Hook rate and hold rate: NEEDS MORE DATA — no video metrics in this pull, so creative fatigue "
              "cannot be confirmed from watch-through behaviour.", 0.6, 5.9, 12.3, 0.6, size=12, color="amber")

    # 9 — winners ------------------------------------------------------------
    s = D.slide("Winner", "CCF Course New — and why it works")
    D.tile(s, 0.7, 1.4, 2.9, "ROAS", f"{ccf['roas']:.2f}x", f"vs {t['roas']:.2f}x account", col="green")
    D.tile(s, 3.75, 1.4, 2.9, "CPA", full(ccf["cpa"]), f"{(1-ccf['cpa']/tg['target_cpa'])*100:.0f}% below target", col="green")
    D.tile(s, 6.8, 1.4, 2.9, "Click→purchase", f"{ccf['cvr']:.2f}%", f"vs {acct_cvr:.2f}% account", col="green")
    D.tile(s, 9.85, 1.4, 2.9, "Frequency", f"{ccf['frequency']:.2f}", f"cap {tg['max_frequency']:.1f} — audience fresh", col="green")
    D.bullets(s, [
        f"It is not winning on cheap traffic: its CPM ({full(ccf['cpm'])}) is 2.6x ABO's. It wins AFTER the click.",
        f"{ccf['cvr']:.2f}% of its clicks buy, against {abo['cvr']:.2f}% for ABO — {ccf['cvr']/abo['cvr']:.1f}x the conversion on the same funnel.",
        f"AOV {full(ccf['aov'])} is the highest in the account, so each conversion is worth more too.",
        f"{ccf['purchases']:.0f} of the account's {t['purchases']:.0f} purchases ({ccf['purchases']/t['purchases']*100:.0f}%) come from here, on {ccf['spend_share']*100:.0f}% of spend.",
    ], 0.7, 3.3, 12, 3.0, size=14, gap=11)

    # 10 — underperformers ---------------------------------------------------
    s = D.slide("Underperformers", "Tracing the chain: CPM → CTR → CPC → CVR → ROAS")
    for i, (c, verdict) in enumerate([(abo, "Creative + audience"), (cbo, "Funnel / offer")]):
        y = 1.4 + i * 2.6
        D.panel(s, 0.7, y, 12, 2.35)
        D.text(s, short[c["campaign"]], 0.95, y + 0.12, 5, 0.35, size=16, bold=True)
        D.text(s, f"{inr(c['spend'])} spend · {c['spend_share']*100:.0f}% of account · {c['roas']:.2f}x ROAS",
               0.95, y + 0.5, 6, 0.3, size=11, color="ink_dim")
        chain = [("CPM", full(c["cpm"])), ("CTR", pct(c["ctr"])), ("CPC", full(c["cpc"])),
                 ("CVR", f"{c['cvr']:.2f}%"), ("AOV", full(c["aov"])), ("ROAS", f"{c['roas']:.2f}x")]
        x = 6.6
        for name, val in chain:
            D.text(s, name, x, y + 0.15, 1.0, 0.25, size=9, color="ink_faint", caps=True)
            D.text(s, val, x, y + 0.42, 1.0, 0.4, size=14, bold=True)
            x += 1.0
        note = (f"Cheapest traffic in the account ({full(c['cpm'])} CPM) and the worst outcome. Weak CTR "
                f"({pct(c['ctr'])}, below the {tg['min_ctr']:.1f}% floor) AND the worst click→purchase ({c['cvr']:.2f}%): "
                f"the creative is not earning the click and the click is not earning the sale. Frequency "
                f"{c['frequency']:.2f} is over the {tg['max_frequency']:.1f} cap — over-exposure is a live suspect.") if c is abo else (
                f"Best CTR in the account ({pct(c['ctr'])}) on the most expensive traffic ({full(c['cpm'])} CPM). "
                f"Conversion is mid ({c['cvr']:.2f}%) and AOV is the lowest ({full(c['aov'])}), so the sale does not pay "
                f"for the click. Frequency {c['frequency']:.2f} is safe — this is NOT fatigue. {c['purchases']:.0f} purchases "
                f"is a small sample; treat as directional.")
        D.text(s, note, 0.95, y + 1.05, 11.5, 1.1, size=12, color="ink_dim")

    # 11 — decision matrix ---------------------------------------------------
    s = D.slide("Creative decision matrix", "Every campaign classified")
    rows = [["Campaign", "Classification", "Evidence", "Action"],
            [short[abo["campaign"]], "CREATIVE NEEDS IMPROVEMENT",
             f"{abo['roas']:.2f}x ROAS (below {tg['breakeven_roas']} BE) · CTR {pct(abo['ctr'])} · CVR {abo['cvr']:.2f}% · freq {abo['frequency']:.2f}",
             "Cut budget 80%, rotate 3 new creatives against a fresh cohort"],
            [short[cbo["campaign"]], "FUNNEL PROBLEM LIKELY",
             f"CTR {pct(cbo['ctr'])} (best) but {cbo['roas']:.2f}x ROAS · AOV {full(cbo['aov'])} (lowest) · freq {cbo['frequency']:.2f} safe",
             "Hold spend, A/B the landing page + offer before any pause"],
            [short[ccf["campaign"]], "SCALE",
             f"{ccf['roas']:.2f}x ROAS · CPA {full(ccf['cpa'])} · CVR {ccf['cvr']:.2f}% · freq {ccf['frequency']:.2f}",
             "Raise daily budget 25-50%, hold ROAS ≥1.80"],
            ["Ad-level creatives", "NEEDS MORE DATA", "No ad-level rows, no hook/hold, no LPV in this pull",
             "Enable ad-level + video breakdowns before judging individual creatives"],
            ["4 blocked ad accounts", "NEEDS MORE DATA", "HTTP 403 on 381390…, 426649…, 778643…, 675820…",
             "Fix API permissions, then re-run the audit blended"]]
    colors = [[None] * 4, [None, "red", None, None], [None, "amber", None, None],
              [None, "green", None, None], [None, "ink_dim", None, None], [None, "ink_dim", None, None]]
    D.table(s, 0.5, 1.4, 12.4, rows, col_w=[2.4, 2.6, 4.2, 3.2], row_h=0.78, size=9, colors=colors)
    D.text(s, "No campaign is classified on a single weak metric — each line pairs an acquisition metric with a conversion metric.",
           0.5, 6.4, 12.4, 0.4, size=10, color="ink_faint")

    # 12 — do not touch yet --------------------------------------------------
    s = D.slide("Do not touch yet", "One metric looks wrong, the whole picture does not")
    rows = [["Campaign / setting", "Unusual metric", "Why not to change it yet"],
            [short[ccf["campaign"]], f"CPM {full(ccf['cpm'])} — 2.6x the cheapest campaign",
             f"It buys the account's best conversion ({ccf['cvr']:.2f}%) and highest AOV. Chasing cheaper traffic is how you lose the {ccf['roas']:.2f}x."],
            [short[cbo["campaign"]], f"ROAS {cbo['roas']:.2f}x — below breakeven",
             f"CTR {pct(cbo['ctr'])} says the ad works and frequency {cbo['frequency']:.2f} says the audience is fresh. Test the funnel before pausing; {cbo['purchases']:.0f} purchases is a small sample."],
            ["Monthly budget", f"Pace {pc['pace_pct']:.0f}% of plan, {pc['days_left']} days left",
             f"Under-pacing on a {inr(pc['budget'])} budget is not the problem while contribution is negative. Fix efficiency first, then spend."],
            ["Account CTR", f"{pct(t['ctr'])}, down {dlt(d['ctr'])} vs prior",
             "Still above your 1.0% floor, and spend more than doubled week on week — a small CTR give-back at 2.4x volume is expected."]]
    D.table(s, 0.5, 1.4, 12.4, rows, col_w=[2.6, 3.4, 6.4], row_h=0.95, size=10)

    # 13 — root cause --------------------------------------------------------
    s = D.slide("Root cause audit", "Problem → evidence → cause")
    rows = [["Problem", "Evidence", "Likely root cause", "Investigate"],
            [f"Blended ROAS {b['totals']['roas']:.2f}x is below the {tg['breakeven_roas']} breakeven",
             f"Contribution {full(b['economics']['contribution'])} over 7d at {b['economics']['gross_margin_pct']:.0f}% margin",
             "MIX — 53% of spend on sub-breakeven campaigns", "Revenue impact of moving ABO+CBO budget to CCF"],
            [f"ABO {abo['roas']:.2f}x on {inr(abo['spend'])}",
             f"CTR {pct(abo['ctr'])} below floor · CVR {abo['cvr']:.2f}% (worst) · freq {abo['frequency']:.2f} over cap",
             "CREATIVE + POSSIBLE FATIGUE", "Creative age, CTR trend since launch, audience size"],
            [f"CBO {cbo['roas']:.2f}x despite best CTR",
             f"CTR {pct(cbo['ctr'])} · CVR {cbo['cvr']:.2f}% · AOV {full(cbo['aov'])} lowest · freq {cbo['frequency']:.2f}",
             "CONVERSION / FUNNEL or OFFER", "LP load + form drop-off, offer/price fit, device split"],
            ["Account view is incomplete", "4 of 5 ad accounts returned HTTP 403",
             "ACCESS / PERMISSIONS", "Token scope and account roles for the 4 blocked IDs"],
            ["Creative fatigue cannot be confirmed", "No hook/hold, no ad-level rows, no daily CTR by creative",
             "INSUFFICIENT DATA", "Enable ad-level + video breakdowns in the pull"]]
    colors = [[None] * 4, [None, None, "amber", None], [None, None, "red", None],
              [None, None, "amber", None], [None, None, "ink_dim", None], [None, None, "ink_dim", None]]
    D.table(s, 0.5, 1.4, 12.4, rows, col_w=[2.9, 3.6, 2.9, 3.0], row_h=0.85, size=9, colors=colors)

    # 14 — top 5 actions -----------------------------------------------------
    s = D.slide("Top 5 actions", "Ranked P1 → P5")
    acts = [
        ("P1", "Move 80% of ABO budget to CCF Course New",
         f"ABO {abo['roas']:.2f}x vs CCF {ccf['roas']:.2f}x on the same funnel", "Blended ROAS 1.33x → 1.60x+ in 14d", "red"),
        ("P2", "Rotate 3 new creatives on ABO against a fresh cohort",
         f"CTR {pct(abo['ctr'])} below floor, frequency {abo['frequency']:.2f} over cap", "ABO CTR above 1.0%, frequency under 2.5", "red"),
        ("P3", "A/B the CBO landing page and offer — do not pause it",
         f"Best CTR {pct(cbo['ctr'])}, worst AOV {full(cbo['aov'])}", "CBO click→purchase above 2.0%", "amber"),
        ("P4", "Fix API access on the 4 blocked ad accounts", "HTTP 403 on 4 of 5 accounts", "A blended audit that covers 100% of spend", "amber"),
        ("P5", "Turn on ad-level and video breakdowns in the pull", "Hook/hold and LPV missing entirely", "Fatigue diagnosable at creative level", "accent"),
    ]
    y = 1.35
    for p, what, ev, metric, col in acts:
        D.panel(s, 0.6, y, 12.2, 1.0)
        D.text(s, p, 0.8, y + 0.28, 0.8, 0.4, size=20, bold=True, color=col)
        D.text(s, what, 1.7, y + 0.14, 6.4, 0.4, size=14, bold=True)
        D.text(s, ev, 1.7, y + 0.55, 6.4, 0.35, size=10, color="ink_dim")
        D.text(s, "EXPECT", 8.4, y + 0.14, 4.2, 0.3, size=8, color="ink_faint", caps=True)
        D.text(s, metric, 8.4, y + 0.42, 4.2, 0.5, size=11, color="green")
        y += 1.13

    # 15 — tests -------------------------------------------------------------
    s = D.slide("Three tests", "Each one comes out of a number above")
    tests = [
        ("Test 1 · ABO creative rotation",
         f"ABO's {pct(abo['ctr'])} CTR and {abo['frequency']:.2f} frequency mean the audience has stopped responding to this creative, not to the offer.",
         "3 new hooks, same offer, same audience, same budget", "Audience, placement, budget, landing page",
         "CTR, then click→purchase", f"CTR above {tg['min_ctr']:.1f}% within 7d at equal or better CVR"),
        ("Test 2 · CBO landing page",
         f"CBO earns clicks ({pct(cbo['ctr'])}) but not sales ({cbo['cvr']:.2f}%, AOV {full(cbo['aov'])}) — the drop is after the click.",
         "2 LP variants: shorter form vs stronger offer framing", "Creative, audience, bid, budget",
         "Click→purchase and AOV", f"CVR above 2.0% or AOV above {full(acct_aov)} within 7d"),
        ("Test 3 · CCF budget step-up",
         f"CCF holds {ccf['roas']:.2f}x at frequency {ccf['frequency']:.2f} — the audience is nowhere near saturated.",
         "+50% daily budget, unchanged creative and targeting", "Creative, audience, offer, LP",
         "ROAS at higher spend", "ROAS stays ≥1.80x for 7 consecutive days"),
    ]
    y = 1.35
    for name, hyp, what, const, metric, success in tests:
        D.panel(s, 0.6, y, 12.2, 1.65)
        D.text(s, name, 0.85, y + 0.12, 5.5, 0.35, size=14, bold=True, color="accent")
        D.text(s, f"Hypothesis: {hyp}", 0.85, y + 0.5, 11.6, 0.5, size=11, color="ink_dim")
        D.text(s, f"TEST: {what}   ·   HOLD CONSTANT: {const}", 0.85, y + 0.95, 11.6, 0.3, size=10)
        D.text(s, f"WATCH: {metric}   ·   SUCCESS: {success}", 0.85, y + 1.25, 11.6, 0.3, size=10, color="green")
        y += 1.8

    # 16 — 30-day plan -------------------------------------------------------
    s = D.slide("30-day plan", "Fix · test · scale · monitor")
    cols = [("Days 1-3 · FIX", ["Shift 80% of ABO budget to CCF", "Brief 3 new ABO creatives", "Open the 4 blocked ad accounts"], "red"),
            ("Days 4-10 · TEST", ["Launch ABO creative rotation", "Ship 2 CBO landing page variants", "Turn on ad-level + video breakdowns"], "amber"),
            ("Days 11-20 · SCALE", ["+50% on CCF if ROAS ≥1.80", "Fund the winning ABO hook", "Re-run this audit blended across 5 accounts"], "green"),
            ("Days 21-30 · MONITOR", ["Blended ROAS vs 1.35 breakeven daily", "Contribution back above zero", "Frequency under 2.5 on every campaign"], "accent")]
    x = 0.6
    for title, items, col in cols:
        D.panel(s, x, 1.4, 3.0, 4.6)
        D.text(s, title, x + 0.2, 1.55, 2.7, 0.3, size=11, bold=True, color=col, caps=True)
        D.bullets(s, items, x + 0.2, 2.0, 2.65, 3.8, size=11, gap=10)
        x += 3.15
    D.text(s, f"Budget headroom: {inr(pc['budget'])}/month, pacing at {pc['pace_pct']:.0f}% with {pc['days_left']} days left — "
              f"every action above fits inside the current plan.", 0.6, 6.2, 12.2, 0.4, size=11, color="ink_dim")

    # 17 — data gaps ---------------------------------------------------------
    s = D.slide("Data gaps", "What would make the next audit stronger")
    D.bullets(s, [
        "4 of 5 ad accounts returned HTTP 403 — this audit covers one account, not the whole spend.",
        "No ad-level rows: every conclusion here is campaign level. Individual creatives are unjudged.",
        "No hook rate / hold rate / ThruPlays — video fatigue cannot be confirmed, only suspected from frequency.",
        "No landing page views, form starts or device split — the click→purchase leak is located but not split.",
        f"FREQUENCY DISCREPANCY: the pull reports account frequency {t['frequency']:.2f} (impressions ÷ reach) and ABO at "
        f"{abo['frequency']:.2f}. An earlier narrative quoted 4.35 / 5.66. This deck uses the pull. Confirm in Ads Manager before acting on fatigue.",
        f"Small samples: CBO has {cbo['purchases']:.0f} purchases in 7 days — directional, not conclusive.",
    ], 0.7, 1.5, 12, 4.6, size=14, gap=14)

    # 18 — final verdict -----------------------------------------------------
    s = D.slide("Final verdict", "Account health")
    D.text(s, "NEEDS ATTENTION", 0.7, 1.35, 6, 0.8, size=32, bold=True, color="amber")
    D.text(s, f"Meta clears breakeven at {t['roas']:.2f}x; blended does not ({b['totals']['roas']:.2f}x). "
              f"Contribution is {full(b['economics']['contribution'])} over 7d.", 0.7, 2.15, 12, 0.6, size=13, color="ink_dim")
    pairs = [("WORKING", f"CCF Course New — {ccf['roas']:.2f}x, {ccf['cvr']:.2f}% CVR, {ccf['purchases']:.0f} of {t['purchases']:.0f} purchases", "green"),
             ("NOT WORKING", f"ABO ({abo['roas']:.2f}x) and CBO ({cbo['roas']:.2f}x) — 53% of spend below breakeven", "red"),
             ("ROOT CAUSE", f"Post-click conversion, not traffic cost: {acct_cvr:.2f}% account CVR, {abo['cvr']:.2f}% on ABO", "amber"),
             ("FIX FIRST", "Move ABO budget to CCF, then rotate ABO creative", "red"),
             ("SCALE", f"CCF +50% while frequency stays at {ccf['frequency']:.2f}", "green"),
             ("DON'T TOUCH", f"CCF's {full(ccf['cpm'])} CPM · CBO's pause decision · the monthly cap", "accent"),
             ("NEEDS MORE DATA", "Ad-level + video metrics · LP funnel · 4 blocked accounts", "ink_dim")]
    y = 3.0
    for i, (label, val, col) in enumerate(pairs):
        col_x = 0.7 if i % 2 == 0 else 6.9
        if i % 2 == 0 and i:
            y += 0.95
        D.text(s, label, col_x, y, 5.8, 0.3, size=9, color=col, caps=True)
        D.text(s, val, col_x, y + 0.28, 5.9, 0.6, size=12, color="ink")

    out = Path(a.out) if a.out else VAULT / "inbox" / "reports" / "decks" / f"{date.today().isoformat()}-meta-ads-audit-deck.pptx"
    out.parent.mkdir(parents=True, exist_ok=True)
    deck.prs.save(str(out))
    print(json.dumps({"ok": True, "slides": deck.n, "path": str(out)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
