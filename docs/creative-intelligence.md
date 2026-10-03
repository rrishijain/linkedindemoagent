# Creative Intelligence

Open **Command Deck → Creative Intel** on the existing console. This feature is an overlay; it does not replace the console or add a separate application.

## Workflow

1. **Sync Meta** reads ad-level results for the last two complete seven-day windows, in each account's timezone. It loads the highest-spend ads across those windows, with account and spend coverage shown explicitly.
2. **Next moves** opens first. It shows which active ads can be compared, which have only poster evidence, and how many have referenced observations. Review priority comes from Python's performance and fatigue rules; Gemini does not choose winners. Paused and disapproved ads remain available in Creatives as historical references.
3. **Analyze next 8** uses Gemini to observe available images, videos and ad copy. It prioritizes active ads with original media, then spend, and upgrades older assessments to the current evidence format. Existing observations are cached by the submitted media, copy, model and observation schema. A failed upgrade retains the previous usable assessment. Opening the view does not run paid analysis.
4. **Creatives** shows measured outcomes, comparable ad-set peers, fatigue evidence and Gemini's observations. Every new proposed test cites specific evidence and states one variable, an exact change, a hypothesis, constants and a diagnostic. Evidence identifies ad copy or an asset number; timestamps are accepted only for actual video. Search by ad name, hook or offer, or filter by campaign and evidence status.
5. **Patterns** compares hooks, offers, formats and visuals within account, campaign, outcome metric, optimization goal, currency, attribution settings and timezone. Small samples stay marked. A poster is not treated as evidence of a video's opening hook. Copy variants and individual assets inside flexible bundles are not credited with the bundle's results.
6. Choose or edit one proposed experiment and **Create brief**. Saved briefs retain source identifiers, reporting dates, measured evidence, evidence references, review flags, limitations and production constraints. The measurement plan identifies the control, baseline and campaign outcome. Factual conflicts and typos must be resolved separately from the creative experiment. Editing a suggested test removes its structured hypothesis metadata instead of silently attaching unrelated evidence.
7. **Draft 3 variants** sends the saved brief into the existing Bulk Creatives runner as a draft-only intent. It produces copy and visual directions for review; this action does not render images, alter campaigns or publish ads.

## Evidence rules

Python computes all marketing comparisons in `scripts/creative_intelligence.py`. Gemini receives creative material, not performance metrics, and does not decide winners.

- Sales use purchase ROAS where purchase values are available in the ad-set cohort, otherwise purchase CPA. Lead, traffic, engagement, video-view and awareness objectives use their supported outcome. Unsupported outcomes remain unranked.
- Peer comparisons require the same account, ad set, objective metric, currency and attribution settings, and a different creative. Each eligible ad needs 1,000 impressions and 10 objective events. A 20% difference is a screening threshold, not statistical significance.
- Possible fatigue requires at least three delivery days and sufficient volume in both windows, a 20% link-CTR decline, a 20% deterioration in the objective metric, and frequency rising at least 15% to 2.5 or above. Other causes remain possible.
- Early attention diagnostics can appear without a fatigue verdict: a 20% link-CTR decline needs 1,000 impressions and 30 link clicks in each window. Frequency at or above 2.5 is a separate exposure diagnostic. Neither alone proves creative fatigue.
- Pattern values use totals, not an average of ad ratios. A descriptive sample requires two distinct creatives and sufficient aggregate volume. Audience and placement differences remain.
- Missing purchase value is distinguished from a genuine zero. Unique reach and frequency are never summed across periods.
- Snapshots older than 30 hours are visibly flagged, including in newly saved briefs. Refreshing Meta updates performance dates; reanalyzing cached creative material does not make performance fresher.
- Observation confidence concerns what Gemini can see or hear, not the probability that a test will improve conversions. The screening floors are not statistical power calculations; tests still need a budget, duration and sample plan.

## Current limits and next work

The current observation format is `observations-v3`. Older usable assessments stay visible and have an upgrade action. Uploaded Gemini files are temporary and deleted after assessment when possible. Combined inline media is limited to 12 MB; larger inputs use Gemini Files.

The feed currently has no video retention curve, CRM-qualified lead outcome, landing-page audit or launched-test results loop. Original video access depends on Meta permissions; reassessing a thumbnail does not recover audio or motion. Bulk Creatives currently drafts static variants. See [the September 9 review](creative-intelligence-review.md) for measured coverage, verified findings and the recommended implementation order.

## Configuration and storage

Keep `GEMINI_API_KEY` in ARGUS's ignored `.env`. It is read again when starting a job, so saving the key does not require a server restart. The same key is forwarded only to Bulk Creatives child processes. Keys and remote media URLs are not returned by the API or written into briefs.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_VISION_MODEL` | `gemini-3.8-flash` | Vision model |
| `CREATIVE_INTEL_BATCH_SIZE` | `8` | Assessments per requested batch, maximum 20 |
| `CREATIVE_INTEL_MAX_ADS` | `40` | Ads per accessible account, maximum 100 |
| `CREATIVE_INTEL_PYTHON` | `python3` | Python executable, Python 3.9+ |

Meta uses the existing `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_IDS` / `META_AD_ACCOUNT_ID`, and `META_API_VERSION`. Inaccessible configured accounts remain visible as coverage gaps.

State, media, cached observations, job logs and saved brief records live under `<vault>/system/creative-intelligence/`. Brief Markdown is also written under `<vault>/inbox/reports/creatives/`. Detached workers survive a Next restart. A stopped worker preserves completed observations and requires a new requested batch; jobs are not automatically replayed. Duplicate brief submissions are blocked.

## Verification

Run `npm run test:creatives`, `npm test`, `npx tsc --noEmit` and `npm run build`. Creative tests use an isolated temporary vault and make no external API calls or live workflow submissions. Browser checks should cover the modal, campaign/search filters, pattern drill-through, brief creation, keyboard dismissal and mobile layout.
