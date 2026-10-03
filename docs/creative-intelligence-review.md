# Creative Intelligence review — 9 September 2026

ARGUS now turns a creative observation into an evidence-linked test and an objective-specific brief inside the existing Creative Intel overlay. The next priority is better source coverage and a record of actual test results.

## What changed

- **Next moves:** an initial view for active ads, ordered by measured review priority, then spend within an account and currency. It explains the suggested action and missing evidence. Inactive ads remain historical references.
- **Referenced observations:** Gemini identifies what it saw, which asset or ad copy supports it, and a timestamp when actual video is available. Each proposed test cites those references.
- **Specific test plans:** one variable, an exact change, a hypothesis, what to keep constant, and a diagnostic. The final success measure continues to follow the campaign objective.
- **Earlier diagnostics:** CTR decline and repeated exposure are shown separately from the stricter combined fatigue signal. Low conversion volume no longer hides every useful attention diagnostic.
- **Better briefs:** Bulk Creatives receives evidence, review flags, reporting dates, the control reference, baseline, success measure and limitations. Factual conflicts and typos are explicitly separated from the experiment. Editing a test does not silently retain a different test's hypothesis metadata.
- **More honest coverage:** poster-only media, thin samples, missing peers, old observations and performance snapshots older than 30 hours are explicit. Pattern groups separate attribution settings, optimization goals and timezones.
- **Safer upgrades:** previous usable observations survive a failed reassessment. Analysis remains cached and bounded; opening the overlay does not start a paid job.

## What is available today

Source: local Creative Intelligence snapshot refreshed **9 September, 15:31 IST**. Current results cover **2–8 September**, compared with **26 August–1 September**. Today is excluded.

| Coverage | Verified result |
| --- | --- |
| Meta accounts | 1 of 5 configured accounts accessible: Rishi Jain Ai Courses |
| Ads loaded | 40 of 130 ads in that account, covering 94.8% of current-window spend |
| Delivery status | 24 active; 15 paused through campaign or ad set; 1 disapproved |
| Accessible media | 21 image creatives; 19 poster-only creatives; no full videos |
| Eligible ad-set comparisons | 0 of 40 currently have enough comparable evidence |
| Combined fatigue | All 40 have insufficient evidence under the existing rules |
| Early diagnostics | 7 ads have attention or repeat-exposure diagnostics |
| New Gemini assessments | 10 completed successfully: 9 images and 1 poster |
| Remaining assessment work | 30 need initial assessment or an upgrade; usable older observations remain visible |

These are account and sample limits, not an assessment of every Digital Scholar creative. The four inaccessible accounts remain listed in coverage. Increasing the ad cap may recover more peers, but cannot resolve low outcome counts or unavailable access.

## Findings worth acting on

These observations were checked against the downloaded images and stored ad copy, independently of the proposed performance hypotheses.

| Creative | Observed issue | Useful next action |
| --- | --- | --- |
| **Angle3** — ad ending 4530750 | The audience line visibly says “FREELASCERS & AGENCY OWNERS.” | Correct the typo. Treat factual corrections separately from creative experiments. |
| **Angle 3** — ad ending 4600750 | Image says “25 HOURS”; contextual ad copy says “8+ hours.” | Clarify whether these mean total content, bonuses or core recordings. Make the distinction consistent across the image, copy and landing page. |
| **Certificates** — ad ending 6510750 | A “30-day plan” image lists only days 1–14. | Label it as a preview or show a verified complete overview. Do not invent days 15–30. |
| Several assessed statics | Dense tool lists, small typography and competing messages recur in observations. | Test one simpler hierarchy against the existing creative. Keep the offer and audience comparable; evaluate the campaign outcome alongside CTR. |

The copy in these ads has multiple delivery variants. The feed cannot identify which individual caption produced an outcome. These findings justify checking the materials; they do not prove the cause of low ROAS.

## What to build next, in priority order

1. **Original-video access and an asset library.** Repair Meta media access or add a private upload linked to the ad/creative ID. Record the media version and checksum. Then assess the actual opening, spoken message, demonstrations, proof, CTA timing and pacing. Gemini supports video inputs and timed observations; our present limitation is the supplied source material. [Gemini video documentation](https://ai.google.dev/gemini-api/docs/video-understanding).

2. **Video retention diagnostics.** Bring in available 3-second views, ThruPlays, watch time and completion quartiles with clear denominators. Compare within placement and duration bands. Connect attention drop-off to observed moments where the available data permits it; aggregate quartiles do not identify an exact second of abandonment.

3. **A test-results loop.** Save a test ID with the brief, control, changed variable, owner and planned budget/duration/sample. Attach the launched variant ad IDs, retrieve their results, and record “supported,” “not supported” or “inconclusive.” Save learnings by product and audience so the next brief uses previous experiments. This is the highest-value database use case for Creative Intelligence.

4. **Approved product facts and landing-page checks.** Store verified prices, course duration, curriculum, offers, claim sources and validity dates. Compare the image, copy and landing page against those facts. Separate corrections from experiments. This would turn today's manually verified duration and syllabus findings into repeatable checks and reduce ungrounded creative suggestions.

5. **Sales-quality outcomes.** Link campaign and ad identifiers to available Trackocity/Community attribution evidence, with matched and unmatched coverage shown. Keep paid sales, refunds and net revenue distinct from platform-attributed purchases. Do not assign customer sales to a creative where attribution is missing. Lead campaigns need qualified-lead or enrolment outcomes before claiming lead quality.

6. **Placement previews and creative history.** Review safe areas, legibility at feed size, caption placement and format fit. Track creative versions and refresh dates. Combine this with audience/placement delivery changes before attributing deterioration to fatigue.

The useful output should be: **what was observed → why it deserves attention → one change to test → how to measure it → what actually happened**. Expected uplift should remain unclaimed until a suitable experiment supports it.

## Verification

- 27 Python evidence/assessment checks and 13 TypeScript integration checks passed.
- 42 existing router checks passed; TypeScript and production build passed.
- Two live pilots plus an eight-creative batch completed without Gemini errors.
- The running local API reports the new observation format and decision context for all 40 ads.
- Live Chrome checks passed for the default desktop layout, 390 px and 320 px mobile widths, campaign/search filters, pattern drill-through, evidence/test selection, brief creation, keyboard tab navigation and Escape dismissal. The temporary viewport override was reset.

No campaign edits or publishing were performed. Bulk Creatives' draft handoff was verified in an isolated test vault.
