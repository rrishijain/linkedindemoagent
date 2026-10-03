import { normalizeForSpeech } from "./spokenText";
import { VOICE_SERVER_URL } from "./config";
import { homeEnv } from "./homeEnv";

// ---------------------------------------------------------------------------
// speak(text) → audio stream. The ONE place TTS vendors live.
// Engines, in order:
//   1. ElevenLabs (Rishi's cloned voice) — used whenever ELEVENLABS_API_KEY +
//      ELEVENLABS_VOICE_ID are set (argus/.env or ~/.claude/.env). Flash v2.5
//      streams first byte in ~75ms, so it still feels local.
//   2. Kokoro voice-server on :3108 — free, offline; the fallback when the
//      key is missing or the ElevenLabs call fails (quota, network).
// ---------------------------------------------------------------------------

const KOKORO_URL = VOICE_SERVER_URL;

const ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech";

function firstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = homeEnv(n) ?? homeEnv(n.toLowerCase());
    if (v) return v;
  }
  return undefined;
}

// accept the common spellings (either case) so a hand-typed .env just works
const elevenKey = () =>
  firstEnv(
    "ELEVENLABS_API_KEY",
    "ELEVEN_LABS_API_KEY",
    "ELEVEN_LABS_APIKEY",
    "ELEVEN_API_KEY",
    "XI_API_KEY"
  );
const elevenVoice = () =>
  firstEnv("ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID", "ELEVEN_VOICE_ID");
const elevenModel = () => homeEnv("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5";

const elevenConfigured = () => Boolean(elevenKey() && elevenVoice());

export class VoiceConfigError extends Error {}

export interface SpeechStream {
  stream: ReadableStream<Uint8Array>;
  mime: string;
  engine: "elevenlabs" | "kokoro";
}

async function elevenSpeak(text: string): Promise<SpeechStream | null> {
  try {
    const res = await fetch(
      `${ELEVEN_URL}/${elevenVoice()}/stream?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenKey()!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, model_id: elevenModel() }),
      }
    );
    if (res.ok && res.body) {
      return { stream: res.body, mime: "audio/mpeg", engine: "elevenlabs" };
    }
    console.error(`[tts] elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null; // fall through to Kokoro
  } catch (e) {
    console.error(`[tts] elevenlabs unreachable: ${e}`);
    return null;
  }
}

// health probe cached briefly so every utterance doesn't pre-flight
let kokoroAliveUntil = 0;
let kokoroAlive = false;

async function kokoroUp(): Promise<boolean> {
  const now = Date.now();
  if (now < kokoroAliveUntil) return kokoroAlive;
  try {
    const res = await fetch(`${KOKORO_URL}/health`, { signal: AbortSignal.timeout(400) });
    kokoroAlive = res.ok;
  } catch {
    kokoroAlive = false;
  }
  // re-check dead servers sooner than live ones
  kokoroAliveUntil = now + (kokoroAlive ? 30_000 : 5_000);
  return kokoroAlive;
}

export async function ttsStatus(): Promise<{ ok: boolean; engine: string | null }> {
  if (elevenConfigured()) return { ok: true, engine: "elevenlabs" };
  if (await kokoroUp()) return { ok: true, engine: "kokoro" };
  return { ok: false, engine: null };
}

export async function speak(text: string): Promise<SpeechStream> {
  text = normalizeForSpeech(text); // "$4,200" → "four thousand dollars"

  if (elevenConfigured()) {
    const out = await elevenSpeak(text);
    if (out) return out;
  }

  if (await kokoroUp()) {
    const res = await fetch(`${KOKORO_URL}/speak?text=${encodeURIComponent(text)}`);
    if (res.ok && res.body) {
      return { stream: res.body, mime: "audio/wav", engine: "kokoro" };
    }
    kokoroAliveUntil = 0; // generation failed mid-flight — drop the cache
    throw new Error(`kokoro ${res.status}`);
  }

  if (elevenConfigured()) {
    // ElevenLabs failed AND Kokoro is down — surface the cloud error, not config
    throw new Error("elevenlabs failed and the voice-server on :3108 is down");
  }
  throw new VoiceConfigError(
    "no TTS engine: the voice-server on :3108 is down (voice-server\\start-voice-server.vbs)"
  );
}
