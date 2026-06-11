#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-status.js — per-platform connection read-back
// (Facebook Stage 1). Mocks Supabase + bundle (getAccount) via depsOverride.
// Verifies auth/gating, the default-instagram back-compat shape, the per-platform
// query (?platform=facebook), the flip to 'connected' (+ persistence + IG legacy
// mirror), graceful bundle-error degradation, and the `platforms` summary array.
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

// `platformRows` are the agent's agent_platform_connections rows. Records
// updates per table. agent_platform_connections.update chains .eq().eq();
// agent_social_connections.update chains a single .eq().
function makeSupabaseMock({
  user         = { id: AGENT_ID },
  authError    = null,
  agent        = { role: "agent", subscription_status: "active" },
  agentErr     = null,
  platformRows = [],
  rowsErr      = null,
  updateErr    = null,
} = {}) {
  const updates = { agent_platform_connections: [], agent_social_connections: [] };
  return {
    updates,
    auth: {
      getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }),
    },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: agentErr }) }) }) };
      }
      if (table === "agent_platform_connections") {
        return {
          select: () => ({ eq: async () => ({ data: platformRows, error: rowsErr }) }),
          update: (row) => ({ eq: () => ({ eq: async () => { updates.agent_platform_connections.push(row); return { error: updateErr }; } }) }),
        };
      }
      if (table === "agent_social_connections") {
        return {
          update: (row) => ({ eq: async () => { updates.agent_social_connections.push(row); return { error: null }; } }),
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

async function callHandler({ headers, query, supabaseOverride, account } = {}) {
  const a = account || makeAccountMock();
  const req = { method: "GET", headers: headers ?? { authorization: `Bearer ${VALID_TOKEN}` }, query: query ?? {} };
  const res = makeRes();
  await handler(req, res, { supabase: supabaseOverride || makeSupabaseMock(), getAccount: a.getAccount });
  return { res, account: a };
}

const IG_ROW = (over = {}) => ({ platform: "instagram", bundle_team_id: "team_1", connection_status: "pending", connected_username: null, connected_at: null, ...over });
const FB_ROW = (over = {}) => ({ platform: "facebook",  bundle_team_id: "team_1", connection_status: "pending", connected_username: null, connected_at: null, ...over });

console.log("\n── api/social-status.js — per-platform connection read-back ──\n");

// 1. No rows → default instagram → status 'none', no bundle call (back-compat shape).
{
  const acct = makeAccountMock();
  const { res } = await callHandler({ supabaseOverride: makeSupabaseMock({ platformRows: [] }), account: acct });
  check("no rows → 200", res.statusCode === 200);
  check("no rows → status 'none'", res.body?.status === "none", res.body?.status);
  check("no rows → username null", res.body?.username === null);
  check("no rows → platform instagram", res.body?.platform === "instagram");
  check("no rows → bundle NOT queried", acct.calls.getAccount === 0);
  check("no rows → platforms array present (3)", Array.isArray(res.body?.platforms) && res.body.platforms.length === 3);
}

// 2. IG row + bundle reports no account → 'pending' (back-compat default platform).
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW()] });
  const acct = makeAccountMock({ account: null });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("IG team + no account → 200", res.statusCode === 200);
  check("IG team + no account → 'pending'", res.body?.status === "pending", res.body?.status);
  check("bundle queried with teamId", acct.calls.lastArgs?.teamId === "team_1");
  check("bundle queried with INSTAGRAM type", acct.calls.lastArgs?.type === "INSTAGRAM", acct.calls.lastArgs?.type);
}

