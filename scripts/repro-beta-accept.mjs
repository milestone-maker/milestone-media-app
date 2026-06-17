// Reproduce the real authenticated accept flow against PRODUCTION
// (https://app.milestonemediaphotography.com). Mirrors what the browser
// does in src/views/BetaAccept/index.jsx — fetch + Authorization bearer.
//
// Steps:
//   1. Create a throwaway auth user (real auth.users row) + sign them in
//      with the service-role admin API to get a genuine access_token.
//   2. Seed a pending invite for that user.
//   3. POST /api/beta-invite-accept with the access_token + invite token.
//   4. Report HTTP status + body.
//   5. Read the agents row to see whether is_beta + beta_expires_at landed.
//   6. Clean up.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);

const PROD = "https://app.milestonemediaphotography.com";
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const stamp = randomUUID().slice(0, 8);
  const email = `repro-accept-${stamp}@example.test`;
  const password = randomUUID();
  let userId = null, inviteId = null;
  try {
    // ── 1. Create real auth user ─────────────────────────────────
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) throw new Error("createUser: " + createErr.message);
    userId = created.user.id;
    console.log(`[setup] user ${userId} ${email}`);

    // Trigger auto-creates agents row; we just need email/role consistent
    await admin.from("agents").upsert(
      { id: userId, email, full_name: "Repro Accept", role: "agent" },
      { onConflict: "id" }
    );

    // ── 2. Sign that user in (anon client) to get a real session ─
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr || !signIn?.session?.access_token) throw new Error("signIn: " + (signErr?.message || "no token"));
    const accessToken = signIn.session.access_token;
    console.log(`[setup] got access_token len=${accessToken.length}`);

    // ── 3. Seed pending invite ───────────────────────────────────
    const inviteToken = randomBytes(32).toString("hex");
    const { data: inv, error: invErr } = await admin.from("beta_invites").insert({
      token: inviteToken, email, beta_duration_days: 90,
    }).select("id").single();
    if (invErr) throw new Error("insert invite: " + invErr.message);
    inviteId = inv.id;
    console.log(`[setup] invite ${inviteId} token=${inviteToken.slice(0, 10)}…`);

    // ── 4. POST against PROD ─────────────────────────────────────
    console.log(`\n[POST] ${PROD}/api/beta-invite-accept`);
    const started = Date.now();
    const resp = await fetch(`${PROD}/api/beta-invite-accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: inviteToken }),
    });
    const elapsed = Date.now() - started;
    const text = await resp.text();
    console.log(`[response] status=${resp.status} elapsed=${elapsed}ms`);
    console.log(`[response] content-type=${resp.headers.get("content-type")}`);
    console.log(`[response] body=${text.slice(0, 500)}`);

    // ── 5. Verify DB state ───────────────────────────────────────
    const { data: ag } = await admin.from("agents")
      .select("is_beta, beta_expires_at")
      .eq("id", userId).single();
    console.log(`[db] is_beta=${ag?.is_beta} beta_expires_at=${ag?.beta_expires_at}`);
    const { data: invAfter } = await admin.from("beta_invites")
      .select("status, accepted_by, accepted_at")
      .eq("id", inviteId).single();
    console.log(`[db] invite.status=${invAfter?.status} accepted_by=${invAfter?.accepted_by}`);
  } catch (err) {
    console.error("CRASH:", err.message);
  } finally {
    if (inviteId) await admin.from("beta_invites").delete().eq("id", inviteId);
    if (userId) {
      await admin.from("agents").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    console.log("[cleanup] done");
  }
}

main();
