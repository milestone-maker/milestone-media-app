#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-status.js — read back the agent's Instagram
// connection. Mocks Supabase + bundle (getAccount) via depsOverride. Verifies
// auth/gating, the 'none' (no team) path, the pending path, and the flip to
// 'connected' (+ username persistence) when bundle reports an account.
//
//   node scripts/test-social-status.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-status.js");

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

function makeSupabaseMock({
  user       = { id: AGENT_ID },
  authError  = null,
  agent      = { role: "agent", subscription_status: "active" },
  agentErr   = null,
  connection = null,
  connErr    = null,
  updateErr  = null,
} = {}) {
  const updates = [];
  return {
    updates,
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
          update: (row) => ({ eq: async () => { updates.push(row); return { error: updateErr }; } }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function makeAccountMock({ account = null, accountThrow = null } = {}) {
  const calls = { getAccount: 0, lastArgs: null };
  return {
    calls,
    getAccount: async (args) => { calls.getAccount++; calls.lastArgs = args; if (accountThrow) throw accountThrow; return account; },
  };
}

async function callHandler({ headers, supabaseOverride, account } = {}) {
  const a = account || makeAccountMock();
  const req = { method: "GET", headers: headers ?? { authorization: `Bearer ${VALID_TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: supabaseOverride || makeSupabaseMock(), getAccount: a.getAccount });
  return { res, account: a };
}

console.log("\n── api/social-status.js — connection read-back ──\n");

// 1. No connection row → status 'none', no bundle call
{
  const acct = makeAccountMock();
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ connection: null }), account: acct });
  check("no row → 200", res.statusCode === 200);
  check("no row → status 'none'", res.body?.status === "none");
  check("no row → username null", res.body?.username === null);
  check("no row → bundle NOT queried", acct.calls.getAccount === 0);
}

// 2. Row with team but bundle reports no account → 'pending'
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "pending", connected_username: null } });
  const acct = makeAccountMock({ account: null });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("team + no account → 200", res.statusCode === 200);
  check("team + no account → 'pending'", res.body?.status === "pending", res.body?.status);
  check("bundle queried with teamId", acct.calls.lastArgs?.teamId === "team_1");
}

// 3. Bundle reports connected account → flips to 'connected' + username persisted
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "pending", connected_username: null } });
  const acct = makeAccountMock({ account: { id: "sa_1", username: "sarah.sells", type: "INSTAGRAM" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("connected → 200", res.statusCode === 200);
  check("connected → status 'connected'", res.body?.status === "connected");
  check("connected → username returned", res.body?.username === "sarah.sells");
  check("connected → persisted to row", supa.updates[0]?.connection_status === "connected");
  check("connected → username persisted", supa.updates[0]?.connected_username === "sarah.sells");
  check("connected → connected_at stamped", typeof supa.updates[0]?.connected_at === "string");
}

// 4. username falls back to displayName when username missing
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "pending" } });
  const acct = makeAccountMock({ account: { id: "sa_1", username: null, displayName: "Sarah Martinez" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("username falls back to displayName", res.body?.username === "Sarah Martinez");
}

// 5. Bundle error → degrade to last-known stored status (no 5xx)
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "pending", connected_username: null } });
  const acct = makeAccountMock({ accountThrow: new Error("bundle 500") });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("bundle error → still 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("bundle error → returns stored status", res.body?.status === "pending");
}

// 6. Already-connected row + bundle still reports account → stays connected
{
  const supa = makeSupabaseMock({ connection: { bundle_team_id: "team_1", connection_status: "connected", connected_username: "sarah.sells" } });
  const acct = makeAccountMock({ account: { id: "sa_1", username: "sarah.sells" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("stays connected → 'connected'", res.body?.status === "connected");
}

// 7. Missing Authorization → 401
{
  const { res } = await callHandler({ headers: {} });
  check("missing auth → 401", res.statusCode === 401);
}

// 8. Unsubscribed non-admin → 402
{
  const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: "canceled" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("unsubscribed → 402", res.statusCode === 402, `got ${res.statusCode}`);
}

// 9. Admin no-sub → 200
{
  const supa = makeSupabaseMock({ agent: { role: "admin", subscription_status: null }, connection: null });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("admin no-sub → 200", res.statusCode === 200, `got ${res.statusCode}`);
}

// 10. Method guard — non-GET → 405
{
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("POST → 405", res.statusCode === 405);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
