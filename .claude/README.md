# `.claude/` — Claude Code configuration for ARGUS

This directory follows the canonical Claude Code layout
(https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/skills).

| Path                   | Scope                          | Committed? |
| ---------------------- | ------------------------------ | ---------- |
| `settings.json`        | Everyone who clones the repo   | yes        |
| `settings.local.json`  | You, this project only         | no (gitignored) |
| `skills/<name>/SKILL.md` | Project skills → `/<name>`   | yes        |
| `agents/<name>.md`     | Project subagents              | yes        |
| `commands/<name>.md`   | Legacy slash commands (skills supersede these) | yes |
| `hooks/`               | Scripts referenced by `hooks` in settings, via `${CLAUDE_PROJECT_DIR}/.claude/hooks/...` | yes |

`CLAUDE.md` stays at the repo root — that is its canonical location, not in here.

## Where ARGUS's skills actually live

The 22 skills ARGUS drives (`metrics-pull`, `perf-report`, `report-deck`,
`seo-audit`, …) are **personal** skills under `~/.claude/skills/`, not project
skills. That is deliberate: `runner/runner.js` launches `claude -p` with `cwd`
set to other agent projects (`SKILL_CWD`), where a project skill in *this*
repo would not resolve. Personal skills load regardless of cwd.

`skills/` here is scaffolded for skills that are genuinely about this repo and
should be version-controlled with it.
