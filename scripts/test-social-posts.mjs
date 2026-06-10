#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-posts.js — list the agent's social posts.
// Mocks Supabase via depsOverride. No network. Verifies: returns the agent's
// rows scoped by agent_id; the optional contentId filter narrows; the right
// ordering is requested; the response shape.
//
//   node scripts/test-social-posts.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "..", "api", "social-posts.js");

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
const TOKEN    = "fake-bearer-token";

const ROWS = [
  { id: "p1", agent_id: AGENT_ID, content_id: "cA", platform: "instagram", status: "submitted", scheduled_for: "2026-06-12T17:00:00Z", canceled_at: null, bundle_post_id: "b1", error_message: null, created_at: "2026-06-10T17:00:00Z" },
  { id: "p2", agent_id: AGENT_ID, content_id: "cA", platform: "instagram", status: "failed",    scheduled_for: null,                   canceled_at: null, bundle_post_id: null, error_message: "x", created_at: "2026-06-09T17:00:00Z" },
  { id: "p3", agent_id: AGENT_ID, content_id: "cB", platform: "instagram", status: "submitted", scheduled_for: "2026-06-11T17:00:00Z", canceled_at: "2026-06-10T18:00:00Z", bundle_post_id: "b3", error_message: null, created_at: "2026-06-08T17:00:00Z" },
];

// Chainable query-builder mock. Records eq filters + order calls and resolves
// (thenable) to the agent-scoped, contentId-filtered rows.
function makeSupabaseMock({ user = { id: AGENT_ID }, agent = { role: "agent", subscription_status: "active" }, rows = ROWS } = {}) {
  const captured = { filters: {}, orders: [] };
  function builder() {
    const b = {
      select: () => b,
      eq: (col, val) => { captured.filters[col] = val; return b; },
      order: (col, opts) => { captured.orders.push([col, opts]); return b; },
      then: (resolveFn) => {
        const out = rows.filter((r) =>
          (captured.filters.agent_id === undefined || r.agent_id === captured.filters.agent_id) &&
          (captured.filters.content_id === undefined || r.content_id === captured.filters.content_id));
        resolveFn({ data: out, error: null });
      },
    };
    return b;
  }
  return {
    _captured: captured,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: null }) }) }) };
      }
      if (table === "social_posts") return builder();
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

async function callHandler({ url = "/api/social-posts", query = undefined, supabase } = {}) {
  const supa = supabase || makeSupabaseMock();
  const req = { method: "GET", url, query, headers: { authorization: `Bearer ${TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: supa });
  return { res, supabase: supa };
}

console.log("\n── api/social-posts.js — list the agent's posts ──\n");

// 1. No filter → all of the agent's rows
{
  const { res, supabase } = await callHandler();
  check("no filter → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("returns all 3 agent rows", Array.isArray(res.body?.posts) && res.body.posts.length === 3);
  check("scoped by agent_id", supabase._captured.filters.agent_id === AGENT_ID);
  check("no content_id filter when absent", supabase._captured.filters.content_id === undefined);
}

// 2. contentId filter (via req.query) narrows to that carousel
{
  const { res, supabase } = await callHandler({ query: { contentId: "cA" } });
  check("contentId=cA → 200", res.statusCode === 200);
  check("narrowed to cA rows (2)", res.body.posts.length === 2 && res.body.posts.every((p) => p.content_id === "cA"));
  check("content_id filter applied", supabase._captured.filters.content_id === "cA");
}

// 2b. contentId via URL query string (no req.query) also works
{
  const { res } = await callHandler({ url: "/api/social-posts?contentId=cB", query: undefined });
  check("contentId via URL → narrowed to cB (1)", res.statusCode === 200 && res.body.posts.length === 1 && res.body.posts[0].content_id === "cB");
}

// 3. Ordering requested: scheduled_for desc nulls-last, then created_at desc
{
  const { supabase } = await callHandler();
  const o = supabase._captured.orders;
  check("first order = scheduled_for desc, nulls last",
    o[0]?.[0] === "scheduled_for" && o[0]?.[1]?.ascending === false && o[0]?.[1]?.nullsFirst === false, JSON.stringify(o[0]));
  check("second order = created_at desc", o[1]?.[0] === "created_at" && o[1]?.[1]?.ascending === false, JSON.stringify(o[1]));
}

// 4. Response shape: each row carries exactly the specified fields
{
  const { res } = await callHandler();
  const FIELDS = ["id", "content_id", "platform", "status", "scheduled_for", "canceled_at", "bundle_post_id", "error_message", "created_at"];
  const row = res.body.posts[0];
  check("row has all specified fields", FIELDS.every((f) => f in row));
}

// 5. Method guard + auth
{
  const req = { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("POST → 405", res.statusCode === 405);

  const r2 = await callHandler({ supabase: { auth: { getUser: async () => ({ data: null, error: { message: "bad" } }) }, from: () => { throw new Error("should not reach"); } } });
  check("invalid token → 401", r2.res.statusCode === 401);
}

assert.ok(typeof handler === "function");
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
