"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CoreProps } from "../coreTypes";
import { idleStrands, type Strand } from "@/lib/strands";

// ---------------------------------------------------------------------------
// OrbCore — a 3D orbiting reactor orb: a glowing solid heart inside a
// wireframe cage, wrapped in an atmospheric rim glow, cycling through its
// colour palette once per second. Drag to orbit (zoom locked).
//
// Replaces WireCore as the centerpiece (2026-09-04, at Rishi's request).
// It keeps the console contract: the month's headline figure sits at the
// centre, one label per channel rings the orb, mode drives spin energy,
// celebrations flare the glow, and error drains the palette cold.
// ---------------------------------------------------------------------------

const MAX_WIRES = 8;
const LABEL_R = 1.02;

// palette the orb cycles through, one step per second
const PALETTE = [0x3a86ff, 0x8338ec, 0xff006e, 0xfb5607, 0xffbe0b];
const COLD = new THREE.Color(0x5a6a80); // error drains it to this

/** centre angle of label k, radians, y UP */
function labelAngle(k: number): number {
  return -Math.PI + ((k + 0.5) * Math.PI * 2) / MAX_WIRES;
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

const ATMOSPHERE_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAG = `
  uniform vec3 glowColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    gl_FragColor = vec4(glowColor, 1.0) * intensity * uIntensity;
  }
`;

export default function OrbCore({ mode = "idle", strands, getLevel, celebrate, readout }: CoreProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const wires = useMemo(() => (strands?.length ? strands.slice(0, MAX_WIRES) : idleStrands()), [strands]);

  const modeRef = useRef(mode);
  const levelRef = useRef(getLevel);
  const celebrateRef = useRef(celebrate ?? null);
  modeRef.current = mode;
  levelRef.current = getLevel;
  celebrateRef.current = celebrate ?? null;

  useEffect(() => {
    const wrap = wrapRef.current;
    const mount = mountRef.current;
    if (!wrap || !mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 15.1; // r=5 orb spans ~80% of the frame, like the old rim

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0); // the cream wall shows through
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    // atmospheric rim glow
    const atmosphereGeometry = new THREE.SphereGeometry(5.55, 48, 48);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        glowColor: { value: new THREE.Color(PALETTE[0]) },
        uIntensity: { value: 1 },
      },
    });
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphereMesh);

    // wireframe cage
    const wireframeGeometry = new THREE.SphereGeometry(5, 32, 32);
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE[0],
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const wireframeGlobe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
    scene.add(wireframeGlobe);

    // the glowing solid heart — held darker than the cage so the headline
    // figure at the centre stays readable on top of it
    const solidGeometry = new THREE.SphereGeometry(4.62, 64, 64);
    const solidMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE[0],
      transparent: true,
      opacity: 0.94,
    });
    const solidGlobe = new THREE.Mesh(solidGeometry, solidMaterial);
    scene.add(solidGlobe);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.enableZoom = false;
    controls.enablePan = false;

    const colors = PALETTE.map((c) => new THREE.Color(c));
    let colorIndex = 0;
    let nextColorIndex = 1;
    let colorT = 0;

    const fit = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ease = (cur: number, target: number, tau: number, dt: number) =>
      cur + (target - cur) * (1 - Math.exp(-dt / tau));

    const current = new THREE.Color();
    const heart = new THREE.Color();
    let energy = 1;
    let amp = 1;
    let cold = 0;
    let flare = 0;
    let lastSeq = celebrateRef.current?.seq ?? 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const m = modeRef.current;
      const level = m === "speaking" ? (levelRef.current?.() ?? 0.5) : 0;

      const cs = celebrateRef.current;
      if (cs && cs.seq !== lastSeq) {
        lastSeq = cs.seq;
        if (cs.tier !== "minor") flare = cs.tier === "record" ? 1.6 : 1;
      }
      flare *= Math.exp(-dt / 0.8);

      const reduced = mq.matches;
      const targetEnergy =
        m === "error" ? 0.12 : m === "working" ? 3.2 : m === "listening" ? 0.55 : m === "speaking" ? 1.4 : 1;
      const targetAmp = m === "speaking" ? 0.6 + 1.1 * level : m === "listening" ? 0.75 : m === "error" ? 0.5 : 1;
      energy = ease(energy, reduced ? 0 : targetEnergy, 0.5, dt);
      amp = ease(amp, targetAmp, m === "speaking" ? 0.06 : 0.4, dt);
      cold = ease(cold, m === "error" ? 1 : 0, 0.5, dt);

      // one palette step per second (frozen when the OS asks for less motion)
      if (!reduced) {
        colorT += dt;
        while (colorT >= 1) {
          colorT -= 1;
          colorIndex = nextColorIndex;
          nextColorIndex = (nextColorIndex + 1) % colors.length;
        }
      }
      current.lerpColors(colors[colorIndex], colors[nextColorIndex], colorT);
      current.lerp(COLD, cold);

      wireframeMaterial.color.copy(current);
      wireframeMaterial.opacity = Math.min(1, 0.5 * amp + 0.35 * flare);
      heart.copy(current).multiplyScalar(0.52 + 0.1 * flare);
      solidMaterial.color.copy(heart);
      (atmosphereMaterial.uniforms.glowColor.value as THREE.Color).copy(current);
      atmosphereMaterial.uniforms.uIntensity.value = (0.75 + 0.45 * amp + 1.1 * flare) * (1 - 0.5 * cold);

      wireframeGlobe.rotation.y += 0.06 * energy * dt * (1 + 2.5 * flare);
      solidGlobe.rotation.y += 0.06 * energy * dt;
      atmosphereMesh.rotation.y += 0.03 * energy * dt;

      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      wireframeGeometry.dispose();
      wireframeMaterial.dispose();
      solidGeometry.dispose();
      solidMaterial.dispose();
      renderer.dispose();
      // three creates a fresh canvas per mount, so (unlike the old raw-WebGL
      // core) tearing this one down is safe under StrictMode remounts
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`wire-core mode-${mode}`} aria-hidden="true">
      <div className="wire-glow" />
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* the month's number, floating at the orb's heart. Decorative: the
          panels carry the same figures for screen readers. */}
      {readout && (
        <div className="core-readout">
          <span className="core-cap">{readout.bigLabel}</span>
          <b className={`core-big h-${readout.bigHealth}`}>{readout.big}</b>
        </div>
      )}

      {/* one label per channel, ringing the orb on the wall outside it */}
      <div className="core-dial">
        {wires.map((s, i) => {
          const ang = labelAngle(i);
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
              <b>{s.value}</b>
              <em>{arrowOf(s)}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}