// 3. IG connected → flips to connected, persists to platform row + legacy mirror.
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW()] });
  const acct = makeAccountMock({ account: { id: "sa_1", username: "sarah.sells", type: "INSTAGRAM" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("IG connected → 200", res.statusCode === 200);
  check("IG connected → status 'connected'", res.body?.status === "connected");
  check("IG connected → username returned", res.body?.username === "sarah.sells");
  check("IG connected → persisted to platform row", supa.updates.agent_platform_connections[0]?.connection_status === "connected");
  check("IG connected → username persisted", supa.updates.agent_platform_connections[0]?.connected_username === "sarah.sells");
  check("IG connected → connected_at stamped", typeof supa.updates.agent_platform_connections[0]?.connected_at === "string");
  check("IG connected → legacy mirror updated", supa.updates.agent_social_connections[0]?.connection_status === "connected");
}

// 4. Facebook query → uses FACEBOOK bundle type, flips connected, NO legacy mirror.
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW({ connection_status: "connected", connected_username: "ig.user" }), FB_ROW()] });
  const acct = makeAccountMock({ account: { id: "sa_2", username: "sarah.fb", type: "FACEBOOK" } });
  const { res } = await callHandler({ query: { platform: "facebook" }, supabaseOverride: supa, account: acct });
  check("FB query → 200", res.statusCode === 200);
  check("FB query → platform facebook", res.body?.platform === "facebook");
  check("FB query → bundle queried with FACEBOOK type", acct.calls.lastArgs?.type === "FACEBOOK", acct.calls.lastArgs?.type);
  check("FB query → status connected", res.body?.status === "connected");
  check("FB query → username sarah.fb", res.body?.username === "sarah.fb");
  check("FB query → FB row persisted (not IG)", supa.updates.agent_platform_connections[0]?.connected_username === "sarah.fb");
  check("FB query → NO legacy mirror", supa.updates.agent_social_connections.length === 0);
  // platforms array reflects both: IG connected (stored), FB connected (fresh)
  const ig = res.body?.platforms?.find((p) => p.platform === "instagram");
  const fb = res.body?.platforms?.find((p) => p.platform === "facebook");
  check("FB query → platforms[IG] stays connected", ig?.status === "connected");
  check("FB query → platforms[FB] connected", fb?.status === "connected" && fb?.username === "sarah.fb");
}

// 5. username falls back to displayName when username missing
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW()] });
  const acct = makeAccountMock({ account: { id: "sa_1", username: null, displayName: "Sarah Martinez" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("username falls back to displayName", res.body?.username === "Sarah Martinez");
}

// 6. Bundle error → degrade to last-known stored status (no 5xx)
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW({ connection_status: "pending" })] });
  const acct = makeAccountMock({ accountThrow: new Error("bundle 500") });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("bundle error → still 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("bundle error → returns stored status", res.body?.status === "pending");
  check("bundle error → no persist", supa.updates.agent_platform_connections.length === 0);
}

// 7. Already-connected IG row + bundle still reports account → stays connected
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW({ connection_status: "connected", connected_username: "sarah.sells" })] });
  const acct = makeAccountMock({ account: { id: "sa_1", username: "sarah.sells" } });
  const { res } = await callHandler({ supabaseOverride: supa, account: acct });
  check("stays connected → 'connected'", res.body?.status === "connected");
}

// 8. Facebook queried but agent has only IG → FB status 'none', no bundle call.
{
  const supa = makeSupabaseMock({ platformRows: [IG_ROW({ connection_status: "connected" })] });
  const acct = makeAccountMock();
  const { res } = await callHandler({ query: { platform: "facebook" }, supabaseOverride: supa, account: acct });
  check("FB-none → 200", res.statusCode === 200);
  check("FB-none → status 'none'", res.body?.status === "none", res.body?.status);
  check("FB-none → bundle NOT queried", acct.calls.getAccount === 0);
}

// 9. Unknown platform query → 400
{
  const { res } = await callHandler({ query: { platform: "tiktok" } });
  check("unknown platform → 400", res.statusCode === 400, `got ${res.statusCode}`);
}

// 10. Missing Authorization → 401
{
  const { res } = await callHandler({ headers: {} });
  check("missing auth → 401", res.statusCode === 401);
}

// 11. Unsubscribed non-admin → 402
{
  const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: "canceled" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("unsubscribed → 402", res.statusCode === 402, `got ${res.statusCode}`);
}

// 12. Admin no-sub → 200
{
  const supa = makeSupabaseMock({ agent: { role: "admin", subscription_status: null }, platformRows: [] });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("admin no-sub → 200", res.statusCode === 200, `got ${res.statusCode}`);
}

// 13. Method guard — non-GET → 405
{
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}` }, query: {} };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("POST → 405", res.statusCode === 405);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
