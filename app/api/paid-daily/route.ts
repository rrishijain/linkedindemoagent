import { NextResponse } from "next/server";
import { readPaidDaily } from "@/lib/paidDaily";

export const dynamic = "force-dynamic";

// Day-wise paid history for the Paid Media detail overlay. Deliberately NOT
// folded into /api/state: that is polled every 5s by every open tab, and this
// payload is ~90 days × campaigns. The console fetches this once, when the
// overlay opens.
export async function GET() {
  try {
    return NextResponse.json(readPaidDaily(90), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "could not read paid history" }, { status: 500 });
  }
}
