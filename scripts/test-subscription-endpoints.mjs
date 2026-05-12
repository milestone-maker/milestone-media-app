#!/usr/bin/env node

// Fail loudly: any unhandled error in this test script must
// translate to a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });
// Unit tests for the checkout-session and portal-session endpoints.
// No real Stripe calls, no real database writes — all clients are mocks
// passed via the handler's third-arg dependency-injection slot.
//
// Run from the milestone-media-app repo root:
//   node scripts/test-subscription-endpoints.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PRICING_PATH = resolve(REPO_ROOT, "public", "pricing.json");

// The endpoint modules construct Stripe and Supabase at module load time
// unless `depsOverride` is passed. We pass overrides in every call so the
// real constructors never run with real keys, but the import still needs
// placeholder env vars to avoid the Stripe class-level throw.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const checkoutMod = await import(pathToFileURL(resolve(REPO_ROOT, "api", "create-checkout-session.js")).href);
const portalMod   = await import(pathToFileURL(resolve(REPO_ROOT, "api", "create-portal-session.js")).href);
const checkoutHandler = checkoutMod.default;
const portalHandler   = portalMod.default;

const pricing = JSON.parse(await readFile(PRICING_PATH, "utf8"));

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
  };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; if (headers) Object.assign(res.headers, headers); };
  res.end = () => { res.ended = true; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── Mock factories ───────────────────────────────────────────────────
function makeSupabaseMock({ user, agent } = {}) {
  const calls = { authGetUser: [], agentsSelectEq: [], agentsUpdate: [] };
  return {
    calls,
    auth: {
      getUser: async (token) => {
        calls.authGetUser.push(token);
        if (!token || token === "INVALID") return { data: { user: null }, error: new Error("bad token") };
        return { data: { user }, error: null };
      },
    },
    from(table) {
      const chain = { table, _filters: [] };
      chain.select = (cols) => { chain._cols = cols; return chain; };
      chain.eq = (col, val) => { chain._filters.push([col, val]); return chain; };
      chain.single = async () => {
        if (table === "agents") {
          calls.agentsSelectEq.push(chain._filters);
          return agent ? { data: agent, error: null } : { data: null, error: new Error("not found") };
        }
        return { data: null, error: null };
      };
      chain.update = (patch) => {
        calls.agentsUpdate.push({ table, patch });
        const upChain = { _filters: [] };
        upChain.eq = (col, val) => { upChain._filters.push([col, val]); return upChain; };
        upChain.then = (resolve) => resolve({ error: null });
        return upChain;
      };
      return chain;
    },
  };
}

function makeStripeMock({ existingCustomers = [], checkoutSessionId = "cs_test_123", portalUrl = "https://billing.stripe.example/portal/xyz" } = {}) {
  const calls = {
    customersList: [],
    customersCreate: [],
    checkoutSessionsCreate: [],
    portalSessionsCreate: [],
  };
  return {
    calls,
    customers: {
      list: async (q) => { calls.customersList.push(q); return { data: existingCustomers }; },
      create: async (data) => { calls.customersCreate.push(data); return { id: "cus_new_" + Math.random().toString(36).slice(2, 9), ...data }; },
    },
    checkout: {
      sessions: {
        create: async (data) => {
          calls.checkoutSessionsCreate.push(data);
          return { id: checkoutSessionId, url: `https://checkout.stripe.example/c/${checkoutSessionId}` };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (data) => {
          calls.portalSessionsCreate.push(data);
          return { id: "bps_test_123", url: portalUrl };
        },
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

// ▸ Checkout: valid happy path with pre-existing customer ID on agent
{
  console.log("\nCheckout endpoint:");
  const stripe = makeStripeMock();
  const supabase = makeSupabaseMock({
    user: { id: "agent-1" },
    agent: { id: "agent-1", email: "alice@example.com", full_name: "Alice", stripe_customer_id: "cus_existing_alice" },
  });
  const req = {
    method: "POST",
    headers: { authorization: "Bearer good-token" },
    body: { tier: "pro", period: "annual" },
  };
  const res = makeRes();
  await checkoutHandler(req, res, { stripe, supabase, pricing });

  check("returns 200 for valid request", res.statusCode === 200, `got ${res.statusCode}`);
  check("response body has session URL", typeof res.body?.url === "string" && res.body.url.includes("checkout.stripe.example"));

  const createArgs = stripe.calls.checkoutSessionsCreate[0];
  check("checkout.sessions.create was called exactly once", stripe.calls.checkoutSessionsCreate.length === 1);
  check("session uses agent's existing stripe_customer_id", createArgs?.customer === "cus_existing_alice");
  check("session mode is subscription", createArgs?.mode === "subscription");
  const expectedPriceId = pricing.stripeIds.subscriptionPrices.annual.pro;
  check("session uses correct price ID from pricing config (pro/annual)",
    createArgs?.line_items?.[0]?.price === expectedPriceId,
    `expected ${expectedPriceId}, got ${createArgs?.line_items?.[0]?.price}`);
  check("session quantity is 1", createArgs?.line_items?.[0]?.quantity === 1);
  check("session enables promotion codes", createArgs?.allow_promotion_codes === true);
  check("success_url contains success=success param",
    /[?&]subscription=success(&|$)/.test(createArgs?.success_url || ""));
  check("cancel_url contains cancelled param",
    /[?&]subscription=cancelled(&|$)/.test(createArgs?.cancel_url || ""));
  check("session metadata includes agent ID",
    createArgs?.metadata?.milestone_agent_id === "agent-1");
  check("did NOT call customers.list (already had ID)", stripe.calls.customersList.length === 0);
  check("did NOT call customers.create (already had ID)", stripe.calls.customersCreate.length === 0);
}

// ▸ Checkout: agent has no customer, existing Stripe customer matches email → reuse
{
  console.log("\nCheckout — first-time subscriber, existing Stripe customer:");
  const stripe = makeStripeMock({
    existingCustomers: [{ id: "cus_found_by_email", email: "bob@example.com" }],
  });
  const supabase = makeSupabaseMock({
    user: { id: "agent-2" },
    agent: { id: "agent-2", email: "bob@example.com", full_name: "Bob", stripe_customer_id: null },
  });
  const req = {
    method: "POST",
    headers: { authorization: "Bearer good-token" },
    body: { tier: "starter", period: "monthly" },
  };
  const res = makeRes();
  await checkoutHandler(req, res, { stripe, supabase, pricing });

  check("returns 200", res.statusCode === 200);
  check("customers.list was called once", stripe.calls.customersList.length === 1);
  check("customers.list searched by email", stripe.calls.customersList[0]?.email === "bob@example.com");
  check("did NOT create a new customer (reused existing)", stripe.calls.customersCreate.length === 0);
  check("session uses reused customer ID",
    stripe.calls.checkoutSessionsCreate[0]?.customer === "cus_found_by_email");
  check("persisted customer ID back to agent record",
    supabase.calls.agentsUpdate.some(u => u.patch?.stripe_customer_id === "cus_found_by_email"));
}

// ▸ Checkout: invalid tier → 400
{
  console.log("\nCheckout — invalid tier:");
  const stripe = makeStripeMock();
  const supabase = makeSupabaseMock({
    user: { id: "agent-x" },
    agent: { id: "agent-x", email: "x@example.com", stripe_customer_id: "cus_x" },
  });
  const req = {
    method: "POST",
    headers: { authorization: "Bearer good-token" },
    body: { tier: "platinum", period: "monthly" },
  };
  const res = makeRes();
  await checkoutHandler(req, res, { stripe, supabase, pricing });
  check("returns 400 for invalid tier", res.statusCode === 400);
  check("error message mentions invalid tier", /invalid tier/i.test(res.body?.error || ""));
  check("did NOT create a checkout session", stripe.calls.checkoutSessionsCreate.length === 0);
}

// ▸ Checkout: no auth token → 401
{
  console.log("\nCheckout — no auth token:");
  const stripe = makeStripeMock();
  const supabase = makeSupabaseMock();
  const req = { method: "POST", headers: {}, body: { tier: "pro", period: "monthly" } };
  const res = makeRes();
  await checkoutHandler(req, res, { stripe, supabase, pricing });
  check("returns 401 when Authorization header missing", res.statusCode === 401);
  check("did NOT touch Stripe", stripe.calls.checkoutSessionsCreate.length === 0);
}

// ▸ Portal: agent has no stripe_customer_id → 400
{
  console.log("\nPortal — agent has no stripe_customer_id:");
  const stripe = makeStripeMock();
  const supabase = makeSupabaseMock({
    user: { id: "agent-3" },
    agent: { id: "agent-3", stripe_customer_id: null },
  });
  const req = { method: "POST", headers: { authorization: "Bearer good-token" }, body: {} };
  const res = makeRes();
  await portalHandler(req, res, { stripe, supabase });
  check("returns 400 when no customer ID on agent", res.statusCode === 400);
  check("error message points to needing to subscribe first",
    /subscribe.*before|no subscription/i.test(res.body?.error || ""));
  check("did NOT create a portal session", stripe.calls.portalSessionsCreate.length === 0);
}

// ▸ Portal: agent has customer ID → success
{
  console.log("\nPortal — agent has stripe_customer_id:");
  const stripe = makeStripeMock({ portalUrl: "https://billing.stripe.example/portal/xyz" });
  const supabase = makeSupabaseMock({
    user: { id: "agent-4" },
    agent: { id: "agent-4", stripe_customer_id: "cus_agent4" },
  });
  const req = { method: "POST", headers: { authorization: "Bearer good-token" }, body: {} };
  const res = makeRes();
  await portalHandler(req, res, { stripe, supabase });
  check("returns 200", res.statusCode === 200);
  check("billingPortal.sessions.create called exactly once", stripe.calls.portalSessionsCreate.length === 1);
  check("portal session uses agent's customer ID",
    stripe.calls.portalSessionsCreate[0]?.customer === "cus_agent4");
  check("response includes portal URL", typeof res.body?.url === "string" && res.body.url.includes("billing.stripe.example"));
}

// ▸ Portal: no auth token → 401
{
  console.log("\nPortal — no auth token:");
  const stripe = makeStripeMock();
  const supabase = makeSupabaseMock();
  const req = { method: "POST", headers: {}, body: {} };
  const res = makeRes();
  await portalHandler(req, res, { stripe, supabase });
  check("returns 401 when Authorization header missing", res.statusCode === 401);
  check("did NOT touch Stripe", stripe.calls.portalSessionsCreate.length === 0);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} passed, ${failed} failed (out of ${passed + failed})`);
if (failed > 0) process.exit(1);
console.log("✓ Subscription endpoint unit tests pass");
