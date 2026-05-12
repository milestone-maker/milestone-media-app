#!/usr/bin/env node
// Unit tests for api/create-booking.js — exercises the credit-eligibility
// decision tree, the conditional-decrement race fallback, and the side-effect
// orchestration. No real Stripe, no real DB, no real network calls.
//
//   node scripts/test-create-booking.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PRICING_PATH = resolve(REPO_ROOT, "public", "pricing.json");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const mod = await import(pathToFileURL(resolve(REPO_ROOT, "api", "create-booking.js")).href);
const handler = mod.default;
const pricing = JSON.parse(await readFile(PRICING_PATH, "utf8"));

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

// ── Mocks ────────────────────────────────────────────────────────────
//
// makeSupabaseMock builds a Supabase-shaped object that supports the
// specific chains create-booking.js uses:
//
//   supabase.auth.getUser(token)
//   supabase.from("agents").select(...).eq(...).single()
//   supabase.from("credit_ledger").select(...).eq(...).lte(...).gte(...).order(...).limit(...).maybeSingle()
//   supabase.from("credit_ledger").update({...}).eq(...).eq(...).lt(...).select(...)
//   supabase.from("bookings").insert({...}).select("id").single()
//   supabase.from("bookings").update({...}).eq(...)
//
// Each chain returns thenables that resolve to { data, error }.
function makeSupabaseMock({
  user,
  agent,
  creditRow,
  decrementResult = "ok", // "ok" | "race" | "error"
  bookingInsertError = null,
} = {}) {
  const calls = {
    authGetUser: [],
    creditLedgerUpdates: [],
    bookingsInserts: [],
    bookingsUpdates: [],
  };

  const mock = {
    calls,
    auth: {
      getUser: async (token) => {
        calls.authGetUser.push(token);
        if (!token || token === "INVALID") return { data: { user: null }, error: new Error("bad token") };
        return { data: { user }, error: null };
      },
    },
    from(table) {
      // ── agents.select(...).eq(...).single() ──
      if (table === "agents") {
        const chain = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.single = async () => agent
          ? { data: agent, error: null }
          : { data: null, error: new Error("no agent") };
        return chain;
      }

      // ── credit_ledger ──
      if (table === "credit_ledger") {
        const chain = { _op: null };
        chain.select = () => chain;
        chain.eq = (col, val) => {
          if (col === "credits_consumed") chain._expectedConsumed = val;
          return chain;
        };
        chain.lte = () => chain;
        chain.gte = () => chain;
        chain.lt = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = async () => ({ data: creditRow, error: null });

        chain.update = (patch) => {
          chain._op = "update";
          chain._patch = patch;
          // Re-bind so the subsequent .eq().eq().lt().select() returns rows
          const upChain = { _expectedConsumed: null };
          upChain.eq = (col, val) => {
            if (col === "credits_consumed") upChain._expectedConsumed = val;
            return upChain;
          };
          upChain.lt = () => upChain;
          upChain.select = async () => {
            calls.creditLedgerUpdates.push({ patch, expectedConsumed: upChain._expectedConsumed });
            if (decrementResult === "error") {
              return { data: null, error: new Error("update failed") };
            }
            if (decrementResult === "race") {
              return { data: [], error: null }; // zero rows affected
            }
            // success: return the post-update row
            return {
              data: [{
                id: creditRow.id,
                credits_granted: creditRow.credits_granted,
                credits_consumed: (creditRow.credits_consumed || 0) + 1,
              }],
              error: null,
            };
          };
          return upChain;
        };
        return chain;
      }

      // ── bookings ──
      if (table === "bookings") {
        const chain = { _op: null };
        chain.insert = (row) => {
          calls.bookingsInserts.push(row);
          const c2 = {};
          c2.select = () => c2;
          c2.single = async () => bookingInsertError
            ? { data: null, error: bookingInsertError }
            : { data: { id: "book_" + Math.random().toString(36).slice(2, 9) }, error: null };
          return c2;
        };
        chain.update = (patch) => {
          const c2 = {};
          c2.eq = async () => {
            calls.bookingsUpdates.push(patch);
            return { error: null };
          };
          return c2;
        };
        return chain;
      }

      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
    },
  };
  return mock;
}

