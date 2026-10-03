import fs from "fs";
import { Readable } from "stream";
import { CreativeError, readCreativeAsset } from "@/lib/creativeIntelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request) {
  try {
    const asset = readCreativeAsset(new URL(req.url).searchParams.get("id") || "");
    const headers: Record<string, string> = {
      "Content-Type": asset.mime, "Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    };
    const range = req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.size}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, asset.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(asset.size - 1, Number(match[2])) : asset.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.size}` } });
      headers["Content-Range"] = `bytes ${start}-${end}/${asset.size}`;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(Readable.toWeb(fs.createReadStream(asset.file, { start, end })) as ReadableStream, { status: 206, headers });
    }
    headers["Content-Length"] = String(asset.size);
    return new Response(Readable.toWeb(fs.createReadStream(asset.file)) as ReadableStream, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof CreativeError ? error.message : "Could not load creative media." }, { status: error instanceof CreativeError ? error.status : 500 });
  }
}
