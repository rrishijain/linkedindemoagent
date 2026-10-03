import { NextResponse } from "next/server";
import { ALLOWED_SKILLS, writeIntent } from "@/lib/skills";
import { isPlainObject, requireString, type Result } from "@/lib/validate";

// ---------------------------------------------------------------------------
// POST /api/queue {skill, args?} — drops an intent JSON into system/queue/.
// The runner daemon picks it up from system/queue/ within seconds.
// This is the "buttons are real" part. Skill list + intent
// shape live in lib/skills.ts (shared with /api/voice).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// args the deck/voice may pass; anything else is a 400 naming the bad field
// (a typo'd arg must not silently become default behavior). The runner
// re-validates (argScope/argRange/modelFor) — this is the first gate, not the
// only one.
const SCOPES = new Set(["meta", "google", "seo", "blended"]);
const RANGES = new Set([7, 30, 90]);
const MODELS = new Set(["claude-opus-4-8", "claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);

function validateArgs(raw: unknown): Result<Record<string, unknown>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, error: "args must be an object" };
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(raw)) {
    switch (key) {
      case "scope":
        if (typeof v !== "string" || !SCOPES.has(v)) {
          return { ok: false, error: `args.scope must be one of: ${[...SCOPES].join(", ")}` };
        }
        out.scope = v;
        break;
      case "range":
        if (typeof v !== "number" || !RANGES.has(v)) {
          return { ok: false, error: `args.range must be one of: ${[...RANGES].join(", ")}` };
        }
        out.range = v;
        break;
      case "model":
        if (typeof v !== "string" || !MODELS.has(v)) {
          return { ok: false, error: `args.model must be one of: ${[...MODELS].join(", ")}` };
        }
        out.model = v;
        break;
      case "topic":
        if (typeof v !== "string" || !v.trim()) {
          return { ok: false, error: "args.topic must be a non-empty string" };
        }
        out.topic = v.trim().slice(0, 200);
        break;
      case "brand":
        if (typeof v !== "string" || !v.trim()) {
          return { ok: false, error: "args.brand must be a non-empty string" };
        }
        out.brand = v.trim().slice(0, 120);
        break;
      case "count":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 30) {
          return { ok: false, error: "args.count must be an integer between 1 and 30" };
        }
        out.count = v;
        break;
      case "dry_run":
        if (typeof v !== "boolean") {
          return { ok: false, error: "args.dry_run must be a boolean" };
        }
        if (v) out.dry_run = true;
        break;
      case "creative_brief_id":
        if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) {
          return { ok: false, error: "args.creative_brief_id must be a saved brief UUID" };
        }
        out.creative_brief_id = v;
        break;
      default:
        return { ok: false, error: `unknown arg: ${key}` };
    }
  }
  return { ok: true, value: out };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!isPlainObject(raw)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const skill = requireString(raw.skill, "skill", { nonEmpty: true });
  if (!skill.ok) {
    return NextResponse.json({ error: skill.error }, { status: 400 });
  }
  if (!ALLOWED_SKILLS.has(skill.value)) {
    return NextResponse.json({ error: `unknown skill: ${skill.value}` }, { status: 400 });
  }

  const args = validateArgs(raw.args);
  if (!args.ok) {
    return NextResponse.json({ error: args.error }, { status: 400 });
  }
  if (args.value.creative_brief_id && skill.value !== "bulk-creatives") {
    return NextResponse.json({ error: "creative_brief_id is only supported by bulk-creatives" }, { status: 400 });
  }

  try {
    const id = writeIntent(skill.value, "vault-console", args.value);
    return NextResponse.json({ ok: true, id, skill: skill.value, args: args.value });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
