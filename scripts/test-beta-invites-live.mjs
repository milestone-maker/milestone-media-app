// End-to-end test for the beta-invite flow against the LIVE linked DB.
//
// Exercises: admin create → public lookup → accept → idempotent re-accept →
// admin re-list → expired-link rejection. Uses a throwaway test agent
// (NOT the demo account). Cleans up after itself.
//
// Run: node scripts/test-beta-invites-live.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import createInviteHandler from "../api/beta-invites.js";
import lookupHandler from "../api/beta-invite-lookup.js";
import acceptHandler from "../api/beta-invite-accept.js";

// Load env from .env.local
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    })
);
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Minimal req/res shims that satisfy the Vercel handler shape.
function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(s, h) { this._status = s; Object.assign(this._headers, h || {}); return this; },
    end() { return this; },
  };
  return res;
}

// Build a Bearer header for a Supabase user. The handlers call
// supabase.auth.getUser(token); to satisfy that without a real JWT, we
// inject a depsOverride that returns the user we want.
function depsForUser(user) {
  return {
    supabase: {
      ...supabase,
      auth: {
        ...supabase.auth,
        getUser: async () => ({ data: { user }, error: null }),
      },
      from: supabase.from.bind(supabase),
    },
  };
}

let passed = 0, failed = 0;
function ok(name, cond, extra = "") {
  if (cond) { console.log(`✓ ${name}`); passed++; }
  else { console.log(`✗ ${name}${extra ? ` — ${extra}` : ""}`); failed++; }
}

async function createAuthUser(email) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomUUID(), // unused; we never log in
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return data.user;
}

