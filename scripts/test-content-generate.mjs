#!/usr/bin/env node

// Fail loudly: any unhandled error in this test script must
// translate to a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/content-generate.js — story_driven_listing.
//
// Runs in two modes:
//
//   default (mock):   no Anthropic call, no Supabase. Mocks both so we
//                     can verify auth, ownership checks, prompt
//                     substitution, and output-shape validation in
//                     isolation. Always runs in CI.
//
//   --live:           real Anthropic call via @milestone-maker/content-engine.
//                     Still mocks Supabase (fixture rows, no DB writes).
//                     Requires ANTHROPIC_API_KEY in the environment.
//                     Prints the full generated caption.
//
//   node scripts/test-content-generate.mjs
//   node scripts/test-content-generate.mjs --live

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "content-generate.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const LIVE = process.argv.includes("--live");
if (LIVE && !process.env.ANTHROPIC_API_KEY) {
  console.error("✗ --live requires ANTHROPIC_API_KEY in the environment");
  console.error("  Run: vercel env pull .env.local  (then: set -a; source .env.local; set +a)");
  process.exit(1);
}

const mod = await import(pathToFileURL(HANDLER_PATH).href);
const handler = mod.default;

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
  id:                AGENT_ID, // not the row's PK — we set agent_id below
  agent_id:          AGENT_ID,
  full_name:         "Sarah Martinez",
  display_name:      "Sarah Martinez",
  brokerage_name:    "Compass DFW",
  brokerage_tagline: null,
  license_number:    "0123456",
  primary_metro:     "Dallas-Fort Worth",
  primary_neighborhoods:   ["Lakewood", "Bishop Arts", "Lower Greenville"],
  secondary_neighborhoods: ["M Streets", "Junius Heights"],
  property_type_focus:     ["historic-single-family", "luxury-resale"],
  specialization_tags:     ["historic-homes", "first-time-luxury-buyers"],
  reference_accounts:      {},
  hook_lines: [
    "There's a porch in Lakewood that catches the late afternoon light just right.",
    "Saturday mornings stretch into Saturday afternoons here.",
  ],
  take_lines: [
    "Some homes feel like a fresh start. This one feels like the place where your next chapter actually begins.",
  ],
  cta_verbs:        ["send me a DM", "schedule", "ask"],
  tone_descriptors: ["warm", "reflective", "grounded", "unhurried"],
  phrases_to_avoid: ["luxury", "stunning", "must-see", "won't last"],
  hashtag_pool_hyper_local:    ["#LakewoodDallas", "#LakewoodHomes", "#LakewoodLiving", "#WhiteRockLake"],
  hashtag_pool_niche_feature:  ["#HistoricHomes", "#1920sCharm"],
  hashtag_pool_broad_industry: ["#DallasRealEstate", "#DFWHomes", "#DFWRealtor"],
  hashtag_pool_action:         ["#DallasLifestyle", "#DallasFamily"],
  framework_weights_inferred:  {},
  framework_weights_override:  null,
  social_instagram:    "@sarahmartinez.dfw",
  social_facebook_url: null,
  social_threads:      null,
  social_linkedin_url: null,
};
// The handler ownership-checks voiceProfile.agent_id against the caller;
// fixture above sets agent_id = AGENT_ID. Reset id to a distinct value
// so we don't accidentally rely on id===agent_id anywhere.
SARAH_VOICE_PROFILE.id = VOICE_PROFILE_ID;

const LAKEWOOD_LISTING = {
  id:           LISTING_ID,
  agent_id:     AGENT_ID,
  address:      "5912 Velasco Ave",
  city:         "Dallas",
  neighborhood: "Lakewood",
  price:        "$875,000",
  beds:         4,
  baths:        3,
  sqft:         "2,850",
  package:      "Signature",
  status:       "In Production",
  hero_img:     null,
  rela_site:    null,
  description:  "Restored 1920s Tudor in the heart of Lakewood.",
  features: [
    "Original 1920s wood floors",
    "Screened back porch",
    "Walk to White Rock Lake",
    "Walk to Saturday market",
    "Original built-ins",
  ],
  media_types:  ["photo", "drone"],
  story_angle:  null, // we pass story_angle via request body to exercise the override path
  created_at:   "2026-05-01T00:00:00Z",
};

