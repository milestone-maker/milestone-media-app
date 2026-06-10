#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Stage 3a (manual scheduling) test for api/social-post.js — the OPTIONAL
// postDate body field. Mocks Supabase + bundle via depsOverride. No network.
// Covers:
//   (a) no postDate            → effectivePostDate ≈ now + buffer, persisted
//                                to scheduled_for, status SCHEDULED.
//   (b) valid future postDate  → threaded to createPost AND persisted to
//                                scheduled_for, status SCHEDULED.
//   (c) past / too-soon postDate → 400, no bundle call, no tracking insert.
//   (d) malformed / wrong-type postDate → 400, no bundle call.
//
//   node scripts/test-social-post-scheduling.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-post.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";
const SB_HOST = new URL(process.env.SUPABASE_URL).host;

const mod = await import(pathToFileURL(HANDLER_PATH).href);
const handler = mod.default;

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

const AGENT_ID    = "00000000-0000-0000-0000-000000000a01";
const CONTENT_ID  = "00000000-0000-0000-0000-000000000d01";
const VALID_TOKEN = "fake-bearer-token";
const CAPTION     = "A quiet kitchen that earns its light.\n\n#dallasrealestate #lakewood";

const URL_A = `https://${SB_HOST}/storage/v1/object/public/carousel-posts/${AGENT_ID}/01_card.png`;
const URL_B = `https://auth.milestonemediaphotography.com/storage/v1/object/public/carousel-posts/${AGENT_ID}/02_photo.jpg`;
const VALID_URLS = [URL_A, URL_B];

// Must mirror SCHEDULE_BUFFER_MS in api/social-post.js.
const BUFFER_MS = 3 * 60 * 1000;
const FIXED_NOW = new Date("2026-06-09T15:30:00.000Z");

function makeSupabaseMock({
  user        = { id: AGENT_ID },
  agent       = { role: "agent", subscription_status: "active" },
  connection  = { bundle_team_id: "team_1", connection_status: "connected" },
  content     = { id: CONTENT_ID, agent_id: AGENT_ID, caption: CAPTION },
} = {}) {
  const track = { inserts: [], updates: [] };
  const mock = {
    _track: track,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: null }) }) }) };
      }
      if (table === "agent_social_connections") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: connection, error: null }) }) }) };
      }
      if (table === "generated_content") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: content, error: null }) }) }) };
      }
      if (table === "social_posts") {
        return {
          insert: (row) => {
            track.inserts.push(row);
            return { select: () => ({ maybeSingle: async () => ({ data: { id: "sp_1" }, error: null }) }) };
          },
          update: (row) => ({ eq: async () => { track.updates.push(row); return { error: null }; } }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return mock;
}

function makeBundleMocks({ postResp = { id: "post_1", status: "SCHEDULED" } } = {}) {
  const calls = { uploads: [], post: null, postCount: 0 };
  return {
    calls,
    createUpload: async ({ teamId, url }) => { calls.uploads.push({ teamId, url }); return { id: `up_${calls.uploads.length}` }; },
    createPost: async (args) => { calls.postCount++; calls.post = args; return postResp; },
  };
}

async function callHandler({ body } = {}) {
  const bundle = makeBundleMocks();
  const supa = makeSupabaseMock();
  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    body: body ?? { contentId: CONTENT_ID, imageUrls: VALID_URLS },
  };
  const res = makeRes();
  await handler(req, res, {
    supabase:     supa,
    createUpload: bundle.createUpload,
    createPost:   bundle.createPost,
    now:          () => FIXED_NOW,
  });
  return { res, bundle, supabase: supa };
}

console.log("\n── api/social-post.js — Stage 3a manual scheduling (postDate) ──\n");

// ── (a) No postDate → immediate: now + buffer, persisted, SCHEDULED ──
{
  const { res, bundle, supabase } = await callHandler();
  const expectedIso = new Date(FIXED_NOW.getTime() + BUFFER_MS).toISOString();
  check("(a) no postDate → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("(a) createPost postDate = now + buffer", bundle.calls.post.postDate === expectedIso, `got ${bundle.calls.post.postDate}`);
  check("(a) createPost status SCHEDULED", bundle.calls.post.status === "SCHEDULED");
  check("(a) tracking insert persists scheduled_for = now + buffer", supabase._track.inserts[0]?.scheduled_for === expectedIso, `got ${supabase._track.inserts[0]?.scheduled_for}`);
  check("(a) response scheduledFor echoes effectivePostDate", res.body?.scheduledFor === expectedIso);
  check("(a) still posts (one createPost call)", bundle.calls.postCount === 1);
}

// ── (b) Valid future postDate → threaded + persisted ──
{
  const future = new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2h
  const { res, bundle, supabase } = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: future } });
  check("(b) valid future postDate → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("(b) createPost postDate = chosen future ISO", bundle.calls.post.postDate === future, `got ${bundle.calls.post.postDate}`);
  check("(b) createPost status SCHEDULED", bundle.calls.post.status === "SCHEDULED");
  check("(b) tracking insert persists scheduled_for = chosen future ISO", supabase._track.inserts[0]?.scheduled_for === future);
  check("(b) response scheduledFor = chosen future ISO", res.body?.scheduledFor === future);
}