async function cleanup(authUserIds, inviteIds) {
  if (inviteIds?.length) {
    await supabase.from("beta_invites").delete().in("id", inviteIds);
  }
  for (const id of authUserIds.filter(Boolean)) {
    await supabase.from("agents").delete().eq("id", id);
    await supabase.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function main() {
  // ── Provision throwaway admin + test agent (real auth.users rows) ─
  const stamp = randomUUID().slice(0, 8);
  const adminEmail = `test-admin-${stamp}@example.test`;
  const testEmail = `test-agent-${stamp}@example.test`;
  const adminAuth = await createAuthUser(adminEmail);
  const testAuth = await createAuthUser(testEmail);
  const adminId = adminAuth.id;
  const testAgentId = testAuth.id;
  const inviteIds = [];
  const authUserIds = [adminId, testAgentId];

  try {
    // Trigger on auth.users insert auto-creates an agents row. We upsert
    // to set the role/email we want for the test.
    const { error: upErr } = await supabase.from("agents").upsert([
      { id: adminId, email: adminEmail, full_name: "Test Admin", role: "admin" },
      { id: testAgentId, email: testEmail, full_name: "Test Agent", role: "agent" },
    ], { onConflict: "id" });
    if (upErr) throw new Error(`seed agents failed: ${upErr.message}`);

    const adminUser = { id: adminId, email: adminEmail };
    const testUser = { id: testAgentId, email: testEmail };

    // ── 1. Admin creates invite ──────────────────────────────────────
    {
      const req = { method: "POST", headers: { authorization: "Bearer x" }, body: { betaDurationDays: 90, email: testEmail } };
      const res = mockRes();
      await createInviteHandler(req, res, depsForUser(adminUser));
      ok("admin creates invite (200)", res._status === 200, JSON.stringify(res._body));
      ok("invite has 64-char hex token", /^[0-9a-f]{64}$/.test(res._body?.invite?.token || ""));
      ok("link uses PUBLIC_APP_BASE", (res._body?.link || "").includes("https://app.milestonemediaphotography.com/beta/accept?token="));
      ok("invite_expires_at ~30 days out", (() => {
        if (!res._body?.invite?.invite_expires_at) return false;
        const days = (new Date(res._body.invite.invite_expires_at).getTime() - Date.now()) / 86400000;
        return days > 29 && days < 31;
      })());
      if (res._body?.invite?.id) inviteIds.push(res._body.invite.id);

      // ── 2. Non-admin gets 403 on create ────────────────────────────
      const res2 = mockRes();
      await createInviteHandler(req, res2, depsForUser(testUser));
      ok("non-admin → 403 on create", res2._status === 403);

      // ── 3. Public lookup of valid token ────────────────────────────
      const goodToken = res._body.invite.token;
      const lookReq = { method: "GET", query: { token: goodToken }, headers: {} };
      const lookRes = mockRes();
      await lookupHandler(lookReq, lookRes, { supabase });
      ok("public lookup of valid token → 200 + valid:true",
        lookRes._status === 200 && lookRes._body?.valid === true, JSON.stringify(lookRes._body));

      // ── 4. Accept by test agent → grants beta ──────────────────────
      const acceptReq = { method: "POST", headers: { authorization: "Bearer x" }, body: { token: goodToken } };
      const acceptRes = mockRes();
      await acceptHandler(acceptReq, acceptRes, depsForUser(testUser));
      ok("accept → 200", acceptRes._status === 200, JSON.stringify(acceptRes._body));
      ok("accept returns beta_duration_days=90", acceptRes._body?.beta_duration_days === 90);
      ok("beta_expires_at ~90 days out", (() => {
        if (!acceptRes._body?.beta_expires_at) return false;
        const days = (new Date(acceptRes._body.beta_expires_at).getTime() - Date.now()) / 86400000;
        return days > 89 && days < 91;
      })());

      // Verify the DB state
      const { data: agentAfter } = await supabase
        .from("agents")
        .select("is_beta, beta_expires_at")
        .eq("id", testAgentId)
        .single();
      ok("agents.is_beta = true after accept", agentAfter?.is_beta === true);
      ok("agents.beta_expires_at populated", !!agentAfter?.beta_expires_at);

      const { data: inviteAfter } = await supabase
        .from("beta_invites")
        .select("status, accepted_by, accepted_at")
        .eq("token", goodToken)
        .single();
      ok("invite.status = accepted", inviteAfter?.status === "accepted");
      ok("invite.accepted_by = test agent", inviteAfter?.accepted_by === testAgentId);
      ok("invite.accepted_at stamped", !!inviteAfter?.accepted_at);

      // ── 5. Idempotent re-accept by same caller ─────────────────────
      const acceptRes2 = mockRes();
      await acceptHandler(acceptReq, acceptRes2, depsForUser(testUser));
      ok("re-accept by same caller → 200 + already_accepted_by_caller:true",
        acceptRes2._status === 200 && acceptRes2._body?.already_accepted_by_caller === true,
        JSON.stringify(acceptRes2._body));

      // ── 6. Different caller on already-accepted invite → 409 ───────
      const otherEmail = `test-other-${stamp}@example.test`;
      const otherAuth = await createAuthUser(otherEmail);
      authUserIds.push(otherAuth.id);
      await supabase.from("agents").upsert({ id: otherAuth.id, email: otherEmail, full_name: "Other", role: "agent" }, { onConflict: "id" });
      const otherRes = mockRes();
      await acceptHandler(acceptReq, otherRes, depsForUser({ id: otherAuth.id, email: otherEmail }));
      ok("accept by different user on accepted invite → 409", otherRes._status === 409, JSON.stringify(otherRes._body));

      // ── 7. Public lookup of accepted invite → valid:false ──────────
      const look2 = mockRes();
      await lookupHandler(lookReq, look2, { supabase });
      ok("lookup of accepted invite → valid:false, status:accepted",
        look2._status === 200 && look2._body?.valid === false && look2._body?.status === "accepted");
    }

    // ── 8. Expired-link rejection (manufacture an already-expired invite)
    {
      const expiredToken = "f".repeat(64);
      const { data: row } = await supabase
        .from("beta_invites")
        .insert({
          token: expiredToken,
          email: "expired@example.test",
          beta_duration_days: 90,
          invite_expires_at: new Date(Date.now() - 86400000).toISOString(), // -1d
          created_by: adminId,
        })
        .select("id")
        .single();
      if (row?.id) inviteIds.push(row.id);

      const lookReq = { method: "GET", query: { token: expiredToken }, headers: {} };
      const lookRes = mockRes();
      await lookupHandler(lookReq, lookRes, { supabase });
      ok("expired-link lookup → valid:false + link_expired:true",
        lookRes._body?.valid === false && lookRes._body?.link_expired === true);

      // Provision a fresh agent for the accept attempt (testAgentId already has beta).
      const freshEmail = `test-fresh-${stamp}@example.test`;
      const freshAuth = await createAuthUser(freshEmail);
      authUserIds.push(freshAuth.id);
      await supabase.from("agents").upsert({ id: freshAuth.id, email: freshEmail, full_name: "Fresh", role: "agent" }, { onConflict: "id" });
      const acceptRes = mockRes();
      await acceptHandler(
        { method: "POST", headers: { authorization: "Bearer x" }, body: { token: expiredToken } },
        acceptRes,
        depsForUser({ id: freshAuth.id, email: freshEmail })
      );
      ok("accept on expired link → 410", acceptRes._status === 410, JSON.stringify(acceptRes._body));

      // Beta should NOT be granted.
      const { data: a } = await supabase.from("agents").select("is_beta").eq("id", freshAuth.id).single();
      ok("fresh agent is_beta still false after expired-link rejection", a?.is_beta === false);
    }

    // ── 9. Admin GET lists invites + active betas ────────────────────
    {
      const req = { method: "GET", headers: { authorization: "Bearer x" }, query: {} };
      const res = mockRes();
      await createInviteHandler(req, res, depsForUser(adminUser));
      ok("admin GET → 200", res._status === 200);
      const seenTokens = (res._body?.invites || []).map((i) => i.token);
      ok("admin list includes both seeded invites",
        inviteIds.length === 2 &&
        seenTokens.some((t) => /^[0-9a-f]{64}$/.test(t)) &&
        seenTokens.includes("f".repeat(64)));
      ok("admin list flags the test agent in activeBetas",
        (res._body?.activeBetas || []).some((a) => a.id === testAgentId && a.days_remaining > 0));
    }
  } finally {
    await cleanup(authUserIds, inviteIds);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(2);
});
