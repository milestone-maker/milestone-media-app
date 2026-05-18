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

// Per-test override for the canned model output. Default is the
// framework-1 Sarah Martinez story-driven response (CANNED_MODEL_OUTPUT).
// Framework-2 tests (or any future test that needs a different shape)
// set this before calling the handler, then reset to null afterward.
let cannedOverride = null;

async function mockGenerate(opts) {
  capturedBuilders = {
    systemPrompt: opts.promptBuilders.buildSystemPrompt({}),
    userMessage:  opts.promptBuilders.buildUserMessage({}),
    model:        opts.model,
    maxTokens:    opts.maxTokens,
  };
  const out = cannedOverride || CANNED_MODEL_OUTPUT;
  return { parsed: out, raw: JSON.stringify(out) };
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

// ── Framework 2 — you_hook_listing ───────────────────────────────────
//
// Same fixture rows as framework 1 (Sarah Martinez voice profile +
// Lakewood listing). scene_angle is request-only — no listings column.
// Two scenarios:
//   F2a: scene_angle override supplied via request body → confirm it
//        flows through to the user message.
//   F2b: no scene_angle in extras and no column on listings → confirm
//        resolveOverride lands on the default fallback string.

const SCENE_ANGLE_OVERRIDE =
  "Standing on the back porch at golden hour, coffee in hand, listening to the neighborhood wake up.";

// Framework-2 canned output — same hashtags as framework 1 so the
// canonicalizer assertions stay simple, but framework_used flipped.
const CANNED_F2_OUTPUT = {
  ...CANNED_MODEL_OUTPUT,
  framework_used: "you_hook_listing",
};

// F2a — happy path with scene_angle override
{
  capturedBuilders = null;
  cannedOverride = CANNED_F2_OUTPUT;
  const res = await callHandler({
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "you_hook_listing",
      scene_angle:      SCENE_ANGLE_OVERRIDE,
    },
  });
  cannedOverride = null;
  check("F2: happy path returns 200",                  res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("F2: framework_used === you_hook_listing",     res.body?.framework_used === "you_hook_listing");
  check("F2: returns caption",                         typeof res.body?.caption === "string" && res.body.caption.length > 0);
  check("F2: returns hook_line",                       typeof res.body?.hook_line === "string");
  check("F2: returns cta_line",                        typeof res.body?.cta_line === "string");
  check("F2: returns hashtags array (8-12)",           Array.isArray(res.body?.hashtags) && res.body.hashtags.length >= 8 && res.body.hashtags.length <= 12);
  check("F2: platform === instagram",                  res.body?.platform === "instagram");
  check("F2: content_type === listing",                res.body?.content_type === "listing");
  check("F2: license_number passed through",           res.body?.license_number === "0123456");

  // Substitution checks specific to framework 2
  check("F2: user message uses request-body scene_angle override",
    capturedBuilders?.userMessage?.includes(SCENE_ANGLE_OVERRIDE));
  check("F2: user message includes 'YOU' HOOK LISTING framework label",
    capturedBuilders?.userMessage?.includes('FRAMEWORK: "YOU" HOOK LISTING'));
  check("F2: user message includes Scene angle: prefix",
    capturedBuilders?.userMessage?.includes("Scene angle: " + SCENE_ANGLE_OVERRIDE));
  check("F2: no unreplaced {placeholders} remain",
    !/\{[a-z_]+\}/.test(capturedBuilders?.userMessage || ""));
}

// F2b — default fallback when scene_angle absent from both extras and listing
{
  capturedBuilders = null;
  cannedOverride = CANNED_F2_OUTPUT;
  // No scene_angle in body. LAKEWOOD_LISTING fixture has no scene_angle
  // column (listings schema doesn't include one for this field).
  await callHandler({
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "you_hook_listing",
    },
  });
  cannedOverride = null;
  check("F2: default fallback for missing scene_angle",
    capturedBuilders?.userMessage?.includes("Scene angle: a quiet moment somewhere in the home"));
}

