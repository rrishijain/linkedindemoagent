import { NextResponse } from "next/server";
import { toggleTop3 } from "@/lib/vault";
import { isPlainObject, requireBoolean, requireInt } from "@/lib/validate";

// POST /api/daily {index, done} — flip a Top 3 checkbox in TODAY's note.
// The console's Directives panel calls this; stale notes are read-only.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!isPlainObject(raw)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  // the daily-note parser only recognizes the three Top 3 checkboxes
  const index = requireInt(raw.index, "index", { min: 0, max: 2 });
  if (!index.ok) {
    return NextResponse.json({ error: index.error }, { status: 400 });
  }
  const done = requireBoolean(raw.done, "done");
  if (!done.ok) {
    return NextResponse.json({ error: done.error }, { status: 400 });
  }

  let ok: boolean;
  try {
    ok = toggleTop3(index.value, done.value);
  } catch (e) {
    console.error("[api/daily] toggleTop3 write failed:", e);
    return NextResponse.json({ error: "failed to write today's note" }, { status: 500 });
  }
  if (!ok) {
    return NextResponse.json({ error: "no matching checkbox in today's note" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
