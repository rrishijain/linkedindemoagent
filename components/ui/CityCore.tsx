"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CoreProps } from "../coreTypes";
import { idleStrands, type Strand } from "@/lib/strands";
import { createCityScene, type CityMood } from "./cityScene";
import "./city-core.css";

const MODE_LABEL = {
  idle: "At your command", working: "Working on it", listening: "Listening",
  speaking: "Speaking", error: "Connection interrupted",
};

function trendArrow(channel: Strand) {
  if (channel.stale) return "";
  if (channel.delta !== null && Number.isFinite(channel.delta)) {
    return channel.delta > .005 ? "↗" : channel.delta < -.005 ? "↘" : "";
  }
  return channel.trend > .06 ? "↗" : channel.trend < -.06 ? "↘" : "";
}

/** An asset-free still stays visible during loading and without WebGL. */
function StillCity() {
  return (
    <svg className="city-still" viewBox="0 0 440 540" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="city-still-sky" x2="0" y2="1"><stop stopColor="#a6c6d8" /><stop offset="1" stopColor="#ffe4c8" /></linearGradient>
        <linearGradient id="city-still-glass" x2="1" y2=".4"><stop stopColor="#85a4b6" /><stop offset=".5" stopColor="#cad7dc" /><stop offset="1" stopColor="#e4c7b7" /></linearGradient>
        <linearGradient id="city-still-water" x2="0" y2="1"><stop stopColor="#cfced0" /><stop offset="1" stopColor="#eee0ce" /></linearGradient>
      </defs>
      <path fill="url(#city-still-sky)" d="M0 0h440v540H0z" />
      <circle cx="176" cy="202" r="44" fill="#fff1d6" />
      <g fill="url(#city-still-glass)">
        <path opacity=".4" d="M0 230h34v130H0zM37 192h33v168H37zM83 237h19v123H83zM305 224h20v136h-20zM343 194h45v166h-45zM404 256h36v104h-36z" />
        <path d="M3 138h58v226H3zM68 173h38v195H68zM119 218h26v143h-26zM290 164h36v201h-36zM339 120h58v245h-58zM404 166h36v199h-36z" />
        <path d="M251 360V147h9v-21h10v21h9v213z" />
      </g>
      <path fill="url(#city-still-water)" d="M0 365h440v175H0z" />
      <path fill="#ede2d5" d="M0 363h174l-44 123H0zM440 363H286l44 123h110zM0 486h440v54H0z" />
      <path stroke="#fff0d4" fill="none" d="m174 365-44 121m156-121 44 121M0 487h440" />
    </svg>
  );
}

