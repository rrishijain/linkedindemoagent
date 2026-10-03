# Changelog

## Unreleased

- Numbers now behave like instruments: a dependency-free odometer
  (`NumberRoll` in `components/panels/shared.tsx`) rolls individual digits
  when a live value changes — KPI tiles, Search rows, pacing sub-figures,
  the blended band, the hub readout and plate chips on the reactor, the
  streak flame, and the top-bar clock (HH:MM only; seconds stay plain).
  The first value a mount sees never rolls, so boot still just fades in
  with wire-ignite, and reduced motion disables the roll. Sparkline
  coverage extended to series Python already wrote but nothing rendered:
  Google Ads spend under its Paid Media row, and GSC impressions as a
  faint second line behind clicks.

- AI Shorts: the AI Newsdesk panel now opens with a swipeable story deck of
  the last 24h — article image, headline, one-line summary; drag/arrow-keys/
  dots to move, tap to open, auto-advance every 12s. Powered by Tavily
  (`lib/newsShorts.ts` → `/api/ainews-shorts`; key `tavily` in argus/.env),
  server-cached 4h in memory AND `<vault>/system/ainews-shorts.json` so the
  free 1,000-credit month is never at risk. No key → the panel falls back to
  the free RSS headline list unchanged.
- Left column reordered: AI Newsdesk leads, Signals below it, then Paid
  Media, Search, Schedule. The Directives panel (Top-3 + Daily Drivers) is
  off the wall — the daily note and `/api/daily` still work; only the panel
  is gone.

- Centerpiece rebuilt as a machined reactor, to a reference: a brushed-steel
  housing of eight armour plates lit by one key light, amber light escaping
  through the joints, a stator ring gauging the month's pace, and the headline
  figure set into the dark hub. Each plate is a channel — its inlay carries the
  colour, the verdict's brightness and live activity, with that channel's own
  number engraved outside it. Same data rules as before: health is the verdict
  `marketing_context.py` wrote, never a judgement made in TS.
- `scripts/build_audit_deck.py`: builds an 18-slide Meta Ads audit deck from
  `marketing-latest.json` (numbers) plus a `/meta-ads-audit` report
  (narrative), reusing the report-deck house theme.

## 1.0.1

- Fix: the runner now spawns `claude -p` with `--dangerously-skip-permissions`.
  Headless runs are non-interactive, so the default permission mode silently
  denied the deliverable write — skills ran but produced no report. Required for
  any skill to write its output on a fresh install.
- Background skills now default to opus (`AGENTIC_OS_MODEL=claude-opus-4-8`) for
  the best report/research quality; onboarding offers sonnet/haiku for lower
  cost, and you can switch any time via Claude Code.
- Onboarding: new step scans your installed `~/.claude/skills` and offers to pin
  existing skills to the command deck and voice layer.
- Onboarding now runs `npm install` itself on a fresh clone — open Claude Code
  in the folder and it installs dependencies before the interview, no manual
  `npm install` needed.

## 1.0.0

Initial release.

- ARGUS-style console (Next.js, three.js orb, file-backed panels)
- Local voice loop: faster-whisper STT + Kokoro TTS, push-to-talk,
  optional wake word
- Three-tier intent router: rules → Claude Haiku (optional) → local
  Ollama model (optional) → rules floor
- Runner daemon executing skills via headless `claude -p`:
  morning-report, inbox-brief, plan-today, plan-tomorrow, vault-cleanup,
  voice-ask
- Claude Code onboarding: run `claude` in the repo, ONBOARD.md interview
  personalizes everything
- Starter vault with sample data — console renders on first boot, zero config
