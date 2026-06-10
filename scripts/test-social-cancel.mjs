#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-cancel.js — cancel a still-upcoming scheduled
// post. Mocks Supabase + bundle.deletePost via depsOverride. No network.
// Covers: future-submitted → bundle delete + canceled_at set; past → reject, no
// bundle call; already canceled → reject; missing bundle_post_id / wrong status
// → reject; bundle delete throws → canceled_at NOT set; other agent's row → 404.
//
//   node scripts/test-social-cancel.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "..", "api", "social-cancel.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const handler = (await import(pathToFileURL(HANDLER_PATH).href)).default;

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

const AGENT_ID = "00000000-0000-0000-0000-000000000a01";
const OTHER_ID = "00000000-0000-0000-0000-0000000000ff";
const ROW_ID   = "00000000-0000-0000-0000-000000000501";
const TOKEN    = "fake-bearer-token";
const FIXED_NOW = new Date("2026-06-10T20:00:00.000Z");
const FUTURE = "2026-06-10T23:00:00+00:00"; // 3h ahead
const PAST   = "2026-06-10T19:00:00+00:00"; // 1h ago

// A submitted, future-scheduled, not-canceled row with a bundle post id.
function baseRow(overrides = {}) {
  return {
    id: ROW_ID, agent_id: AGENT_ID, content_id: "c1", platform: "instagram",
    status: "submitted", scheduled_for: FUTURE, canceled_at: null,
    bundle_post_id: "bp_123", error_message: null, created_at: "2026-06-10T17:00:00Z",
    ...overrides,
  };
}

function makeSupabaseMock({ user = { id: AGENT_ID }, agent = { role: "agent", subscription_status: "active" }, post = baseRow(), updateErr = null } = {}) {
  const track = { updates: [] };
  return {
    _track: track,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: null }) }) }) };
      }
      if (table === "social_posts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: post, error: null }) }) }),
          update: (row) => {
            track.updates.push(row);
            return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updateErr ? null : { ...post, ...row }, error: updateErr }) }) }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeDeleteMock({ throwErr = null } = {}) {
  const calls = [];
  return {
    calls,
    deletePost: async ({ postId }) => { calls.push(postId); if (throwErr) throw throwErr; return true; },
  };
}

async function callHandler({ body = { id: ROW_ID }, supabase, del } = {}) {
  const supa = supabase || makeSupabaseMock();
  const d = del || makeDeleteMock();
  const req = { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body };
  const res = makeRes();
  await handler(req, res, { supabase: supa, deletePost: d.deletePost, now: () => FIXED_NOW });
  return { res, supabase: supa, del: d };
}

console.log("\n── api/social-cancel.js — cancel a scheduled post ──\n");

// (a) Happy path: future + submitted + bundle id + not canceled
{
  const { res, supabase, del } = await callHandler();
  check("(a) future submitted → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("(a) bundle deletePost called with bundle_post_id", del.calls.length === 1 && del.calls[0] === "bp_123");
  check("(a) canceled_at set on the row", supabase._track.updates.length === 1 && typeof supabase._track.updates[0].canceled_at === "string");
  check("(a) returns the updated post", !!res.body?.post && res.body.post.canceled_at);
}

// (b) Past scheduled_for → rejected, NO bundle call, no update
{
  const { res, supabase, del } = await callHandler({ supabase: makeSupabaseMock({ post: baseRow({ scheduled_for: PAST }) }) });
  check("(b) past schedule → 409", res.statusCode === 409, `got ${res.statusCode}`);
  check("(b) message says already gone out", /already gone out/i.test(res.body?.error || ""));
  check("(b) no bundle call", del.calls.length === 0);
  check("(b) canceled_at untouched (no update)", supabase._track.updates.length === 0);
}

// (c) Already canceled → rejected, no bundle call
{
  const { res, supabase, del } = await callHandler({ supabase: makeSupabaseMock({ post: baseRow({ canceled_at: "2026-06-10T18:00:00Z" }) }) });
  check("(c) already canceled → 409", res.statusCode === 409, `got ${res.statusCode}`);
  check("(c) no bundle call", del.calls.length === 0);
  check("(c) no update", supabase._track.updates.length === 0);
}

// (d) Missing bundle_post_id → rejected cleanly, no bundle call
{
  const { res, del } = await callHandler({ supabase: makeSupabaseMock({ post: baseRow({ bundle_post_id: null }) }) });
  check("(d) missing bundle_post_id → 409", res.statusCode === 409, `got ${res.statusCode}`);
  check("(d) no bundle call", del.calls.length === 0);
}

// (d2) Wrong status (pending) → rejected cleanly, no bundle call
{
  const { res, del } = await callHandler({ supabase: makeSupabaseMock({ post: baseRow({ status: "pending" }) }) });
  check("(d2) status pending → 409", res.statusCode === 409, `got ${res.statusCode}`);
  check("(d2) no bundle call", del.calls.length === 0);
}

// (e) Bundle deletePost throws → canceled_at NOT set, string error
{
  const del = makeDeleteMock({ throwErr: new Error("bundle 500") });
  const { res, supabase } = await callHandler({ del });
  check("(e) bundle delete throws → 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("(e) error is a string", typeof res.body?.error === "string" && res.body.error.length > 0);
  check("(e) canceled_at NOT set (no update)", supabase._track.updates.length === 0);
}

// (f) Row belongs to another agent → 404, no bundle call
{
  const { res, del } = await callHandler({ supabase: makeSupabaseMock({ post: baseRow({ agent_id: OTHER_ID }) }) });
  check("(f) other agent's row → 404", res.statusCode === 404, `got ${res.statusCode}`);
  check("(f) no bundle call", del.calls.length === 0);
}

// Missing id → 400
{
  const { res } = await callHandler({ body: {} });
  check("missing id → 400", res.statusCode === 400);
}

// Method guard
{
  const req = { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock(), deletePost: async () => true, now: () => FIXED_NOW });
  check("GET → 405", res.statusCode === 405);
}

assert.ok(typeof handler === "function");
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