// Generic-forwarding test — protects option (b) endpoint behavior.
// An unknown body key must be silently ignored (forwarded into extras
// but never consumed by the prompt module's resolveOverride calls).
// Regression guard against anyone adding filtering logic to the endpoint.
{
  capturedBuilders = null;
  cannedOverride = CANNED_F2_OUTPUT;
  const res = await callHandler({
    body: {
      voice_profile_id:  VOICE_PROFILE_ID,
      listing_id:        LISTING_ID,
      framework_name:    "you_hook_listing",
      scene_angle:       SCENE_ANGLE_OVERRIDE,
      random_unused_key: "garbage value that should be ignored",
      another_phantom:   {nested: "also fine"},
    },
  });
  cannedOverride = null;
  check("generic-forward: unknown extras keys don't error → 200",
    res.statusCode === 200);
  check("generic-forward: known scene_angle still substituted",
    capturedBuilders?.userMessage?.includes(SCENE_ANGLE_OVERRIDE));
  check("generic-forward: garbage value not present in user message",
    !capturedBuilders?.userMessage?.includes("garbage value"));
  check("generic-forward: random_unused_key not present as placeholder",
    !capturedBuilders?.userMessage?.includes("random_unused_key"));
}

// ── Framework 3 — walkthrough_carousel ───────────────────────────────
//
// New surface area for framework 3:
//   • Per-request override key: slide_subjects (string).
//   • Default fallback: "kitchen, primary suite, primary bathroom,
//                       living area, outdoor space" (5 subjects → 7 slides).
//   • Additional required output field: "slides" (array).
//
// Two happy-path tests + one default-fallback test + the per-framework
// output-validation regression at the end.

const SLIDE_SUBJECTS_OVERRIDE = "entryway, chef kitchen, primary suite, screened porch, rooftop deck";

// Canned framework-3 output — same caption shell as frameworks 1/2 plus
// a well-formed 7-slide array for the override-list scenario.
const CANNED_F3_OUTPUT = {
  ...CANNED_MODEL_OUTPUT,
  framework_used: "walkthrough_carousel",
  slides: [
    { slide_number: 1, subject: "cover",          text: "Step inside a Lakewood Tudor" },
    { slide_number: 2, subject: "entryway",       text: "Original 1920s wood floors greet you" },
    { slide_number: 3, subject: "chef kitchen",   text: "Marble counters, built-in pantry" },
    { slide_number: 4, subject: "primary suite",  text: "South-facing windows, morning light" },
    { slide_number: 5, subject: "screened porch", text: "Slow Saturdays start here" },
    { slide_number: 6, subject: "rooftop deck",   text: "Sunset views over White Rock Lake" },
    { slide_number: 7, subject: "final",          text: "DM me to walk through it" },
  ],
};

// F3a — happy path with slide_subjects override
{
  capturedBuilders = null;
  cannedOverride = CANNED_F3_OUTPUT;
  const res = await callHandler({
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "walkthrough_carousel",
      slide_subjects:   SLIDE_SUBJECTS_OVERRIDE,
    },
  });
  cannedOverride = null;
  check("F3: happy path returns 200",                  res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("F3: framework_used === walkthrough_carousel", res.body?.framework_used === "walkthrough_carousel");
  check("F3: slides array present in response",        Array.isArray(res.body?.slides));
  // 5 subjects + 1 cover + 1 final = 7 slides
  check("F3: slides length === 1 cover + N subjects + 1 final",
    res.body?.slides?.length === 7);
  check("F3: slide 1 subject === 'cover'",             res.body?.slides?.[0]?.subject === "cover");
  check("F3: last slide subject === 'final'",          res.body?.slides?.[res.body?.slides?.length - 1]?.subject === "final");

  // Substitution checks
  check("F3: user message includes WALK-THROUGH CAROUSEL framework label",
    capturedBuilders?.userMessage?.includes("FRAMEWORK: WALK-THROUGH CAROUSEL"));
  check("F3: user message uses request-body slide_subjects override",
    capturedBuilders?.userMessage?.includes(SLIDE_SUBJECTS_OVERRIDE));
  check("F3: user message includes Slide subjects line",
    capturedBuilders?.userMessage?.includes("Slide subjects (ordered, one slide per subject): " + SLIDE_SUBJECTS_OVERRIDE));
  check("F3: no unreplaced {placeholders} remain",
    !/\{[a-z_]+\}/.test(capturedBuilders?.userMessage || ""));
}

