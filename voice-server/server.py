"""
ARGUS local voice — Kokoro-82M TTS + faster-whisper STT behind FastAPI
on :3108.

The standalone voice process the handoff reserved (Next API routes stay
stateless; this holds the warm models). lib/tts.ts and lib/stt.ts
auto-detect it via /health and fall back to ElevenLabs when it's not
running.

GET  /health         -> {"ok": true, "voice": "...", "stt": {...}}
GET  /speak?text=... -> audio/wav, streamed sentence-by-sentence so the
                        browser starts playback after the FIRST sentence
                        is generated, not the whole reply.
POST /stt            -> raw audio body (webm/opus/wav) -> {"text": "..."}
                        faster-whisper on CUDA (RTX 5090, ~100ms warm),
                        CPU int8 if CUDA init fails.

Run: .venv\\Scripts\\python.exe server.py   (or start-voice-server.vbs)
"""

import asyncio
import concurrent.futures
import glob
import io
import json
import math
import os
import re
import struct
import sys
import threading
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

# ctranslate2 (faster-whisper) needs cuDNN/cuBLAS DLLs from the pip
# nvidia-* wheels on the DLL search path BEFORE import. Windows-only API —
# Mac/Linux skip this entirely (CPU or CoreML there). The handles returned
# by add_dll_directory must be KEPT — if they're GC'd the directory drops
# off the search path again.
_dll_dirs = []
if hasattr(os, "add_dll_directory"):
    for _d in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
        _dll_dirs.append(os.add_dll_directory(_d))
        os.environ["PATH"] = _d + os.pathsep + os.environ["PATH"]

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

from wakeword import WakeListener, WAKE_MODEL, WAKE_DEFAULT

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 3108


