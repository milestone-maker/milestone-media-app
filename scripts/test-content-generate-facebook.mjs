#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/content-generate.js — Facebook Stage 2 content set.
// Mock-only (no Anthropic, no DB). Verifies:
//   • all 5 FB frameworks register + resolve and flow through the endpoint
//   • each emits the universal 7 fields with platform:"facebook" and NO slides
//   • the TREC compliance line is present in the caption
//   • per-module maxTokens is honored (3500, market_plain_talk 4096; IG default 2048)
//   • the microsite link is appended (FB, when a published microsite exists),
//     placed BEFORE the trailing hashtags; omitted when none; NEVER for Instagram
//   • the persisted generated_content row carries platform:"facebook" + the link
//   • the Instagram path is unchanged
//
//   node scripts/test-content-generate-facebook.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "content-generate.js");
const REGISTRY_PATH = resolve(REPO_ROOT, "api", "_content", "registry.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const { default: handler } = await import(pathToFileURL(HANDLER_PATH).href);
const { findPrompt, listPrompts } = await import(pathToFileURL(REGISTRY_PATH).href);

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

const AGENT_ID         = "00000000-0000-0000-0000-000000000a01";
const VOICE_PROFILE_ID = "00000000-0000-0000-0000-000000000b01";
const LISTING_ID       = "00000000-0000-0000-0000-000000000c01";
const VALID_TOKEN      = "fake-bearer-token";

const VOICE_PROFILE = {
  id: VOICE_PROFILE_ID, agent_id: AGENT_ID, full_name: "Sarah Martinez", display_name: "Sarah Martinez",
  brokerage_name: "Compass DFW", license_number: "0123456",
  hook_lines: ["Picture a slow Saturday in Prosper."], take_lines: ["Home is where the week finally exhales."],
  cta_verbs: ["join the conversation", "share"], tone_descriptors: ["warm", "grounded"],
  phrases_to_avoid: ["luxury", "desirable"],
};
const LISTING = {
  id: LISTING_ID, agent_id: AGENT_ID, address: "2410 Prosperity Dr", city: "Prosper", neighborhood: "Prosper",
  price: "$725,000", beds: 4, baths: 3, sqft: "3200", features: ["pool", "study", "walk to trails"],
  description: "A great home.", created_at: "2026-05-01T00:00:00Z",
};

// Supabase mock — captures generated_content inserts so we can assert persistence.
function makeSupabaseMock({ agent = { role: "agent", subscription_status: "active" } } = {}) {
  const inserted = [];
  const single = (data) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    inserted,
    auth: { getUser: async () => ({ data: { user: { id: AGENT_ID } }, error: null }) },
    from: (table) => {
      if (table === "agents")               return single(agent);
      if (table === "agent_voice_profiles") return single(VOICE_PROFILE);
      if (table === "listings")             return single(LISTING);
      if (table === "generated_content") {
        return { insert: (row) => { inserted.push(row); return { select: () => ({ maybeSingle: async () => ({ data: { id: "gc_1" }, error: null }) }) }; } };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Canned FB model output for a framework. Caption: body → compliance line →
// final CTA lead-in (colon line, NO url). No hashtags in caption (FB rule);
// hashtags[] is 1–3.
function cannedFb(slug) {
  return {
    caption:
      "Picture a slow Saturday in Prosper, the kind where the morning stretches out unhurried.\n\n" +
      "There's a home here — 4 bed, 3 bath, near the trails — that fits that rhythm.\n\n" +
      "Home is where the week finally exhales.\n\n" +
      "Sarah Martinez | Compass DFW | TREC License #0123456\n\n" +
      "See every photo and book a tour here:",
    hook_line: "Picture a slow Saturday in Prosper, the kind where the morning stretches out unhurried.",
    cta_line: "See every photo and book a tour here:",
    hashtags: ["#prosper", "#prospertx"],
    framework_used: slug,
    license_number: "0123456",
    platform: "facebook",
    content_type: "listing",
  };
}

// Canned IG output (unchanged path).
function cannedIg() {
  return {
    caption: "A lovely listing.\n\nSarah Martinez | Compass DFW | TREC License #0123456\n\n#dallas #realestate #dfw #homes #prosper #texas #listing #forsale",
    hook_line: "A lovely listing.", cta_line: "DM me.",
    hashtags: ["#dallas", "#realestate", "#dfw", "#homes", "#prosper", "#texas", "#listing", "#forsale"],
    framework_used: "story_driven_listing", license_number: "0123456",
    platform: "instagram", content_type: "listing",
  };
}

let capturedMaxTokens = null;
let capturedUserMessage = null;
function makeGenerate(canned) {
  return async (opts) => {
    capturedMaxTokens = opts.maxTokens;
    // Exercise the injected builders so a template error would surface here,
    // and capture the built user message for guardrail assertions.
    opts.promptBuilders.buildSystemPrompt({});
    capturedUserMessage = opts.promptBuilders.buildUserMessage({});
    return { parsed: canned, raw: JSON.stringify(canned) };
  };
}

// Microsite resolver spy.
function makeResolver(url) {
  const calls = [];
  return { calls, fn: async (_sb, listingId) => { calls.push(listingId); return url; } };
}

async function callHandler({ body, supabase, generate, resolveMicrositeUrl } = {}) {
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` }, body };
  const res = makeRes();
  await handler(req, res, { supabase: supabase || makeSupabaseMock(), generate, resolveMicrositeUrl });
  return res;
}

// Listing-focused frameworks first, then community/market (matches UI order).
const FB_FRAMEWORKS = [
  "property_showcase", "investment_angle",
  "neighbor_story", "community_question", "market_plain_talk", "win_share", "resource_drop",
];
const MICROSITE_URL = "https://app.milestonemediaphotography.com/p/2410-prosperity";

console.log("\n── api/content-generate.js — Facebook Stage 2 content set ──\n");

// 0. Registration: all 7 FB frameworks present under facebook/listing.
{
  const fb = listPrompts().filter((p) => p.platform === "facebook");
  check("7 FB frameworks registered", fb.length === 7, `got ${fb.length}`);
  for (const slug of FB_FRAMEWORKS) {
    check(`findPrompt facebook/listing/${slug}`, !!findPrompt("facebook", "listing", slug));
  }
}

// 1. Each FB framework: universal fields, platform facebook, no slides, compliance, maxTokens, microsite append.
for (const slug of FB_FRAMEWORKS) {
  capturedMaxTokens = null;
  const resolver = makeResolver(MICROSITE_URL);
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: slug, platform: "facebook", content_type: "listing" },
    generate: makeGenerate(cannedFb(slug)),
    resolveMicrositeUrl: resolver.fn,
  });
  check(`${slug} → 200`, res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check(`${slug} → platform facebook`, res.body?.platform === "facebook");
  check(`${slug} → framework_used matches`, res.body?.framework_used === slug);
  check(`${slug} → content_type listing`, res.body?.content_type === "listing");
  check(`${slug} → caption present`, typeof res.body?.caption === "string" && res.body.caption.length > 0);
  check(`${slug} → hook_line + cta_line present`, !!res.body?.hook_line && !!res.body?.cta_line);
  check(`${slug} → 1-3 hashtags`, Array.isArray(res.body?.hashtags) && res.body.hashtags.length >= 1 && res.body.hashtags.length <= 3);
  check(`${slug} → NO slides`, res.body?.slides === undefined);
  check(`${slug} → TREC compliance line in caption`, res.body?.caption.includes("TREC License #0123456"));
  const expTokens = slug === "market_plain_talk" ? 4096 : 3500;
  check(`${slug} → maxTokens ${expTokens}`, capturedMaxTokens === expTokens, `got ${capturedMaxTokens}`);
  // microsite append: URL present, after CTA lead-in, BEFORE hashtags
  check(`${slug} → microsite_url returned`, res.body?.microsite_url === MICROSITE_URL);
  check(`${slug} → URL in caption`, res.body?.caption.includes(MICROSITE_URL));
  check(`${slug} → URL after CTA lead-in`, res.body.caption.indexOf("book a tour here:") < res.body.caption.indexOf(MICROSITE_URL));
  check(`${slug} → URL before hashtags`, res.body.caption.indexOf(MICROSITE_URL) < res.body.caption.indexOf("#prosper"));
  check(`${slug} → resolver called with listing id`, resolver.calls.length === 1 && resolver.calls[0] === LISTING_ID);
  // investment_angle must carry the financial guardrails in its built prompt.
  if (slug === "investment_angle") {
    check("investment_angle → no-fabricated-figures guardrail in prompt", capturedUserMessage.includes("Do NOT fabricate specific financial figures"));
    check("investment_angle → no-guaranteed-returns guardrail in prompt", capturedUserMessage.includes("Do NOT guarantee, promise, or imply assured future returns"));
  }
}

// 2. Microsite omitted when none published → no URL, microsite_url null, CTA stands.
{
  const resolver = makeResolver(null);
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "neighbor_story", platform: "facebook", content_type: "listing" },
    generate: makeGenerate(cannedFb("neighbor_story")),
    resolveMicrositeUrl: resolver.fn,
  });
  check("no-microsite → 200", res.statusCode === 200);
  check("no-microsite → microsite_url null", res.body?.microsite_url === null);
  check("no-microsite → no http link in caption", !res.body.caption.includes("http"));
  check("no-microsite → CTA lead-in still present", res.body.caption.includes("book a tour here:"));
}

// 3. Persistence: generated_content row carries platform:facebook + the appended link.
{
  const supa = makeSupabaseMock();
  const resolver = makeResolver(MICROSITE_URL);
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "win_share", platform: "facebook", content_type: "listing" },
    supabase: supa,
    generate: makeGenerate(cannedFb("win_share")),
    resolveMicrositeUrl: resolver.fn,
  });
  check("persist → 200 + saved_id", res.statusCode === 200 && res.body?.saved_id === "gc_1");
  check("persist → row platform facebook", supa.inserted[0]?.platform === "facebook");
  check("persist → row caption has URL", supa.inserted[0]?.caption.includes(MICROSITE_URL));
  check("persist → row slides absent (FB)", supa.inserted[0]?.slides === undefined);
}

// 4. Instagram path UNCHANGED: resolver NOT called, no microsite_url, platform instagram, 8 hashtags.
{
  capturedMaxTokens = null;
  const resolver = makeResolver(MICROSITE_URL);
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "story_driven_listing", platform: "instagram", content_type: "listing" },
    generate: makeGenerate(cannedIg()),
    resolveMicrositeUrl: resolver.fn,
  });
  check("IG → 200", res.statusCode === 200);
  check("IG → platform instagram", res.body?.platform === "instagram");
  check("IG → NO microsite_url field", !("microsite_url" in (res.body || {})));
  check("IG → resolver NOT called", resolver.calls.length === 0);
  check("IG → no microsite URL in caption", !res.body.caption.includes("/p/"));
  check("IG → default maxTokens 2048", capturedMaxTokens === 2048, `got ${capturedMaxTokens}`);
}

// 5. Unknown FB framework → 400.
{
  const res = await callHandler({
    body: { voice_profile_id: VOICE_PROFILE_ID, listing_id: LISTING_ID, framework_name: "not_a_framework", platform: "facebook", content_type: "listing" },
    generate: makeGenerate(cannedFb("neighbor_story")),
    resolveMicrositeUrl: makeResolver(null).fn,
  });
  check("unknown FB framework → 400", res.statusCode === 400, `got ${res.statusCode}`);
}

// 6. UI order: the Content view's facebook framework list is listing-first, in
//    the exact required order. Parsed from source (the list lives in JSX state).
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(resolve(REPO_ROOT, "src", "views", "Content", "index.jsx"), "utf8");
  const fbBlock = src.split("facebook: [")[1]?.split("],")[0] || "";
  const slugOrder = [...fbBlock.matchAll(/slug:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const expected = [
    "property_showcase", "investment_angle", "neighbor_story",
    "community_question", "market_plain_talk", "win_share", "resource_drop",
  ];
  check("UI FB list has 7 frameworks", slugOrder.length === 7, `got ${slugOrder.length}`);
  check("UI FB order is listing-first, exact", JSON.stringify(slugOrder) === JSON.stringify(expected), slugOrder.join(","));
}

// 7. Hook originality: the shared system prompt carries the ORIGINALITY rule +
//    BANNED OPENERS list, and the per-framework templates carry NO liftable
//    example opener / sample caption text the model could copy verbatim.
{
  const { FACEBOOK_CAPTION_SYSTEM_PROMPT } = await import(
    pathToFileURL(resolve(REPO_ROOT, "api", "_content", "prompts", "facebook", "_helpers.js")).href
  );
  const sp = FACEBOOK_CAPTION_SYSTEM_PROMPT;
  check("system prompt has HOOK ORIGINALITY rule", sp.includes("HOOK ORIGINALITY"));
  check("system prompt requires varying the opener type", sp.includes("VARY THE OPENER TYPE"));
  check("system prompt has BANNED OPENERS list", sp.includes("BANNED OPENERS"));
  for (const banned of ["Everybody sleeps on", "Welcome to", "Nestled in", "Looking for", "Imagine", "Picture this"]) {
    check(`banned opener listed: ${banned}`, sp.includes(banned));
  }
  check("system prompt forbids reflexive neighborhood-name opener", sp.includes("reflexively naming the listing"));
  // Old liftable examples removed from the shared prompt.
  check("scrubbed: no 'book a tour here' sample in system prompt", !sp.includes("book a tour here"));
  check("scrubbed: no 'what would you add' sample in system prompt", !sp.includes("what would you add"));

  // Per-framework templates carry no liftable example opener / sample caption.
  for (const slug of FB_FRAMEWORKS) {
    const built = findPrompt("facebook", "listing", slug).build({ voiceProfile: VOICE_PROFILE, listing: LISTING, extras: {} });
    const um = built.userMessage;
    check(`${slug} template: no 'Everybody sleeps' example`, !um.includes("Everybody sleeps"));
    check(`${slug} template: no 'book a tour here' sample`, !um.includes("book a tour here"));
    check(`${slug} template: no 'what would you add' sample`, !um.includes("what would you add"));
    check(`${slug} template: references HOOK ORIGINALITY`, um.includes("HOOK ORIGINALITY"));
    // system prompt is the same binding one for every framework
    check(`${slug} uses the FB system prompt`, built.systemPrompt === sp);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
