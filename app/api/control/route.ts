import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { VAULT_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const FILE_RE = /^[0-9a-fA-F-]{1,64}\.json$/;
const ACTIONS = new Set(["approve", "reject", "requeue", "discard"]);

const SYSTEM_DIR = join(VAULT_ROOT, "system");
const QUEUE_DIR = join(SYSTEM_DIR, "queue");
const PROCESSING_DIR = join(QUEUE_DIR, "processing");
const PENDING_DIR = join(QUEUE_DIR, "pending-approval");
const FAILED_DIR = join(QUEUE_DIR, "failed");
const RUNS_DIR = join(SYSTEM_DIR, "runs");
const STATUS_FILE = join(SYSTEM_DIR, "runner-status.json");

type JsonObject = Record<string, unknown>;
type FileRecord = JsonObject & { file: string };
type ControlAction = "approve" | "reject" | "requeue" | "discard";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isJsonObject(value)) throw new Error("JSON value is not an object");
  return value;
}

function readDirectory(directory: string): FileRecord[] {
  let files: string[];
  try {
    files = readdirSync(directory).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }

  const records: FileRecord[] = [];
  for (const file of files) {
    try {
      records.push({ ...readJsonObject(join(directory, file)), file });
    } catch {
      // A single incomplete or malformed file must not break the control feed.
    }
  }
  return records;
}

function timestamp(record: JsonObject): number {
  for (const key of ["ts_completed", "ts_started", "ts"] as const) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function newestFirst<T extends JsonObject>(records: T[]): T[] {
  return records.sort((a, b) => timestamp(b) - timestamp(a));
}

function readRunner(): JsonObject | null {
  try {
    const heartbeat = readJsonObject(STATUS_FILE);
    const parsed = typeof heartbeat.ts === "string" ? Date.parse(heartbeat.ts) : Number.NaN;
    const stale = !Number.isFinite(parsed) || Date.now() - parsed > 120_000;
    return { ...heartbeat, stale };
  } catch {
    return null;
  }
}

function readFailed(): FileRecord[] {
  return newestFirst(readDirectory(FAILED_DIR)).map((intent) => {
    let note: string | null = null;
    try {
      note = readFileSync(`${join(FAILED_DIR, intent.file)}.note.txt`, "utf8").trim() || null;
    } catch {
      // Notes are optional; the quarantined intent is still useful without one.
    }
    return { ...intent, note, file: intent.file };
  });
}

export async function GET() {
  const runs = newestFirst(readDirectory(RUNS_DIR))
    .slice(0, 40)
    .map(({ file: _file, ...run }) => run);

  return NextResponse.json(
    {
      runner: readRunner(),
      queue: newestFirst(readDirectory(QUEUE_DIR)),
      processing: newestFirst(readDirectory(PROCESSING_DIR)),
      pending: newestFirst(readDirectory(PENDING_DIR)),
      failed: readFailed(),
      runs,
    },
    { headers: NO_STORE },
  );
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function safeFilePath(directory: string, file: string): string | null {
  if (!FILE_RE.test(file) || file.includes("/") || file.includes("\\")) return null;
  const root = resolve(directory);
  const candidate = resolve(root, file);
  return dirname(candidate) === root ? candidate : null;
}

function sourceDirectory(action: ControlAction): string {
  return action === "approve" || action === "reject" ? PENDING_DIR : FAILED_DIR;
}

function destinationDirectory(action: ControlAction): string | null {
  if (action === "approve" || action === "requeue") return QUEUE_DIR;
  if (action === "reject") return FAILED_DIR;
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad json", 400);
  }

  if (!isJsonObject(body)) return jsonError("body must be a JSON object", 400);
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) {
    return jsonError("action must be one of: approve, reject, requeue, discard", 400);
  }
  if (typeof body.file !== "string") return jsonError("file must be a string", 400);

  const action = body.action as ControlAction;
  const source = safeFilePath(sourceDirectory(action), body.file);
  if (!source) return jsonError("invalid file", 400);
  if (!existsSync(source)) return jsonError("source file not found", 404);

  const destinationDir = destinationDirectory(action);
  const destination = destinationDir ? safeFilePath(destinationDir, body.file) : null;
  if (destinationDir && !destination) return jsonError("invalid destination", 400);

  try {
    if (action === "approve") {
      mkdirSync(QUEUE_DIR, { recursive: true });
      if (existsSync(destination!)) return jsonError("destination file already exists", 409);

      const intent = readJsonObject(source);
      const temp = join(QUEUE_DIR, `.control-${process.pid}-${randomUUID()}.tmp`);
      try {
        writeFileSync(temp, `${JSON.stringify({ ...intent, approved: true }, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
        renameSync(temp, destination!);
      } catch (error) {
        try {
          if (existsSync(temp)) unlinkSync(temp);
        } catch {
          // Preserve the original error; the temp path is scoped to queue/.
        }
        throw error;
      }
      unlinkSync(source);
    } else if (action === "reject") {
      mkdirSync(FAILED_DIR, { recursive: true });
      if (existsSync(destination!)) return jsonError("destination file already exists", 409);
      renameSync(source, destination!);
      writeFileSync(
        `${destination!}.note.txt`,
        `rejected from Control Room at ${new Date().toISOString()}\n`,
        "utf8",
      );
    } else if (action === "requeue") {
      mkdirSync(QUEUE_DIR, { recursive: true });
      if (existsSync(destination!)) return jsonError("destination file already exists", 409);
      renameSync(source, destination!);
      const note = `${source}.note.txt`;
      if (existsSync(note)) unlinkSync(note);
    } else {
      unlinkSync(source);
      const note = `${source}.note.txt`;
      if (existsSync(note)) unlinkSync(note);
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 500);
  }
}
