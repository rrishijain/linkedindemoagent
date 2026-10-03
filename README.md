# ARGUS

## Jarvis personal setup in this workspace

The home page is now **Jarvis**, a red and black personal command center.
It saves today's priorities, focus and time blocks to the private local vault
in `.argus-local/vault/`; **Ask Jarvis** uses the installed Codex CLI. The
original ARGUS marketing console is at `/marketing`. Its Claude runner and
publishing commands are disabled in this setup.

The app is running at <http://127.0.0.1:3107>. To restart it later, run
`npm run build` and `npm run start` from this folder. See
[`docs/jarvis-build-map.md`](docs/jarvis-build-map.md) for the full extraction,
connection status and next build steps.

---

A voice-controlled, ARGUS-style heads-up display for your own life —
**local-first**, file-backed, with a background Claude agent doing the heavy
thinking. Hold Space, talk; it answers in under a second, dispatches real
work to a queue, and speaks the results when they land. Every glyph on
screen traces to a real file. No theater.

**The fastest path to "it's mine": run `claude` in this folder.** Claude
Code reads `ONBOARD.md` and interviews you — vault location, timezone, your
metrics, your voice — applying every edit for you. The rest of this README
is for humans who want to understand or do it by hand.

## Quickstart (2 minutes to a living console)

```bash
npm install
npx next dev -p 3107        # → http://localhost:3107
```

That's it for the visual demo — the console boots against the bundled
`starter-vault/` with sample data. Three more pieces make it real:

1. **The runner** (background skill executor): `node runner/runner.js` in a
   second terminal. Needs the `claude` CLI installed and logged in.
