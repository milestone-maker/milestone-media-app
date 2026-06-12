#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-post.js — FACEBOOK posting path (Stage 3a).
// bundle mocked via depsOverride. Verifies:
//   • connection read from agent_platform_connections by (agent_id, platform=facebook)
//   • album built by REUSING the IG selection (selectCarouselPhotos) over the
//     listing's photo_labels, taking RAW photo_url, in order, host-filtered
//   • microsite token re-resolved at POST time: substituted live / dropped when
//     none / inserted when a microsite was published AFTER generation
//   • createPost called with platform 'facebook' + the resolved caption + uploadIds
//   • tracking row platform='facebook'; scheduled vs immediate
//
//   node scripts/test-social-post-facebook.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-post.js");
const MICROSITE_PATH = resolve(REPO_ROOT, "api", "_lib", "microsite.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";
const SB_HOST = new URL(process.env.SUPABASE_URL).host;

const { default: handler } = await import(pathToFileURL(HANDLER_PATH).href);
const { MICROSITE_TOKEN } = await import(pathToFileURL(MICROSITE_PATH).href);

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

const AGENT_ID   = "00000000-0000-0000-0000-000000000a01";
const CONTENT_ID = "00000000-0000-0000-0000-000000000d01";
const LISTING_ID = "00000000-0000-0000-0000-000000000c01";
const VALID_TOKEN = "fake-bearer-token";

// FB caption carries the microsite placeholder token (after the CTA lead-in,
// before the hashtags) — exactly how content-generate stores it.
const FB_CAPTION =
  "A grounded look at this home.\n\nSarah Martinez | Compass DFW | TREC License #0123456\n\nSee the full home here:\n" +
  MICROSITE_TOKEN + "\n\n#prosper";

const pub = (name) => `https://${SB_HOST}/storage/v1/object/public/published-media/${LISTING_ID}/${name}`;

// photo_labels rows (raw URLs). Includable (confidence ≥ 0.7). One has a pool
// feature so backyard is included; one is on a FOREIGN host (must be filtered).
const PHOTO_LABELS = [
  { id: "1", listing_id: LISTING_ID, photo_url: pub("drone.jpg"),    category: "drone",            features: [],            confidence: 0.95, agent_corrected: false, sort_order: 0 },
  { id: "2", listing_id: LISTING_ID, photo_url: pub("facade.jpg"),   category: "front_facade",     features: [],            confidence: 0.95, agent_corrected: false, sort_order: 1 },
  { id: "3", listing_id: LISTING_ID, photo_url: pub("living.jpg"),   category: "living",           features: [],            confidence: 0.95, agent_corrected: false, sort_order: 2 },
  { id: "4", listing_id: LISTING_ID, photo_url: pub("kitchen.jpg"),  category: "kitchen",          features: [],            confidence: 0.95, agent_corrected: false, sort_order: 3 },
  { id: "5", listing_id: LISTING_ID, photo_url: pub("pbed.jpg"),     category: "primary_bedroom",  features: [],            confidence: 0.95, agent_corrected: false, sort_order: 4 },
  { id: "6", listing_id: LISTING_ID, photo_url: pub("pbath.jpg"),    category: "primary_bathroom", features: [],            confidence: 0.95, agent_corrected: false, sort_order: 5 },
  { id: "7", listing_id: LISTING_ID, photo_url: pub("yard.jpg"),     category: "backyard",         features: ["pool deck"], confidence: 0.95, agent_corrected: false, sort_order: 6 },
  { id: "8", listing_id: LISTING_ID, photo_url: "https://evil.cdn.example/yard2.jpg", category: "dining", features: [], confidence: 0.95, agent_corrected: false, sort_order: 7 },
];
// Expected FB album order (IG selection over the above): cover drone, then the
// subject walk facade→living→kitchen→pbed→pbath, + backyard (pool). dining & the
// foreign-host url are excluded.
const EXPECTED_ALBUM = [pub("drone.jpg"), pub("facade.jpg"), pub("living.jpg"), pub("kitchen.jpg"), pub("pbed.jpg"), pub("pbath.jpg"), pub("yard.jpg")];

function makeSupabaseMock({
  agent       = { role: "agent", subscription_status: "active" },
  connection  = { bundle_team_id: "team_1", connection_status: "connected" },
  content     = { id: CONTENT_ID, agent_id: AGENT_ID, listing_id: LISTING_ID, caption: FB_CAPTION },
  photoLabels = PHOTO_LABELS,
} = {}) {
  const track = { inserts: [], updates: [] };
  const seen = { connPlatform: null };
  return {
    _track: track, _seen: seen,
    auth: { getUser: async () => ({ data: { user: { id: AGENT_ID } }, error: null }) },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: null }) }) }) };
      }
      if (table === "agent_platform_connections") {
        return { select: () => ({ eq: () => ({ eq: (_c, v) => { seen.connPlatform = v; return { maybeSingle: async () => ({ data: connection, error: null }) }; } }) }) };
      }
      if (table === "generated_content") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: content, error: null }) }) }) };
      }
      if (table === "photo_labels") {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: photoLabels, error: null }) }) }) };
      }
      if (table === "social_posts") {
        return {
          insert: (row) => { track.inserts.push(row); return { select: () => ({ maybeSingle: async () => ({ data: { id: "sp_1" }, error: null }) }) }; },
          update: (row) => ({ eq: async () => { track.updates.push(row); return { error: null }; } }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeBundle({ postResp = { id: "post_1", status: "SCHEDULED" } } = {}) {
  const calls = { uploads: [], post: null, postCount: 0 };
  return {
    calls,
    createUpload: async ({ teamId, url }) => { calls.uploads.push({ teamId, url }); return { id: `up_${calls.uploads.length}` }; },
    createPost: async (args) => { calls.postCount++; calls.post = args; return postResp; },
  };
}

const FIXED_NOW = new Date("2026-06-09T15:30:00.000Z");

async function callHandler({ body, supabase, bundle, resolveMicrositeUrl } = {}) {
  const b = bundle || makeBundle();
  const supa = supabase || makeSupabaseMock();
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` }, body: body ?? { contentId: CONTENT_ID, platform: "facebook" } };
  const res = makeRes();
  await handler(req, res, {
    supabase: supa, createUpload: b.createUpload, createPost: b.createPost,
    resolveMicrositeUrl: resolveMicrositeUrl || (async () => "https://app.milestonemediaphotography.com/p/the-home"),
    now: () => FIXED_NOW,
  });
  return { res, bundle: b, supabase: supa };
}

console.log("\n── api/social-post.js — Facebook posting path ──\n");

const LIVE_URL = "https://app.milestonemediaphotography.com/p/the-home";

// 1. HAPPY PATH — connection, album, token substitution, createPost FACEBOOK.
{
  const { res, bundle, supabase } = await callHandler();
  check("fb happy → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("connection queried for platform=facebook", supabase._seen.connPlatform === "facebook");
  check("album = reused IG selection (raw URLs, in order)", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
  check("foreign-host + dining photo excluded from album", !bundle.calls.uploads.some((u) => u.url.includes("evil.cdn")));
  check("uploads carry the FB team id", bundle.calls.uploads.every((u) => u.teamId === "team_1"));
  check("createPost called with platform facebook", bundle.calls.post?.platform === "facebook");
  check("createPost uploadIds in album order", JSON.stringify(bundle.calls.post.uploadIds) === JSON.stringify(["up_1","up_2","up_3","up_4","up_5","up_6","up_7"]));
  check("caption token substituted with LIVE url", bundle.calls.post.text.includes(LIVE_URL) && !bundle.calls.post.text.includes(MICROSITE_TOKEN));
  check("tracking row platform=facebook", supabase._track.inserts[0]?.platform === "facebook");
  check("tracking image_urls = album", JSON.stringify(supabase._track.inserts[0]?.image_urls) === JSON.stringify(EXPECTED_ALBUM));
  check("immediate → postDate now+3min", bundle.calls.post.postDate === new Date(FIXED_NOW.getTime() + 3*60*1000).toISOString());
}

// 2. Microsite RETIRED/none at post time → token line dropped (no link, no token).
{
  const { res, bundle } = await callHandler({ resolveMicrositeUrl: async () => null });
  check("no live microsite → 200", res.statusCode === 200);
  check("token dropped (no token in caption)", !bundle.calls.post.text.includes(MICROSITE_TOKEN));
  check("no microsite url in caption", !bundle.calls.post.text.includes("/p/"));
  check("CTA lead-in survives", bundle.calls.post.text.includes("See the full home here:"));
}

// 3. Microsite published AFTER generation → live url inserted at the token slot.
{
  const NEW_URL = "https://app.milestonemediaphotography.com/p/published-later";
  const { bundle } = await callHandler({ resolveMicrositeUrl: async () => NEW_URL });
  check("published-after-gen → live url inserted", bundle.calls.post.text.includes(NEW_URL));
}

// 4. Legacy caption with NO token → posted unchanged.
{
  const supa = makeSupabaseMock({ content: { id: CONTENT_ID, agent_id: AGENT_ID, listing_id: LISTING_ID, caption: "No token here.\n\n#prosper" } });
  const { bundle } = await callHandler({ supabase: supa, resolveMicrositeUrl: async () => LIVE_URL });
  check("legacy no-token caption unchanged", bundle.calls.post.text === "No token here.\n\n#prosper");
}

// 5. FB not connected → 409 with FB-specific message, no bundle call.
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "pending" } });
  const { res, bundle } = await callHandler({ supabase: supa });
  check("fb not connected → 409", res.statusCode === 409, `got ${res.statusCode}`);
  check("409 message names Facebook", /Facebook not connected/.test(res.body?.error || ""), res.body?.error);
  check("no bundle call when not connected", bundle.calls.postCount === 0);
}

// 6. No usable classified photos → BLOCKED (no text-only post), no bundle call.
{
  const supa = makeSupabaseMock({ photoLabels: [] });
  const { res, bundle } = await callHandler({ supabase: supa });
  check("no photos → 409 blocked", res.statusCode === 409, `got ${res.statusCode}`);
  check("no photos → code 'no_photos'", res.body?.code === "no_photos");
  check("no photos → actionable message (run photo analysis)", /photo analysis/i.test(res.body?.error || ""), res.body?.error);
  check("no photos → no bundle call", bundle.calls.postCount === 0 && bundle.calls.uploads.length === 0);
}

// 7. Scheduled FB post — future postDate honored.
{
  const future = new Date(FIXED_NOW.getTime() + 60*60*1000).toISOString();
  const { res, bundle, supabase } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", postDate: future } });
  check("scheduled fb → 200", res.statusCode === 200);
  check("scheduled fb → postDate honored", bundle.calls.post.postDate === future);
  check("scheduled fb → tracking scheduled_for", supabase._track.inserts[0]?.scheduled_for === future);
}

// 8. FB ignores client-supplied imageUrls (album is server-built).
{
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", imageUrls: ["https://evil.cdn.example/x.jpg"] } });
  check("fb ignores client imageUrls (uses server album)", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
}

// 9. BACKYARD UNGATE — backyard photo present with NO pool (decoupled from the
//    carousel's pool gate). Album still includes the backyard photo.
{
  const noPool = PHOTO_LABELS
    .filter((p) => p.category !== "dining") // drop the foreign-host row's category noise
    .map((p) => p.category === "backyard" ? { ...p, features: [] } : p); // remove pool feature
  const supa = makeSupabaseMock({ photoLabels: noPool });
  const { bundle } = await callHandler({ supabase: supa });
  check("backyard ungate → album includes backyard (no pool)", bundle.calls.uploads.some((u) => u.url === pub("yard.jpg")));
  check("backyard ungate → full album in order", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
}

// 10. No-backyard photo → album simply omits it (no crash).
{
  const noYard = PHOTO_LABELS.filter((p) => p.category !== "backyard" && p.category !== "dining");
  const supa = makeSupabaseMock({ photoLabels: noYard });
  const { res, bundle } = await callHandler({ supabase: supa });
  check("no backyard → 200", res.statusCode === 200);
  check("no backyard → album omits backyard", !bundle.calls.uploads.some((u) => u.url === pub("yard.jpg")));
}

// 11. AGENT EXTRA PHOTOS — appended after the curated set, in selection order.
{
  const E1 = pub("extra-1.jpg"), E2 = pub("extra-2.jpg");
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", extraPhotoUrls: [E1, E2] } });
  const album = bundle.calls.uploads.map((u) => u.url);
  check("extras appended after curated, in order", JSON.stringify(album) === JSON.stringify([...EXPECTED_ALBUM, E1, E2]));
}

// 12. Extra that's already in the curated set → de-duped (not added twice).
{
  const E1 = pub("extra-1.jpg");
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", extraPhotoUrls: [pub("kitchen.jpg"), E1] } });
  const album = bundle.calls.uploads.map((u) => u.url);
  check("curated-dup extra skipped", JSON.stringify(album) === JSON.stringify([...EXPECTED_ALBUM, E1]));
  check("kitchen appears exactly once", album.filter((u) => u === pub("kitchen.jpg")).length === 1);
}

// 13. Foreign-host extra dropped (same allowlist as curated).
{
  const E1 = pub("extra-1.jpg");
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", extraPhotoUrls: ["https://evil.cdn.example/x.jpg", E1] } });
  const album = bundle.calls.uploads.map((u) => u.url);
  check("foreign-host extra dropped", !album.some((u) => u.includes("evil.cdn")));
  check("valid extra kept", JSON.stringify(album) === JSON.stringify([...EXPECTED_ALBUM, E1]));
}

// 14. Absent / empty extras → exactly today's curated album.
{
  const { bundle: b1 } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook" } });
  check("absent extras = curated album", JSON.stringify(b1.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
  const { bundle: b2 } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", extraPhotoUrls: [] } });
  check("empty extras = curated album", JSON.stringify(b2.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
}

// 15. No cap — many extras all included.
{
  const many = Array.from({ length: 12 }, (_, i) => pub(`extra-${i}.jpg`));
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", extraPhotoUrls: many } });
  const album = bundle.calls.uploads.map((u) => u.url);
  check("no cap → all extras included", album.length === EXPECTED_ALBUM.length + many.length);
  check("no cap → extras after curated", JSON.stringify(album) === JSON.stringify([...EXPECTED_ALBUM, ...many]));
}

// 16. EXPLICIT ALBUM (albumPhotoUrls) — the agent's final ordered selection.
{
  // Subset + reorder of valid listing photos → posts exactly that.
  const album = [pub("kitchen.jpg"), pub("drone.jpg"), pub("yard.jpg")];
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: album } });
  check("explicit album → posts exactly that order", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify(album));
}

// 17. Explicit album supersedes curated (does NOT append the default set).
{
  const album = [pub("kitchen.jpg")];
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: album } });
  check("explicit album is the WHOLE album (no curated merge)", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify([pub("kitchen.jpg")]));
}

// 18. Validation: foreign-host URL dropped; non-listing valid-host URL dropped.
{
  const album = ["https://evil.cdn.example/x.jpg", pub("kitchen.jpg"), pub("ghost-not-in-listing.jpg")];
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: album } });
  check("album: foreign-host dropped, non-listing dropped, valid kept", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify([pub("kitchen.jpg")]));
}

// 19. A listing photo that lives on a FOREIGN host is still rejected (host AND listing).
{
  // PHOTO_LABELS id 8 (dining) is on evil.cdn — in the listing set but bad host.
  const album = ["https://evil.cdn.example/yard2.jpg"];
  const { res, bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: album } });
  check("foreign-host listing photo → album empties → 409 no_photos", res.statusCode === 409 && res.body?.code === "no_photos");
  check("foreign-host listing photo → no bundle call", bundle.calls.postCount === 0);
}

// 20. De-dupe + order preserved in the explicit album.
{
  const album = [pub("kitchen.jpg"), pub("kitchen.jpg"), pub("drone.jpg")];
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: album } });
  check("explicit album de-duped, order kept", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify([pub("kitchen.jpg"), pub("drone.jpg")]));
}

// 21. Empty/all-invalid explicit album → no_photos (no text-only post).
{
  const { res, bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook", albumPhotoUrls: ["https://evil.cdn.example/x.jpg"] } });
  check("all-invalid album → 409 no_photos", res.statusCode === 409 && res.body?.code === "no_photos");
  check("all-invalid album → no bundle call", bundle.calls.postCount === 0);
}

// 22. No album sent → falls back to the curated default (back-compat).
{
  const { bundle } = await callHandler({ body: { contentId: CONTENT_ID, platform: "facebook" } });
  check("no album → curated fallback", JSON.stringify(bundle.calls.uploads.map((u) => u.url)) === JSON.stringify(EXPECTED_ALBUM));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