const REQUEST_STORY_ANGLE =
  "A porch that catches the late afternoon light, where Saturday mornings stretch into Saturday afternoons.";

const VALID_TOKEN = "fake-bearer-token";

// ── Mocks ────────────────────────────────────────────────────────────

function makeSupabaseMock({
  user             = { id: AGENT_ID },
  authError        = null,
  voiceProfile     = SARAH_VOICE_PROFILE,
  voiceProfileErr  = null,
  listing          = LAKEWOOD_LISTING,
  listingErr       = null,
} = {}) {
  return {
    auth: {
      getUser: async (_token) => {
        if (authError) return { data: null, error: authError };
        return { data: { user }, error: null };
      },
    },
    from: (table) => {
      const thenable = (rowOrErr) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => rowOrErr,
          }),
        }),
      });
      if (table === "agent_voice_profiles") {
        return thenable({ data: voiceProfile, error: voiceProfileErr });
      }
      if (table === "listings") {
        return thenable({ data: listing, error: listingErr });
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Canned model output matching the framework's documented JSON shape.
//
// The caption body's trailing hashtag block uses DELIBERATELY MISMATCHED
// CASING vs the hashtags[] array (#lakewooddallas all-lowercase in body,
// #LakewoodDallas CamelCase in array). This reproduces the live-output
// bug from Stage 5c framework 1 and lets the happy-path test assert
// the canonicalizer fixed it end-to-end.
const CANNED_MODEL_OUTPUT = {
  caption:
    "There's a porch in Lakewood that catches the late afternoon light just right—the kind of porch where Saturday mornings stretch into Saturday afternoons.\n\n" +
    "That's the home I want to show you today.\n\n" +
    "A 4 bed, 3 bath in the heart of Lakewood. 2,850 sqft of character you don't get in new builds.\n\n" +
    "Original 1920s wood floors that tell their own stories. A screened back porch made for slow mornings. And White Rock Lake a short walk away for weekend trails and the Saturday market.\n\n" +
    "Some homes feel like a fresh start. This one feels like the place where your next chapter actually begins.\n\n" +
    "Send me a DM to schedule a private tour this week.\n\n" +
    "Sarah Martinez | Compass DFW | TREC License #0123456\n\n" +
    // ↓ mismatched casing — #lakewooddallas (lowercase) here vs #LakewoodDallas in hashtags[]
    "#lakewooddallas #DallasRealEstate #DFWHomes #WhiteRockLake #LakewoodHomes #HistoricHomes #LakewoodLiving #DallasLifestyle #DFWRealtor #DallasFamily",
  hook_line:
    "There's a porch in Lakewood that catches the late afternoon light just right—the kind of porch where Saturday mornings stretch into Saturday afternoons.",
  cta_line: "Send me a DM to schedule a private tour this week.",
  hashtags: [
    "#LakewoodDallas", "#DallasRealEstate", "#DFWHomes", "#WhiteRockLake",
    "#LakewoodHomes", "#HistoricHomes", "#LakewoodLiving", "#DallasLifestyle",
    "#DFWRealtor", "#DallasFamily",
  ],
  framework_used: "story_driven_listing",
  license_number: "0123456",
  platform: "instagram",
  content_type: "listing",
};

let capturedBuilders = null;

async function mockGenerate(opts) {
  capturedBuilders = {
    systemPrompt: opts.promptBuilders.buildSystemPrompt({}),
    userMessage:  opts.promptBuilders.buildUserMessage({}),
    model:        opts.model,
    maxTokens:    opts.maxTokens,
  };
  return { parsed: CANNED_MODEL_OUTPUT, raw: JSON.stringify(CANNED_MODEL_OUTPUT) };
}

// Live mode: route to the real engine via the handler's default path.
// We DON'T inject generate, so handler uses generateAndParseObject(),
// which calls @milestone-maker/content-engine → Anthropic.
async function callHandler({ live = false, body, supabaseOverride, generateOverride } = {}) {
  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    body,
  };
  const res = makeRes();
  const depsOverride = {
    supabase: supabaseOverride || makeSupabaseMock(),
  };
  if (!live) {
    depsOverride.generate = generateOverride || mockGenerate;
  }
  await handler(req, res, depsOverride);
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────

console.log("\n── api/content-generate.js — story_driven_listing ──\n");

// 1. Happy path (mock engine)
{
  capturedBuilders = null;
  const res = await callHandler({
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "story_driven_listing",
      story_angle:      REQUEST_STORY_ANGLE,
    },
  });
  check("happy path returns 200",                     res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("returns caption",                            typeof res.body?.caption === "string" && res.body.caption.length > 0);
  check("returns hook_line",                          typeof res.body?.hook_line === "string");
  check("returns cta_line",                           typeof res.body?.cta_line === "string");
  check("returns hashtags array (8-12)",              Array.isArray(res.body?.hashtags) && res.body.hashtags.length >= 8 && res.body.hashtags.length <= 12);
  check("framework_used === story_driven_listing",    res.body?.framework_used === "story_driven_listing");
  check("platform === instagram",                     res.body?.platform === "instagram");
  check("content_type === listing",                   res.body?.content_type === "listing");
  check("license_number passed through",              res.body?.license_number === "0123456");

  // Verify substitution into the prompt body
  check("user message includes agent name",           capturedBuilders?.userMessage?.includes("Sarah Martinez"));
  check("user message includes neighborhood (Lakewood)", capturedBuilders?.userMessage?.includes("Neighborhood: Lakewood"));
  check("user message includes beds/baths/sqft",      capturedBuilders?.userMessage?.includes("Beds: 4 | Baths: 3 | Sqft: 2,850"));
  check("user message uses request-body story_angle (override)", capturedBuilders?.userMessage?.includes(REQUEST_STORY_ANGLE));
  check("user message includes brokerage",            capturedBuilders?.userMessage?.includes("Compass DFW"));
  check("user message includes license #",            capturedBuilders?.userMessage?.includes("0123456"));
  check("tone_descriptors substituted as one line",   capturedBuilders?.userMessage?.includes("Tone: warm, reflective, grounded, unhurried"));
  check("avoided_words populated",                    capturedBuilders?.userMessage?.includes("Words to avoid: luxury, stunning"));
  check("signature_phrases concat hook+take",         capturedBuilders?.userMessage?.includes("Signature phrases: There's a porch in Lakewood"));
  check("cta_style formatted from cta_verbs",         capturedBuilders?.userMessage?.includes("Preferred CTA verbs: send me a DM"));
  check("no unreplaced {placeholders} remain",        !/\{[a-z_]+\}/.test(capturedBuilders?.userMessage || ""));

  // Canonicalization assertions — caption body must end up using the
  // array's casing exactly, and the mismatched lowercase tag from the
  // canned body must be gone.
  check("canonicalized: caption ends with array-cased hashtag block",
    res.body?.caption?.endsWith("#LakewoodDallas #DallasRealEstate #DFWHomes #WhiteRockLake #LakewoodHomes #HistoricHomes #LakewoodLiving #DallasLifestyle #DFWRealtor #DallasFamily"));
  check("canonicalized: lowercase #lakewooddallas removed from caption body",
    !res.body?.caption?.includes("#lakewooddallas"));
  check("canonicalized: compliance line with TREC License #0123456 preserved",
    res.body?.caption?.includes("Sarah Martinez | Compass DFW | TREC License #0123456"));
}

// 2. Missing Authorization header → 401
{
  const req = { method: "POST", headers: {}, body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock(), generate: mockGenerate });
  check("missing auth → 401", res.statusCode === 401);
}

