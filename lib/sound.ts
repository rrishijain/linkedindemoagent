// ---------------------------------------------------------------------------
// Client-side chime singleton — the celebration layer's audio channel.
// Oscillator synthesis only (no assets); volume sits far under speech.
// Same autoplay reality as voiceClient: nothing plays until the first user
// gesture — but unlike speech, a chime minutes late is wrong, so pre-unlock
// cues are DROPPED, never queued. Chimes also respect the cross-tab voice
// lead (argus.voice.lead): two tabs must not double-chime, and the chime
// should come from the tab that is also doing the talking.
// ---------------------------------------------------------------------------

import { voice } from "./voiceClient";

export type SoundCue = "tick" | "quest" | "record" | "risk";

const MUTE_KEY = "argus.sound.muted";

class SoundClient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  private inited = false;

  init() {
    if (this.inited || typeof window === "undefined") return;
    this.inited = true;
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  get muted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  }

  /** returns the NEW muted state */
  toggleMute(): boolean {
    const next = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {}
    return next;
  }

  play(cue: SoundCue) {
    if (!this.unlocked || this.muted || typeof window === "undefined") return;
    if (!voice.hasLead()) return; // silent tab stays silent
    try {
      this.ensure();
    } catch {
      return;
    }
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    switch (cue) {
      case "tick": // a counter click, barely there
        this.tone(1320, 0, 0.07, "sine", 1);
        this.tone(880, 0, 0.07, "sine", 0.4);
        break;
      case "quest": // two-note rise, a fifth
        this.tone(660, 0, 0.09, "triangle", 0.9);
        this.tone(990, 0.09, 0.2, "triangle", 1);
        this.tone(993, 0.09, 0.2, "triangle", 0.5); // detune pair for warmth
        break;
      case "record": // C5–G5–C6 arpeggio over a low swell
        this.tone(523.25, 0, 0.35, "sine", 1);
        this.tone(783.99, 0.09, 0.35, "sine", 1);
        this.tone(1046.5, 0.18, 0.5, "sine", 1);
        this.tone(130.81, 0, 0.7, "sine", 0.35);
        break;
      case "risk": // a low, non-alarming "hm" — the chain-at-risk nudge
        this.tone(220, 0, 0.25, "triangle", 0.7);
        break;
    }
  }

  private ensure() {
    if (this.ctx) return;
    // own tiny AudioContext — voiceClient's graph is private and carries the
    // speech sheen chain; contexts are cheap and this keeps zero coupling
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.08; // far under speech
    this.master.connect(this.ctx.destination);
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, peak: number) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

export const sound = new SoundClient();
