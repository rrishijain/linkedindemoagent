import { NextResponse } from "next/server";
import { getNewsShorts } from "@/lib/newsShorts";

// ---------------------------------------------------------------------------
// GET /api/ainews-shorts — last-24h AI story deck (Tavily + og:image).
// Cached in lib/newsShorts (4h TTL + disk cache — Tavily credits are a
// budget); this route never 500s on upstream failures.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getNewsShorts());
}