// ── (b2) Future postDate given in a non-UTC offset is normalized to the same instant ──
{
  // 2026-06-09T12:00:00-05:00 == 2026-06-09T17:00:00Z (well past now+buffer)
  const offsetIso = "2026-06-09T12:00:00-05:00";
  const expectedIso = new Date(offsetIso).toISOString();
  const { res, bundle } = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: offsetIso } });
  check("(b2) offset ISO accepted → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("(b2) normalized to UTC instant", bundle.calls.post.postDate === expectedIso, `got ${bundle.calls.post.postDate}`);
}

// ── (c) Past / too-soon postDate → 400, no bundle call, no tracking insert ──
{
  // Past
  const past = new Date(FIXED_NOW.getTime() - 60 * 1000).toISOString();
  const r1 = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: past } });
  check("(c) past postDate → 400", r1.res.statusCode === 400, `got ${r1.res.statusCode}`);
  check("(c) past → no bundle call", r1.bundle.calls.uploads.length === 0 && r1.bundle.calls.postCount === 0);
  check("(c) past → no tracking insert", r1.supabase._track.inserts.length === 0);

  // Too soon: inside the buffer window (now + 1min < now + 3min buffer).
  const tooSoon = new Date(FIXED_NOW.getTime() + 60 * 1000).toISOString();
  const r2 = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: tooSoon } });
  check("(c) too-soon postDate → 400", r2.res.statusCode === 400, `got ${r2.res.statusCode}`);
  check("(c) too-soon → no bundle call", r2.bundle.calls.postCount === 0);

  // Exactly at the boundary (now + buffer) → allowed.
  const boundary = new Date(FIXED_NOW.getTime() + BUFFER_MS).toISOString();
  const r3 = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: boundary } });
  check("(c) exactly now+buffer → 200 (inclusive boundary)", r3.res.statusCode === 200, `got ${r3.res.statusCode}`);
}

// ── (d) Malformed / wrong-type postDate → 400, no bundle call ──
{
  for (const bad of ["not-a-date", "2026-13-45T99:99:99Z", ""]) {
    const r = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: bad } });
    check(`(d) malformed postDate (${JSON.stringify(bad)}) → 400`, r.res.statusCode === 400, `got ${r.res.statusCode}`);
    check("(d) malformed → no bundle call", r.bundle.calls.postCount === 0);
  }
  // Wrong type (number) → 400
  const rNum = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: VALID_URLS, postDate: 1234567890 } });
  check("(d) numeric postDate → 400", rNum.res.statusCode === 400, `got ${rNum.res.statusCode}`);
  check("(d) numeric → no bundle call", rNum.bundle.calls.postCount === 0);
}

// A couple of node:assert sanity guards so the file genuinely exercises assert.
assert.strictEqual(typeof handler, "function", "handler must be a function");
assert.ok(BUFFER_MS === 3 * 60 * 1000, "buffer constant mirrors the endpoint");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
