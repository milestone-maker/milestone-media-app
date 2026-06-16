// Vercel Serverless Function — Beta invite admin endpoints
// POST /api/beta-invites
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { betaDurationDays?: int (default 90), email?: string }
//   Returns: { invite: { id, token, email, beta_duration_days,
//             invite_expires_at, status, created_at }, link: string }
// GET  /api/beta-invites
//   Headers: Authorization: Bearer <supabase access token>
//   Returns: { invites: [...], activeBetas: [...] }
//
// Both require role='admin' on the calling agent (mirrors api/search-
// console.js and others). The service-role client bypasses RLS; the
// admin gate is enforced explicitly here.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_APP_BASE (optional override; defaults to the prod custom domain)

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function buildLink(token) {
  return `${PUBLIC_APP_BASE}/beta/accept?token=${token}`;
}

// Compute days remaining from a beta_expires_at timestamp. null/past → 0.
function daysRemaining(betaExpiresAt) {
  if (!betaExpiresAt) return null; // null = never expires (the demo convention)
  const ms = new Date(betaExpiresAt).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }

    const { data: caller, error: callerErr } = await supabase
      .from("agents")
      .select("id, role")
      .eq("id", authData.user.id)
      .single();
    if (callerErr || !caller) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (caller.role !== "admin") {
      return res.status(403).json({ error: "admin only" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const betaDurationDays = Number.isInteger(body.betaDurationDays)
        ? body.betaDurationDays
        : 90;
      if (betaDurationDays <= 0 || betaDurationDays > 3650) {
        return res.status(400).json({ error: "betaDurationDays must be between 1 and 3650" });
      }
      const email = (typeof body.email === "string" && body.email.trim())
        ? body.email.trim().toLowerCase()
        : null;

      const inviteToken = randomBytes(32).toString("hex");

      const { data: invite, error: insertErr } = await supabase
        .from("beta_invites")
        .insert({
          token: inviteToken,
          email,
          beta_duration_days: betaDurationDays,
          created_by: caller.id,
        })
        .select("id, token, email, beta_duration_days, status, invite_expires_at, created_at")
        .single();
      if (insertErr || !invite) {
        return res.status(500).json({ error: "failed to create invite", detail: insertErr?.message });
      }

      return res.status(200).json({ invite, link: buildLink(invite.token) });
    }

    // GET — list invites + active betas.
    const { data: invites, error: invitesErr } = await supabase
      .from("beta_invites")
      .select("id, token, email, beta_duration_days, status, invite_expires_at, accepted_by, accepted_at, created_at")
      .order("created_at", { ascending: false });
    if (invitesErr) {
      return res.status(500).json({ error: "failed to list invites", detail: invitesErr.message });
    }

    // Active beta agents: is_beta = true (regardless of expiry; UI surfaces remaining).
    const { data: betaAgents, error: betaErr } = await supabase
      .from("agents")
      .select("id, email, full_name, beta_expires_at")
      .eq("is_beta", true)
      .order("beta_expires_at", { ascending: true, nullsFirst: false });
    if (betaErr) {
      return res.status(500).json({ error: "failed to list active betas", detail: betaErr.message });
    }

    const activeBetas = (betaAgents || []).map((a) => ({
      id: a.id,
      email: a.email,
      full_name: a.full_name,
      beta_expires_at: a.beta_expires_at,
      days_remaining: daysRemaining(a.beta_expires_at),
    }));

    const invitesWithLink = (invites || []).map((i) => ({ ...i, link: buildLink(i.token) }));

    return res.status(200).json({ invites: invitesWithLink, activeBetas });
  } catch (err) {
    return res.status(500).json({ error: "internal error", detail: err?.message });
  }
}