// fetch mock — records every call, returns a configurable response per URL pattern
function makeFetchMock({ invoiceId = "inv_test_001", calendarEventId = "cal_evt_001" } = {}) {
  const calls = [];
  return {
    calls,
    fn: async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method: opts?.method, body });
      if (url.includes("/api/calendar")) {
        return { ok: true, json: async () => ({ eventId: calendarEventId }) };
      }
      if (url.includes("/api/send-email")) {
        return { ok: true, json: async () => ({ sent: true }) };
      }
      if (url.includes("/api/create-invoice")) {
        return { ok: true, json: async () => ({ invoiceId, success: true }) };
      }
      return { ok: false, json: async () => ({}) };
    },
  };
}

// ── Common fixtures ─────────────────────────────────────────────────
const USER = { id: "user_001" };
const baseAgent = (overrides = {}) => ({
  id: USER.id,
  email: "agent@example.com",
  full_name: "Test Agent",
  subscription_tier: "starter",
  subscription_status: "active",
  ...overrides,
});
const creditRow = (overrides = {}) => ({
  id: "cl_001",
  credits_granted: 1,
  credits_consumed: 0,
  ...overrides,
});

function basePayload(overrides = {}) {
  return {
    address: "123 Main St",
    city: "Dallas",
    state: "Texas",
    zip: "75201",
    sqft_tier: "1501_2500",
    access_method: "lockbox",
    booking_mode: "package",
    selected_package: "essential",
    selected_services: [],
    selected_addons: [],
    booking_date: "2026-06-01",
    booking_time: "10:00 AM",
    client_name: "Jane Buyer",
    client_email: "jane@example.com",
    client_phone: null,
    subtotal: 999999, // deliberately bogus — server must recompute
    ...overrides,
  };
}

function makeReq(payload, { token = "VALID" } = {}) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, host: "test.local", "x-forwarded-proto": "https" },
    body: payload,
  };
}

async function runCase(name, { agent, cr, payload, token, decrementResult, expect }) {
  console.log(`\n— ${name}`);
  const supabase = makeSupabaseMock({
    user: USER,
    agent,
    creditRow: cr,
    decrementResult,
  });
  const fetchMock = makeFetchMock();
  const req = makeReq(payload, { token });
  const res = makeRes();

  await handler(req, res, { supabase, pricing, fetch: fetchMock.fn });

  expect({ res, supabase, fetchMock });
}

// ── Cases ────────────────────────────────────────────────────────────

await runCase("Starter + Essential + 1 credit → credit consumed, addons-only invoice", {
  agent: baseAgent({ subscription_tier: "starter" }),
  cr: creditRow(),
  payload: basePayload({ selected_package: "essential" }),
  expect: ({ res, supabase, fetchMock }) => {
    check("status 200", res.statusCode === 200);
    check("creditConsumed true", res.body.creditConsumed === true);
    check("subtotal is 0 (essential covered, no addons)", res.body.subtotal === 0);
    check("ledger decrement attempted", supabase.calls.creditLedgerUpdates.length === 1);
    check("booking insert has credit_consumed:true", supabase.calls.bookingsInserts[0].credit_consumed === true);
    check("booking insert has credit_ledger_id", supabase.calls.bookingsInserts[0].credit_ledger_id === "cl_001");
    const urls = fetchMock.calls.map(c => c.url);
    check("calendar called", urls.some(u => u.includes("/api/calendar")));
    check("email called",    urls.some(u => u.includes("/api/send-email")));
    check("invoice NOT called (subtotal is 0)", !urls.some(u => u.includes("/api/create-invoice")));
  },
});