// F3b — default fallback when slide_subjects absent
{
  capturedBuilders = null;
  cannedOverride = CANNED_F3_OUTPUT;
  await callHandler({
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "walkthrough_carousel",
    },
  });
  cannedOverride = null;
  check("F3: default fallback for missing slide_subjects",
    capturedBuilders?.userMessage?.includes(
      "Slide subjects (ordered, one slide per subject): kitchen, primary suite, primary bathroom, living area, outdoor space"
    ));
}

// Per-framework output-validation regression
//
// Proves additionalRequiredOutputFields is consulted, not a hardcoded
// universal list. Two scenarios with the same omission (slides field):
//   • Framework 3 demands slides → 502
//   • Framework 1 does not demand slides → 200
{
  // F3 model output missing the slides field → 502
  cannedOverride = { ...CANNED_F3_OUTPUT, slides: undefined };
  const res3 = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "walkthrough_carousel" },
  });
  cannedOverride = null;
  check("output-validation: F3 missing slides → 502", res3.statusCode === 502);
  check("output-validation: F3 missing slides reports 'slides' in missing list",
    Array.isArray(res3.body?.missing) && res3.body.missing.includes("slides"));

  // F1 model output ALSO missing slides (which F1 doesn't require) → 200
  cannedOverride = { ...CANNED_MODEL_OUTPUT, slides: undefined };
  const res1 = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing" },
  });
  cannedOverride = null;
  check("output-validation: F1 missing slides → 200 (not in its declared set)",
    res1.statusCode === 200);
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

  console.log("\n── GENERATED CAPTION (story_driven_listing) ──\n");
  console.log(res.body?.caption);
  console.log("\n── HASHTAGS ──");
  console.log(res.body?.hashtags?.join(" "));
  console.log("");

  // ── Framework 2 live ──
  console.log("\n── LIVE — you_hook_listing ──");
  const res2 = await callHandler({
    live: true,
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "you_hook_listing",
      scene_angle:      SCENE_ANGLE_OVERRIDE,
    },
  });
  check("live F2: returns 200",                          res2.statusCode === 200, `got ${res2.statusCode} ${JSON.stringify(res2.body)}`);
  check("live F2: framework_used === you_hook_listing",  res2.body?.framework_used === "you_hook_listing");
  check("live F2: caption is non-empty string",          typeof res2.body?.caption === "string" && res2.body.caption.length > 100);
  check("live F2: hashtags 8-12",                        Array.isArray(res2.body?.hashtags) && res2.body.hashtags.length >= 8 && res2.body.hashtags.length <= 12);
  check("live F2: license # appears in caption",         res2.body?.caption?.includes("0123456"));
  check("live F2: brokerage appears in caption",         res2.body?.caption?.includes("Compass DFW"));
  // Framework-2-specific: hook begins with "You"
  check("live F2: caption opens with 'You'",             /^you\b/i.test(String(res2.body?.caption || "").trimStart()));
  // Canonicalizer holds: caption trailing block matches hashtags array byte-for-byte
  check("live F2: caption ends with array-joined hashtags",
    res2.body?.caption?.endsWith((res2.body?.hashtags || []).join(" ")));

  console.log("\n── GENERATED CAPTION (you_hook_listing) ──\n");
  console.log(res2.body?.caption);
  console.log("\n── HASHTAGS ──");
  console.log(res2.body?.hashtags?.join(" "));
  console.log("");

  // ── Framework 3 live ──
  console.log("\n── LIVE — walkthrough_carousel ──");
  const res3 = await callHandler({
    live: true,
    body: {
      voice_profile_id: VOICE_PROFILE_ID,
      listing_id:       LISTING_ID,
      framework_name:   "walkthrough_carousel",
      // No slide_subjects override — exercises default fallback in production.
    },
  });
  check("live F3: returns 200",                          res3.statusCode === 200, `got ${res3.statusCode} ${JSON.stringify(res3.body)}`);
  check("live F3: framework_used === walkthrough_carousel", res3.body?.framework_used === "walkthrough_carousel");
  check("live F3: slides array present",                 Array.isArray(res3.body?.slides));
  // Default fallback has 5 subjects → 7 slides total (1 cover + 5 + 1 final)
  check("live F3: 7 slides (cover + 5 default subjects + final)",
    res3.body?.slides?.length === 7);
  check("live F3: slide 1 subject === 'cover'",          res3.body?.slides?.[0]?.subject === "cover");
  check("live F3: last slide subject === 'final'",       res3.body?.slides?.[res3.body?.slides?.length - 1]?.subject === "final");
  // Every slide has slide_number + subject + text
  const slidesWellFormed = (res3.body?.slides || []).every(
    (s) => typeof s.slide_number === "number" && typeof s.subject === "string" && typeof s.text === "string"
  );
  check("live F3: every slide has slide_number/subject/text", slidesWellFormed);
  // Slide overlay text length cap (prompt says max 8 words; allow some slack via a soft cap of 12)
  const overlaysShort = (res3.body?.slides || []).every(
    (s) => String(s.text || "").trim().split(/\s+/).length <= 12
  );
  check("live F3: all slide overlays ≤ 12 words (soft cap on prompt's 8-word rule)", overlaysShort);
  // Universal contract checks
  check("live F3: hashtags 8-12",                        Array.isArray(res3.body?.hashtags) && res3.body.hashtags.length >= 8 && res3.body.hashtags.length <= 12);
  check("live F3: license # appears in caption",         res3.body?.caption?.includes("0123456"));
  check("live F3: brokerage appears in caption",         res3.body?.caption?.includes("Compass DFW"));
  check("live F3: caption ends with array-joined hashtags",
    res3.body?.caption?.endsWith((res3.body?.hashtags || []).join(" ")));
  // hook_line should equal the cover slide's text per the prompt contract
  check("live F3: hook_line === cover slide text",
    res3.body?.hook_line === res3.body?.slides?.[0]?.text);
  // cta_line should equal the final slide's text
  check("live F3: cta_line === final slide text",
    res3.body?.cta_line === res3.body?.slides?.[res3.body?.slides?.length - 1]?.text);

  console.log("\n── GENERATED CAPTION (walkthrough_carousel) ──\n");
  console.log(res3.body?.caption);
  console.log("\n── SLIDES ──");
  for (const s of (res3.body?.slides || [])) {
    console.log(`  ${String(s.slide_number).padStart(2, " ")}. [${s.subject}] ${s.text}`);
  }
  console.log("\n── HASHTAGS ──");
  console.log(res3.body?.hashtags?.join(" "));
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

