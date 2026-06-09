#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-connect.js — start the bundle Instagram
// connect flow. Mocks Supabase + bundle (createTeam / createPortal) via
// depsOverride. No network, no real key. Verifies auth, subscription gating,
// idempotent team creation, row upsert, and portalUrl return.
//
//   node scripts/test-social-connect.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-connect.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

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
const VALID_TOKEN = "fake-bearer-token";

// Supabase mock. `connection` is the existing agent_social_connections row
// (null = none). Records upserts in `upserts`.
function makeSupabaseMock({
  user       = { id: AGENT_ID },
  authError  = null,
  agent      = { role: "agent", subscription_status: "active", full_name: "Sarah Martinez" },
  agentErr   = null,
  connection = null,
  connErr    = null,
  upsertErr  = null,
} = {}) {
  const upserts = [];
  const api = {
    upserts,
    auth: {
      getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }),
    },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: agentErr }) }) }) };
      }
      if (table === "agent_social_connections") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: connection, error: connErr }) }) }),
          upsert: async (row, opts) => { upserts.push({ row, opts }); return { error: upsertErr }; },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return api;
}

function makeBundleMocks({ teamId = "team_new", portalUrl = "https://portal.bundle.social/xyz", teamThrow = null, portalThrow = null } = {}) {
  const calls = { createTeam: 0, createPortal: 0, lastPortalArgs: null, lastTeamArgs: null };
  return {
    calls,
    createTeam: async (args) => { calls.createTeam++; calls.lastTeamArgs = args; if (teamThrow) throw teamThrow; return { id: teamId, name: args?.name }; },
    createPortal: async (args) => { calls.createPortal++; calls.lastPortalArgs = args; if (portalThrow) throw portalThrow; return portalUrl; },
  };
}

async function callHandler({ headers, supabaseOverride, bundle } = {}) {
  const b = bundle || makeBundleMocks();
  const req = { method: "POST", headers: headers ?? { authorization: `Bearer ${VALID_TOKEN}`, origin: "https://app.example" }, body: {} };
  const res = makeRes();
  await handler(req, res, {
    supabase:     supabaseOverride || makeSupabaseMock(),
    createTeam:   b.createTeam,
    createPortal: b.createPortal,
  });
  return { res, bundle: b };
}

console.log("\n── api/social-connect.js — start bundle Instagram connect ──\n");

// 1. Happy path — no existing row → creates team, upserts pending, returns portalUrl
{
  const { res, bundle } = await callHandler();
  check("happy path → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("returns portalUrl", res.body?.portalUrl === "https://portal.bundle.social/xyz");
  check("returns status pending", res.body?.status === "pending");
  check("createTeam called once", bundle.calls.createTeam === 1);
  check("createPortal called once", bundle.calls.createPortal === 1);
  check("portal scoped to teamId from createTeam", bundle.calls.lastPortalArgs?.teamId === "team_new");
  check("portal redirectUrl built from origin", bundle.calls.lastPortalArgs?.redirectUrl === "https://app.example/?social=connected");
}

// 2. Idempotency — existing row WITH team id → reuse, no second team
{
  const supa = makeSupabaseMock({ connection: { id: "c1", bundle_team_id: "team_existing", connection_status: "pending" } });
  const { res, bundle } = await callHandler({ supabaseOverride: supa });
  check("existing team → 200", res.statusCode === 200);
  check("does NOT create a second team", bundle.calls.createTeam === 0);
  check("upserts nothing new (reuse path)", supa.upserts.length === 0);
  check("portal uses existing teamId", bundle.calls.lastPortalArgs?.teamId === "team_existing");
}

// 3. Upsert writes pending + team id on first connect
{
  const supa = makeSupabaseMock();
  await callHandler({ supabaseOverride: supa });
  const up = supa.upserts[0];
  check("upsert row has agent_id", up?.row?.agent_id === AGENT_ID);
  check("upsert row status pending", up?.row?.connection_status === "pending");
  check("upsert row carries bundle_team_id", up?.row?.bundle_team_id === "team_new");
  check("upsert onConflict agent_id", up?.opts?.onConflict === "agent_id");
}

// 4. Missing Authorization → 401
{
  const { res } = await callHandler({ headers: {} });
  check("missing auth → 401", res.statusCode === 401);
}

// 5. Invalid/expired token → 401
{
  const supa = makeSupabaseMock({ authError: { message: "bad jwt" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("invalid token → 401", res.statusCode === 401);
}

// 6. Unsubscribed non-admin → 402 (before any bundle call)
{
  for (const status of [null, "canceled", "incomplete", "unpaid", "paused"]) {
    const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: status, full_name: "X" } });
    const { res, bundle } = await callHandler({ supabaseOverride: supa });
    check(`unsubscribed (status=${status}) → 402`, res.statusCode === 402, `got ${res.statusCode}`);
    check(`unsubscribed → no bundle call`, bundle.calls.createTeam === 0 && bundle.calls.createPortal === 0);
  }
}

// 7. Subscribed statuses pass through to 200
{
  for (const status of ["trialing", "active", "past_due"]) {
    const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: status, full_name: "X" } });
    const { res } = await callHandler({ supabaseOverride: supa });
    check(`subscribed (status=${status}) → 200`, res.statusCode === 200, `got ${res.statusCode}`);
  }
}

// 8. Admin with no subscription → 200 (bypass)
{
  const supa = makeSupabaseMock({ agent: { role: "admin", subscription_status: null, full_name: "Admin" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("admin no-sub → 200 (bypass)", res.statusCode === 200, `got ${res.statusCode}`);
}

// 9. No agent profile row → 401
{
  const supa = makeSupabaseMock({ agent: null });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("no agent profile → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

// 10. bundle create-team failure → 502, nothing saved
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks({ teamThrow: new Error("bundle 503") });
  const { res } = await callHandler({ supabaseOverride: supa, bundle });
  check("create-team failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("create-team failure → no upsert persisted", supa.upserts.length === 0);
}

// 11. bundle create-portal-link failure → 502 (team already upserted)
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks({ portalThrow: new Error("portal down") });
  const { res } = await callHandler({ supabaseOverride: supa, bundle });
  check("create-portal failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
}

// 12. Method guard — non-POST → 405
{
  const req = { method: "GET", headers: { authorization: `Bearer ${VALID_TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("GET → 405", res.statusCode === 405);
}

// 13. redirectUrl falls back to host when no origin header
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks();
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}`, host: "preview.vercel.app", "x-forwarded-proto": "https" }, body: {} };
  const res = makeRes();
  await handler(req, res, { supabase: supa, createTeam: bundle.createTeam, createPortal: bundle.createPortal });
  check("redirectUrl falls back to host", bundle.calls.lastPortalArgs?.redirectUrl === "https://preview.vercel.app/?social=connected", bundle.calls.lastPortalArgs?.redirectUrl);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