export default function CityCore({ mode = "idle", strands, readout, getLevel, celebrate }: CoreProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<CityMood>("golden");
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [available, setAvailable] = useState(true);
  const [reveal, setReveal] = useState(0);
  const current = useRef({ mode, mood, paused, reveal, getLevel, celebrate });
  current.current = { mode, mood, paused, reveal, getLevel, celebrate };
  const channels = useMemo(() => (strands?.length ? strands : idleStrands()).slice(0, 8), [strands]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(mq.matches);
    onMotion();
    mq.addEventListener("change", onMotion);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      setAvailable(false);
      return () => mq.removeEventListener("change", onMotion);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);
    const city = createCityScene(renderer);
    let dirty = true;
    const fit = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      city.camera.aspect = width / height;
      city.camera.updateProjectionMatrix();
      dirty = true;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(mount);

    let pointerX = 0, pointerY = 0, x = 0, y = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = mount.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - .5) * 2;
      pointerY = ((event.clientY - rect.top) / rect.height - .5) * -2;
    };
    const leave = () => { pointerX = 0; pointerY = 0; };
    mount.addEventListener("pointermove", move, { passive: true });
    mount.addEventListener("pointerleave", leave);

    let raf = 0, last = 0, elapsed = 0, opening = 0, flare = 0;
    let lastReveal = 0, lastCelebration = celebrate?.seq ?? 0;
    let lastSignature = "", visible = true, contextLost = false;
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || contextLost) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 30) return;
      const dt = Math.min((now - last) / 1000, .065);
      last = now;
      const state = current.current;
      const still = state.paused || mq.matches;
      const signature = `${state.mood}:${state.mode}:${still}:${state.reveal}`;
      const changed = signature !== lastSignature;
      lastSignature = signature;
      if (still && !changed && !dirty) return;
      if (state.reveal !== lastReveal) { lastReveal = state.reveal; opening = 0; }
      if (!still) { elapsed += dt; opening = Math.min(1, opening + dt / 2.7); }
      if (state.celebrate && state.celebrate.seq !== lastCelebration) {
        lastCelebration = state.celebrate.seq;
        if (state.celebrate.tier !== "minor") flare = state.celebrate.tier === "record" ? 1.5 : .7;
      }
      flare *= Math.exp(-dt * 1.5);
      x += (pointerX - x) * .04;
      y += (pointerY - y) * .04;
      const activity = state.mode === "speaking" ? (state.getLevel?.() ?? .3) : state.mode === "working" ? .65 : 0;
      city.render({
        time: elapsed, delta: still ? 0 : dt, pointerX: still ? 0 : x, pointerY: still ? 0 : y,
        reveal: still ? 1 : 1 - Math.pow(1 - opening, 3), blueHour: state.mood === "blue",
        activity, celebration: still ? 0 : flare,
      });
      dirty = false;
    };
    const start = () => { if (!raf && visible && !document.hidden && !contextLost) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    });
    intersection.observe(mount);
    const onContextLost = (event: Event) => {
      event.preventDefault(); contextLost = true; stop(); setAvailable(false);
    };
    const onContextRestored = () => { contextLost = false; dirty = true; setAvailable(true); start(); };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop(); resize.disconnect(); intersection.disconnect();
      mq.removeEventListener("change", onMotion);
      mount.removeEventListener("pointermove", move);
      mount.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      city.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
    // Prop changes are read by the scene loop, never by remounting WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={`city-core city-${mood} mode-${mode}${paused ? " city-paused" : ""}${!available ? " city-unavailable" : ""}`} aria-label="Horizon city view">
      <div className="city-heading"><span />YOUR NEXT HORIZON<span /></div>
      <div className="city-portal">
        <div className="city-aperture">
          <StillCity />
          <div className="city-canvas" ref={mountRef} />
          <div className="city-atmosphere" aria-hidden="true" />
          <div key={reveal} className="city-opening" aria-hidden="true">
            <div className="city-door city-door-left" /><div className="city-door city-door-right" />
          </div>
          <div className="city-scene-caption" aria-hidden="true"><span>JARVIS</span><span>{mood === "golden" ? "CRIMSON" : "NIGHT"}</span></div>
        </div>
        <div className="city-sill" aria-hidden="true" />
      </div>

      <div className="city-channels" aria-hidden="true">
        {channels.map((channel, i) => (
          <div key={channel.id} className={`city-channel city-channel-${i < 4 ? "left" : "right"}${channel.stale ? " stale" : ""} h-${channel.health}`} style={{ "--channel-row": i % 4, "--channel-color": channel.color } as React.CSSProperties}>
            <span><i />{channel.label}</span><b>{channel.value}<em>{trendArrow(channel)}</em></b>
            {channel.stale && <small>STALE</small>}
          </div>
        ))}
      </div>

      <div className="city-footer">
        <div className="city-readout">
          <div><span className="city-metric-label">{readout?.bigLabel ?? "CONTRIBUTION MTD"}</span><b className={`h-${readout?.bigHealth ?? "none"}`}>{readout?.big ?? "—"}</b></div>
          <span className="city-mode"><i />{MODE_LABEL[mode]}</span>
        </div>
        <div className="city-toolbar" aria-label="City appearance">
          <div className="city-moods" role="group" aria-label="Lighting">
            <button type="button" aria-pressed={mood === "golden"} onClick={() => setMood("golden")}><span className="city-sun-icon" aria-hidden="true">☀</span>Crimson</button>
            <button type="button" aria-pressed={mood === "blue"} onClick={() => setMood("blue")}><span className="city-moon-icon" aria-hidden="true">☾</span>Night</button>
          </div>
          <span className="city-toolbar-divider" />
          <button className="city-icon-button" type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "Resume city motion" : "Pause city motion"} aria-pressed={paused} disabled={reduced || !available} title={reduced ? "Motion follows your reduced-motion preference" : paused ? "Resume motion" : "Pause motion"}>
            {paused || reduced ? <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 7 5-7 5Z" fill="currentColor" /></svg> : <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
          </button>
          <button className="city-icon-button" type="button" onClick={() => setReveal(r => r + 1)} aria-label="Replay city opening" disabled={reduced || paused} title="Replay opening"><svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 7a6 6 0 1 1 0 5M3 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
      </div>
    </section>
  );
}