// ── Unit tests: prompts/_helpers.js ──────────────────────────────────
//
// Direct unit tests on every helper exported from
// api/_content/prompts/_helpers.js — the shared boilerplate that
// every framework's build() function composes from. Covers happy
// path, edge cases (null/empty), and documented "Assumes" boundaries.

console.log("\n── api/_content/prompts/_helpers.js — shared builder helpers ──\n");

const helpers = await import(pathToFileURL(resolve(REPO_ROOT, "api", "_content", "prompts", "_helpers.js")).href);
const {
  arrOrEmpty,
  formatList,
  requireBuildInputs,
  mapVoiceProfileToPromptVars,
  mapListingToPromptVars,
  resolveOverride,
  requirePromptVars,
  substituteTemplate,
} = helpers;

// ── arrOrEmpty ──
{
  const a = [1, 2, 3];
  check("arrOrEmpty: array passes through (same reference)", arrOrEmpty(a) === a);
  check("arrOrEmpty: null → []",         Array.isArray(arrOrEmpty(null))      && arrOrEmpty(null).length === 0);
  check("arrOrEmpty: undefined → []",    Array.isArray(arrOrEmpty(undefined)) && arrOrEmpty(undefined).length === 0);
  check("arrOrEmpty: string → []",       arrOrEmpty("x").length === 0);
  check("arrOrEmpty: object → []",       arrOrEmpty({a:1}).length === 0);
}

// ── formatList ──
{
  check("formatList: joins with commas",            formatList(["a", "b", "c"])             === "a, b, c");
  check("formatList: empty → default fallback",     formatList([])                          === "(none specified)");
  check("formatList: null → default fallback",      formatList(null)                        === "(none specified)");
  check("formatList: custom fallback honored",      formatList([], "warm and direct")       === "warm and direct");
  check("formatList: filters blanks/whitespace",    formatList(["a", "", "  ", "b"])        === "a, b");
  check("formatList: all-blank → fallback",         formatList(["", "  ", null])            === "(none specified)");
  check("formatList: coerces non-strings via String", formatList([1, true, 3])              === "1, true, 3");
}

