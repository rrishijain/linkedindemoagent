import fs from "fs";
import path from "path";
import { VAULT_ROOT } from "./config";
import { homeEnv } from "./homeEnv";
import { GEN_AI_RE } from "./ainews";

// ---------------------------------------------------------------------------
// AI Shorts — last-24h gen-AI stories via the Tavily news search, enriched
// with each article's own og:image so the wall can show a swipeable story
// deck (components/panels/AiNews.tsx). Distinct from lib/ainews.ts (free RSS,
// headlines only): this one SPENDS credits, so caching is the whole design.
//
// Credit budget: the free Tavily tier is 1,000 credits/month. One refresh =
// QUERIES.length basic searches = 4 credits. The 4h TTL caps spend at
// 24/day ≈ 720/month, and the disk cache below means a server restart
// re-serves the last pull instead of burning a fresh one. og:image fetches
// hit the article pages directly — no Tavily spend.
//
// Key: `tavily` in argus/.env (lowercase, same convention as eleven_labs_*;
// Next loads it into process.env) or TAVILY_API_KEY in env / ~/.claude/.env.
// ---------------------------------------------------------------------------

export interface ShortItem {
  title: string;
  url: string;
  /** short uppercase source tag, e.g. VERGE, ALJAZEERA */
  source: string;
  /** first sentences of Tavily's content snippet */
  summary: string;
  /** article og:image, or null when the page didn't offer one */
  image: string | null;
  /** epoch ms; 0 when Tavily gave no parseable date */
  ts: number;
}

export interface ShortsPayload {
  generated_at: string;
  /** false = no key configured or every query failed (items may be stale) */
  ok: boolean;
  reason?: "no-key" | "fetch-failed";
  items: ShortItem[];
}

// four buckets cover the beats the newsdesk cares about without overlapping
// much; keep this list short — each entry is one credit per refresh
const QUERIES = [
  "OpenAI ChatGPT GPT model announcement",
  "Anthropic Claude AI announcement",
  "Google Gemini DeepMind AI announcement",
  "AI LLM model release Meta Mistral xAI Grok DeepSeek",
];

const MAX_ITEMS = 8;
const TTL_MS = 4 * 3600 * 1000;
const TAVILY_TIMEOUT_MS = 15_000;
const IMG_TIMEOUT_MS = 4_000;
const CACHE_FILE = () => path.join(VAULT_ROOT, "system", "ainews-shorts.json");

function tavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY ?? process.env.tavily ?? homeEnv("TAVILY_API_KEY");
}

// --- curation ---------------------------------------------------------------

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

function sourceTag(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // "techcrunch.com" → TECHCRUNCH, "9to5mac.com" → 9TO5MAC
    return host.split(".")[0].toUpperCase().slice(0, 12);
  } catch {
    return "WEB";
  }
}

function firstSentences(content: string, max = 180): string {
  const clean = content.replace(/\s+/g, " ").replace(/^[#*\[\]>\s]+/, "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

function tokensOf(t: string): Set<string> {
  return new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 3));
}

/** merge all query results into one ranked, deduped top-N list */
function curate(batches: TavilyResult[][]): Omit<ShortItem, "image">[] {
  const now = Date.now();
  const seen: Set<string>[] = [];
  const urls = new Set<string>();
  const scored: { item: Omit<ShortItem, "image">; rank: number }[] = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (!r.title || !r.url) continue;
      const title = r.title.replace(/\s+/g, " ").trim();
      if (!GEN_AI_RE.test(title)) continue; // off the gen-AI beat
      const ts = r.published_date ? Date.parse(r.published_date) || 0 : 0;
      if (ts !== 0 && now - ts > 36 * 3600 * 1000) continue; // stale for a 24h deck
      if (urls.has(r.url)) continue;
      // fuzzy dedupe — same story worded differently across outlets
      const tok = tokensOf(title);
      const dupe =
        tok.size > 0 &&
        seen.some((prev) => {
          let hit = 0;
          for (const w of tok) if (prev.has(w)) hit++;
          return hit / Math.min(tok.size, prev.size || 1) >= 0.55;
        });
      if (dupe) continue;
      urls.add(r.url);
      seen.push(tok);
      const ageH = ts ? (now - ts) / 3600_000 : 24;
      scored.push({
        item: {
          title,
          url: r.url,
          source: sourceTag(r.url),
          summary: firstSentences(r.content ?? ""),
          ts,
        },
        // relevance first, recency as the tiebreak within the last day
        rank: (r.score ?? 0.5) - ageH / 200,
      });
    }
  }
  return scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_ITEMS)
    .map((s) => s.item);
}

