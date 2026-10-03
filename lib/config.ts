import path from "path";
import { homeEnv } from "./homeEnv";

// ---------------------------------------------------------------------------
// Personal-machine config — ALL of it, in one place. Every value reads an env
// var (process.env first, then ~/.claude/.env) and falls back to a default
// that works on a fresh clone. ONBOARD.md walks through each one.
// Client components can't import this (server-only via homeEnv/fs); the two
// client-side values use NEXT_PUBLIC_ vars — see lib/voiceClient.ts and
// components/ReportOverlay.tsx.
// ---------------------------------------------------------------------------

/** Reads CONSOLE_* first, then the pre-rename HUD_* name. Existing
 *  ~/.claude/.env files still say HUD_TZ / HUD_USER_NAME, and the skills under
 *  ~/.claude/skills/ read HUD_TZ directly — honouring both keeps a machine
 *  that was set up before the rename working untouched. */
function consoleEnv(suffix: string): string | undefined {
  return homeEnv(`CONSOLE_${suffix}`) ?? homeEnv(`HUD_${suffix}`);
}

/** Vault root — the folder of plain files everything reads/writes.
 *  Defaults to the bundled starter vault so the console renders demo data
 *  before any setup. Point it at your real vault when ready. */
export const VAULT_ROOT =
  homeEnv("VAULT_ROOT") ?? path.resolve(process.cwd(), "starter-vault");

/** IANA timezone for "today" — daily notes, schedules, and the runner must
 *  all agree on this or dates flip near midnight UTC. */
export const CONSOLE_TZ = consoleEnv("TZ") ?? "America/Chicago";

/** Local voice-server (Kokoro TTS + faster-whisper STT). */
export const VOICE_SERVER_URL = homeEnv("VOICE_SERVER_URL") ?? "http://127.0.0.1:3108";

/** How the voice prompts refer to you ("<name>: <what you said>"). */
export const USER_NAME = consoleEnv("USER_NAME") ?? "User";
