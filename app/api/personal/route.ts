import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { CONSOLE_TZ, VAULT_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CONSOLE_TZ }).format(new Date());
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\r\n]+/g, " ").trim();
  return text.length <= max ? text : null;
}

function replaceSection(note: string, heading: string, body: string): string {
  const marker = `## ${heading}`;
  const start = note.indexOf(marker);
  if (start < 0) return `${note.trimEnd()}\n\n${marker}\n\n${body}\n`;
  const contentStart = start + marker.length;
  const next = note.indexOf("\n## ", contentStart);
  return `${note.slice(0, contentStart)}\n\n${body}\n${next < 0 ? "" : note.slice(next + 1)}`;
}

export async function PUT(req: Request) {
  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = input as Record<string, unknown>;
  if (!Array.isArray(body.priorities) || body.priorities.length !== 3 || !Array.isArray(body.schedule) || body.schedule.length > 20) {
    return NextResponse.json({ error: "Use three priorities and up to 20 schedule items" }, { status: 400 });
  }
  const priorities = body.priorities.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const p = item as Record<string, unknown>;
    const text = cleanText(p.text, 180);
    return text === null || typeof p.done !== "boolean" ? null : { text, done: p.done };
  });
  const schedule = body.schedule.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const s = item as Record<string, unknown>;
    const title = cleanText(s.item, 180);
    return typeof s.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) && title ? { time: s.time, item: title } : null;
  });
  const focus = cleanText(body.focus, 240);
  if (priorities.some((item) => item === null) || schedule.some((item) => item === null) || focus === null) {
    return NextResponse.json({ error: "Check the text and times" }, { status: 400 });
  }
  const date = today();
  const file = path.join(VAULT_ROOT, "daily-notes", `${date}.md`);
  const initial = `---\ndate: ${date}\nschema_version: 1\nfocus: ""\n---\n\n# ${date}\n\n## Top 3 Priorities\n\n## Schedule\n\n## Current Focus\n\n## Notes\n\n`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let note = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : initial;
    const p = priorities as { text: string; done: boolean }[];
    const s = schedule as { time: string; item: string }[];
    note = replaceSection(note, "Top 3 Priorities", p.map((item, i) => `${i + 1}. [${item.done ? "x" : " "}] ${item.text}`).join("\n"));
    note = replaceSection(note, "Schedule", s.map((item) => `- ${item.time} — ${item.item}`).join("\n"));
    note = replaceSection(note, "Current Focus", focus);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, note, "utf8");
    fs.renameSync(tmp, file);
    return NextResponse.json({ ok: true, date });
  } catch (error) {
    console.error("[api/personal]", error);
    return NextResponse.json({ error: "Could not save today's note" }, { status: 500 });
  }
}
