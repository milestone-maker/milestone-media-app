#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-post.js — publish a generated carousel to
// the connected Instagram via bundle (Stage 2a). Mocks Supabase + bundle
// (createUpload / createPost) via depsOverride. No network, no real key.
// Verifies auth/gating, connection requirement, ownership, URL validation,
// ordered uploads, and the create-post body.
//
//   node scripts/test-social-post.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-post.js");

// Must match the host the endpoint derives from SUPABASE_URL for the URL guard.
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

// Two valid public Storage URLs (default supabase host + custom domain).
const URL_A = `https://${SB_HOST}/storage/v1/object/public/carousel-posts/${AGENT_ID}/01_card.png`;
const URL_B = `https://auth.milestonemediaphotography.com/storage/v1/object/public/carousel-posts/${AGENT_ID}/02_photo.jpg`;
const VALID_URLS = [URL_A, URL_B];

function makeSupabaseMock({
  user           = { id: AGENT_ID },
  authError      = null,
  agent          = { role: "agent", subscription_status: "active" },
  agentErr       = null,
  connection     = { bundle_team_id: "team_1", connection_status: "connected" },
  connErr        = null,
  content        = { id: CONTENT_ID, agent_id: AGENT_ID, caption: CAPTION },
  contentErr     = null,
  socialInsertId = "sp_1",
  socialInsertErr = null,
} = {}) {
  // Records every social_posts write so tests can assert the tracking lifecycle.
  const track = { inserts: [], updates: [] };
  const mock = {
    _track: track,
    auth: {
      getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }),
    },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: agentErr }) }) }) };
      }
      if (table === "agent_social_connections") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: connection, error: connErr }) }) }) };
      }
      if (table === "generated_content") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: content, error: contentErr }) }) }) };
      }
      if (table === "social_posts") {
        return {
          insert: (row) => {
            track.inserts.push(row);
            return { select: () => ({ maybeSingle: async () => ({ data: socialInsertErr ? null : { id: socialInsertId }, error: socialInsertErr }) }) };
          },
          update: (row) => ({ eq: async (_col, _val) => { track.updates.push(row); return { error: null }; } }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return mock;
}

function makeBundleMocks({ uploadThrow = null, postThrow = null, postResp = { id: "post_1", status: "SCHEDULED" } } = {}) {
  const calls = { uploads: [], post: null, postCount: 0 };
  return {
    calls,
    createUpload: async ({ teamId, url }) => {
      calls.uploads.push({ teamId, url });
      if (uploadThrow) throw uploadThrow;
      // id derived from order so we can assert ordering preserved.
      return { id: `up_${calls.uploads.length}` };
    },
    createPost: async (args) => {
      calls.postCount++; calls.post = args;
      if (postThrow) throw postThrow;
      return postResp;
    },
  };
}

const FIXED_NOW = new Date("2026-06-09T15:30:00.000Z");

async function callHandler({ headers, body, supabaseOverride, bundle } = {}) {
  const b = bundle || makeBundleMocks();
  const supa = supabaseOverride || makeSupabaseMock();
  const req = {
    method: "POST",
    headers: headers ?? { authorization: `Bearer ${VALID_TOKEN}` },
    body: body ?? { contentId: CONTENT_ID, imageUrls: VALID_URLS },
  };
  const res = makeRes();
  await handler(req, res, {
    supabase:     supa,
    createUpload: b.createUpload,
    createPost:   b.createPost,
    now:          () => FIXED_NOW,
  });
  return { res, bundle: b, supabase: supa };
}

console.log("\n── api/social-post.js — publish carousel to Instagram ──\n");

// 1. HAPPY PATH
{
  const { res, bundle, supabase } = await callHandler();
  check("happy path → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("returns postId", res.body?.postId === "post_1");
  check("returns status", res.body?.status === "SCHEDULED");
  check("returns trackingId", res.body?.trackingId === "sp_1");
  check("createUpload called once per URL", bundle.calls.uploads.length === 2);
  check("uploads in order (URL_A first)", bundle.calls.uploads[0].url === URL_A && bundle.calls.uploads[1].url === URL_B);
  check("uploads carry teamId", bundle.calls.uploads.every((u) => u.teamId === "team_1"));
  check("createPost called once", bundle.calls.postCount === 1);
  check("post uploadIds in order", JSON.stringify(bundle.calls.post.uploadIds) === JSON.stringify(["up_1", "up_2"]));
  check("post text = stored caption (verbatim, hashtags NOT re-appended)", bundle.calls.post.text === CAPTION);
  check("post text has no duplicated hashtag block", (bundle.calls.post.text.match(/#dallasrealestate/g) || []).length === 1);
  check("post status SCHEDULED (immediate)", bundle.calls.post.status === "SCHEDULED");
  // Immediate posts now use now + a small buffer (Stage 3a) so bundle never
  // sees a postDate that isn't slightly in the future.
  check("post postDate = now + 3min buffer", bundle.calls.post.postDate === new Date(FIXED_NOW.getTime() + 3 * 60 * 1000).toISOString());
  check("post title is a label, not the caption", typeof bundle.calls.post.title === "string" && bundle.calls.post.title !== CAPTION);

  // Tracking lifecycle: pending row inserted, then updated to submitted.
  const t = supabase._track;
  check("tracking: one pending row inserted", t.inserts.length === 1);
  check("tracking: insert has agent_id + content_id", t.inserts[0]?.agent_id === AGENT_ID && t.inserts[0]?.content_id === CONTENT_ID);
  check("tracking: insert status pending", t.inserts[0]?.status === "pending");
  check("tracking: insert stores image_urls", JSON.stringify(t.inserts[0]?.image_urls) === JSON.stringify(VALID_URLS));
  check("tracking: updated to submitted", t.updates.some((u) => u.status === "submitted"));
  check("tracking: submitted carries bundle_post_id", t.updates.some((u) => u.status === "submitted" && u.bundle_post_id === "post_1"));
  check("tracking: never marked failed on success", !t.updates.some((u) => u.status === "failed"));
}

// 2. Missing Authorization → 401
{
  const { res } = await callHandler({ headers: {} });
  check("missing auth → 401", res.statusCode === 401);
}

// 3. Invalid/expired token → 401
{
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ authError: { message: "bad jwt" } }) });
  check("invalid token → 401", res.statusCode === 401);
}

// 4. Unsubscribed non-admin → 402 (before any bundle call)
{
  const bundle = makeBundleMocks();
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ agent: { role: "agent", subscription_status: "canceled" } }), bundle });
  check("unsubscribed → 402", res.statusCode === 402, `got ${res.statusCode}`);
  check("unsubscribed → no bundle call", bundle.calls.uploads.length === 0 && bundle.calls.postCount === 0);
}

