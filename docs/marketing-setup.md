# ARGUS — marketing data setup (one-time)

Every secret lives in **`~/.claude/.env`** (uppercase keys). Nothing reads the
repo's `.env` / `.env.local` except Next's two `NEXT_PUBLIC_*` build vars.
All commands use `/usr/bin/python3` — the system Python that has python-pptx.

## 0. Migrate stray keys (done once, safe to re-run)

```bash
/usr/bin/python3 ~/.claude/skills/metrics-pull/scripts/migrate_env_local.py --clean
```

## 1. Google Ads (unlocks `google_ads` rows + Google decks)

Prereqs in the GCP project that owns `GOOGLE_ADS_CLIENT_ID`:
- **Google Ads API** and **Search Console API** enabled.
- OAuth consent screen **published** (test-mode refresh tokens expire in 7 days).
- Redirect URI `http://localhost:8765` on the OAuth client.
- Developer token at **Basic access** or higher (test tokens only read test accounts).

```bash
/usr/bin/python3 ~/.claude/skills/metrics-pull/scripts/google_oauth_setup.py        # → GOOGLE_ADS_REFRESH_TOKEN
/usr/bin/python3 ~/.claude/skills/metrics-pull/scripts/google_ads_discover_customer.py  # → GOOGLE_ADS_CUSTOMER_ID
```
If the account sits under a manager (MCC), also set `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
to the manager id (the discover script prints both).

## 2. Search Console (unlocks `gsc` rows, Search & AEO panel, SEO decks)

Option A (preferred): the refresh token from step 1 already carries the
`webmasters.readonly` scope — nothing more to do if the same Google account is
an owner/user of `sc-domain:digitalscholar.in`.

Option B: use the dedicated Search Console OAuth client (`GSC_CLIENT_ID`):
```bash
/usr/bin/python3 ~/.claude/skills/metrics-pull/scripts/google_oauth_setup.py --gsc-only  # → GSC_REFRESH_TOKEN
```

## 3. Meta — fix the four 403 accounts

`last-pull.json` shows `meta_ads: partial` because only `act_7320570008071386`
is reachable. In **business.facebook.com → Business Settings → Users → System
Users** (or the user that generated `META_ACCESS_TOKEN`), assign these ad
accounts with at least *View performance*:

`act_381390356801519` · `act_426649162707101` · `act_778643837056259` · `act_6758204914284162`

Then regenerate the token with `ads_read` + `read_insights` (+ `business_management`
for a System User). A **System User token never expires** — prefer it over a
60-day user token. Verify:
```bash
curl -s "https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name&access_token=$(grep ^META_ACCESS_TOKEN ~/.claude/.env | cut -d= -f2)"
```
All five ids should appear. Fill `META_APP_SECRET` if you want token refresh later.

## 4. Run everything

```bash
bash ~/.claude/skills/metrics-pull/scripts/run_all.sh
cat ~/the-vault/system/metrics/last-pull.json          # meta_ads / google_ads / gsc → ok
python3 -m json.tool ~/the-vault/system/metrics/marketing-latest.json | head -40
```

The 6-hourly launchd job `com.argus.metrics` runs the same script.

## What gets written

| File (under `<vault>/system/metrics/`) | Written by | Read by |
|---|---|---|
| `metrics.csv` | every `pull_*.py` | console sparklines (`lib/vault.ts readMetrics`) |
| `history/meta-daily.csv`, `google-daily.csv`, `gsc-daily.csv` | pull scripts (90-day upsert) | `marketing_context.py` |
| `ads-latest.json`, `seo-latest.json`, `aeo-latest.json`, `ig-latest.json` | pull scripts | dashboard, context |
| `last-pull.json` | `_common.update_snapshot` | Sources panel, DATA chip |
| `marketing-latest.json` | `marketing_context.py --write-latest` | **Console** (`VaultState.marketing`) |
| `context/<scope>-<range>d.json` | `marketing_context.py --write` | perf-report, report-deck |

Targets (breakeven ROAS, CPA ceilings, monthly budget…) live in
`<vault>/ops/targets.md` frontmatter and drive every verdict and colour.

---

# Publishing (Phase 4)

## Blog — `ds-blog-publish`
Runs the existing **ds-seo-agent** project headlessly (`runner.js` spawns
`claude -p` with `cwd` = the project, so its CLAUDE.md, rules, skills and
`.env` load). Say *"publish a blog post about <topic>"* (live) or add *"as a
draft"* (WordPress draft, no verification). Deck button = next topic from the
cluster backlog. Safeties: slug dedupe against `output/blog-registry.md` and
`<vault>/system/publish-ledger.json`, **2 live posts/day cap** (runner-enforced),
50-min timeout, opus.

Env (project `.env`, already set): `WP_SITE_URL`, `WP_USERNAME`,
`WP_APPLICATION_PASSWORD`, `WP_AUTHOR_ID=270`, `GEMINI_API_KEY`.
Override the project location with `DS_SEO_AGENT_DIR` in `~/.claude/.env`.

## Carousel — Digital Scholar (retired 2026-08-21)

`ds-carousel-publish` was unwired from ARGUS: one carousel agent is enough, and
the DS Instagram token had been dead since 2026-07-15. The `carouselagent-DS`
project still sits on disk, works standalone, and keeps the account guard and
`--dry-run` that were added here — rewiring it means restoring the skill name to
`ALLOWED_SKILLS`, `SKILL_CWD`, `DECK_GROUPS` and the router aliases, and getting
a token for @digital_scholar first (add that page to the same System User that
already serves @rrishijain, and it never expires).

## News carousel — `news-carousel`

A **different account and a different pipeline** from the DS carousel above.
Runs **rrishijainxCarousel-Final** headlessly via its `/news-carousel-publish`
skill: scan today's AI news → two-source verify → write → Gemini render →
`verify_slides.mjs --fix` vision QA → host → post to **@rrishijain**.
Say *"break the news"*, *"publish a news carousel about <story>"*, or add
*"as a draft"* for a dry run. **1 live carousel/day**, 45-min timeout, opus.

Shipping nothing is a valid outcome: if no story clears the three gates in
`.claude/rules/story-selection.md`, the run writes a `no-story` note and stops.

### Credentials (already working — nothing for you to do)
The project `.env` holds a Meta **System User token that never expires**, with
`instagram_content_publish`, in app `2003009497320905`. Verify any time:
```bash
cd "…/CarouselsAgents/rrishijainxCarousel-Final"
node scripts/check_instagram.mjs   # token, scopes, and which handle it reaches
node scripts/check_media.mjs       # the WordPress media host
```
`IG_BUSINESS_ACCOUNT_ID` must be the **Instagram user id** `17841401018203376`,
not the Page id `679761555231753`. It was set to the Page id, which fails with
"does not support this operation" — the July post shipped from Modal, whose
secret store had the right one. Corrected on 2026-08-21.

`publish_instagram.mjs` refuses to post unless the token's handle equals
`IG_EXPECTED_USERNAME` (`rrishijain`). Exit codes: 3 guard · 4 slug already live.

### Slide hosting
Instagram will only fetch slides from a public https URL. `upload_wp.mjs` puts
them in the **digitalscholar.in media library** (uploads are attributed to the
admin user, id 1) and `--cleanup` removes them again after the post, since
Instagram keeps its own copy. R2 is the alternative if you ever want the slides
off the WP site — `upload_images.mjs` already speaks it, it just needs
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE`.

### The cloud twin
`deploy/modal_app.py` is deployed and still running its own crons (every 30 min
20:30–02:30 IST, hourly 07:00–16:00, every ~2h otherwise), staging decks at
`rishi-70867--breaking-ai-carousel-review.modal.run` with Approve / Reject
buttons. That URL has **no authentication** — anyone holding it can publish to
@rrishijain. Two independent systems now write to one account: if you don't
want both, shut the Modal crons down (`modal app stop`) or keep ARGUS to
`--dry-run`.

## Ledger
`<vault>/system/publish-ledger.json` — `{"entries":[{kind, slug, url, ts, run_id, dry_run}]}`.
Written by the skills, read by the runner for the daily caps. Delete an entry
to allow a re-publish of the same slug.

## Reports
- `perf-report` (AI) → `inbox/reports/perf/`; `report-deck` (direct-exec PPTX + HTML)
  → `inbox/reports/decks/`, served to the console by `/api/file`.
- Weekly: `com.argus.weekly-deck` (launchd, Mon 08:30) enqueues a blended
  7-day deck through the runner so it shows on the wall and is spoken.