// 3. Missing body fields → 400
{
  const res = await callHandler({ body: { listing_id: LISTING_ID, framework_name: "story_driven_listing" } });
  check("missing voice_profile_id → 400", res.statusCode === 400);
}

// 4. Unknown framework → 400
{
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "bogus_framework" },
  });
  check("unknown framework → 400", res.statusCode === 400);
}

// 5. Ownership mismatch on voice profile → 403
{
  const otherVoice = { ...SARAH_VOICE_PROFILE, agent_id: "00000000-0000-0000-0000-0000000000ff" };
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" },
    supabaseOverride: makeSupabaseMock({ voiceProfile: otherVoice }),
  });
  check("voice profile owned by someone else → 403", res.statusCode === 403);
}

// 6. Missing license_number → 422
{
  const noLicense = { ...SARAH_VOICE_PROFILE, license_number: null };
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" },
    supabaseOverride: makeSupabaseMock({ voiceProfile: noLicense }),
  });
  check("null license_number → 422", res.statusCode === 422);
}

// 7. Voice profile not found → 404
{
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" },
    supabaseOverride: makeSupabaseMock({ voiceProfile: null }),
  });
  check("voice profile missing → 404", res.statusCode === 404);
}

// 8. story_angle column used when request body omits it
{
  capturedBuilders = null;
  const listingWithAngle = { ...LAKEWOOD_LISTING, story_angle: "the column-level story angle" };
  await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" },
    supabaseOverride: makeSupabaseMock({ listing: listingWithAngle }),
  });
  check("falls back to listing.story_angle when request body omits it",
    capturedBuilders?.userMessage?.includes("the column-level story angle"));
}

