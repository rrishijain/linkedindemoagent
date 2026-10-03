import { NextResponse } from "next/server";
import { getAiNews } from "@/lib/ainews";

// ---------------------------------------------------------------------------
// GET /api/ainews — merged gen-AI headlines from the top players' own feeds.
// Cached in lib/ainews (12 min TTL); this route never 500s on feed failures.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAiNews());
}
