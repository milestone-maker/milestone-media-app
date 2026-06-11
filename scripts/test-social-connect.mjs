#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/social-connect.js — start the bundle connect flow
// for a given platform (Facebook Stage 1: multi-platform). Mocks Supabase +
// bundle (createTeam / createPortal) via depsOverride. No network, no real key.
// Verifies auth, subscription gating, platform validation, idempotent team
// creation across platforms, per-platform row upsert into
// agent_platform_connections, the Instagram→legacy mirror, and portalUrl return.
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

// Supabase mock. `platformRows` are the agent's existing
// agent_platform_connections rows (array). Records upserts per table.
function makeSupabaseMock({
  user         = { id: AGENT_ID },
  authError    = null,
  agent        = { role: "agent", subscription_status: "active", full_name: "Sarah Martinez" },
  agentErr     = null,
  platformRows = [],
  rowsErr      = null,
  upsertErr    = null,
} = {}) {
  const upserts = { agent_platform_connections: [], agent_social_connections: [] };
  const api = {
    upserts,
    auth: {
      getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }),
    },
    from: (table) => {
      if (table === "agents") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agent, error: agentErr }) }) }) };
      }
      if (table === "agent_platform_connections") {
        return {
          // .select(...).eq('agent_id', id) → awaited array result
          select: () => ({ eq: async () => ({ data: platformRows, error: rowsErr }) }),
          upsert: async (row, opts) => { upserts.agent_platform_connections.push({ row, opts }); return { error: upsertErr }; },
        };
      }
      if (table === "agent_social_connections") {
        return {
          upsert: async (row, opts) => { upserts.agent_social_connections.push({ row, opts }); return { error: null }; },
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

async function callHandler({ headers, body, supabaseOverride, bundle } = {}) {
  const b = bundle || makeBundleMocks();
  const req = {
    method: "POST",
    headers: headers ?? { authorization: `Bearer ${VALID_TOKEN}`, origin: "https://app.example" },
    body: body ?? {},
  };
  const res = makeRes();
  await handler(req, res, {
    supabase:     supabaseOverride || makeSupabaseMock(),
    createTeam:   b.createTeam,
    createPortal: b.createPortal,
  });
  return { res, bundle: b };
}

console.log("\n── api/social-connect.js — start bundle connect (multi-platform) ──\n");

// 1. Happy path (default platform = instagram) — no rows → creates team, upserts
//    pending IG row, mirrors legacy, returns portalUrl.
{
  const supa = makeSupabaseMock();
  const { res, bundle } = await callHandler({ supabaseOverride: supa });
  check("default → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("returns portalUrl", res.body?.portalUrl === "https://portal.bundle.social/xyz");
  check("returns status pending", res.body?.status === "pending");
  check("returns platform instagram", res.body?.platform === "instagram");
  check("createTeam called once", bundle.calls.createTeam === 1);
  check("createPortal called once", bundle.calls.createPortal === 1);
  check("portal scoped to teamId", bundle.calls.lastPortalArgs?.teamId === "team_new");
  check("portal requests instagram platform", JSON.stringify(bundle.calls.lastPortalArgs?.platforms) === JSON.stringify(["instagram"]));
  check("portal redirectUrl from origin + platform", bundle.calls.lastPortalArgs?.redirectUrl === "https://app.example/?social=connected&platform=instagram", bundle.calls.lastPortalArgs?.redirectUrl);
  check("upserts IG platform row pending", supa.upserts.agent_platform_connections[0]?.row?.connection_status === "pending");
  check("platform row carries platform=instagram", supa.upserts.agent_platform_connections[0]?.row?.platform === "instagram");
  check("platform row onConflict agent_id,platform", supa.upserts.agent_platform_connections[0]?.opts?.onConflict === "agent_id,platform");
  check("IG mirrors legacy table", supa.upserts.agent_social_connections[0]?.row?.bundle_team_id === "team_new");
  check("legacy mirror onConflict agent_id", supa.upserts.agent_social_connections[0]?.opts?.onConflict === "agent_id");
}

// 2. Facebook connect, NO existing rows → creates team, upserts FB row, NO legacy mirror.
{
  const supa = makeSupabaseMock();
  const { res, bundle } = await callHandler({ body: { platform: "facebook" }, supabaseOverride: supa });
  check("facebook → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("facebook → platform facebook", res.body?.platform === "facebook");
  check("facebook → portal requests facebook", JSON.stringify(bundle.calls.lastPortalArgs?.platforms) === JSON.stringify(["facebook"]));
  check("facebook → FB platform row upserted", supa.upserts.agent_platform_connections[0]?.row?.platform === "facebook");
  check("facebook → NO legacy mirror", supa.upserts.agent_social_connections.length === 0);
  check("facebook → redirect carries platform", bundle.calls.lastPortalArgs?.redirectUrl?.includes("platform=facebook"));
}

// 3. Facebook connect REUSES an existing IG team (no second team created).
{
  const supa = makeSupabaseMock({
    platformRows: [{ id: "r1", platform: "instagram", bundle_team_id: "team_existing", connection_status: "connected" }],
  });
  const { res, bundle } = await callHandler({ body: { platform: "facebook" }, supabaseOverride: supa });
  check("fb reuse → 200", res.statusCode === 200);
  check("fb reuse → does NOT create a second team", bundle.calls.createTeam === 0);
  check("fb reuse → portal uses existing team", bundle.calls.lastPortalArgs?.teamId === "team_existing");
  check("fb reuse → FB row upserted with existing team", supa.upserts.agent_platform_connections[0]?.row?.bundle_team_id === "team_existing");
}

// 4. Idempotent reconnect — platform row already has a team → no upsert, reuse.
{
  const supa = makeSupabaseMock({
    platformRows: [{ id: "r1", platform: "instagram", bundle_team_id: "team_existing", connection_status: "pending" }],
  });
  const { res, bundle } = await callHandler({ supabaseOverride: supa });
  check("reconnect → 200", res.statusCode === 200);
  check("reconnect → no new team", bundle.calls.createTeam === 0);
  check("reconnect → no platform upsert (idempotent)", supa.upserts.agent_platform_connections.length === 0);
  check("reconnect → no legacy mirror upsert", supa.upserts.agent_social_connections.length === 0);
  check("reconnect → portal reuses team", bundle.calls.lastPortalArgs?.teamId === "team_existing");
}

// 5. Unknown platform → 400, no bundle call.
{
  const supa = makeSupabaseMock();
  const { res, bundle } = await callHandler({ body: { platform: "tiktok" }, supabaseOverride: supa });
  check("unknown platform → 400", res.statusCode === 400, `got ${res.statusCode}`);
  check("unknown platform → no bundle call", bundle.calls.createTeam === 0 && bundle.calls.createPortal === 0);
}

// 6. Missing Authorization → 401
{
  const { res } = await callHandler({ headers: {} });
  check("missing auth → 401", res.statusCode === 401);
}

// 7. Invalid/expired token → 401
{
  const supa = makeSupabaseMock({ authError: { message: "bad jwt" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("invalid token → 401", res.statusCode === 401);
}

// 8. Unsubscribed non-admin → 402 (before any bundle call)
{
  for (const status of [null, "canceled", "incomplete", "unpaid", "paused"]) {
    const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: status, full_name: "X" } });
    const { res, bundle } = await callHandler({ supabaseOverride: supa });
    check(`unsubscribed (status=${status}) → 402`, res.statusCode === 402, `got ${res.statusCode}`);
    check(`unsubscribed → no bundle call`, bundle.calls.createTeam === 0 && bundle.calls.createPortal === 0);
  }
}

// 9. Subscribed statuses pass through to 200
{
  for (const status of ["trialing", "active", "past_due"]) {
    const supa = makeSupabaseMock({ agent: { role: "agent", subscription_status: status, full_name: "X" } });
    const { res } = await callHandler({ supabaseOverride: supa });
    check(`subscribed (status=${status}) → 200`, res.statusCode === 200, `got ${res.statusCode}`);
  }
}

// 10. Admin with no subscription → 200 (bypass)
{
  const supa = makeSupabaseMock({ agent: { role: "admin", subscription_status: null, full_name: "Admin" } });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("admin no-sub → 200 (bypass)", res.statusCode === 200, `got ${res.statusCode}`);
}

// 11. No agent profile row → 401
{
  const supa = makeSupabaseMock({ agent: null });
  const { res } = await callHandler({ supabaseOverride: supa });
  check("no agent profile → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

// 12. bundle create-team failure → 502, nothing saved
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks({ teamThrow: new Error("bundle 503") });
  const { res } = await callHandler({ supabaseOverride: supa, bundle });
  check("create-team failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("create-team failure → no upsert persisted", supa.upserts.agent_platform_connections.length === 0);
}

// 13. bundle create-portal-link failure → 502
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks({ portalThrow: new Error("portal down") });
  const { res } = await callHandler({ supabaseOverride: supa, bundle });
  check("create-portal failure → 502", res.statusCode === 502, `got ${res.statusCode}`);
}

// 14. Method guard — non-POST → 405
{
  const req = { method: "GET", headers: { authorization: `Bearer ${VALID_TOKEN}` } };
  const res = makeRes();
  await handler(req, res, { supabase: makeSupabaseMock() });
  check("GET → 405", res.statusCode === 405);
}

// 15. redirectUrl falls back to host when no origin header
{
  const supa = makeSupabaseMock();
  const bundle = makeBundleMocks();
  const req = { method: "POST", headers: { authorization: `Bearer ${VALID_TOKEN}`, host: "preview.vercel.app", "x-forwarded-proto": "https" }, body: {} };
  const res = makeRes();
  await handler(req, res, { supabase: supa, createTeam: bundle.createTeam, createPortal: bundle.createPortal });
  check("redirectUrl falls back to host", bundle.calls.lastPortalArgs?.redirectUrl === "https://preview.vercel.app/?social=connected&platform=instagram", bundle.calls.lastPortalArgs?.redirectUrl);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