// --- og:image enrichment ----------------------------------------------------

async function ogImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh) ARGUS-Console/1.0" },
      signal: AbortSignal.timeout(IMG_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    // meta tags live in <head> — the first chunk is plenty, skip the body
    const html = (await res.text()).slice(0, 120_000);
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const src = m?.[1]?.replace(/&amp;/g, "&");
    return src && /^https?:\/\//.test(src) ? src : null;
  } catch {
    return null;
  }
}

// --- fetch + two-layer cache (module memory, then disk) ---------------------

let cache: { at: number; items: ShortItem[]; ok: boolean } | null = null;
let inFlight: Promise<void> | null = null;

function readDiskCache(): void {
  if (cache) return;
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE(), "utf-8")) as {
      at?: number;
      items?: ShortItem[];
    };
    if (typeof j.at === "number" && Array.isArray(j.items)) {
      cache = { at: j.at, items: j.items, ok: true };
    }
  } catch {
    // no disk cache yet
  }
}

function writeDiskCache(): void {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE()), { recursive: true });
    fs.writeFileSync(CACHE_FILE(), JSON.stringify({ at: cache.at, items: cache.items }));
  } catch {
    // read-only vault is fine — memory cache still holds
  }
}

async function refresh(key: string): Promise<void> {
  const batches = await Promise.allSettled(
    QUERIES.map(async (query) => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          topic: "news",
          days: 1,
          search_depth: "basic",
          max_results: 8,
        }),
        signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()) as { results?: TavilyResult[] }).results ?? [];
    })
  );
  const okBatches = batches.filter((b) => b.status === "fulfilled").map((b) => b.value);
  if (okBatches.length === 0) {
    // total failure: keep stale items but stamp the attempt so we don't
    // hammer Tavily every poll — retry no sooner than 15 min from now
    cache = { at: Date.now() - TTL_MS + 15 * 60_000, items: cache?.items ?? [], ok: false };
    return;
  }
  const items = curate(okBatches);
  const images = await Promise.all(items.map((it) => ogImage(it.url)));
  cache = {
    at: Date.now(),
    items: items.map((it, i) => ({ ...it, image: images[i] })),
    ok: true,
  };
  writeDiskCache();
}

/** cached shorts deck — never throws; serves stale over blank */
export async function getNewsShorts(): Promise<ShortsPayload> {
  const key = tavilyKey();
  readDiskCache();
  if (!key) {
    return {
      generated_at: new Date(cache?.at ?? Date.now()).toISOString(),
      ok: false,
      reason: "no-key",
      items: cache?.items ?? [],
    };
  }
  if (!cache || Date.now() - cache.at > TTL_MS) {
    if (!inFlight) {
      inFlight = refresh(key).finally(() => {
        inFlight = null;
      });
    }
    try {
      await inFlight;
    } catch {
      cache = cache ?? { at: Date.now(), items: [], ok: false };
    }
  }
  return {
    generated_at: new Date(cache!.at).toISOString(),
    ok: cache!.ok,
    ...(cache!.ok ? {} : { reason: "fetch-failed" as const }),
    items: cache!.items,
  };
}
