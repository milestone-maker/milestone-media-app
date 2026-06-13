#!/usr/bin/env node

// Fail loudly: any unhandled error must produce a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit tests for api/mark-sold.js — the "mark as sold" action.
//
// Mirrors scripts/test-retire-microsite.mjs: the handler takes its supabase
// client via the depsOverride 3rd arg, so we inject a small filter-aware mock
// directly — no module-cache stubbing, no real DB. The mock holds ONE
// microsites row and honors .eq() filters, so a non-owner reads back null → 404.
//
// Cases:
//   (a) owner marks a LIVE microsite sold → 200; sold_at set, published STAYS true,
//       sold_price null when not provided, retired_at untouched
//   (b) sold_price provided → stored verbatim (free-form text)
//   (c) non-owner → 404, no write
//   (d) not live: already-sold / retired / unpublished → 409, no write
//   (e) missing id → 400; missing auth → 401; non-POST → 405; by-slug works
//
//   node scripts/test-mark-sold.mjs

import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "..", "api", "mark-sold.js");
const { default: handler } = await import(HANDLER_PATH);

// ── Mocks (same shape as test-retire-microsite.mjs) ─────────────────────
function makeSupabase({ authUser, row }) {
  const calls = { updatePatch: null, updateCalled: false };

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
    json(body) { if (this.statusCode === null) this.statusCode = 200; this.jsonBody = body; return this; },
  };
  return res;
}

const liveRow = () => ({
  id: "ms-1", agent_id: "agent-1", slug: "5912-velasco",
  published: true, retired_at: null, sold_at: null, sold_price: null,
});

// ── Runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (err) { console.error(`✗ ${name}\n   ${err.message}`); failed++; }
}

// (a) owner marks a LIVE microsite sold → sold_at set, published stays true.
await run("owner marks live microsite sold → 200; sold_at set, published stays true, sold_price null", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.ok(res.jsonBody?.microsite, "response should include the updated row");
  assert.strictEqual(supabase._calls.updateCalled, true, "an update should have happened");
  const patch = supabase._calls.updatePatch;
  assert.ok(patch.sold_at, "patch.sold_at should be set");
  assert.doesNotThrow(() => new Date(patch.sold_at).toISOString(), "sold_at should be a valid date");
  assert.strictEqual(patch.sold_price, null, "sold_price should be null when not provided");
  assert.strictEqual("published" in patch, false, "must NOT touch published (stays true)");
  assert.strictEqual("retired_at" in patch, false, "must NOT touch retired_at");
  assert.strictEqual(res.jsonBody.microsite.published, true, "returned row stays published");
});

// (b) sold_price provided → stored verbatim.
await run("sold_price provided → stored verbatim (free-form text)", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1", sold_price: "1,425,000" } }), res, { supabase });

  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updatePatch.sold_price, "1,425,000", "sold_price stored verbatim");
});

// (b2) blank/whitespace sold_price → normalized to null.
await run("blank sold_price → null", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1", sold_price: "   " } }), res, { supabase });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(supabase._calls.updatePatch.sold_price, null, "blank price → null");
});

// (c) non-owner → 404, no write.
await run("non-owner → 404, no write", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-2" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });
  assert.strictEqual(res.statusCode, 404, `expected 404, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for a non-owner");
});

// (d1) already-sold → 409, no write.
await run("already-sold → 409, no write", async () => {
  const row = { ...liveRow(), sold_at: "2026-06-01T00:00:00.000Z" };
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });
  assert.strictEqual(res.statusCode, 409, `expected 409, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for an already-sold site");
});

// (d2) retired → 409, no write.
await run("retired → 409, no write", async () => {
  const row = { ...liveRow(), published: false, retired_at: "2026-01-01T00:00:00.000Z" };
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });
  assert.strictEqual(res.statusCode, 409, `expected 409, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for a retired site");
});

// (d3) unpublished draft → 409, no write.
await run("unpublished draft → 409, no write", async () => {
  const row = { ...liveRow(), published: false, retired_at: null };
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" } }), res, { supabase });
  assert.strictEqual(res.statusCode, 409, `expected 409, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false, "no update for a draft");
});

// (e1) missing id → 400.
await run("missing micrositeId/slug → 400", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: {} }), res, { supabase });
  assert.strictEqual(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false);
});

// (e2) by slug works.
await run("owner marks sold by slug → 200", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { slug: "5912-velasco" } }), res, { supabase });
  assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.ok(supabase._calls.updatePatch.sold_at, "sold_at set via slug path");
});

// (e3) missing auth → 401.
await run("missing Authorization header → 401", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ body: { micrositeId: "ms-1" }, auth: null }), res, { supabase });
  assert.strictEqual(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
  assert.strictEqual(supabase._calls.updateCalled, false);
});

// (e4) non-POST → 405.
await run("non-POST method → 405", async () => {
  const supabase = makeSupabase({ authUser: { id: "agent-1" }, row: liveRow() });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res, { supabase });
  assert.strictEqual(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