await runCase("Starter + Essential + 1 credit + paid addon → credit consumed, invoice for addon only", {
  agent: baseAgent({ subscription_tier: "starter" }),
  cr: creditRow(),
  payload: basePayload({
    selected_package: "essential",
    selected_addons: [{ id: "microsite", qty: 1 }],
  }),
  expect: ({ res, fetchMock }) => {
    const addonDef = pricing.addons.find(a => a.id === "microsite");
    check("status 200", res.statusCode === 200);
    check("creditConsumed true", res.body.creditConsumed === true);
    check("subtotal equals microsite addon price", res.body.subtotal === (addonDef?.price || 0));
    const invCall = fetchMock.calls.find(c => c.url.includes("/api/create-invoice"));
    check("invoice WAS called", !!invCall);
    check("invoice total matches addon", invCall && invCall.body.booking.total === (addonDef?.price || 0));
    check("invoice packageName null (credit covered)", invCall && invCall.body.booking.packageName === null);
  },
});

await runCase("Starter + Signature (above tier) → no credit, full price", {
  agent: baseAgent({ subscription_tier: "starter" }),
  cr: creditRow(),
  payload: basePayload({ selected_package: "signature" }),
  expect: ({ res, supabase }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    check("subtotal is Signature price (549)", res.body.subtotal === 549);
    check("no ledger decrement", supabase.calls.creditLedgerUpdates.length === 0);
  },
});

await runCase("Pro + Signature + 2 credits → credit consumed", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2, credits_consumed: 0 }),
  payload: basePayload({ selected_package: "signature" }),
  expect: ({ res }) => {
    check("creditConsumed true", res.body.creditConsumed === true);
    check("subtotal is 0", res.body.subtotal === 0);
  },
});

await runCase("Pro + Essential + 2 credits → credit consumed (below tier OK)", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "essential" }),
  expect: ({ res }) => {
    check("creditConsumed true", res.body.creditConsumed === true);
    check("subtotal is 0", res.body.subtotal === 0);
  },
});

await runCase("Pro + Luxury (above tier) → no credit, full price", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "luxury" }),
  expect: ({ res }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    check("subtotal is Luxury price (1095)", res.body.subtotal === 1095);
  },
});

await runCase("Elite + Luxury + 4 credits → credit consumed", {
  agent: baseAgent({ subscription_tier: "elite" }),
  cr: creditRow({ credits_granted: 4 }),
  payload: basePayload({ selected_package: "luxury" }),
  expect: ({ res }) => {
    check("creditConsumed true", res.body.creditConsumed === true);
    check("subtotal is 0", res.body.subtotal === 0);
  },
});

await runCase("Elite + 0 credits remaining → no credit, full price", {
  agent: baseAgent({ subscription_tier: "elite" }),
  cr: creditRow({ credits_granted: 4, credits_consumed: 4 }),
  payload: basePayload({ selected_package: "luxury" }),
  expect: ({ res, supabase }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    check("subtotal is full Luxury price", res.body.subtotal === 1095);
    check("no ledger decrement attempted", supabase.calls.creditLedgerUpdates.length === 0);
  },
});

await runCase("No active subscription (null tier/status) → no credit", {
  agent: baseAgent({ subscription_tier: null, subscription_status: null }),
  cr: null,
  payload: basePayload({ selected_package: "essential" }),
  expect: ({ res }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    const essPrice = pricing.essentialPricing["1501_2500"];
    check(`subtotal is Essential @ 1501_2500 ($${essPrice})`, res.body.subtotal === essPrice);
  },
});

await runCase("subscription_status = canceled → no credit", {
  agent: baseAgent({ subscription_tier: "pro", subscription_status: "canceled" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "signature" }),
  expect: ({ res, supabase }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    check("subtotal is full Signature price (549)", res.body.subtotal === 549);
    check("no ledger decrement", supabase.calls.creditLedgerUpdates.length === 0);
  },
});

