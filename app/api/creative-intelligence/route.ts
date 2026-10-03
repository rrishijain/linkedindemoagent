import { NextResponse } from "next/server";
import { CreativeError, createCreativeBrief, getCreativeState, queueCreativeBrief, startCreativeJob } from "@/lib/creativeIntelligence";
import { isPlainObject } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof CreativeError ? error.message : "Creative Intelligence could not complete this request." }, { status: error instanceof CreativeError ? error.status : 500 });
}

export function GET() {
  try { return NextResponse.json(getCreativeState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 }); }
  if (!isPlainObject(raw)) return NextResponse.json({ error: "Expected an action." }, { status: 400 });
  try {
    if (raw.action === "refresh" || raw.action === "analyze") {
      if (raw.ad_id !== undefined && (typeof raw.ad_id !== "string" || !/^\d+$/.test(raw.ad_id))) throw new CreativeError("Invalid ad identifier.");
      return NextResponse.json({ job: startCreativeJob(raw.action, raw.ad_id as string | undefined) }, { status: 202 });
    }
    if (raw.action === "brief" && typeof raw.ad_id === "string" && /^\d+$/.test(raw.ad_id) && typeof raw.experiment === "string" && raw.experiment.length <= 2000) {
      return NextResponse.json({ brief: createCreativeBrief(raw.ad_id, raw.experiment) }, { status: 201 });
    }
    if (raw.action === "queue_brief" && typeof raw.brief_id === "string") return NextResponse.json(queueCreativeBrief(raw.brief_id));
    return NextResponse.json({ error: "Unknown action or invalid arguments." }, { status: 400 });
  } catch (error) { return failure(error); }
}
