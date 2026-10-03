# ARGUS morning email

Recipient: rishi@echovme.com. Schedule: daily at 09:00 Asia/Kolkata, with one 10:00 catch-up attempt if needed. The existing Codex heartbeat `reconcile-trackocity-and-community-sales` coordinates the email and preserves two-day sales checks plus Monday weekly calibration. Keep this Mac on and Codex running; this is not a cloud sender schedule. Morning numbers use the most recent collector results (the existing metrics collector normally runs at 06:00).

## Configuration

Server-only `.env`: `RESEND_API_KEY`, `ARGUS_DIGEST_TO`, and `ARGUS_DIGEST_FROM` (an address on a verified Resend domain). The provided key is send-only: domain listing returned restricted_api_key. A verified sender is still required. Do not print credentials or use NEXT_PUBLIC variables for them.

## Commands

- Preview: `/usr/bin/python3 scripts/morning_digest.py`
- Send the authorized briefing: `/usr/bin/python3 scripts/morning_digest.py --send`
- Tests: `/usr/bin/python3 -m unittest discover -s scripts -p test_morning_digest.py`

Run from `/Users/rishijain/Downloads/argus`. Preview HTML/text and private delivery records live under `/Users/rishijain/the-vault/system/email-digests/`.

The email reads canonical marketing context, creative intelligence, sales reconciliation, and runner records. It includes actions, paid results and pacing, source-specific sales and reconciliation status, creative findings, workflow activity, and source health. It does not recompute marketing verdicts. Platform-attributed revenue is separate from transaction sales; unknown currency and missing data stay unknown. Activity reflects recorded ARGUS runs, not unrecorded work in other apps. The daily digest does not itself collect new browser sales or run paid Gemini analysis.

## Delivery safety

Sending is explicit (`--send`); previews never call Resend. Recipient is restricted to the user-authorized address. A process lock, per-IST-date outbox record, and Resend idempotency key protect against duplicate sends. Retries preserve the exact original request, including content, because Resend rejects changed payloads under the same key. Successful acceptance records the email ID permanently. An uncertain request older than 23 hours requires manual review instead of automatic retry beyond Resend's 24-hour deduplication window. Do not delete pending records after ambiguous network failures. If a request was definitively rejected and sender configuration must change, review its HTTP status before repairing the pending record. An API acceptance confirms submission, not inbox delivery; the current send-only key cannot inspect delivery events.

Source documents: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys

## Change reporting and setup status (2026-09-10)

Verified product changes come from `<vault>/system/argus-changes/*.json`, with `completed_at` (ISO timestamp), `status: "verified"`, `summary`, and nonempty `evidence`. Only the preceding 24 hours are included. Record an entry after completing and validating a change; file modification times are not evidence of shipped work. Missing records are explicitly described as no recorded changes.

The briefing also includes channel diagnostics, campaign recommendations from canonical records, blended economics and social/search metrics. Unavailable sources remain labelled rather than replaced with invented numbers.

A first briefing was accepted by Resend on September 10 using its testing sender `onboarding@resend.dev` and the account owner's authorized inbox. This was a one-command sender override, not a persistent production configuration. The Resend account has no domains configured; recurring production delivery remains blocked until a domain is verified and `ARGUS_DIGEST_FROM` is saved. The existing 09:00 IST automation and 10:00 catch-up are active. API acceptance is not confirmation of inbox delivery.
