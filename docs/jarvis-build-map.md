# Jarvis build map

## What is running now

- **Personal home (`/`)** — red and black dashboard for three priorities, focus, and manual time blocks. It saves to a plain Markdown daily note in `.argus-local/vault/daily-notes/`.
- **Ask Jarvis** — calls the installed Codex CLI through `/api/ask`, using the user's Codex sign-in. It receives today's saved plan as context and answers in read-only mode. It does not read Google accounts from the local app.
- **Marketing console (`/marketing`)** — the original ARGUS console, rebranded and themed for Jarvis. Its panels render empty until real marketing feeds are connected.
- **Safety boundary** — the original Claude runner is not started, and `JARVIS_DISABLE_LEGACY_SKILLS=1` disables its queue actions, including publishing. The app binds to `127.0.0.1:3107`.
- **Private files** — `.env.local`, `.argus-config.json`, and `.argus-local/` are excluded from source control.

## What came from ARGUS

| Layer | Existing implementation | Jarvis decision |
|---|---|---|
| Interface | Next.js console, Horizon city, marketing panels, report overlays, voice UI | Keep as the marketing view; personal home is simpler and comes first. |
| Vault | Markdown daily notes/reports, JSON queue/runs, CSV metrics | Keep plain files and a separate personal vault with no sample metrics. |
| Router | Rules, optional Anthropic routing, optional Ollama fallback | Legacy route remains in code; no Claude services configured. |
| Background work | `runner/runner.js` executes `claude -p` and installed Claude skills | Off. Rebuild approved jobs with Codex before enabling them. |
| Voice | Local Python Whisper/Kokoro server and browser push-to-talk | Optional later; not installed in the first setup. |
| Marketing | Meta/Google Ads, Search Console, reports, creative analysis and publishing pipelines | Interface retained; no live data or publishing credentials copied to the personal vault. |
| Security | Localhost origin guard; no login | Keep localhost only. Add authentication before any remote access. |

## Requested sources

| Source | Access in this Codex chat | Access in the local Jarvis app | Next implementation |
|---|---|---|---|
| Google Calendar | Connected; primary calendar found | No automatic sync | Read-only OAuth connection and event import, with timezone and calendar selection. |
| Gmail | Connected | No automatic sync | Read-only inbox summary; ask before drafting or sending. |
| Google Tasks | No connector in this setup | No sync | Google Tasks OAuth read, then decide whether Jarvis or Tasks owns edits. |
| Notion | Plugin not installed | No sync | Identify the databases/pages that should be included. |
| Slack | Plugin not installed | No sync | Select relevant channels and define read-only digest rules. |

The Codex chat's connected app access is not automatically available to a local Next.js process. Jarvis must receive its own supported authorization before it can show live account data. Until then, the dashboard labels these connections as pending.

## Existing feature inventory

- **Dashboard data:** `lib/vault.ts` reads the daily note, metrics CSV, marketing snapshot, queue, run history, morning report, and engagement records for `/api/state`. Missing files become empty states.
- **Marketing panels:** AI Newsdesk and shorts, Signals, Paid Media, Search/AEO, Sources, Pacing, Shipped work, Decision Queue, and Command Deck. A creative intelligence overlay analyzes ad media and saves briefs. The original data and targets are not in the new vault.
- **Agent commands:** the legacy roster includes planning, inbox summaries, morning reports, data pulls, Meta/Google/SEO/AEO audits, reports and decks, competitor intelligence, creative batches, blog publishing, and Instagram carousel publishing. The roster is disabled in this setup.
- **Voice pipeline:** browser push-to-talk and transcript routes feed rules/optional LLM routing; a local Python server supplies Whisper transcription and Kokoro speech. The runner would process longer requests in the background. None of these services are required for the current personal page.
- **External systems in the old setup:** Anthropic/Claude, optional Ollama, Google/Meta/Search Console APIs, Gemini/KIE image generation, Tavily news search, publishing projects, and personal skills in `~/.claude/skills/`. Their configurations are specific to the original owner and are not copied into Jarvis.
- **Important coupling:** original skills are declared in `lib/skills.ts`, routed in `lib/router.ts`, presented in `components/panels/CommandDeck.tsx`, and executed in `runner/runner.js`. Enabling one means replacing all Claude assumptions, validating inputs, and adding a deliverable path.

## Files to work in next

| Goal | Starting files |
|---|---|
| Add a connected agenda | `components/PersonalConsole.tsx`, `app/api/personal/route.ts`, new server-side Google authorization and sync modules |
| Add Gmail summary | new read-only mail adapter and personal dashboard card |
| Replace Claude background runner | `runner/runner.js` as reference, new Codex runner; keep action allowlists and run records |
| Add marketing metrics | `lib/vault.ts`, `components/panels/`, `docs/marketing-setup.md` |
| Add voice | `voice-server/`, `lib/voiceClient.ts`, `lib/router.ts` after text commands are stable |

## Run it

From this folder, run `npm run start` after `npm run build`, then open <http://127.0.0.1:3107>. For development, use `npm run dev`. Keep only one server mode running at a time because both use the same `.next` output directory.

## Next build order

1. Google Calendar read-only agenda and Google Tasks import.
2. Gmail triage summary with source links; no automatic sends.
3. A Codex task runner with scoped, reviewable actions and run history.
4. Marketing metrics connectors and user-selected KPIs.
5. Optional voice after text workflows feel right.