// ── requireBuildInputs ──
{
  // happy path: no throw
  let threw = false;
  try { requireBuildInputs({ voiceProfile: {}, listing: {} }, "test-fw"); } catch { threw = true; }
  check("requireBuildInputs: both present → no throw", !threw);

  let err = null;
  try { requireBuildInputs({ voiceProfile: null, listing: {} }, "test-fw"); } catch (e) { err = e; }
  check("requireBuildInputs: missing voiceProfile throws with framework label",
    err && err.message === "test-fw build: voiceProfile is required");

  err = null;
  try { requireBuildInputs({ voiceProfile: {}, listing: null }, "test-fw"); } catch (e) { err = e; }
  check("requireBuildInputs: missing listing throws with framework label",
    err && err.message === "test-fw build: listing is required");

  // voiceProfile checked first
  err = null;
  try { requireBuildInputs({ voiceProfile: null, listing: null }, "test-fw"); } catch (e) { err = e; }
  check("requireBuildInputs: voiceProfile checked before listing",
    err && err.message.includes("voiceProfile"));
}

// ── mapVoiceProfileToPromptVars ──
{
  const vp = {
    full_name: "Test Agent",
    brokerage_name: "Test Brokerage",
    license_number: "9999999",
    tone_descriptors: ["warm", "direct"],
    cta_verbs: ["DM", "schedule"],
    phrases_to_avoid: ["luxury", "stunning"],
  };
  const out = mapVoiceProfileToPromptVars(vp);
  check("mapVP: agent_name from full_name",   out.agent_name === "Test Agent");
  check("mapVP: brokerage_name pass-through", out.brokerage_name === "Test Brokerage");
  check("mapVP: license_number pass-through", out.license_number === "9999999");
  check("mapVP: tone_descriptors formatted",  out.tone_descriptors === "warm, direct");
  check("mapVP: cta_style with verbs",        out.cta_style === "Preferred CTA verbs: DM, schedule. Use one naturally.");
  check("mapVP: avoided_words formatted",     out.avoided_words === "luxury, stunning");

  // Assumes-block: null license_number passes through (caller is endpoint guard)
  const vpNoLicense = { ...vp, license_number: null };
  check("mapVP: null license_number passes through",
    mapVoiceProfileToPromptVars(vpNoLicense).license_number === null);

  // Edge: empty/missing arrays fall back to documented defaults
  const vpEmpty = {
    full_name: "X", brokerage_name: "Y", license_number: "1",
    tone_descriptors: [], cta_verbs: null, phrases_to_avoid: undefined,
  };
  const outEmpty = mapVoiceProfileToPromptVars(vpEmpty);
  check("mapVP: empty tone_descriptors → 'warm and direct' fallback",
    outEmpty.tone_descriptors === "warm and direct");
  check("mapVP: null cta_verbs → default verbs in style line",
    outEmpty.cta_style === "Preferred CTA verbs: send, schedule, ask. Use one naturally.");
  check("mapVP: undefined phrases_to_avoid → '(none specified)'",
    outEmpty.avoided_words === "(none specified)");
}

// ── mapListingToPromptVars ──
{
  const listing = {
    city: "Dallas", neighborhood: "Lakewood",
    beds: 4, baths: 3, sqft: "2,850",
    features: ["porch", "wood floors"],
  };
  const out = mapListingToPromptVars(listing);
  check("mapListing: neighborhood from column",     out.neighborhood === "Lakewood");
  check("mapListing: city pass-through",            out.city === "Dallas");
  check("mapListing: beds pass-through",            out.beds === 4);
  check("mapListing: baths pass-through",           out.baths === 3);
  check("mapListing: sqft pass-through",            out.sqft === "2,850");
  check("mapListing: features formatted",           out.features === "porch, wood floors");

  // neighborhood falls back to city
  const noNeighborhood = { ...listing, neighborhood: null };
  check("mapListing: null neighborhood falls back to city",
    mapListingToPromptVars(noNeighborhood).neighborhood === "Dallas");

  // both null → static default
  const neither = { ...listing, neighborhood: null, city: null };
  check("mapListing: null neighborhood + null city → '(neighborhood not specified)'",
    mapListingToPromptVars(neither).neighborhood === "(neighborhood not specified)");
  check("mapListing: null city → '(city not specified)'",
    mapListingToPromptVars(neither).city === "(city not specified)");

  // beds=0 preserved via ?? (Assumes-block boundary: 0 is a valid value)
  const zeroBeds = { ...listing, beds: 0, baths: 0 };
  const outZero = mapListingToPromptVars(zeroBeds);
  check("mapListing: beds=0 preserved (?? not ||)",  outZero.beds === 0);
  check("mapListing: baths=0 preserved (?? not ||)", outZero.baths === 0);

  // null beds → fallback string
  const noBeds = { ...listing, beds: null, baths: null, sqft: null };
  const outNo = mapListingToPromptVars(noBeds);
  check("mapListing: null beds → fallback",  outNo.beds  === "(beds not specified)");
  check("mapListing: null baths → fallback", outNo.baths === "(baths not specified)");
  check("mapListing: null sqft → fallback",  outNo.sqft  === "(sqft not specified)");

  // empty features
  check("mapListing: null features → '(no standout features listed)'",
    mapListingToPromptVars({ ...listing, features: null }).features === "(no standout features listed)");
}