await runCase("subscription_status = past_due → credit still usable (grace)", {
  agent: baseAgent({ subscription_tier: "pro", subscription_status: "past_due" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "signature" }),
  expect: ({ res }) => {
    check("creditConsumed true (past_due is in grace)", res.body.creditConsumed === true);
    check("subtotal is 0", res.body.subtotal === 0);
  },
});

await runCase("Individual services booking + credits available → no credit (mode never eligible)", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({
    booking_mode: "individual",
    selected_package: null,
    selected_services: ["photography"],
  }),
  expect: ({ res, supabase }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    const photo = pricing.individualServices.photography.priceByTier["1501_2500"];
    check(`subtotal is photography service price ($${photo})`, res.body.subtotal === photo);
    check("no ledger decrement", supabase.calls.creditLedgerUpdates.length === 0);
  },
});

await runCase("Race lost on decrement → falls back to full price, no error", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "signature" }),
  decrementResult: "race",
  expect: ({ res, supabase }) => {
    check("status 200 (no error)", res.statusCode === 200);
    check("creditConsumed false (fell back)", res.body.creditConsumed === false);
    check("subtotal is full Signature price (549)", res.body.subtotal === 549);
    check("decrement was attempted", supabase.calls.creditLedgerUpdates.length === 1);
    check("booking insert has credit_consumed:false", supabase.calls.bookingsInserts[0].credit_consumed === false);
    check("booking insert has credit_ledger_id null", supabase.calls.bookingsInserts[0].credit_ledger_id === null);
  },
});

await runCase("Eligible booking, zero addons → final 0, invoice NOT called, cal+email DO run", {
  agent: baseAgent({ subscription_tier: "pro" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "signature", selected_addons: [] }),
  expect: ({ res, fetchMock }) => {
    check("subtotal is 0", res.body.subtotal === 0);
    const urls = fetchMock.calls.map(c => c.url);
    check("calendar called", urls.some(u => u.includes("/api/calendar")));
    check("email called", urls.some(u => u.includes("/api/send-email")));
    check("invoice NOT called", !urls.some(u => u.includes("/api/create-invoice")));
  },
});

await runCase("Eligible booking, paid addons → invoice IS called for addon residual", {
  agent: baseAgent({ subscription_tier: "elite" }),
  cr: creditRow({ credits_granted: 4 }),
  payload: basePayload({
    selected_package: "luxury",
    selected_addons: [{ id: "microsite", qty: 1 }],
  }),
  expect: ({ res, fetchMock }) => {
    const addonDef = pricing.addons.find(a => a.id === "microsite");
    check("subtotal equals microsite addon residual", res.body.subtotal === (addonDef?.price || 0));
    const invCall = fetchMock.calls.find(c => c.url.includes("/api/create-invoice"));
    check("invoice WAS called", !!invCall);
    check("invoice total matches addon", invCall && invCall.body.booking.total === (addonDef?.price || 0));
  },
});

// ── Auth / defensive cases ──────────────────────────────────────────

await (async () => {
  console.log("\n— No auth token → 401");
  const supabase = makeSupabaseMock({ user: USER, agent: baseAgent() });
  const fetchMock = makeFetchMock();
  const req = { method: "POST", headers: { host: "test.local" }, body: basePayload() };
  const res = makeRes();
  await handler(req, res, { supabase, pricing, fetch: fetchMock.fn });
  check("status 401", res.statusCode === 401);
  check("no booking insert", supabase.calls.bookingsInserts.length === 0);
})();

await runCase("Invalid tier in agent record → no credit, full price (defensive)", {
  agent: baseAgent({ subscription_tier: "garbage_tier", subscription_status: "active" }),
  cr: creditRow({ credits_granted: 2 }),
  payload: basePayload({ selected_package: "signature" }),
  expect: ({ res, supabase }) => {
    check("creditConsumed false", res.body.creditConsumed === false);
    check("subtotal is full Signature price", res.body.subtotal === 549);
    check("no ledger decrement", supabase.calls.creditLedgerUpdates.length === 0);
  },
});

// ── Summary ─────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
