"use client";

import { useEffect, useRef, useState } from "react";
import { fmtINR } from "@/lib/format";

// ---------------------------------------------------------------------------
// Primitives shared by every console panel — typographic heading, sparkline,
// count-up. No chrome, no boxes: the panels are text on the scrims.
// ---------------------------------------------------------------------------

export function SectionTitle({ title, tick, href, tickCls }: { title: string; tick?: string; href?: string; tickCls?: string }) {
  return (
    <h2 className="sec-title">
      {href ? (
        <a className="sec-link" href={href} target="_blank" rel="noreferrer">
          {title} ↗
        </a>
      ) : (
        <span>{title}</span>
      )}
      {tick && <span className={`tick ${tickCls ?? ""}`}>{tick}</span>}
    </h2>
  );
}

/** Clickable-row semantics for non-button markup: focusable + Enter/Space. */
export function pressable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

/** In-theme loading placeholder — shimmer lines inside a panel. */
export function PanelLoading({ lines = 2 }: { lines?: number }) {
  return (
    <div className="panel-loading" role="status" aria-label="loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel-line" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Inline sparkline. `null` gaps are skipped; <2 points renders a flat rule. */
export function Sparkline({ points, className = "" }: { points: (number | null)[]; className?: string }) {
  const idx = points.map((v, i) => [v, i] as const).filter((p): p is readonly [number, number] => p[0] !== null);
  if (idx.length < 2) return <div className={`spark spark-flat ${className}`} aria-hidden="true" />;
  const vals = idx.map((p) => p[0]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 100;
  const H = 16;
  const n = points.length - 1 || 1;
  const path = idx
    .map(([v, i], k) => {
      const x = (i / n) * W;
      const y = H - 2 - ((v - min) / range) * (H - 4);
      return `${k === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const [lastV, lastI] = idx[idx.length - 1];
  const lastY = H - 2 - ((lastV - min) / range) * (H - 4);
  const firstV = idx[0][0];
  const trend =
    lastV > firstV ? `trending up over ${idx.length} points` : lastV < firstV ? `trending down over ${idx.length} points` : `flat over ${idx.length} points`;
  return (
    <svg
      className={`spark ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={trend}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <circle cx={(lastI / n) * W} cy={lastY} r="1.8" fill="currentColor" />
    </svg>
  );
}

/** Animated count-up. `format` defaults to Indian grouping. */
export function CountUp({ value, format = fmtINR }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) {
      setDisplay(value);
      return;
    }
    // reduced motion: no per-frame re-render churn — land on the value at once
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const dur = 1400;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(display)}</>;
}

const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Odometer digits. Renders an already-formatted string; each digit sits in a
 * clipped mask over an invisible in-flow ghost (which keeps width + baseline
 * exact in any typography context) and rolls vertically when the value
 * changes. Digits key by place-from-the-right so 9,999 → 10,000 rolls the
 * digits that actually turned over. The first value a mount sees never rolls
 * (boot stays still) and reduced motion disables the roll entirely.
 */
export function NumberRoll({ text, className = "" }: { text: string; className?: string }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // arm transitions a frame after first paint so mount lands, not rolls
    const raf = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const chars = Array.from(text);
  const n = chars.length;
  return (
    <span className={`nroll ${live ? "live" : ""} ${className}`}>
      {/* plain copy for screen readers; the rolling chars are decorative */}
      <span className="vh">{text}</span>
      {chars.map((ch, i) => {
        const key = n - i; // place value, counted from the units end
        if (ch < "0" || ch > "9") {
          return (
            <span className="nroll-c" key={`c${key}`} aria-hidden="true">
              {ch}
            </span>
          );
        }
        const d = ch.charCodeAt(0) - 48;
        return (
          <span className="nroll-d" key={`d${key}`} aria-hidden="true">
            <span className="nroll-ghost">{ch}</span>
            <span className="nroll-strip" style={{ transform: `translateY(${-d * 10}%)` }}>
              {STRIP.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Map a verdict colour to the CSS status class used across panels. */
export function verdictCls(v: string | undefined | null): string {
  return v === "green" ? "ok" : v === "amber" ? "warn" : v === "red" ? "bad" : "na";
}
