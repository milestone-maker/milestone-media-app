// Vercel Serverless Function — Accept (redeem) a beta invite
// POST /api/beta-invite-accept
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { token: string }
//   Returns: { accepted: true, beta_expires_at: string,
//              beta_duration_days: int, already_accepted_by_caller: boolean }
//
// Preconditions (re-checked atomically; the public lookup is informational):
//   • caller is authenticated
//   • caller has an agents row (created on signup; created here if Google
//     OAuth landed without one)
//   • token matches an invite row
//   • invite.status = 'pending' AND invite.invite_expires_at > now()
//
// On accept:
//   • set agents.is_beta = true and beta_expires_at = now() + beta_duration_days
//   • set invite.status = 'accepted', accepted_by = caller.id, accepted_at = now()
//
// Idempotency: if status='accepted' AND accepted_by = caller.id, return
// success with already_accepted_by_caller=true and the existing
// beta_expires_at (no re-stamp — re-clicking the same link doesn't reset
// the clock). status='accepted' by SOMEONE ELSE → 409. Revoked/expired
// → 410.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabaseSingleton;
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

const TOKEN_RE = /^[0-9a-f]{64}$/;

async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const bearer = bearerFrom(req);
    if (!bearer) return res.status(401).json({ error: "missing Authorization header" });

    const token = (req.body?.token || "").toString().trim().toLowerCase();
    if (!token || !TOKEN_RE.test(token)) {
      return res.status(400).json({ error: "missing or malformed token" });
    }

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser(bearer);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const callerId = authData.user.id;
    const callerEmail = authData.user.email || null;

    const { data: invite, error: inviteErr } = await supabase
      .from("beta_invites")
      .select("id, token, status, beta_duration_days, invite_expires_at, accepted_by")
      .eq("token", token)
      .maybeSingle();
    if (inviteErr) {
      return res.status(500).json({ error: "lookup failed", detail: inviteErr.message });
    }
    if (!invite) {
      return res.status(404).json({ error: "invite not found" });
    }

    // Idempotent re-accept by the same caller.
    if (invite.status === "accepted" && invite.accepted_by === callerId) {
      const { data: ag } = await supabase
        .from("agents")
        .select("beta_expires_at")
        .eq("id", callerId)
        .single();
      return res.status(200).json({
        accepted: true,
        already_accepted_by_caller: true,
        beta_duration_days: invite.beta_duration_days,
        beta_expires_at: ag?.beta_expires_at ?? null,
      });
    }
    if (invite.status === "accepted") {
      return res.status(409).json({ error: "invite already accepted by another user" });
    }
    if (invite.status === "revoked") {
      return res.status(410).json({ error: "invite has been revoked" });
    }
    if (invite.status === "expired") {
      return res.status(410).json({ error: "invite has expired" });
    }

    // status === 'pending' from here on — check link expiry.
    if (new Date(invite.invite_expires_at).getTime() <= Date.now()) {
      // Flip to expired so the admin list reflects reality.
      await supabase
        .from("beta_invites")
        .update({ status: "expired" })
        .eq("id", invite.id)
        .eq("status", "pending");
      return res.status(410).json({ error: "invite link has expired" });
    }

    // Ensure the agents row exists (Google OAuth path may land without one).
    // Email/full_name are best-effort — the signup path on App.jsx sets them,
    // and the agent can edit later. role defaults to 'agent'.
    const { data: existing } = await supabase
      .from("agents")
      .select("id")
      .eq("id", callerId)
      .maybeSingle();
    if (!existing) {
      const { error: upsertErr } = await supabase.from("agents").upsert(
        { id: callerId, email: callerEmail, role: "agent" },
        { onConflict: "id" }
      );
      if (upsertErr) {
        return res.status(500).json({ error: "failed to create agent profile", detail: upsertErr.message });
      }
    }

    const betaExpiresAt = new Date(
      Date.now() + invite.beta_duration_days * 86400000
    ).toISOString();

    const { error: agentErr } = await supabase
      .from("agents")
      .update({ is_beta: true, beta_expires_at: betaExpiresAt })
      .eq("id", callerId);
    if (agentErr) {
      return res.status(500).json({ error: "failed to grant beta", detail: agentErr.message });
    }

    // Conditional UPDATE: only flip the invite if it is STILL pending. This
    // closes a race where two clients hit accept at the same instant —
    // exactly one will see a row updated.
    const { data: claimed, error: claimErr } = await supabase
      .from("beta_invites")
      .update({
        status: "accepted",
        accepted_by: callerId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimErr) {
      return res.status(500).json({ error: "failed to record acceptance", detail: claimErr.message });
    }
    if (!claimed) {
      // Lost the race. The beta grant is already applied to the caller,
      // which is harmless; just report the conflict.
      return res.status(409).json({ error: "invite was accepted by another session" });
    }

    return res.status(200).json({
      accepted: true,
      already_accepted_by_caller: false,
      beta_duration_days: invite.beta_duration_days,
      beta_expires_at: betaExpiresAt,
    });
  } catch (err) {
    return res.status(500).json({ error: "internal error", detail: err?.message });
  }
}

export default withSentry(handler);
