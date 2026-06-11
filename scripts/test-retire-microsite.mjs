#!/usr/bin/env node

// Fail loudly: any unhandled error must produce a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit tests for api/retire-microsite.js — the "mark sold / take down" action.
//
// The handler takes its supabase client via the depsOverride 3rd arg, so we
// inject a small filter-aware mock directly — no module-cache stubbing, no
// real DB. The mock holds ONE microsites row and honors .eq() filters, so a
// non-owner (agent_id mismatch) naturally reads back null → 404.
//
// Cases:
//   (a) owner retires a LIVE microsite → 200, published=false + retired_at set, row returned
//   (b) non-owner → 404 (owner-scoped query yields null; existence not leaked)
//   (c) already-retired OR not-published → 409, NO write
//   (d) missing id → 400
//   (+) missing auth header → 401; non-POST → 405
//
//   node scripts/test-retire-microsite.mjs

import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "..", "api", "retire-microsite.js");
const { default: handler } = await import(HANDLER_PATH);

// ── Mocks ──────────────────────────────────────────────────────────────

// A filter-aware microsites-table mock around a single stored row. Records
// any update patch so tests can assert exactly what was written.
function makeSupabase({ authUser, row }) {
  const calls = { updatePatch: null, updateCalled: false };

  // Build a chainable query object that accumulates eq() filters and, at the
  // terminal (maybeSingle/single), applies them against `row`.
  function selectChain() {
    const filters = {};
    const chain = {
      eq(col, val) { filters[col] = val; return chain; },
      async maybeSingle() {
        if (!row) return { data: null, error: null };
        const match = Object.entries(filters).every(([k, v]) => row[k] === v);
        return { data: match ? row : null, error: null };
      },
    };
    return chain;
  }

  function updateChain(patch) {
    calls.updateCalled = true;
    calls.updatePatch = patch;
    const filters = {};
    const chain = {
      eq(col, val) { filters[col] = val; return chain; },
      select() { return chain; },
      async single() {
        const match = row && Object.entries(filters).every(([k, v]) => row[k] === v);
        if (!match) return { data: null, error: { message: "no row" } };
        return { data: { ...row, ...patch }, error: null };
      },
    };
    return chain;
  }

  return {
    _calls: calls,
    auth: {
      async getUser(_token) {
        return authUser
          ? { data: { user: authUser }, error: null }
          : { data: { user: null }, error: { message: "bad token" } };
      },
    },
    from(table) {
      assert.strictEqual(table, "microsites", `unexpected table ${table}`);
      return {
        select() { return selectChain(); },
        update(patch) { return updateChain(patch); },
      };
    },
  };
}

function makeReq({ method = "POST", body = {}, auth = "Bearer tok" } = {}) {
  return { method, body, headers: auth ? { authorization: auth } : {} };
}

function makeRes() {
  const res = {
    statusCode: null,
    jsonBody: undefined,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code) { this.statusCode = code; return this; },
    end() { return this; },
    status(code) { this.statusCode = code; return this; },
    // Vercel/Express: res.json() with no prior res.status() defaults to 200.
    json(body) { if (this.statusCode === null) this.statusCode = 200; this.jsonBody = body; return this; },
  };
  return res;
}

const liveRow = () => ({
  id: "ms-1", agent_id: "agent-1", slug: "5912-velasco", published: true, retired_at: null,
});

// ── Runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (err) { console.error(`✗ ${name}\n   ${err.message}`); failed++; }
}

// (a) owner retires a LIVE microsite
await run("owner retires a live microsite → 200, published=false + retired_at set, row returned", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.ok(res.jsonBody?.microsite, "response should include the updated microsite row");
  assert.strictEqual(res.jsonBody.microsite.published, false, "published should be false");
  assert.ok(res.jsonBody.microsite.retired_at, "retired_at should be set on returned row");
  // The write itself:
  assert.strictEqual(supabase._calls.updateCalled, true, "an update should have happened");
  assert.strictEqual(supabase._calls.updatePatch.published, false, "patch.published should be false");
  assert.ok(supabase._calls.updatePatch.retired_at, "patch.retired_at should be a timestamp");
  assert.doesNotThrow(() => new Date(supabase._calls.updatePatch.retired_at).toISOString(),
    "retired_at should be a valid date");
});

// (b) non-owner → 404, no write
await run("non-owner → 404 (not found), no write", async () => {
  // Row is owned by agent-1; caller is agent-2. Owner-scoped query → null.
  const supabase = makeSupabase({ authUser: { id: "agent-2" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 404, `expected 404, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update should happen for a non-owner");
});

// (c1) already-retired → 409, no write
await run("already-retired microsite → 409, no write", async () => {
  const row = { ...liveRow(), published: false, retired_at: "2026-01-01T00:00:00.000Z" };
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 409, `expected 409, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for an already-retired site");
});

// (c2) not-published (but never retired) → 409, no write
await run("not-published microsite → 409, no write", async () => {
  const row = { ...liveRow(), published: false, retired_at: null };
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 409, `expected 409, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for an unpublished site");
});

// (d) missing id → 400
await run("missing micrositeId/slug → 400", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: {} }), res, { supabase });

  assert.strictEqual(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update when id missing");
});

// (+) retire by slug also works (owner, live)
await run("owner retires by slug → 200", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { slug: "5912-velasco" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.strictEqual(res.jsonBody.microsite.published, false);
});

// (+) missing auth header → 401
await run("missing Authorization header → 401", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" }, auth: null }), res, { supabase });

  assert.strictEqual(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false);
});

// (+) non-POST → 405
await run("non-POST method → 405", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res, { supabase });

  assert.strictEqual(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
