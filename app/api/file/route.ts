import { NextResponse } from "next/server";
import { readVaultFile } from "@/lib/vault";

// ---------------------------------------------------------------------------
// GET /api/file?path=inbox/reports/decks/<name>.(html|pptx|png) — serves a
// generated deck artifact from the vault. Prefix + extension allowlisted in
// lib/vault.ts (readVaultFile); HTML is sandboxed by CSP because it is a
// self-contained file (inline CSS + SVG, no scripts).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? "";
  const file = readVaultFile(rel);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": MIME[file.ext],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (file.ext === "html") {
    headers["Content-Security-Policy"] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  } else if (file.ext === "pptx") {
    headers["Content-Disposition"] = `attachment; filename="${rel.split("/").pop()}"`;
  }
  return new Response(new Uint8Array(file.buf), { status: 200, headers });
}