def _load_env_file(path):
    """The docs point users at ~/.claude/.env for KOKORO_VOICE/KOKORO_SPEED
    etc — actually load it. Real environment variables win over file values."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except OSError:
        pass


_load_env_file(os.path.join(os.path.expanduser("~"), ".claude", ".env"))


def _env_float(name, default, lo, hi):
    """Finite, in-range float or the default — float('nan') as a threshold
    would silently disable wake detection (NaN compares false to everything)."""
    raw = os.environ.get(name, "")
    try:
        v = float(raw) if raw else default
    except ValueError:
        v = default
    if not math.isfinite(v) or not (lo <= v <= hi):
        print(f"{name}={raw!r} out of range [{lo}, {hi}]; using {default}")
        v = default
    return v


def _env_device(name):
    v = os.environ.get(name, "auto").lower()
    if v not in ("auto", "cpu", "cuda"):
        print(f"{name}={v!r} not one of auto/cpu/cuda; using auto")
        v = "auto"
    return v


VOICE = os.environ.get("KOKORO_VOICE", "bm_george")  # calm British male
SPEED = _env_float("KOKORO_SPEED", 1.0, 0.5, 2.0)
KOKORO_DEVICE_PREF = _env_device("KOKORO_DEVICE")
WHISPER_DEVICE_PREF = _env_device("WHISPER_DEVICE")
# Kokoro voice ids are <lang><gender>_<name>: b = British, a = American,
# and so on. Phonemize in the voice's OWN accent — an af_/am_ voice read
# with en-gb rules comes out mushy. Set KOKORO_LANG to override.
VOICE_LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr",
               "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}
LANG = os.environ.get("KOKORO_LANG") or VOICE_LANGS.get(VOICE[:1], "en-us")
SAMPLE_RATE = 24000  # kokoro output rate
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small.en")
# domain vocab bias — keeps acronyms like MRR from coming out "M.R.A."
WHISPER_PROMPT = os.environ.get(
    "WHISPER_PROMPT",
    "ARGUS marketing dashboard voice commands: ROAS, CPA, CPL, CTR, CPM, "
    "ad spend, budget pacing, breakeven, Meta Ads, Google Ads, Search Console, "
    "GSC, AEO, Instagram, lakh, crore, decision queue, kill, scale, fix, "
    "meta ads audit, SEO audit, AEO audit, perf report, weekly deck, blended deck, "
    "publish blog post, build carousel, pull data, rebuild board, morning intel, "
    "daily briefing, runner, queue, top three priorities, Digital Scholar.",
)


def load_kokoro():
    """CUDA via onnxruntime-gpu (~250ms/sentence vs ~1050ms CPU). kokoro-onnx
    picks the provider from ONNX_PROVIDER at init; if CUDA can't actually
    create (missing DLLs etc) onnxruntime silently falls back to CPU inside
    the session, so trust the session's own report, not the env var. A tiny
    inference runs inside the attempt because CUDA can also init fine and
    then blow up on the first kernel launch — that must fall back too, not
    crash the first /speak."""
    model = os.path.join(HERE, "kokoro-v1.0.onnx")
    voices = os.path.join(HERE, "voices-v1.0.bin")
    if KOKORO_DEVICE_PREF != "cpu":
        k = None
        try:
            os.environ["ONNX_PROVIDER"] = "CUDAExecutionProvider"
            k = Kokoro(model, voices)
            device = "cuda" if "CUDAExecutionProvider" in k.sess.get_providers() else "cpu"
            k.create("Hi.", voice=VOICE, speed=SPEED, lang=LANG)  # prove it infers
            if device == "cpu":
                # session silently fell back internally — it WORKS, reuse it
                os.environ.pop("ONNX_PROVIDER", None)
            return k, device
        except Exception as e:
            del k  # release the broken session before rebuilding
            print(f"kokoro cuda failed ({e}); falling back to cpu")
        os.environ.pop("ONNX_PROVIDER", None)
    return Kokoro(model, voices), "cpu"


def load_whisper():
    """CUDA float16 (5090 = ~100ms warm) with CPU int8 fallback so a
    broken CUDA stack degrades to slow-but-working, never to dead. The
    silence transcribe inside the attempt catches the CUDA stacks that
    construct fine but fail on first inference (missing cuDNN kernels)."""
    if WHISPER_DEVICE_PREF != "cpu":
        m = None
        try:
            m = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
            list(m.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1, language="en")[0])
            return m, "cuda"
        except Exception as e:
            del m  # release GPU memory before rebuilding on cpu
            print(f"whisper cuda failed ({e}); falling back to cpu int8")
    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8"), "cpu"


# constructed in lifespan(), not at import — launching via uvicorn, the .vbs
# or `python server.py` all warm up and tear down identically
kokoro = None
KOKORO_DEVICE = "unloaded"
whisper = None
WHISPER_DEVICE = "unloaded"

# one whisper model, two callers (/stt route + wake-word thread) — serialize
whisper_lock = threading.Lock()


def transcribe_pcm(audio_f32):
    """float32 mono 16k -> text. Shared by the wake-word capture path."""
    with whisper_lock:
        segments, _info = whisper.transcribe(
            audio_f32, beam_size=1, language="en", vad_filter=False,
            initial_prompt=WHISPER_PROMPT,
        )
        # segments is a lazy generator — consume INSIDE the lock or the
        # actual decode runs unguarded
        return " ".join(s.text.strip() for s in segments).strip()


# --- P4: wake word + console event stream ---------------------------------
# The console connects to ws://:3108/events. The wake thread emits through
# emit_event() which hops onto the uvicorn event loop thread-safely.

WAKE_ENABLED = os.environ.get("WAKE_WORD", WAKE_DEFAULT).lower() not in ("off", "0", "false")
WAKE_THRESHOLD = _env_float("WAKE_THRESHOLD", 0.5, 0.05, 1.0)

ws_clients: set = set()
main_loop = None


def _log_emit_result(fut):
    try:
        exc = fut.exception()
    except concurrent.futures.CancelledError:
        return
    if exc is not None:
        print(f"event broadcast failed: {exc!r}")


def emit_event(payload: dict):
    loop = main_loop
    if loop is None or loop.is_closed():
        return
    msg = json.dumps(payload)

    async def _one(ws):
        try:
            await asyncio.wait_for(ws.send_text(msg), timeout=1.0)
        except Exception:
            # slow or dead client — drop it rather than stall the broadcast
            ws_clients.discard(ws)
            try:
                await ws.close()
            except Exception:
                pass

    async def _send():
        await asyncio.gather(*(_one(ws) for ws in list(ws_clients)))

    try:
        fut = asyncio.run_coroutine_threadsafe(_send(), loop)
    except RuntimeError:  # loop shut down between the check and the submit
        return
    fut.add_done_callback(_log_emit_result)


wake = None  # created in lifespan() when WAKE_ENABLED


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global kokoro, KOKORO_DEVICE, whisper, WHISPER_DEVICE, wake, main_loop
    main_loop = asyncio.get_running_loop()
    # warm both models so the first real request doesn't pay init cost —
    # whisper's first CUDA run JITs kernels (~9s); feed it kokoro's warmup
    # audio so the whole pipeline is hot. to_thread keeps the loop breathing
    # so uvicorn's own signal handling stays responsive during the ~10s load.
    await asyncio.to_thread(_load_and_warm)
    if WAKE_ENABLED:
        wake = WakeListener(transcribe_pcm, emit_event, threshold=WAKE_THRESHOLD)
        wake.start()
    print(f"kokoro({KOKORO_DEVICE}) + whisper({WHISPER_MODEL}/{WHISPER_DEVICE}) warm — serving :{PORT} voice={VOICE}/{LANG}")
    yield
    # shutdown: stop emitting first, then close the mic and join the thread
    main_loop = None
    if wake is not None:
        wake.stop()


def _load_and_warm():
    global kokoro, KOKORO_DEVICE, whisper, WHISPER_DEVICE
    kokoro, KOKORO_DEVICE = load_kokoro()
    whisper, WHISPER_DEVICE = load_whisper()
    samples, _ = kokoro.create("Systems online.", voice=VOICE, speed=SPEED, lang=LANG)
    warm = io.BytesIO()
    sf.write(warm, samples, SAMPLE_RATE, format="WAV")
    warm.seek(0)
    with whisper_lock:
        list(whisper.transcribe(warm, beam_size=1, language="en")[0])


app = FastAPI(lifespan=lifespan)

# the console is a localhost page; nothing off this machine has any business
# on the event stream. No Origin header (ws_probe.py, curl) stays allowed.
ALLOWED_WS_HOSTS = {"localhost", "127.0.0.1", "::1"}


@app.websocket("/events")
async def events(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin:
        try:
            host = urlparse(origin).hostname
        except ValueError:
            host = None
        if host not in ALLOWED_WS_HOSTS:
            await ws.close(code=1008)
            return
    await ws.accept()
    # hello tells the console whether hands-free is actually armed — the client
    # can't read /health cross-origin, and "wake word armed" must not lie
    await ws.send_text(json.dumps({"type": "hello", "wake": bool(wake and wake.ok)}))
    ws_clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # client pings — content ignored
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)


def wav_header(sample_rate: int) -> bytes:
    """Streaming WAV header with unknown length (0x7FFFFFFF) — browsers
    play it progressively and stop at end-of-stream."""
    data_size = 0x7FFFFFFF - 36
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE",
        b"fmt ", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b"data", data_size,
    )


SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")
MAX_CHUNK = 250  # chars — unpunctuated text must not become one huge chunk


def _split_long(part: str):
    """Word-boundary split of anything over MAX_CHUNK — a 900-char run-on
    with no punctuation would otherwise synthesize as a single chunk and
    kill time-to-first-audio."""
    if len(part) <= MAX_CHUNK:
        return [part]
    out, cur = [], ""
    for w in part.split():
        nxt = f"{cur} {w}".strip()
        if cur and len(nxt) > MAX_CHUNK:
            out.append(cur)
            cur = w
        else:
            cur = nxt
    if cur:
        out.append(cur)
    return out or [part]


def chunks_of(text: str):
    """First sentence ships alone so playback starts ASAP; the rest glue
    into >=60-char chunks so tiny fragments don't chop the prosody, capped
    at MAX_CHUNK so no chunk stalls the stream."""
    parts = [p.strip() for p in SENTENCE_SPLIT.split(text) if p.strip()]
    if not parts:
        return _split_long(text) if text.strip() else [text]
    parts = [piece for p in parts for piece in _split_long(p)]
    out, cur = [parts[0]], ""
    for p in parts[1:]:
        if cur and len(cur) + 1 + len(p) > MAX_CHUNK:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
        if len(cur) >= 60:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "kokoro",
        "voice": VOICE,
        "lang": LANG,
        "speed": SPEED,
        "device": KOKORO_DEVICE,
        "stt": {"ok": True, "model": WHISPER_MODEL, "device": WHISPER_DEVICE},
        "wake": {
            "enabled": WAKE_ENABLED,
            "ok": bool(wake and wake.ok),
            "model": WAKE_MODEL,
            "threshold": WAKE_THRESHOLD,
            "error": wake.error if wake else None,
            # fatal=True means it will not retry (setup failure / gave up);
            # error with fatal=False means the mic dropped and it's retrying
            "fatal": bool(wake and wake.fatal),
        },
    }


MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # push-to-talk clips are ~100KB; 25MB is hostile
MAX_AUDIO_S = 120.0


class AudioTooLong(Exception):
    pass


def _transcribe_blob(audio: bytes) -> str:
    """Blocking decode + inference — always called via asyncio.to_thread so
    the lock wait and the decode never sit on the event loop."""
    # faster-whisper decodes webm/opus/wav via PyAV from a file-like object
    with whisper_lock:
        segments, info = whisper.transcribe(
            io.BytesIO(audio), beam_size=1, language="en", vad_filter=False,
            initial_prompt=WHISPER_PROMPT,
        )
        # duration is known after decode but BEFORE the lazy inference runs —
        # bail here so an hour-long file can't pin the model
        if info.duration and info.duration > MAX_AUDIO_S:
            raise AudioTooLong(f"{info.duration:.0f}s")
        return " ".join(s.text.strip() for s in segments).strip()


@app.post("/stt")
async def stt(req: Request):
    chunks, total = [], 0
    async for chunk in req.stream():
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            return Response(status_code=413, content="audio too large")
        chunks.append(chunk)
    audio = b"".join(chunks)
    if len(audio) < 1000:
        return Response(status_code=400, content="clip too short")
    t0 = time.time()
    try:
        text = await asyncio.to_thread(_transcribe_blob, audio)
    except AudioTooLong:
        return Response(status_code=413, content=f"clip longer than {MAX_AUDIO_S:.0f}s")
    return {"text": text, "ms": int((time.time() - t0) * 1000)}


_BREATH = b"\x00" * int(SAMPLE_RATE * 0.12) * 2  # short pause between sentences


def _synth(chunk: str) -> bytes:
    samples, _sr = kokoro.create(chunk, voice=VOICE, speed=SPEED, lang=LANG)
    return (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


@app.get("/speak")
def speak(text: str = ""):
    text = text.strip()[:900]
    if not text:
        return Response(status_code=400, content="empty text")

    # synthesize the FIRST chunk before committing to a 200 — a broken
    # synthesizer must be a 500, not a WAV header followed by silence
    chunks = chunks_of(text)
    try:
        first = _synth(chunks[0])
    except Exception as e:
        print(f"tts failed ({type(e).__name__}: {e})")
        return Response(status_code=500, content="tts failed")

    def gen():
        yield wav_header(SAMPLE_RATE)
        yield first
        yield _BREATH
        for chunk in chunks[1:]:
            try:
                pcm = _synth(chunk)
            except Exception as e:
                # mid-stream failure: the header is out, so end the stream
                # cleanly — the browser plays what it got and stops
                print(f"tts failed mid-stream ({type(e).__name__}: {e}); ending stream early")
                return
            yield pcm
            yield _BREATH

    return StreamingResponse(gen(), media_type="audio/wav",
                             headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    # model load + warm-up happens in lifespan() — identical whether this
    # runs via `python server.py`, the .vbs launcher, or bare uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
