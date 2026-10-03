# ARGUS data freshness

Repaired 2026-09-05.

- Sources ages are calculated from timestamps on each API state read. Health expires using the producer’s max_age_s (legacy fallback: 13 hours). Check ages are not the date range of the data.
- Existing alert callouts refresh their text when a flag changes and disappear when resolved; dismissed alerts are not recreated by this synchronization.
- Shared collector JSON updates use file locks and atomic replacement. CSV append/header creation is serialized.
- The Mac launch agent com.argus.metrics runs at 00:00, 06:00, 12:00 and 18:00 local system time, catching up on wake. The Mac must be on and the user logged in; this is not cloud execution.
- run_all.sh now propagates collector process failures/timeouts and rebuild failures instead of always exiting successfully. Individual source API failures remain explicit source statuses.
- Instagram now uses the existing Graph API connection for @rrishijain. It reads profile totals and posts from the preceding 28 days. Engagement is mean per-post (likes + comments) / current followers; cadence is count / four weeks. It does not estimate reach.
- Instagram credentials are in ~/.claude/.env, referenced by INSTAGRAM_ENV_FILE. Background launchd cannot read the original Desktop project’s .env due to macOS privacy controls. Credential rotations must update the collector configuration too.
- YouTube and TikTok return skipped/not-connected when configuration is missing; synthetic output requires explicit --force-mock.

## Remaining source setup

- Meta: one of five configured accounts is accessible. Four return HTTP 403; they remain included as coverage failures.
- GSC: the working shared Google OAuth identity returns an empty Search Console sites list and 403 for the configured property. Grant that identity access or reconnect an identity that owns the property.
- The Google OAuth fields in ARGUS’s project .env differ from the collectors’ working ~/.claude/.env. The project credentials returned invalid_client when tested, so the working collector credentials were retained.
- YouTube: YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID are missing. TikTok: TIKTOK_HANDLE is missing.

## Files and verification

Collector scripts: ~/.claude/skills/metrics-pull/scripts.
Schedule: ~/Library/LaunchAgents/com.argus.metrics.plist.
Logs: ~/.claude/skills/metrics-pull/logs, including scheduler stdout/stderr.
Pre-change backup: /tmp/argus-freshness-baseline.

Run npx tsx scripts/test-freshness.ts for presentation freshness and alert regression checks. Run /usr/bin/python3 -m unittest discover -s ~/.claude/skills/metrics-pull/scripts -p test_freshness.py for collector concurrency and Instagram derivation checks.
