import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// CSRF / origin guard for the localhost-only console. Every mutating request to
// /api/* must come from the console itself: the Host header must be the local
// bind (localhost:3107 / 127.0.0.1:3107) and, when a browser attaches an
// Origin header, it must be a localhost origin too. A malicious web page in
// the same browser can't forge either, so drive-by POSTs to the queue/voice
// endpoints die here with a 403. GETs pass through untouched.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3107",
  "http://127.0.0.1:3107",
]);

const ALLOWED_HOSTS = new Set(["localhost:3107", "127.0.0.1:3107"]);

export function middleware(req: NextRequest) {
  if (req.method === "GET") return NextResponse.next();

  const host = req.headers.get("host") ?? "";
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json({ error: "forbidden host" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
