"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CoreProps } from "./coreTypes";
import { idleStrands, type Strand } from "@/lib/strands";
import { NumberRoll } from "./panels/shared";

// ---------------------------------------------------------------------------
// WireCore — the DAYBREAK centerpiece. A machined reactor sitting on the wall:
// a brushed-metal housing of eight armour plates, amber light bleeding out
// through the joints, a ring of stator slats burning behind them, and the
// month's headline number set into the dark hub.
//
// It is a LIT OBJECT, not a painting: every pixel builds a height field, takes
// its normal from that field and shades it against one key light. Hard edges,
// real bevels, specular hits. The only soft thing is the light spill.
//
// Each armour plate IS a channel (lib/strands.ts):
//   plate inlay colour — channel identity
//   inlay brightness   — the verdict marketing_context.py already wrote
//   inlay dark + cold  — that source isn't reporting
//   inlay flicker      — live activity on that channel
//   the number engraved outside the plate — that channel's own figure
// The slat ring is the month's pace gauge: slats light up to pacing.pace_pct,
// which is Python's number, not one invented here.
//
// It reads the room too: idle turns slowly, working spins up, listening dims
// and draws in, speaking rides the REAL speech envelope, error goes cold.
// Celebrations overdrive the core; a record fires a shock ring + sparks.
//
// WebGL2 fragment shader, with a canvas-2D fallback on the same geometry.
// ---------------------------------------------------------------------------

const MAX_WIRES = 8;
const PLATES = 8;
/** a channel that isn't reporting: its inlay goes to cold dead metal */
const DEAD: [number, number, number] = [0.42, 0.43, 0.48];

// Ring geometry, r = 1 at half the square's side. The shader hard-codes these
// same numbers; the labels outside the rim are placed from LABEL_R.
const RIM_R1 = 0.78;
const LABEL_R = 1.02;

