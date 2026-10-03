import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { CreativeAd, CreativeSnapshot } from "../lib/creativeTypes";

async function main() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "argus-creative-tests-"));
  process.env.VAULT_ROOT = vault;
  const { createCreativeBrief, queueCreativeBrief, getCreativeState, readCreativeAsset, startCreativeJob, CreativeError } = await import("../lib/creativeIntelligence");
  const { creativeBriefContext, creativeGeminiEnvironment } = await import("../runner/creative-brief.js");
  const { GET: media } = await import("../app/api/creative-intelligence/media/route");
  const { POST } = await import("../app/api/creative-intelligence/route");
  let passed = 0;
  const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };
  const root = path.join(vault, "system", "creative-intelligence");
  const json = (file: string, data: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
  const m = { spend: 1000, impressions: 10000, reach: 5000, frequency: 2, link_clicks: 200, purchases: 20, revenue: 3000, revenue_reported: true, leads: 0, landing_page_views: 150, engagements: 300, video_views: 0, ctr: 2, cpc: 5, roas: 3 };
  const ad: CreativeAd = {
    id: "101", creative_id: "1001", name: "Test source", account_id: "1", account_name: "Test account", campaign_id: "10", campaign_name: "A campaign", adset_id: "11", adset_name: "An ad set",
    currency: "INR", timezone: "Asia/Kolkata", objective: "OUTCOME_SALES", optimization_goal: "VALUE", status: "ACTIVE", format: "image", is_dynamic: false, visual_variants: 1,
    copy: { body: "Verified offer", title: "Learn AI", cta: "Learn more", variants: 1 }, media: [], media_note: "", fingerprint: "f",
    current: m, previous: m, daily: [], metric: { key: "roas", label: "Purchase ROAS", unit: "ratio", higher_is_better: true, result_key: "purchases" },
    performance: { status: "insufficient", value: 3, peer_value: null, delta_pct: null, peer_count: 0, reason: "Not enough peers." },
    fatigue: { status: "insufficient", reasons: ["Not enough history."], ctr_change: null, performance_change: null, frequency_change: null },
    analysis: { status: "ready", model: "test-only", analyzed_at: "2026-09-05T00:00:00Z", evidence_scope: "Images", hook_type: "direct", hook_text: "Learn AI", offer_type: "course_program", offer_text: "Verified offer", visual_style: "typography", next_tests: ["Change the headline only"], limitations: [] },
  };
  const windows = { current: { from: "2026-08-29", to: "2026-09-04" }, previous: { from: "2026-08-22", to: "2026-08-28" } };
  const snapshot: CreativeSnapshot = { schema_version: 1, generated_at: "2026-09-05T00:00:00Z", analyzed_at: "2026-09-05T00:00:00Z", windows,
    coverage: { configured_accounts: 1, reporting_accounts: 1, accounts: [{ id: "1", name: "Test account", status: "ok", windows }] }, ads: [ad], patterns: [], notes: [], rules: { min_impressions: 1000, min_results: 10, relative_change_pct: 20, frequency_floor: 2.5 } };
  try {
    json(path.join(root, "latest.json"), snapshot);
    let brief = createCreativeBrief("101", "Change only the opening headline. Keep the offer unchanged.");
    check("brief keeps source evidence and explicit limitations", () => {
      assert.match(brief.markdown, /Source ad: 101; creative: 1001/);
      assert.match(brief.markdown, /2026-08-29 to 2026-09-04/);
      assert.match(brief.markdown, /Not enough peers/);
      assert.match(brief.markdown, /do not establish|does not establish/);
      assert.ok(fs.existsSync(path.join(vault, brief.report_path)));
    });
    check("structured experiment keeps evidence, control and outcome metric", () => {
      snapshot.ads[0].analysis.evidence = [{ id: "E1", source: "creative_media", asset_index: 1, at_seconds: null, observation: "Offer text is small." }];
      snapshot.ads[0].analysis.risks = ["Course duration differs between image and copy."];
      snapshot.ads[0].analysis.tests = [{ variable: "visual_hierarchy", change: "Enlarge the offer", hypothesis: "Test whether readers notice it", keep_constant: "Price, audience and CTA", diagnostic: "link_ctr", evidence_ids: ["E1"] }];
      json(path.join(root, "latest.json"), snapshot);
      const structured = createCreativeBrief("101", "Enlarge the offer");
      assert.match(structured.markdown, /E1: Asset 1 — Offer text is small/);
      assert.match(structured.markdown, /Keep constant: Price, audience and CTA/);
      assert.match(structured.markdown, /Control reference: ad 101/);
      assert.match(structured.markdown, /final outcome remains Purchase ROAS/);
      assert.match(structured.markdown, /Review flag: Course duration differs between image and copy/);
      assert.match(structured.markdown, /Resolve factual conflicts and typos separately/);
      const custom = createCreativeBrief("101", "Different custom change");
      assert.match(custom.markdown, /Custom hypothesis/);
      assert.doesNotMatch(custom.markdown, /Hypothesis: Test whether readers notice it/);
    });
    check("Bulk Creatives receives an immutable ID and a draft-only intent", () => {
      const queued = queueCreativeBrief(brief.id);
      const intent = JSON.parse(fs.readFileSync(path.join(vault, "system", "queue", `${queued.id}.json`), "utf8"));
      assert.equal(intent.skill, "bulk-creatives");
      assert.equal(intent.args.creative_brief_id, brief.id);
      assert.equal(intent.args.dry_run, true);
      assert.equal(intent.args.count, 3);
    });
    check("repeat submission does not create a second job", () => {
      assert.equal(queueCreativeBrief(brief.id).already_queued, true);
      assert.equal(fs.readdirSync(path.join(vault, "system", "queue")).length, 1);
    });
    check("runner consumes the matching saved brief and rejects traversal", () => {
      const prompt = creativeBriefContext({ creative_brief_id: brief.id }, vault);
      assert.match(prompt, /Change only the opening headline/);
      assert.match(prompt, /untrusted data/);
      assert.equal(creativeBriefContext({}, vault), "");
      assert.throws(() => creativeBriefContext({ creative_brief_id: "../../.env" }, vault));
      assert.throws(() => creativeBriefContext({ creative_brief_id: crypto.randomUUID() }, vault));
    });
    check("pending vision observations cannot produce an evidence brief", () => {
      snapshot.ads[0].analysis.status = "pending";
      json(path.join(root, "latest.json"), snapshot);
      assert.throws(() => createCreativeBrief("101", "Test"), CreativeError);
      snapshot.ads[0].analysis.status = "ready";
      json(path.join(root, "latest.json"), snapshot);
    });
    check("an active worker blocks a second refresh", () => {
      const id = crypto.randomUUID();
      json(path.join(root, "jobs", `${id}.json`), { id, status: "running", pid: process.pid, started_at: new Date().toISOString() });
      fs.writeFileSync(path.join(root, "active.lock"), id);
      assert.throws(() => startCreativeJob("refresh"), (e: unknown) => e instanceof CreativeError && e.status === 409);
      fs.unlinkSync(path.join(root, "active.lock"));
    });
    check("dead worker recovery preserves data and does not automatically replay", () => {
      const id = crypto.randomUUID();
      json(path.join(root, "jobs", `${id}.json`), { id, status: "running", pid: null, started_at: "2020-01-01T00:00:00Z" });
      json(path.join(root, "latest-job.json"), { id });
      fs.writeFileSync(path.join(root, "active.lock"), id);
      const state = getCreativeState();
      assert.equal(state.job?.status, "interrupted");
      assert.equal(state.snapshot?.ads.length, 1);
      assert.ok(!fs.existsSync(path.join(root, "active.lock")));
      assert.ok(!("key" in state.config));
    });
    check("only the Gemini key is forwarded from ARGUS config", () => {
      const project = path.join(vault, "fake-project"); fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, ".env"), 'GEMINI_API_KEY="test-key"\nUNRELATED_SECRET=not-forwarded\n');
      assert.deepEqual(creativeGeminiEnvironment(project), { GEMINI_API_KEY: "test-key" });
    });
    const assetId = "a".repeat(64);
    json(path.join(root, "media", `${assetId}.json`), { mime_type: "video/mp4", bytes: 8 });
    fs.writeFileSync(path.join(root, "media", `${assetId}.bin`), "12345678");
    check("asset lookup rejects path injection", () => {
      assert.throws(() => readCreativeAsset("../../.env"), CreativeError);
      assert.equal(readCreativeAsset(assetId).size, 8);
    });
    const partial = media(new Request(`http://localhost:3107/api/creative-intelligence/media?id=${assetId}`, { headers: { range: "bytes=2-4" } }));
    assert.equal(partial.status, 206); assert.equal(await partial.text(), "345");
    assert.equal(partial.headers.get("content-range"), "bytes 2-4/8"); passed++; console.log("PASS video byte ranges support playback without reading the whole file");
    check("invalid and unsatisfiable ranges are rejected", () => {
      for (const range of ["bytes=20-30", "bytes=4-1", "bytes=0-1,4-5", "bytes=-"]) assert.equal(media(new Request(`http://localhost:3107/api/creative-intelligence/media?id=${assetId}`, { headers: { range } })).status, 416);
    });
    const response = await POST(new Request("http://localhost:3107/api/creative-intelligence", { method: "POST", body: JSON.stringify({ action: "queue_brief", brief_id: "../../.env" }) }));
    assert.equal(response.status, 400); passed++; console.log("PASS invalid API brief identifiers fail before dispatch");
    console.log(`\n${passed} Creative Intelligence integration checks passed. No live workflows or external API calls were made.`);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