2. **Voice** (optional, fully local): see [Voice server setup](#voice-server-setup).
3. **Your vault + your data**: run `claude` here and let onboarding wire it,
   or follow `ONBOARD.md` manually.

**Day-to-day**: open `claude` in this folder and say **"spin up ARGUS"** —
it starts whatever isn't running (voice server, runner, console) detached, so
everything survives closing the terminal. Want it automatic at login? Tell
Claude "make ARGUS start on boot" and it wires the startup shortcuts
(`start-console.vbs`, `runner/start-runner.vbs`,
`voice-server/start-voice-server.vbs`).

## How it works

**Full visual explainer: [`docs/architecture.html`](docs/architecture.html)**
— open in any browser, works offline. The short version:

```
┌──────────────────────────── YOUR MACHINE ────────────────────────────┐   ┌─ CLOUD (opt) ─┐
│                                                                      │   │               │
│  Browser console ── Next.js server ─── THE VAULT ─── Runner daemon ──┼───┼─ Anthropic    │
│  :3107 orb/PTT    :3107 router        plain files    polls queue,    │   │  API          │
│       │           rules→Haiku→qwen    md/json/csv    spawns headless │   │  · Haiku route│
│       │                │                             claude -p       │   │  · claude -p  │
│  Voice server :3108 ───┘              Ollama :11434                  │   │    (tier 3 +  │
│  Kokoro TTS · whisper STT             offline router fallback        │   │     skills)   │
└──────────────────────────────────────────────────────────────────────┘   └───────────────┘
```

- **Voice never leaves your machine** — STT (faster-whisper) and TTS
  (Kokoro) run locally; push-to-talk round trip is 175–500ms on a GPU.
- **Three router tiers**: 1 = dispatch a skill (intent JSON → queue),
  2 = instant answer from the vault snapshot (~25ms), 3 = background
  headless-Claude ask, answer spoken when it lands.
- **Mental model**: the voice layer is a dispatcher, not a worker. Files
  are the message bus — every step of every job is inspectable on disk.

## Repo structure

```
argus/
├── CLAUDE.md                     project instructions for Claude Code
├── .claude/                      Claude Code config (canonical layout)
│   ├── settings.json             shared, committed
│   ├── settings.local.json       yours only, gitignored
│   ├── skills/<name>/SKILL.md    project skills → /<name>
│   ├── agents/<name>.md          project subagents
│   ├── commands/<name>.md        legacy slash commands
│   └── hooks/                    hook scripts
├── app/                          Next.js routes + /api handlers
├── components/                   Console.tsx, WireCore, panels/
├── lib/                          vault reads, router, voice, engagement
├── runner/                       the background skill executor
├── voice-server/                 Kokoro TTS + faster-whisper STT (:3108)
├── scripts/                      test-router, enqueue-intent, benches
├── docs/                         architecture.html, marketing-setup.md
└── starter-vault/                sample vault so a fresh clone renders
```

The skills ARGUS dispatches (`metrics-pull`, `perf-report`, `report-deck`, …)
are **personal** skills in `~/.claude/skills/`, not project skills — the runner
spawns `claude -p` with `cwd` set to other agent projects, where a project
skill in this repo would not resolve. See [`.claude/README.md`](.claude/README.md).

## Vault structure

```
VAULT_ROOT/                       (default: ./starter-vault)
├── system/
│   ├── queue/                    intents written by console, claimed by runner
│   ├── runs/                     run records + logs (*.json, *.md)
│   ├── metrics/
│   │   ├── metrics.csv           timestamp,source,metric,value,status,error
│   │   └── latest-video.json     newest upload stats (optional)
│   ├── schemas/daily-note.md     frozen daily-note contract
│   └── runner-status.json        runner heartbeat (written by runner)
├── daily-notes/YYYY-MM-DD.md     priorities, schedule, focus
└── inbox/
    ├── reports/morning/          morning briefings (feeds the AI Wire)
    └── voice/                    voice-ask answers
```

Everything degrades gracefully: missing files render as empty panels, a
dead runner shows RUNNER OFFLINE, missing voice-server returns a clean 503.

## Configuration

All env vars are read from your shell or `~/.claude/.env` (a plain
`KEY=value` file; process env wins). `NEXT_PUBLIC_*` vars go in `.env.local`
in the repo root instead (they're inlined into the client at build).

The `CONSOLE_*` vars were called `HUD_*` before the rename. Both spellings
are still read (`CONSOLE_*` wins), so an existing `~/.claude/.env` keeps
working untouched.

| Var | Purpose | Default |
|---|---|---|
| `VAULT_ROOT` | vault folder | `./starter-vault` |
| `CONSOLE_TZ` | IANA timezone for "today" (console + runner) | `America/Chicago` |
| `CONSOLE_USER_NAME` | how voice notes refer to you | `User` |
| `AGENTIC_OS_MODEL` | model for background `claude -p` runs | `claude-opus-4-8` |
| `ANTHROPIC_API_KEY` | enables Haiku intent routing (~$0.002/ask) | unset (optional) |
| `VOICE_ROUTER` | force router engine: `auto`/`rules`/`haiku`/`local` | `auto` |
| `VOICE_ROUTER_MODEL` / `OLLAMA_URL` | local routing fallback | `qwen3.5:4b` / `:11434` |
| `VOICE_SERVER_URL` | TTS/STT server | `http://127.0.0.1:3108` |
| `KOKORO_VOICE` / `KOKORO_SPEED` | TTS voice + speed | `bm_george` / `1.0` |
| `WHISPER_MODEL` / `WHISPER_PROMPT` | STT model + vocab bias | `small.en` / built-in |
| `KOKORO_DEVICE` / `WHISPER_DEVICE` | force `cpu` if CUDA misbehaves | auto |
| `WAKE_WORD` | hands-free wake word (`on`/`off`) | `off` (speaker bleed) |
| `NEXT_PUBLIC_OBSIDIAN_VAULT` | Obsidian vault name for deep links | unset (link hidden) |
| `NEXT_PUBLIC_VOICE_WS` | wake-event websocket | `ws://127.0.0.1:3108/events` |

⚠️ `ANTHROPIC_API_KEY` belongs in the `~/.claude/.env` FILE only — set as a
system-wide env var it flips your interactive `claude` CLI from
subscription to API billing.

## Voice server setup

Fully local TTS + STT. One-time setup (Windows; Mac/Linux analogous):

```bash
cd voice-server
python -m venv .venv
.venv/Scripts/pip install kokoro-onnx fastapi uvicorn soundfile faster-whisper ^
  onnxruntime-gpu nvidia-cudnn-cu12 nvidia-cublas-cu12 nvidia-cufft-cu12 ^
  nvidia-cuda-runtime-cu12 nvidia-curand-cu12
# CPU-only machines: replace onnxruntime-gpu + nvidia-* with plain onnxruntime
```

Download `kokoro-v1.0.onnx` (~325MB) and `voices-v1.0.bin` (~28MB) from the
[kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases)
into `voice-server/`. Start: `voice-server\start-voice-server.vbs` (hidden)
or `.venv/Scripts/python server.py`. GPU gives ~250ms/sentence TTS and
~130ms STT; CPU works at ~4x slower.

**Pick your voice**: `python make_samples.py` regenerates `samples/` +
open `audition.html`, pick, set `KOKORO_VOICE`/`KOKORO_SPEED`, restart.

**Wake word (optional)**: `pip install --no-deps openwakeword` then
`pip install sounddevice requests tqdm scikit-learn websockets` —
`--no-deps` is LOAD-BEARING (bare install overwrites onnxruntime-gpu with
the CPU build). Then `python -c "from openwakeword.utils import
download_models; download_models(['hey_jarvis_v0.1'])"`. Off by default:
without headphones the wake mic hears the console's own speech.

## Using it

- **Hold Space** — push-to-talk. "Brief me" / "good morning" = the spoken
  rundown. "What's in the queue", "how many subscribers do I have" =
  instant answers. "Run the inbox brief" = dispatch. Anything open-ended =
  background ask, spoken when ready.
- **Esc** stops speech; clicking a Documents row opens the report overlay;
  Directives checkboxes are clickable (today's note only).
- **TRANSCRIPT** (bottom-left) shows the voice conversation ring; RESET
  clears it.
- **Demo modes** (no data needed): `?demo=callouts` seeds doc callout
  cards, `?demo=taskwork` plays the full task-callout lifecycle. Keys 1–5
  force core modes, B cycles backgrounds.

## Security

This is a localhost app with **no authentication by design** — the API can
queue real work and read vault markdown. Never bind it to `0.0.0.0`, never
port-forward 3107/3108, never run it on a shared machine you don't trust.

## Mac/Linux notes

Everything is Node/Python and runs cross-platform; the two `.vbs`
launchers are Windows conveniences — use `node runner/runner.js &` and
`python voice-server/server.py &` (or launchd/systemd). On Apple Silicon
use plain `onnxruntime` (CPU) or set `KOKORO_DEVICE=cpu`/`WHISPER_DEVICE=cpu`.

## Customizing

`ONBOARD.md` is the map: an interview script Claude Code runs for you, plus
an Edit Manifest listing every personalization touchpoint — skill roster,
voice aliases, the load-bearing spoken-offer wording, metrics panels, the
morning-report research beat. Quality gates after any `lib/` change:
`npm test` (16-case router sweep, no API spend) + `npx tsc --noEmit`.