/** centre angle of plate k, radians, y UP (shader space) */
function plateAngle(k: number): number {
  return -Math.PI + ((k + 0.5) * Math.PI * 2) / PLATES;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** how hard a plate's inlay burns — the verdict, nothing re-judged here */
function verdictLook(s: Strand, t: number, k: number): { bright: number; throb: number } {
  if (s.health === "bad") return { bright: 1.15, throb: 1 + 0.25 * Math.sin(t * 3.4 + k) };
  if (s.health === "warn") return { bright: 0.95, throb: 1 + 0.08 * Math.sin(t * 2.1 + k) };
  if (s.health === "good") return { bright: 1.2, throb: 1 };
  return { bright: 0.85, throb: 1 };
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; ttl: number; size: number; color: string;
}

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

#define TAU 6.28318530718
#define PI 3.14159265359
#define MAXW ${MAX_WIRES}
#define PLATES ${PLATES}.0

uniform vec2  u_res;
uniform float u_time;
uniform float u_amp;     // speech envelope / mode amplitude
uniform float u_flare;   // celebration impulse
uniform float u_ring;    // shock ring radius, < 0 idle
uniform float u_gauge;   // slat ring fill 0..1 (month pace, from Python)
uniform float u_cold;    // error: the light goes out
uniform int   u_count;
uniform vec3  u_col[MAXW];
uniform vec4  u_a[MAXW]; // x size, y brightness, z stale, w activity

out vec4 fragColor;

float sq(float x) { return x * x; }

float hash21(vec2 p) {
  p = fract(p * vec2(0.3183099, 0.3678794));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// --- the machined ring stack ----------------------------------------------
// r bands, outward: hub face, hot ring, stator slats, rib collar, armour
// plates, outer rim. Everything below reads from these same numbers.
const float HUB_R   = 0.290;
const float HOT_R0  = 0.300;
const float HOT_R1  = 0.335;
const float SLAT_R0 = 0.345;
const float SLAT_R1 = 0.505;
const float RIB_R0  = 0.515;
const float RIB_R1  = 0.560;
const float PLT_R0  = 0.572;
const float PLT_R1  = 0.745;
const float RIM_R0  = 0.748;
const float RIM_R1  = ${RIM_R1.toFixed(3)};

// angular gap between two armour plates, in turns
const float JOINT = 0.016;

/** smooth bevel: 1 in the middle of a band, rolling to 0 at both edges */
float bevel(float x, float lo, float hi, float w) {
  return smoothstep(lo, lo + w, x) * smoothstep(hi, hi - w, x);
}

/** height field of the housing — the whole object's relief in one function */
float H(float r, float a) {
  float h = 0.0;
  // hub: a shallow dish with a raised bezel
  h += bevel(r, 0.0, HUB_R, 0.010) * (0.30 + 0.22 * smoothstep(HUB_R - 0.05, HUB_R, r));
  // rib collar: radial ribs, 48 of them
  float ribs = 0.5 + 0.5 * cos(a * TAU * 48.0);
  h += bevel(r, RIB_R0, RIB_R1, 0.008) * (0.52 + 0.16 * ribs);
  // armour plates, split by joints
  float ja = fract(a * PLATES);
  float joint = smoothstep(0.0, JOINT, ja) * smoothstep(1.0, 1.0 - JOINT, ja);
  float plate = bevel(r, PLT_R0, PLT_R1, 0.016) * joint;
  h += plate * 0.95;
  // a milled step across each plate
  h -= plate * bevel(r, 0.640, 0.676, 0.006) * 0.22;
  // bolt bosses, one per plate
  float ba = (ja - 0.5) / PLATES * TAU;
  float bd = length(vec2(r - 0.612, ba * 0.612));
  h += smoothstep(0.030, 0.020, bd) * 0.30;
  // outer rim ring
  h += bevel(r, RIM_R0, RIM_R1, 0.006) * 0.62;
  return h;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 c = u_res * 0.5;
  float S = min(u_res.x, u_res.y) * 0.5;
  vec2 uv = (frag - c) / S;
  float r = length(uv);
  float th = atan(uv.y, uv.x);
  float a = fract((th + PI) / TAU);          // 0..1 round the object
  float px = 1.4 / S;                        // one pixel, in r units

  // --- surface normal from the height field ------------------------------
  float e = max(px * 1.2, 0.0016);
  float h0 = H(r, a);
  float hr = (H(r + e, a) - H(r - e, a)) / (2.0 * e);
  float ea = e / max(r, 0.06) / TAU;
  float ha = (H(r, a + ea) - H(r, a - ea)) / (2.0 * ea * TAU * max(r, 0.06));
  vec2 dirR = vec2(cos(th), sin(th));
  vec2 dirT = vec2(-sin(th), cos(th));
  vec2 grad = dirR * hr + dirT * ha;
  vec3 n = normalize(vec3(-grad * 0.055, 1.0));

  // key light from the upper left, the way the reference is lit
  vec3 L = normalize(vec3(-0.52, 0.66, 0.62));
  float diff = max(dot(n, L), 0.0);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 46.0);
  float fres = pow(1.0 - max(n.z, 0.0), 2.5);

  // brushed steel: a fine circumferential grain, plus an environment gradient
  float grain = hash21(vec2(floor(a * 2600.0), floor(r * 190.0)));
  float envG = 0.5 + 0.5 * n.y;                       // sky above, floor below
  vec3 steel = mix(vec3(0.22, 0.23, 0.27), vec3(0.74, 0.75, 0.80), envG);
  steel *= 0.91 + 0.09 * grain;
  vec3 metal = steel * (0.30 + 0.72 * diff) + vec3(1.0, 0.99, 0.96) * spec * 0.55
             + vec3(0.70, 0.74, 0.84) * fres * 0.14;

  // grooves and joints read as shadow, not as missing metal
  float ja = fract(a * PLATES);
  float jointGap = 1.0 - smoothstep(0.0, JOINT, ja) * smoothstep(1.0, 1.0 - JOINT, ja);
  float inPlate = bevel(r, PLT_R0, PLT_R1, 0.004);
  metal *= 1.0 - 0.55 * jointGap * inPlate;
  metal *= 1.0 - 0.30 * bevel(r, RIB_R0, RIB_R1, 0.004) * (0.5 + 0.5 * cos(a * TAU * 48.0));

  // --- the light -----------------------------------------------------------
  float glowPulse = 0.86 + 0.14 * sin(u_time * 1.7) + 0.55 * u_flare;
  glowPulse *= mix(1.0, 0.35, u_cold) * (0.72 + 0.42 * u_amp);
  vec3 amber = vec3(1.0, 0.52, 0.08);
  vec3 hotW  = vec3(1.0, 0.84, 0.50);
  amber = mix(amber, vec3(0.42, 0.52, 0.68), u_cold);   // error drains it cold
  hotW  = mix(hotW,  vec3(0.72, 0.80, 0.92), u_cold);

  // stator slats: 46 radial bars, turning slowly, filled up to the gauge
  float sa = a - u_time * 0.012;
  float slatPhase = fract(sa * 46.0);
  float slat = smoothstep(0.30, 0.44, slatPhase) * smoothstep(0.86, 0.72, slatPhase);
  float slatBand = bevel(r, SLAT_R0, SLAT_R1, 0.012);
  // the gauge fills clockwise from the top: unfilled slats sit dim, not dark
  float fillPos = fract(1.25 - a);
  float filled = mix(0.22, 1.0, step(fillPos, clamp(u_gauge, 0.0, 1.0)));
  // depth inside the barrel: brighter toward the inner edge
  float depth = mix(1.0, 0.42, smoothstep(SLAT_R0, SLAT_R1, r));
  float slatE = slat * slatBand * depth * filled;

  // the hot ring behind the slats
  float hot = bevel(r, HOT_R0, HOT_R1, 0.008);
  // light escaping between the armour plates
  float leak = jointGap * bevel(r, PLT_R0 - 0.02, RIM_R1, 0.02) * 0.85;
  // and the wash it throws across the rib collar
  float wash = bevel(r, RIB_R0 - 0.03, RIB_R1 + 0.02, 0.03) * 0.35;

  vec3 emis = vec3(0.0);
  // the slats burn amber, and only their inner ends go near white
  float slatHeat = smoothstep(SLAT_R1, SLAT_R0, r);
  emis += mix(amber, hotW, sq(slatHeat)) * slatE * 1.25;
  emis += mix(amber, hotW, 0.55) * hot * 1.35;
  emis += amber * leak * 0.95;
  emis += amber * wash * 0.8;

  // --- the plate inlays: one per channel ----------------------------------
  int pk = int(floor(a * PLATES));
  float slot = bevel(r, 0.682, 0.722, 0.005) * smoothstep(0.11, 0.17, ja) * smoothstep(0.89, 0.83, ja);
  metal *= 1.0 - 0.72 * slot;                       // machine the slot out first
  float inlay = bevel(r, 0.690, 0.714, 0.003) * smoothstep(0.12, 0.18, ja) * smoothstep(0.88, 0.82, ja);
  if (inlay > 0.001) {
    for (int i = 0; i < MAXW; i++) {
      if (i >= u_count) break;
      if (i != pk) continue;
      vec4 A = u_a[i];
      float bright = A.y, stale = A.z, act = A.w;
      float flick = 1.0 + act * 0.55 * sin(u_time * 6.0 + float(i) * 2.1);
      float b = bright * flick * mix(1.0, 0.16, stale) * mix(1.0, 0.3, u_cold) * (1.0 + 0.9 * u_flare);
      emis += mix(u_col[i], vec3(1.0), 0.05) * inlay * b * 0.95;
    }
  }

  // bounce: the amber light spilling onto the metal around it
  float bounce = slatBand * 0.30 + bevel(r, RIB_R0 - 0.05, PLT_R0 + 0.06, 0.06) * 0.16 * glowPulse;
  metal += amber * bounce * glowPulse * 0.55;

  // --- assemble ------------------------------------------------------------
  float body = smoothstep(RIM_R1 + px, RIM_R1 - px, r);          // the silhouette
  float hubFace = smoothstep(HUB_R + px, HUB_R - px, r);
  // the hub is dark graphite so the number set into it can be read
  vec3 hubCol = mix(vec3(0.085, 0.080, 0.100), vec3(0.20, 0.19, 0.23), 0.5 + 0.5 * n.y);
  hubCol += vec3(1.0) * spec * 0.5;
  hubCol += amber * 0.045 * glowPulse;                             // light from the ring
  vec3 surface = mix(metal, hubCol, hubFace);

  vec3 rgb = surface * body + emis * glowPulse * max(body, 0.55);

  // spill onto the wall outside the object, and the shock ring
  float spill = exp(-sq((r - RIM_R1) / 0.105)) * (1.0 - body) * 0.38 * glowPulse;
  rgb += amber * spill;
  float alpha = clamp(body + spill * 1.1, 0.0, 1.0);

  if (u_ring >= 0.0) {
    float rr = RIM_R1 + u_ring * 0.5;
    float shock = exp(-sq((r - rr) / 0.035)) * (1.0 - u_ring);
    rgb += vec3(1.0, 0.72, 0.30) * shock * 1.4;
    alpha = max(alpha, shock);
  }

  alpha += (hash21(frag) - 0.5) * 0.008;
  fragColor = vec4(rgb / max(alpha, 1e-4), clamp(alpha, 0.0, 1.0));
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[WireCore] shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function arrowOf(s: Strand): string {
  const d = s.delta;
  if (s.stale) return "";
  if (d !== null && d !== undefined && !Number.isNaN(d)) {
    if (d > 0.005) return "▲";
    if (d < -0.005) return "▼";
    return "";
  }
  return s.trend > 0.06 ? "▲" : s.trend < -0.06 ? "▼" : "";
}

export default function WireCore({ mode = "idle", strands, getLevel, celebrate, readout }: CoreProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wires = useMemo(() => (strands?.length ? strands.slice(0, MAX_WIRES) : idleStrands()), [strands]);

  // the slat ring is a gauge of Python's pace number — parsed back off the
  // readout so nothing new is computed here
  const gauge = useMemo(() => {
    const pace = readout?.sub?.find((x) => x.label.startsWith("pace"))?.value ?? "";
    const n = parseFloat(pace);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0.62;
  }, [readout]);

  const modeRef = useRef(mode);
  const wiresRef = useRef(wires);
  const levelRef = useRef(getLevel);
  const celebrateRef = useRef(celebrate ?? null);
  const gaugeRef = useRef(gauge);
  const wakeRef = useRef<() => void>(() => {});
  modeRef.current = mode;
  wiresRef.current = wires;
  levelRef.current = getLevel;
  celebrateRef.current = celebrate ?? null;
  gaugeRef.current = gauge;

  useEffect(() => {
    wakeRef.current();
  }, [mode, wires, celebrate, gauge]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const fxCanvas = fxCanvasRef.current;
    if (!wrap || !glCanvas || !fxCanvas) return;

    const gl = glCanvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    const fx = fxCanvas.getContext("2d");
    if (!fx) return;

    let prog: WebGLProgram | null = null;
    let uni: Record<string, WebGLUniformLocation | null> = {};
    if (gl) {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (vs && fs) {
        const p = gl.createProgram();
        if (p) {
          gl.attachShader(p, vs);
          gl.attachShader(p, fs);
          gl.linkProgram(p);
          if (gl.getProgramParameter(p, gl.LINK_STATUS)) prog = p;
          else console.warn("[WireCore] link:", gl.getProgramInfoLog(p));
        }
      }
      if (prog) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.useProgram(prog);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        uni = {
          res: gl.getUniformLocation(prog, "u_res"),
          time: gl.getUniformLocation(prog, "u_time"),
          amp: gl.getUniformLocation(prog, "u_amp"),
          flare: gl.getUniformLocation(prog, "u_flare"),
          ring: gl.getUniformLocation(prog, "u_ring"),
          gauge: gl.getUniformLocation(prog, "u_gauge"),
          cold: gl.getUniformLocation(prog, "u_cold"),
          count: gl.getUniformLocation(prog, "u_count"),
          col: gl.getUniformLocation(prog, "u_col[0]"),
          a: gl.getUniformLocation(prog, "u_a[0]"),
        };
      }
    }
    const use2D = !gl || !prog;
    glCanvas.style.display = use2D ? "none" : "block";

    let W = 0;
    let H2 = 0;
    let dpr = 1;
    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      // the housing is full of thin machined detail — it wants the real dpr
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(rect.width * dpr));
      H2 = Math.max(1, Math.round(rect.height * dpr));
      glCanvas.width = W;
      glCanvas.height = H2;
      fxCanvas.width = W;
      fxCanvas.height = H2;
      if (gl) gl.viewport(0, 0, W, H2);
    };
    fit();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ease = (cur: number, target: number, tau: number, dt: number) =>
      cur + (target - cur) * (1 - Math.exp(-dt / tau));

    const colBuf = new Float32Array(MAX_WIRES * 3);
    const aBuf = new Float32Array(MAX_WIRES * 4);

    let t = 0;
    let last = performance.now();
    let energy = 1;
    let amp = 1;
    let cold = 0;
    let flare = 0;
    let ring = -1;
    let lastSeq = celebrateRef.current?.seq ?? 0;
    let particles: Particle[] = [];
    let raf = 0;
    let parked = false;

    const spawnSparks = (n: number) => {
      const pal = ["#ffb340", "#ffd98a", "#fff0c8", ...wiresRef.current.map((s) => s.color)];
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (3 + Math.random() * 5) * dpr;
        const rad = (Math.min(W, H2) / 2) * RIM_R1;
        particles.push({
          x: W / 2 + Math.cos(ang) * rad,
          y: H2 / 2 - Math.sin(ang) * rad,
          vx: Math.cos(ang) * sp,
          vy: -Math.sin(ang) * sp,
          life: 0,
          ttl: 0.7 + Math.random() * 0.7,
          size: (1.6 + Math.random() * 2.2) * dpr,
          color: pal[i % pal.length],
        });
      }
    };

    // --- 2D fallback: the same rings, flat shaded -------------------------
    const draw2D = (ctx: CanvasRenderingContext2D, ws: Strand[]) => {
      const cx = W / 2;
      const cy = H2 / 2;
      const S = Math.min(W, H2) / 2;
      const g = ctx.createRadialGradient(cx, cy, S * 0.29, cx, cy, S * RIM_R1);
      g.addColorStop(0, "#2a2730");
      g.addColorStop(0.28, "#ffb340");
      g.addColorStop(0.6, "#8d8f99");
      g.addColorStop(1, "#c9cbd2");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, S * RIM_R1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#16141c";
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.29, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < ws.length; k++) {
        const s = ws[k];
        const ang = plateAngle(k);
        let rgb = hexToRgb(s.color);
        if (s.stale) rgb = mix3(rgb, DEAD, 0.85);
        ctx.strokeStyle = `rgb(${rgb.map((c) => Math.round(c * 255)).join(",")})`;
        ctx.lineWidth = 4 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, S * 0.702, -ang - 0.28, -ang + 0.28);
        ctx.stroke();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const m = modeRef.current;
      const ws = wiresRef.current;
      const level = m === "speaking" ? (levelRef.current?.() ?? 0.5) : 0;

      const cs = celebrateRef.current;
      if (cs && cs.seq !== lastSeq) {
        lastSeq = cs.seq;
        if (cs.tier !== "minor") {
          flare = 1;
          if (cs.tier === "record") {
            ring = 0;
            if (!mq.matches) spawnSparks(52);
          }
        }
      }
      flare *= Math.exp(-dt / (particles.length ? 1.1 : 0.6));
      if (ring >= 0) {
        ring += dt * 0.9;
        if (ring > 1) ring = -1;
      }

      const reduced = mq.matches;
      const targetEnergy =
        m === "error" ? 0.15 : m === "working" ? 2.6 : m === "listening" ? 0.6 : m === "speaking" ? 1.3 : 1;
      const targetAmp =
        m === "speaking" ? 0.5 + 1.2 * level : m === "listening" ? 0.72 : m === "error" ? 0.5 : 1;
      energy = ease(energy, reduced ? 0 : targetEnergy, 0.5, dt);
      amp = ease(amp, targetAmp, m === "speaking" ? 0.06 : 0.4, dt);
      cold = ease(cold, m === "error" ? 1 : 0, 0.5, dt);
      t += dt * energy;

      if (!use2D && gl && prog) {
        const n = Math.min(ws.length, MAX_WIRES);
        for (let k = 0; k < n; k++) {
          const s = ws[k];
          let rgb = hexToRgb(s.color);
          if (s.stale) rgb = mix3(rgb, DEAD, 0.85);
          colBuf[k * 3] = rgb[0];
          colBuf[k * 3 + 1] = rgb[1];
          colBuf[k * 3 + 2] = rgb[2];
          const look = verdictLook(s, t, k);
          aBuf[k * 4] = 0.6 + 0.95 * ((s.trend + 1) / 2);
          aBuf[k * 4 + 1] = look.bright * look.throb;
          aBuf[k * 4 + 2] = s.stale ? 1 : 0;
          aBuf[k * 4 + 3] = s.stale ? 0 : s.activity;
        }
        gl.uniform2f(uni.res!, W, H2);
        gl.uniform1f(uni.time!, t);
        gl.uniform1f(uni.amp!, amp);
        gl.uniform1f(uni.flare!, flare);
        gl.uniform1f(uni.ring!, ring);
        gl.uniform1f(uni.gauge!, gaugeRef.current);
        gl.uniform1f(uni.cold!, cold);
        gl.uniform1i(uni.count!, n);
        gl.uniform3fv(uni.col!, colBuf);
        gl.uniform4fv(uni.a!, aBuf);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      fx.clearRect(0, 0, W, H2);
      if (use2D) draw2D(fx, ws);
      if (particles.length) {
        for (const p of particles) {
          p.life += dt;
          p.x += p.vx * dt * 60;
          p.y += p.vy * dt * 60;
          p.vy += 3.2 * dpr * dt;
          const al = Math.max(0, 1 - p.life / p.ttl);
          if (al <= 0) continue;
          fx.globalAlpha = al;
          fx.fillStyle = p.color;
          fx.beginPath();
          fx.arc(p.x, p.y, p.size * (0.5 + 0.5 * al), 0, Math.PI * 2);
          fx.fill();
        }
        particles = particles.filter((p) => p.life < p.ttl);
        fx.globalAlpha = 1;
      }

      if (
        reduced &&
        energy < 0.005 &&
        flare < 0.01 &&
        ring < 0 &&
        particles.length === 0 &&
        Math.abs(amp - targetAmp) < 0.01
      ) {
        cancelAnimationFrame(raf);
        parked = true;
      }
    };

    const wake = () => {
      if (!parked) return;
      parked = false;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;
    mq.addEventListener("change", wake);
    const ro = new ResizeObserver(() => {
      fit();
      wake();
    });
    ro.observe(wrap);

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      parked = true;
    };
    glCanvas.addEventListener("webglcontextlost", onLost);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", wake);
      glCanvas.removeEventListener("webglcontextlost", onLost);
      wakeRef.current = () => {};
      ro.disconnect();
      // NB: never loseContext() here. React remounts this effect (dev
      // StrictMode, hot reload) against the SAME canvas, and getContext hands
      // back the same — now dead — context, dropping the wall to the fallback.
      if (gl && prog) gl.deleteProgram(prog);
    };
  }, []);

  const canvasStyle = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

  return (
    <div ref={wrapRef} className={`wire-core mode-${mode}`} aria-hidden="true">
      <div className="wire-glow" />
      <canvas ref={glCanvasRef} style={canvasStyle} />
      <canvas ref={fxCanvasRef} style={canvasStyle} />

      {/* the month's number, set into the dark hub. Decorative: the panels
          carry the same figures for screen readers. */}
      {readout && (
        <div className="core-readout">
          <span className="core-cap">{readout.bigLabel}</span>
          {/* the digits roll only when a refresh changes the figure — the
              first paint still just fades in with wire-ignite */}
          <b className={`core-big h-${readout.bigHealth}`}>
            <NumberRoll text={readout.big} />
          </b>
        </div>
      )}

      {/* one engraved label per plate, on the wall just outside its inlay */}
      <div className="core-dial">
        {wires.map((s, i) => {
          const ang = plateAngle(i);
          return (
            <span
              key={s.id}
              className={`core-chip${s.stale ? " stale" : ""} h-${s.health}`}
              style={
                {
                  left: `${50 + Math.cos(ang) * LABEL_R * 50}%`,
                  top: `${50 - Math.sin(ang) * LABEL_R * 50}%`, // CSS y runs down
                  "--c": s.color,
                } as React.CSSProperties
              }
            >
              <i />
              <span className="core-chip-label">{s.label}</span>
              <b><NumberRoll text={s.value} /></b>
              <em>{arrowOf(s)}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}
