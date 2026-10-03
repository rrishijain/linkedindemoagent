import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { VAULT_ROOT } from "@/lib/config";
import { readDailyNote } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let active = false;

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const question = (raw as Record<string, unknown>).question;
  if (typeof question !== "string" || !question.trim() || question.length > 1000) {
    return NextResponse.json({ error: "Enter a question under 1,000 characters" }, { status: 400 });
  }
  if (active) return NextResponse.json({ error: "Jarvis is answering another question" }, { status: 429 });
  const note = readDailyNote();
  const context = note?.isToday ? JSON.stringify({ priorities: note.top3.filter((item) => item.text.trim()), schedule: note.schedule, focus: note.focus }) : "No daily plan has been saved today.";
  const prompt = `You are Jarvis, Rishi's concise personal assistant. Answer the user's question using the saved plan below and general reasoning. If data from Google Calendar, Gmail, Google Tasks, Notion or Slack is needed, state that live sync is not connected yet. Do not claim to have checked those accounts. Do not make file changes or run commands. Keep the answer under 180 words.\n\nSaved plan: ${context}\n\nQuestion: ${question.trim()}`;

  active = true;
  try {
    const answer = await new Promise<string>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(["PATH", "HOME", "CODEX_HOME", "USER", "LANG", "TMPDIR"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])) };
      const child = spawn("codex", ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "-C", VAULT_ROOT, prompt], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let error = "";
      const timeout = setTimeout(() => child.kill("SIGTERM"), 120_000);
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.length > 12_000) child.kill("SIGTERM"); });
      child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString().slice(0, 2000); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 && output.trim()) resolve(output.trim());
        else reject(new Error(error.includes("not logged in") ? "Codex sign-in is needed" : "Codex could not answer right now"));
      });
    });
    return NextResponse.json({ answer });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Codex could not answer" }, { status: 503 });
  } finally {
    active = false;
  }
}
