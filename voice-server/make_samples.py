"""Generate A/B samples for a set of Kokoro voices into samples/, plus an
audition.html to click through them.

Defaults to the female shortlist (that's the open question); pass voice ids or
a prefix to audition anything else:

    python make_samples.py                 # female shortlist
    python make_samples.py bm_             # every British male
    python make_samples.py af_heart bf_emma

Set the winner with KOKORO_VOICE (+ optional KOKORO_SPEED) in ~/.claude/.env
and restart the voice-server.
"""
import glob
import os
import sys

# Windows/CUDA only — no-ops on Mac and Linux, where the glob finds nothing.
# Keep the add_dll_directory handles alive or the directories drop off again.
_dll_dirs = []
for _d in glob.glob(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", "*", "bin")):
    _dll_dirs.append(os.add_dll_directory(_d))
    os.environ["PATH"] = _d + os.pathsep + os.environ["PATH"]
    os.environ.setdefault("ONNX_PROVIDER", "CUDAExecutionProvider")

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")
os.makedirs(OUT, exist_ok=True)

# same accent map the server uses — audition a voice the way it will be served
VOICE_LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr",
               "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}

# the female shortlist: all four British (a straight swap for bm_george's
# register), the four best-rated American, and one Hindi-English
DEFAULT = ["bf_emma", "bf_isabella", "bf_alice", "bf_lily",
           "af_heart", "af_bella", "af_nicole", "af_sarah", "hf_alpha"]

TEXT = (
    "Good evening. All systems are operating within normal parameters. "
    "The perf report is done — blended ROAS is up about twelve percent "
    "week over week, and two runs are still working."
)
SPEEDS = [1.0, 1.08]

kokoro = Kokoro(
    os.path.join(HERE, "kokoro-v1.0.onnx"),
    os.path.join(HERE, "voices-v1.0.bin"),
)

available = set(kokoro.get_voices())
args = sys.argv[1:]
if not args:
    voices = [v for v in DEFAULT if v in available]
else:
    voices = sorted({v for a in args for v in available if v == a or v.startswith(a)})
if not voices:
    sys.exit(f"no such voices: {args}")
print("auditioning:", ", ".join(voices))

rows = []
for voice in voices:
    lang = VOICE_LANGS.get(voice[:1], "en-us")
    for speed in SPEEDS:
        name = f"{voice}_x{speed:.2f}.wav"
        samples, sr = kokoro.create(TEXT, voice=voice, speed=speed, lang=lang)
        sf.write(os.path.join(OUT, name), samples, sr)
        rows.append((voice, speed, name))
        print("wrote", name)

items = "\n".join(
    f'<div class="row"><b>{v}</b> <span>x{s:.2f}</span>'
    f'<audio controls preload="none" src="samples/{n}"></audio></div>'
    for v, s, n in rows
)
current = os.environ.get("KOKORO_VOICE", "bm_george")
html = f"""<!doctype html><meta charset="utf-8"><title>Kokoro voice audition</title>
<style>body{{background:#0a0e14;color:#9fd8e8;font-family:Consolas,monospace;padding:2rem}}
.row{{display:flex;align-items:center;gap:1rem;margin:.4rem 0}}
.row b{{width:8rem}}.row span{{width:4rem;opacity:.6}}audio{{width:30rem}}</style>
<h2>Kokoro voice audition — current: {current}</h2>
<p>Pick one, then set KOKORO_VOICE (and KOKORO_SPEED) in ~/.claude/.env and
restart the voice-server.</p>
{items}
"""
with open(os.path.join(HERE, "audition.html"), "w", encoding="utf-8") as f:
    f.write(html)
print("\nopen", os.path.join(HERE, "audition.html"))
