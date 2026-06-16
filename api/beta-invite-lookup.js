// Vercel Serverless Function — Public beta-invite token lookup
// GET /api/beta-invite-lookup?token=<token>
//   No auth required. Used by the /beta/accept landing page to decide
//   what UI to show BEFORE the visitor signs up or signs in.
//
// Returns:
//   200 { valid: boolean, status: 'pending'|'accepted'|'revoked'|'expired',
//         email: string|null, beta_duration_days: int,
//         invite_expires_at: string, link_expired: boolean }
//   400 if token is missing/malformed.
//   404 if no row matches the token (deliberately conflated with
//       expired/revoked so a brute-force probe can't distinguish a
//       wrong token from a real one whose state we don't want leaked).
//
// "valid" means status='pending' AND now() <= invite_expires_at — i.e.
// the link can still be redeemed. The accept endpoint re-validates the
// same conditions inside a service-role write, so the lookup is purely
// informational.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

// A token is 32 bytes hex = 64 lowercase hex chars. Reject anything else
// before hitting the DB.
const TOKEN_RE = /^[0-9a-f]{64}$/;

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = (req.query?.token || "").toString().trim().toLowerCase();
    if (!token || !TOKEN_RE.test(token)) {
      return res.status(400).json({ error: "missing or malformed token" });
    }

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: invite, error } = await supabase
      .from("beta_invites")
      .select("status, email, beta_duration_days, invite_expires_at")
      .eq("token", token)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: "lookup failed", detail: error.message });
    }
    if (!invite) {
      return res.status(404).json({ error: "invite not found" });
    }

    const linkExpired = new Date(invite.invite_expires_at).getTime() <= Date.now();
    const valid = invite.status === "pending" && !linkExpired;

    return res.status(200).json({
      valid,
      status: invite.status,
      email: invite.email,
      beta_duration_days: invite.beta_duration_days,
      invite_expires_at: invite.invite_expires_at,
      link_expired: linkExpired,
    });
  } catch (err) {
    return res.status(500).json({ error: "internal error", detail: err?.message });
  }
}
