// ---------------------------------------------------------------------------
// Gen-AI newsdesk — pulls the top players' own RSS/Atom feeds server-side,
// merges + dedupes + sorts, and caches in module memory. No keys, no spend:
// these are public feeds. Anthropic / Meta AI / Mistral publish no RSS
// (probed 2026-08-31) — the press feeds below carry their launches instead.
// Served by /api/ainews; rendered by components/panels/AiNews.tsx.
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  link: string;
  /** short uppercase source tag shown in the panel */
  source: string;
  /** epoch ms; 0 when the feed gave no parseable date */
  ts: number;
}

const FEEDS: { source: string; url: string; filter?: boolean }[] = [
  { source: "OPENAI", url: "https://openai.com/news/rss.xml" },
  { source: "DEEPMIND", url: "https://deepmind.google/blog/rss.xml" },
  { source: "GOOGLE", url: "https://blog.google/technology/ai/rss/" },
  { source: "HF", url: "https://huggingface.co/blog/feed.xml" },
  { source: "SMOL", url: "https://news.smol.ai/rss.xml" },
  // press "AI" categories let drones/chips/policy through — filter to gen-AI
  { source: "TC", url: "https://techcrunch.com/category/artificial-intelligence/feed/", filter: true },
  { source: "VERGE", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", filter: true },
  { source: "VB", url: "https://venturebeat.com/category/ai/feed/", filter: true },
];

// gen-AI relevance gate for press feeds: the story must name a top lab, a
// frontier model, or an LLM-tool concept in its TITLE. Lab feeds skip this.
// Exported for lib/newsShorts.ts, which gates Tavily results the same way.
export const GEN_AI_RE = new RegExp(
  [
    "openai", "chatgpt", "gpt-?\\d", "\\bgpt\\b", "anthropic", "claude", "gemini",
    "deepmind", "llama", "meta ai", "mistral", "\\bgrok\\b", "\\bxai\\b", "x\\.ai",
    "deepseek", "qwen", "\\bkimi\\b", "moonshot", "perplexity", "hugging ?face",
    "midjourney", "stability ai", "stable diffusion", "\\bsora\\b", "\\bveo\\b",
    "nano banana", "imagen", "notebooklm", "copilot", "\\bcodex\\b", "claude code",
    "cursor", "windsurf", "vibe cod", "coding assistant", "ai coding",
    "\\bllms?\\b", "large language", "generative ai", "gen ai", "genai",
    "foundation model", "frontier model", "reasoning model", "ai model",
    "ai agents?", "agentic", "chatbot", "ai assistant", "superintelligen", "\\bagi\\b",
  ].join("|"),
  "i"
);

const PER_FEED = 8; // newest N per feed so one noisy outlet can't flood
const TOTAL_CAP = 40;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const TTL_MS = 12 * 60 * 1000; // refetch at most every 12 min
const FETCH_TIMEOUT_MS = 6000;

// --- tiny feed parser (RSS <item> + Atom <entry>) --------------------------
// A regex parser is deliberate: zero deps, and feed XML this simple doesn't
// need a tree. Anything unparseable just yields no items.

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(raw: string): string {
  return decodeEntities(
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/^\[AINews\]\s*/i, "") // smol.ai prefixes every digest
    .replace(/\s+/g, " ")
    .trim();
}

function field(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function itemLink(block: string): string | null {
  // Atom: <link rel="alternate" href="…"/> (rel-less first link otherwise)
  const atom =
    block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) ??
    block.match(/<link[^>]*href="([^"]+)"/i);
  // RSS: <link>https://…</link>
  const rss = field(block, "link");
  const raw = rss && /^https?:\/\//.test(cleanText(rss)) ? cleanText(rss) : atom?.[1] ?? null;
  return raw ? decodeEntities(raw) : null;
}

function itemTs(block: string): number {
  for (const tag of ["pubDate", "published", "updated", "dc:date"]) {
    const v = field(block, tag);
    if (v) {
      const t = Date.parse(cleanText(v));
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
}

export function parseFeed(xml: string, source: string, filter = false): NewsItem[] {
  const blocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g) ?? [];
  const out: NewsItem[] = [];
  for (const b of blocks) {
    const title = field(b, "title");
    const link = itemLink(b);
    if (!title || !link) continue;
    const t = cleanText(title);
    if (!t) continue;
    if (filter && !GEN_AI_RE.test(t)) continue; // press item off the gen-AI beat
    out.push({ title: t, link, source, ts: itemTs(b) });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, PER_FEED);
}

// --- fetch + cache ----------------------------------------------------------

let cache: { at: number; items: NewsItem[]; feeds_ok: number } | null = null;
let inFlight: Promise<{ items: NewsItem[]; feeds_ok: number }> | null = null;

async function fetchAll(): Promise<{ items: NewsItem[]; feeds_ok: number }> {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) ARGUS-Console/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      return parseFeed(await res.text(), f.source, f.filter === true);
    })
  );
  const now = Date.now();
  const merged: NewsItem[] = [];
  const seenTokens: Set<string>[] = [];
  const tokensOf = (t: string) =>
    new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 3));
  let ok = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    ok++;
    for (const item of r.value) {
      if (item.ts !== 0 && now - item.ts > MAX_AGE_MS) continue;
      // fuzzy dedupe: two outlets word the same story differently ("Sony,
      // Warner sue Anthropic" vs "Sony Music … are suing Anthropic") — if
      // most significant words already appeared in one title, skip this one
      const tok = tokensOf(item.title);
      const dupe =
        tok.size > 0 &&
        seenTokens.some((prev) => {
          let hit = 0;
          for (const w of tok) if (prev.has(w)) hit++;
          return hit / Math.min(tok.size, prev.size || 1) >= 0.55;
        });
      if (dupe) continue;
      seenTokens.push(tok);
      merged.push(item);
    }
  }
  merged.sort((a, b) => b.ts - a.ts);
  return { items: merged.slice(0, TOTAL_CAP), feeds_ok: ok };
}

/** cached newsdesk — never throws; a total failure serves the stale cache
 *  (or empty) rather than a 500 */
export async function getAiNews(): Promise<{
  generated_at: string;
  items: NewsItem[];
  feeds_ok: number;
  feeds_total: number;
}> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    if (!inFlight) {
      inFlight = fetchAll().finally(() => {
        inFlight = null;
      });
    }
    try {
      const fresh = await inFlight;
      // keep the old list when every feed suddenly fails — stale beats blank
      if (fresh.items.length > 0 || !cache) {
        cache = { at: Date.now(), ...fresh };
      } else {
        cache = { ...cache, at: Date.now() };
      }
    } catch {
      cache = cache ?? { at: Date.now(), items: [], feeds_ok: 0 };
    }
  }
  return {
    generated_at: new Date(cache.at).toISOString(),
    items: cache.items,
    feeds_ok: cache.feeds_ok,
    feeds_total: FEEDS.length,
  };
}