// 5. Admin no-sub → passes the gate (→ 200 happy)
{
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ agent: { role: "admin", subscription_status: null } }) });
  check("admin no-sub → 200", res.statusCode === 200, `got ${res.statusCode}`);
}

// 6. Not connected → 409
{
  for (const conn of [null, { bundle_team_id: null, connection_status: "pending" }, { bundle_team_id: "team_1", connection_status: "pending" }]) {
    const bundle = makeBundleMocks();
    const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ connection: conn }), bundle });
    check(`not connected (${JSON.stringify(conn)}) → 409`, res.statusCode === 409, `got ${res.statusCode}`);
    check("not connected → no bundle call", bundle.calls.uploads.length === 0 && bundle.calls.postCount === 0);
  }
}

// 7. Content not owned → 403
{
  const otherContent = { id: CONTENT_ID, agent_id: "00000000-0000-0000-0000-0000000000ff", caption: CAPTION };
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ content: otherContent }) });
  check("content not owned → 403", res.statusCode === 403, `got ${res.statusCode}`);
}

// 8. Content not found → 404
{
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ content: null }) });
  check("content missing → 404", res.statusCode === 404, `got ${res.statusCode}`);
}

// 9. Missing contentId → 400
{
  const { res } = await callHandler({ body: { imageUrls: VALID_URLS } });
  check("missing contentId → 400", res.statusCode === 400);
}