// ── resolveOverride ──
{
  const listing = { story_angle: "from the column" };
  check("resolveOverride: extras wins over listing",
    resolveOverride({ story_angle: "from extras" }, listing, "story_angle", "default") === "from extras");
  check("resolveOverride: listing used when extras blank",
    resolveOverride({}, listing, "story_angle", "default") === "from the column");
  check("resolveOverride: fallback when both missing",
    resolveOverride({}, {}, "story_angle", "default") === "default");
  check("resolveOverride: whitespace extras treated as missing",
    resolveOverride({ story_angle: "   " }, listing, "story_angle", "default") === "from the column");
  check("resolveOverride: whitespace listing treated as missing",
    resolveOverride({}, { story_angle: "  " }, "story_angle", "default") === "default");
  check("resolveOverride: trims extras value",
    resolveOverride({ story_angle: "  hello  " }, {}, "story_angle", "default") === "hello");
  check("resolveOverride: null extras object handled",
    resolveOverride(null, listing, "story_angle", "default") === "from the column");
  check("resolveOverride: null listing object handled",
    resolveOverride({}, null, "story_angle", "default") === "default");
}

// ── requirePromptVars ──
{
  let threw = false;
  try { requirePromptVars({ a: 1, b: "x" }, ["a", "b"], "test-fw"); } catch { threw = true; }
  check("requirePromptVars: all present → no throw", !threw);

  let err = null;
  try { requirePromptVars({ a: 1 }, ["a", "b", "c"], "test-fw"); } catch (e) { err = e; }
  check("requirePromptVars: lists all missing keys with framework label",
    err && err.message === "test-fw build: missing required placeholder values: b, c");

  // Assumes-block boundary: empty string / 0 / false are VALID
  threw = false;
  try { requirePromptVars({ a: "", b: 0, c: false }, ["a", "b", "c"], "test-fw"); } catch { threw = true; }
  check("requirePromptVars: empty string / 0 / false treated as valid", !threw);

  // null and undefined are missing
  err = null;
  try { requirePromptVars({ a: null, b: undefined }, ["a", "b"], "test-fw"); } catch (e) { err = e; }
  check("requirePromptVars: null and undefined both flagged as missing",
    err && err.message === "test-fw build: missing required placeholder values: a, b");
}

// ── substituteTemplate ──
{
  check("substituteTemplate: replaces single placeholder",
    substituteTemplate("Hi {name}", { name: "world" }) === "Hi world");
  check("substituteTemplate: replaces multiple placeholders",
    substituteTemplate("{a} + {b} = {c}", { a: 1, b: 2, c: 3 }) === "1 + 2 = 3");
  check("substituteTemplate: leaves unknown placeholders verbatim",
    substituteTemplate("Hi {name}, missing {unknown}", { name: "x" }) === "Hi x, missing {unknown}");
  check("substituteTemplate: coerces values via String",
    substituteTemplate("n={n}", { n: 42 }) === "n=42");
  check("substituteTemplate: empty template → empty output",
    substituteTemplate("", { a: 1 }) === "");
  // Assumes-block: JSON-style {"key": ...} should NOT be substituted
  // (inner key starts with `"`, not a word char)
  check("substituteTemplate: JSON-style braces inside template preserved",
    substituteTemplate(`{"key": "{val}"}`, { val: "v" }) === `{"key": "v"}`);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed${LIVE ? " (live mode)" : " (mock mode)"}\n`);
if (failed > 0) process.exit(1);
