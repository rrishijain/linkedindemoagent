"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { PanelLoading, SectionTitle } from "./shared";

// ---------------------------------------------------------------------------
// AI Newsdesk — two layers in one panel:
//   1. AI Shorts: a swipeable story deck (image + headline + one-line summary)
//      of the last 24h, from /api/ainews-shorts (Tavily, server-cached 4h).
//      Swipe/drag, ‹ › arrows, dots, auto-advance; tap opens the article.
//   2. The live headline list from /api/ainews (free RSS, no keys) below it —
//      and standing alone when Tavily has no key or no stories.
// Distinct from the right column's "AI Wire", which reads the morning-intel
// note's headlines.
// ---------------------------------------------------------------------------

interface NewsItem {
  title: string;
  link: string;
  source: string;
  ts: number;
}
interface NewsPayload {
  generated_at: string;
  items: NewsItem[];
  feeds_ok: number;
  feeds_total: number;
}
interface ShortItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  image: string | null;
  ts: number;
}
interface ShortsPayload {
  generated_at: string;
  ok: boolean;
  reason?: "no-key" | "fetch-failed";
  items: ShortItem[];
}

const REFRESH_MS = 15 * 60 * 1000;
const SHORTS_REFRESH_MS = 30 * 60 * 1000; // server TTL gates real spend
const ADVANCE_MS = 12_000;
const SWIPE_PX = 45; // drag past this → change card
const TAP_PX = 8; // under this → it was a click, open the story

function age(ts: number): string {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// --- the swipe deck ---------------------------------------------------------

function ShortsDeck({ items }: { items: ShortItem[] }) {
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // px offset while dragging
  const [paused, setPaused] = useState(false);
  const startX = useRef(0);
  const moved = useRef(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // broken og:image URLs collapse to the monogram fallback
  const [deadImgs, setDeadImgs] = useState<Set<string>>(new Set());

  const go = useCallback(
    (next: number) => setIdx(Math.max(0, Math.min(items.length - 1, next))),
    [items.length]
  );

  // auto-advance, wrapping — parked while hovered, dragging, or tab hidden
  useEffect(() => {
    if (paused || drag !== null || items.length < 2) return;
    const id = setInterval(() => {
      if (!document.hidden) setIdx((i) => (i + 1) % items.length);
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, drag, items.length]);

  // a refreshed deck can be shorter than the index we were on
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    moved.current = false;
    setDrag(0);
    trackRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > TAP_PX) moved.current = true;
    // rubber-band at the ends instead of sliding into nothing
    const atEdge = (dx > 0 && idx === 0) || (dx < 0 && idx === items.length - 1);
    setDrag(atEdge ? dx / 3 : dx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    const dx = e.clientX - startX.current;
    setDrag(null);
    if (dx <= -SWIPE_PX) go(idx + 1);
    else if (dx >= SWIPE_PX) go(idx - 1);
    else if (!moved.current) {
      window.open(items[idx].url, "_blank", "noopener");
    }
  };

  const cur = items[idx];
  return (
    <div
      className="shorts"
      role="group"
      aria-roledescription="carousel"
      aria-label={`AI shorts, story ${idx + 1} of ${items.length}: ${cur?.title ?? ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(idx - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(idx + 1);
        } else if (e.key === "Enter" && cur) {
          window.open(cur.url, "_blank", "noopener");
        }
      }}
      tabIndex={0}
    >
      <div
        ref={trackRef}
        className={`shorts-track ${drag !== null ? "dragging" : ""}`}
        style={{ transform: `translateX(calc(${-idx * 100}% + ${drag ?? 0}px))` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {items.map((s) => (
          <article className="shorts-card" key={s.url}>
            {s.image && !deadImgs.has(s.url) ? (
              <img
                className="shorts-img"
                src={s.image}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() =>
                  setDeadImgs((d) => {
                    const next = new Set(d);
                    next.add(s.url);
                    return next;
                  })
                }
              />
            ) : (
              <div className="shorts-img shorts-img-fallback" aria-hidden="true">
                {s.source.slice(0, 2)}
              </div>
            )}
            <div className="shorts-scrim">
              <div className="shorts-meta">
                <span className="shorts-src">{s.source}</span>
                {s.ts > 0 && <span className="shorts-age">{age(s.ts)}</span>}
              </div>
              <div className="shorts-headline">{s.title}</div>
              {s.summary && <div className="shorts-sub">{s.summary}</div>}
            </div>
          </article>
        ))}
      </div>

      {items.length > 1 && (
        <>
          <button
            className="shorts-nav prev"
            aria-label="previous story"
            disabled={idx === 0}
            onClick={() => go(idx - 1)}
          >
            ‹
          </button>
          <button
            className="shorts-nav next"
            aria-label="next story"
            disabled={idx === items.length - 1}
            onClick={() => go(idx + 1)}
          >
            ›
          </button>
          <div className="shorts-dots" aria-hidden="true">
            {items.map((s, i) => (
              <button
                key={s.url}
                className={i === idx ? "on" : ""}
                tabIndex={-1}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- the panel --------------------------------------------------------------

export default memo(function AiNews({ hot }: { hot?: boolean }) {
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [shorts, setShorts] = useState<ShortsPayload | null>(null);

  useEffect(() => {
    let dead = false;
    const pull = () =>
      fetch("/api/ainews", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: NewsPayload | null) => {
          if (dead) return;
          if (j) {
            setNews(j);
            setStatus("ok");
          } else {
            setStatus((s) => (s === "ok" ? s : "error")); // keep old items visible
          }
        })
        .catch(() => {
          if (!dead) setStatus((s) => (s === "ok" ? s : "error"));
        });
    const pullShorts = () =>
      fetch("/api/ainews-shorts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: ShortsPayload | null) => {
          if (!dead && j) setShorts(j);
        })
        .catch(() => {});
    void pull();
    void pullShorts();
    const id = setInterval(pull, REFRESH_MS);
    const id2 = setInterval(pullShorts, SHORTS_REFRESH_MS);
    return () => {
      dead = true;
      clearInterval(id);
      clearInterval(id2);
    };
  }, []);

  const hasDeck = (shorts?.items.length ?? 0) > 0;
  const tick =
    status === "loading" && !news
      ? "LOADING"
      : status === "error" && !news
        ? "FEED DOWN"
        : hasDeck
          ? "SHORTS · 24H"
          : `LIVE · ${news?.feeds_ok ?? 0}/${news?.feeds_total ?? 0} FEEDS`;

  return (
    <section
      className={`block accent-coral boot-stagger ${hot ? "voice-hot" : ""}`}
      style={{ animationDelay: "0.06s" }}
    >
      <SectionTitle
        title="AI Newsdesk"
        tick={tick}
        tickCls={status === "error" && !news ? "bad" : !news && !hasDeck ? "dim" : ""}
      />
      {hasDeck && <ShortsDeck items={shorts!.items} />}
      {status === "loading" && !news && !hasDeck ? (
        <PanelLoading />
      ) : !news ? (
        hasDeck ? null : (
          <div className="prio dim">news feed unreachable — retrying every 15 min</div>
        )
      ) : news.items.length === 0 && !hasDeck ? (
        <div className="prio dim">no headlines right now</div>
      ) : (
        <div className={`ainews-list ${hasDeck ? "under-deck" : ""}`}>
          {news.items.map((n, i) => (
            <a
              className="wire-row"
              key={`${n.link}-${i}`}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="ainews-src">{n.source}</span>
              <span className="ainews-title">{n.title}</span>
              <span className="ainews-age">{age(n.ts)}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
});
