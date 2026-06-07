#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/content-regenerate-slide.js — single-card statement
// regeneration. Mirrors scripts/test-content-generate.mjs (mock Supabase + mock
// engine). Verifies auth, subscription gating, ownership checks, prompt reuse,
// output-shape validation, and graceful engine-failure handling.
//
//   default (mock): no Anthropic, no Supabase — mocks both. Always runs in CI.
//   --live:         real Anthropic call via the engine; mocks Supabase only.
//
//   node scripts/test-content-regenerate-slide.mjs
//   node scripts/test-content-regenerate-slide.mjs --live

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "content-regenerate-slide.js");
const PROMPT_PATH  = resolve(REPO_ROOT, "api", "_content", "prompts", "instagram", "listing", "walkthrough-carousel.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const LIVE = process.argv.includes("--live");
if (LIVE && !process.env.ANTHROPIC_API_KEY) {
  console.error("✗ --live requires ANTHROPIC_API_KEY in the environment");
  process.exit(1);
}

const mod = await import(pathToFileURL(HANDLER_PATH).href);
const handler = mod.default;
const { subjectWithFeatures } = await import(pathToFileURL(PROMPT_PATH).href);

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; if (headers) Object.assign(res.headers, headers); };
  res.end = () => { res.ended = true; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── Fixture data ─────────────────────────────────────────────────────

const AGENT_ID         = "00000000-0000-0000-0000-000000000a01";
const VOICE_PROFILE_ID = "00000000-0000-0000-0000-000000000b01";
const LISTING_ID       = "00000000-0000-0000-0000-000000000c01";

const SARAH_VOICE_PROFILE = {
  id:               VOICE_PROFILE_ID,
  agent_id:         AGENT_ID,
  full_name:        "Sarah Martinez",
  display_name:     "Sarah Martinez",
  brokerage_name:   "Compass DFW",
  license_number:   "0123456",
  cta_verbs:        ["send me a DM", "schedule", "ask"],
  tone_descriptors: ["warm", "reflective", "grounded", "unhurried"],
  phrases_to_avoid: ["luxury", "stunning", "must-see", "won't last"],
  hook_lines:       [],
  take_lines:       [],
};

const LAKEWOOD_LISTING = {
  id:           LISTING_ID,
  agent_id:     AGENT_ID,
  address:      "5912 Velasco Ave",
  city:         "Dallas",
  neighborhood: "Lakewood",
  beds:         4, baths: 3, sqft: "2,850",
  features:     ["Original 1920s wood floors", "Screened back porch"],
};

const VALID_TOKEN = "fake-bearer-token";

// ── Mocks ────────────────────────────────────────────────────────────

function makeSupabaseMock({
  user            = { id: AGENT_ID },
  authError       = null,
  agent           = { role: "agent", subscription_status: "active" },
  agentErr        = null,
  voiceProfile    = SARAH_VOICE_PROFILE,
  voiceProfileErr = null,
  listing         = LAKEWOOD_LISTING,
  listingErr      = null,
} = {}) {
  const thenable = (rowOrErr) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => rowOrErr }) }),
  });
  return {
    auth: {
      getUser: async (_token) => {
        if (authError) return { data: null, error: authError };
        return { data: { user }, error: null };
      },
    },
    from: (table) => {
      if (table === "agents")               return thenable({ data: agent, error: agentErr });
      if (table === "agent_voice_profiles") return thenable({ data: voiceProfile, error: voiceProfileErr });
      if (table === "listings")             return thenable({ data: listing, error: listingErr });
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

let capturedBuilders = null;
const CANNED_STATEMENT = "The kitchen opens with a marble waterfall island that quietly steals the room.";

async function mockGenerate(opts) {
  capturedBuilders = {
    systemPrompt: opts.promptBuilders.buildSystemPrompt({}),
    userMessage:  opts.promptBuilders.buildUserMessage({}),
    model:        opts.model,
    maxTokens:    opts.maxTokens,
  };
  const out = { statement: CANNED_STATEMENT };
  return { parsed: out, raw: JSON.stringify(out) };
}

async function callHandler({ live = false, body, supabaseOverride, generateOverride } = {}) {
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` }, body };
  const res = makeRes();
  const depsOverride = { supabase: supabaseOverride || makeSupabaseMock() };
  if (!live) depsOverride.generate = generateOverride || mockGenerate;
  await handler(req, res, depsOverride);
  return res;
}

const VALID_BODY = {
  voice_profile_id: VOICE_PROFILE_ID,
  listing_id:       LISTING_ID,
  category:         "kitchen",
  features:         ["marble waterfall island", "white cabinetry"],
};

// ── Tests ────────────────────────────────────────────────────────────

console.log("\n── api/content-regenerate-slide.js — single-card statement regeneration ──\n");

// 1. Happy path (mock engine)
{
  capturedBuilders = null;
  const res = await callHandler({ body: VALID_BODY });
  check("happy path returns 200",                 res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("returns statement string",               typeof res.body?.statement === "string" && res.body.statement.length > 0);
  check("statement is the (trimmed) model output", res.body?.statement === CANNED_STATEMENT);

  // Prompt reuse / substitution assertions
  check("prompt includes agent name",             capturedBuilders?.userMessage?.includes("Sarah Martinez"));
  check("prompt includes brokerage",              capturedBuilders?.userMessage?.includes("Compass DFW"));
  check("prompt builds room via subjectWithFeatures", capturedBuilders?.userMessage?.includes("Kitchen — marble waterfall island, white cabinetry"));
  check("prompt asks for {\"statement\": ...} JSON", capturedBuilders?.userMessage?.includes('{"statement"'));
  check("prompt requests no caption/hashtag output fields",
    !capturedBuilders?.userMessage?.includes('"caption"') && !capturedBuilders?.userMessage?.includes('"hashtags"'));
  check("tone descriptors substituted",           capturedBuilders?.userMessage?.includes("warm, reflective, grounded, unhurried"));
  check("avoided words substituted",              capturedBuilders?.userMessage?.includes("luxury, stunning"));
  check("no unreplaced {placeholders} remain",    !/\{[a-z_]+\}/.test(capturedBuilders?.userMessage || ""));
  check("model default matches content-generate", capturedBuilders?.model === "claude-sonnet-4-6");
}

// 2. Missing Authorization header → 401
{
  const req = { method: "POST", headers: {}, body: VALID_BODY };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock(), generate: mockGenerate });
  check("missing auth → 401", res.statusCode === 401);
}

// 3. Invalid/expired token → 401
{
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ authError: { message: "bad jwt" } }) });
  check("invalid token → 401", res.statusCode === 401);
}

// 4. Missing body fields → 400
{
  const r1 = await callHandler({ body: { listing_id: LISTING_ID, category: "kitchen" } });
  check("missing voice_profile_id → 400", r1.statusCode === 400);
  const r2 = await callHandler({ body: { voice_profile_id: VOICE_PROFILE_ID, category: "kitchen" } });
  check("missing listing_id → 400", r2.statusCode === 400);
  const r3 = await callHandler({ body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID } });
  check("missing category → 400", r3.statusCode === 400);
  const r4 = await callHandler({ body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, category: "   " } });
  check("blank category → 400", r4.statusCode === 400);
}

// 5. Voice profile owned by someone else → 403
{
  const otherVoice = { ...SARAH_VOICE_PROFILE, agent_id: "00000000-0000-0000-0000-0000000000ff" };
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ voiceProfile: otherVoice }) });
  check("voice profile not owned → 403", res.statusCode === 403);
}

// 6. Listing owned by someone else → 403
{
  const otherListing = { ...LAKEWOOD_LISTING, agent_id: "00000000-0000-0000-0000-0000000000ff" };
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ listing: otherListing }) });
  check("listing not owned → 403", res.statusCode === 403);
}

// 7. Voice profile / listing not found → 404
{
  const r1 = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ voiceProfile: null }) });
  check("voice profile missing → 404", r1.statusCode === 404);
  const r2 = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ listing: null }) });
  check("listing missing → 404", r2.statusCode === 404);
}

// 8. Subscription gate — unsubscribed non-admin → 402 (before engine runs)
{
  for (const status of [null, "canceled", "incomplete", "unpaid", "paused"]) {
    const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ agent: { role: "agent", subscription_status: status } }) });
    check(`unsubscribed non-admin (status=${status}) → 402`, res.statusCode === 402, `got ${res.statusCode}`);
    check(`unsubscribed → subscription_required body`, res.body?.error === "subscription_required");
  }
}

// 9. Subscription gate — active/grace statuses pass through to 200
{
  for (const status of ["trialing", "active", "past_due"]) {
    const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ agent: { role: "agent", subscription_status: status } }) });
    check(`subscribed (status=${status}) → 200`, res.statusCode === 200, `got ${res.statusCode}`);
  }
}

// 10. Admin bypass — admin with NO subscription still passes
{
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ agent: { role: "admin", subscription_status: null } }) });
  check("admin with no subscription → 200 (bypass)", res.statusCode === 200, `got ${res.statusCode}`);
}

// 11. Missing agent profile → 401
{
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ agent: null }) });
  check("no agent profile row → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

// 12. No license_number required (single statement has no compliance line) → 200
{
  const noLicense = { ...SARAH_VOICE_PROFILE, license_number: null };
  const res = await callHandler({ body: VALID_BODY, supabaseOverride: makeSupabaseMock({ voiceProfile: noLicense }) });
  check("missing license_number still → 200 (no TREC line here)", res.statusCode === 200, `got ${res.statusCode}`);
}

// 13. Engine parse failure → graceful 502
{
  const throwParse = async () => { const e = new Error("content-engine returned unparseable JSON"); e.code = "ENGINE_PARSE_FAILED"; throw e; };
  const res = await callHandler({ body: VALID_BODY, generateOverride: throwParse });
  check("engine parse failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("engine parse failure → unparseable JSON body", res.body?.error === "model returned unparseable JSON");
}

// 14. Engine generic failure → graceful 502
{
  const throwGeneric = async () => { throw new Error("network blip"); };
  const res = await callHandler({ body: VALID_BODY, generateOverride: throwGeneric });
  check("engine generic failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
}

// 15. Model returned object without statement → 502
{
  const noStatement = async () => ({ parsed: { not_statement: "oops" }, raw: '{"not_statement":"oops"}' });
  const res = await callHandler({ body: VALID_BODY, generateOverride: noStatement });
  check("missing statement field → 502", res.statusCode === 502, `got ${res.statusCode}`);
}

// 16. Empty/whitespace statement → 502
{
  const blank = async () => ({ parsed: { statement: "   " }, raw: '{"statement":"   "}' });
  const res = await callHandler({ body: VALID_BODY, generateOverride: blank });
  check("blank statement → 502", res.statusCode === 502, `got ${res.statusCode}`);
}

// 17. features omitted → still 200 (defaults to []) and room is bare name
{
  capturedBuilders = null;
  const res = await callHandler({ body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, category: "living" } });
  check("features omitted → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("room is bare name when no features", capturedBuilders?.userMessage?.includes("Living room") && !capturedBuilders?.userMessage?.includes("Living room —"));
}

// ── subjectWithFeatures reuse (direct unit) ──────────────────────────
console.log("\n── subjectWithFeatures reuse ──\n");
{
  check("category + 2 features → 'Kitchen — a, b'",
    subjectWithFeatures({ category: "kitchen", features: ["marble waterfall island", "white cabinetry"] })
      === "Kitchen — marble waterfall island, white cabinetry");
  check("caps at 3 features",
    subjectWithFeatures({ category: "living", features: ["a", "b", "c", "d"] }) === "Living room — a, b, c");
  check("no features → bare human name",
    subjectWithFeatures({ category: "primary_bedroom", features: [] }) === "Primary bedroom");
  check("unknown category → category passthrough",
    subjectWithFeatures({ category: "wine_cellar", features: [] }) === "wine_cellar");
  check("non-array features → bare name (no throw)",
    subjectWithFeatures({ category: "dining", features: null }) === "Dining room");
}

// ── LIVE mode ─────────────────────────────────────────────────────────
if (LIVE) {
  console.log("\n── LIVE — real Anthropic statement regeneration ──");
  const res = await callHandler({ live: true, body: VALID_BODY });
  check("live: returns 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("live: statement non-empty string", typeof res.body?.statement === "string" && res.body.statement.length > 5);
  check("live: single sentence-ish (no newlines)", !/\n/.test(res.body?.statement || ""));
  const lower = String(res.body?.statement || "").toLowerCase();
  check("live: avoided word 'luxury' absent", !lower.includes("luxury"));
  check("live: avoided word 'stunning' absent", !lower.includes("stunning"));
  console.log("\n── GENERATED STATEMENT ──\n  " + res.body?.statement + "\n");
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed${LIVE ? " (live mode)" : " (mock mode)"}\n`);
if (failed > 0) process.exit(1);