// 9. LIVE mode — real Anthropic call. Only when --live passed.
if (LIVE) {
  console.log("\n── LIVE mode — calling Anthropic via @milestone-maker/content-engine ──");
  const res = await callHandler({
    live: true,
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "story_driven_listing",
      story_angle:      REQUEST_STORY_ANGLE,
    },
  });
  check("live: returns 200",                          res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("live: framework_used === story_driven_listing", res.body?.framework_used === "story_driven_listing");
  check("live: caption is non-empty string",          typeof res.body?.caption === "string" && res.body.caption.length > 100);
  check("live: hashtags 8-12",                        Array.isArray(res.body?.hashtags) && res.body.hashtags.length >= 8 && res.body.hashtags.length <= 12);
  check("live: license # appears in caption",         res.body?.caption?.includes("0123456"));
  check("live: brokerage appears in caption",         res.body?.caption?.includes("Compass DFW"));

  console.log("\n── GENERATED CAPTION ──\n");
  console.log(res.body?.caption);
  console.log("\n── HASHTAGS ──");
  console.log(res.body?.hashtags?.join(" "));
  console.log("");
}

// ── Unit tests: canonicalizeHashtags ─────────────────────────────────
//
// Direct unit tests on the post-processor itself, separate from the
// handler integration test above. Imports from the same source the
// handler uses.

console.log("\n── api/_content/post-processors.js — canonicalizeHashtags ──\n");

const postProc = await import(pathToFileURL(resolve(REPO_ROOT, "api", "_content", "post-processors.js")).href);
const { canonicalizeHashtags } = postProc;

// 1. Empty hashtags array → unchanged (same reference)
{
  const input = { caption: "Hello\n\n#tag #stuff", hashtags: [] };
  const out = canonicalizeHashtags(input);
  check("empty hashtags array → returns same reference", out === input);
}

// 2. Missing hashtags field → unchanged
{
  const input = { caption: "Hello\n\n#tag #stuff" };
  const out = canonicalizeHashtags(input);
  check("missing hashtags field → returns same reference", out === input);
}

// 3. hashtags not an array → unchanged
{
  const input = { caption: "Hello\n\n#tag", hashtags: "#NotAnArray" };
  const out = canonicalizeHashtags(input);
  check("hashtags not an array → returns same reference", out === input);
}