// 10. Empty / non-array imageUrls → 400
{
  const r1 = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: [] } });
  check("empty imageUrls → 400", r1.res.statusCode === 400);
  const r2 = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: "nope" } });
  check("non-array imageUrls → 400", r2.res.statusCode === 400);
}

// 11. Non-Supabase / untrusted URL → 400 (no bundle call)
{
  for (const bad of [
    "https://evil.example.com/storage/v1/object/public/b/a.jpg", // wrong host
    `http://${SB_HOST}/storage/v1/object/public/b/a.jpg`,        // not https
    `https://${SB_HOST}/private/secret.jpg`,                      // not the public storage path
    "not-a-url",
  ]) {
    const bundle = makeBundleMocks();
    const { res } = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: [URL_A, bad] }, bundle });
    check(`untrusted url rejected (${bad.slice(0, 38)}…) → 400`, res.statusCode === 400, `got ${res.statusCode}`);
    check("untrusted url → no bundle call", bundle.calls.uploads.length === 0 && bundle.calls.postCount === 0);
  }
}

// 12. Over the 20-image backstop → 400
{
  const many = Array.from({ length: 21 }, (_, i) => `https://${SB_HOST}/storage/v1/object/public/b/${i}.jpg`);
  const bundle = makeBundleMocks();
  const { res } = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: many }, bundle });
  check("over-20 images → 400", res.statusCode === 400, `got ${res.statusCode}`);
  check("over-20 → no bundle call", bundle.calls.uploads.length === 0);
}

// 13. Exactly 20 images → allowed (passes validation through to bundle)
{
  const twenty = Array.from({ length: 20 }, (_, i) => `https://${SB_HOST}/storage/v1/object/public/b/${i}.jpg`);
  const { res, bundle } = await callHandler({ body: { contentId: CONTENT_ID, imageUrls: twenty } });
  check("exactly 20 images → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("20 uploads attempted", bundle.calls.uploads.length === 20);
}

// 14. Bundle upload failure → 502, no post created, tracking → failed
{
  const bundle = makeBundleMocks({ uploadThrow: new Error("bundle upload 500") });
  const { res, supabase } = await callHandler({ bundle });
  check("upload failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("upload failure → no post created", bundle.calls.postCount === 0);
  const t = supabase._track;
  check("upload failure → pending row was inserted", t.inserts.length === 1 && t.inserts[0].status === "pending");
  check("upload failure → updated to failed", t.updates.some((u) => u.status === "failed"));
  check("upload failure → failed has error_message", t.updates.some((u) => u.status === "failed" && typeof u.error_message === "string" && u.error_message.length > 0));
  check("upload failure → never marked submitted", !t.updates.some((u) => u.status === "submitted"));
}

// 15. Bundle create-post failure → 502, tracking → failed
{
  const bundle = makeBundleMocks({ postThrow: new Error("bundle post 500") });
  const { res, supabase } = await callHandler({ bundle });
  check("post failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
  const t = supabase._track;
  check("post failure → uploads happened before failure", t.inserts.length === 1);
  check("post failure → updated to failed", t.updates.some((u) => u.status === "failed"));
  check("post failure → never marked submitted", !t.updates.some((u) => u.status === "submitted"));
}

// 16. Method guard — non-POST → 405
{
  const req = { method: "GET", headers: { authorization: `Bearer ${VALID_TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("GET → 405", res.statusCode === 405);
}

// 17. No agent profile → 401
{
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ agent: null }) });
  check("no agent profile → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