// 4. Single-line trailing block — replaced with array casing
{
  const input = {
    caption: "Body paragraph here.\n\n#old #tags #here",
    hashtags: ["#New", "#TAGS", "#Here"],
  };
  const out = canonicalizeHashtags(input);
  check("single-line trailing block replaced",
    out.caption === "Body paragraph here.\n\n#New #TAGS #Here");
  check("single-line: input not mutated", input.caption.endsWith("#old #tags #here"));
}

// 5. Multi-line trailing block — replaced as a single block
{
  const input = {
    caption: "Body paragraph here.\n\n#a #b #c\n#d #e #f",
    hashtags: ["#A", "#B", "#C", "#D", "#E", "#F"],
  };
  const out = canonicalizeHashtags(input);
  check("multi-line trailing block collapsed + replaced",
    out.caption === "Body paragraph here.\n\n#A #B #C #D #E #F");
}

// 6. Case mismatches in body → final caption uses array casing exactly
{
  const input = {
    caption: "Story body.\n\n#lakewooddallas #dallasrealestate",
    hashtags: ["#LakewoodDallas", "#DallasRealEstate"],
  };
  const out = canonicalizeHashtags(input);
  check("case-mismatched body → array casing wins",
    out.caption === "Story body.\n\n#LakewoodDallas #DallasRealEstate");
  check("case-mismatched: lowercase fully removed",
    !out.caption.includes("#lakewooddallas") && !out.caption.includes("#dallasrealestate"));
}

// 7. No trailing hashtag block — array appended after blank line
{
  const input = {
    caption: "Story body, no tags at the bottom.",
    hashtags: ["#One", "#Two"],
  };
  const out = canonicalizeHashtags(input);
  check("no trailing block → array appended after blank line",
    out.caption === "Story body, no tags at the bottom.\n\n#One #Two");
}

// 7b. No trailing hashtag block, caption has trailing whitespace already
{
  const input = {
    caption: "Story body.\n\n",
    hashtags: ["#One"],
  };
  const out = canonicalizeHashtags(input);
  check("no trailing block + trailing whitespace → trimmed before append",
    out.caption === "Story body.\n\n#One");
}

// 8. Negative case: compliance line contains "#0123456" AND there's a
//    separate trailing hashtag block. Only the trailing block should
//    be replaced; the compliance line stays exactly as-is.
{
  const input = {
    caption:
      "Story body here.\n\n" +
      "Sarah Martinez | Compass DFW | TREC License #0123456\n\n" +
      "#old #wrong #casing",
    hashtags: ["#Right", "#Casing", "#Here"],
  };
  const out = canonicalizeHashtags(input);
  check("compliance line with #0123456 preserved exactly",
    out.caption.includes("Sarah Martinez | Compass DFW | TREC License #0123456"));
  check("only trailing block replaced, not compliance line",
    out.caption.endsWith("#Right #Casing #Here"));
  check("old wrong hashtags removed",
    !out.caption.includes("#old") && !out.caption.includes("#wrong"));
  // Also confirm the compliance line wasn't matched as a hashtag block
  // (would have been replaced by appending, producing a duplicate).
  const occurrences = (out.caption.match(/#Right #Casing #Here/g) || []).length;
  check("canonical block appears exactly once (no duplicate from append fallback)",
    occurrences === 1);
}

// 9. Caption is empty string + hashtags present → caption becomes the block
{
  const input = { caption: "", hashtags: ["#Only"] };
  const out = canonicalizeHashtags(input);
  check("empty caption → caption becomes canonical block alone",
    out.caption === "#Only");
}

// 10. Non-string caption → unchanged
{
  const input = { caption: null, hashtags: ["#X"] };
  const out = canonicalizeHashtags(input);
  check("non-string caption → returns same reference", out === input);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed${LIVE ? " (live mode)" : " (mock mode)"}\n`);
if (failed > 0) process.exit(1);
