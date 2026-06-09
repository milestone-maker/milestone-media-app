// Vercel Serverless Function — start the bundle.social Instagram connect flow.
// POST /api/social-connect
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    (none)
//   Returns: { portalUrl, status }
//
// Purpose: ensure the calling agent has a bundle "team", then mint a hosted
// portal link the agent opens to connect their Instagram. Stage 1 of the
// bundle posting integration — no posting here, just connection.
//
// Auth + gating mirror api/content-regenerate-slide.js EXACTLY:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. Subscription gate (admins exempt) via _lib/subscription.isSubscribed
//   4. Service-role load/upsert of agent_social_connections for auth.uid()
//   5. Idempotent create-team (only when no stored bundle_team_id), then
//      create-portal-link for that team
//
// Idempotency: bundle does NOT dedupe teams, so we guard on our own row —
// agent_social_connections.agent_id is UNIQUE and we only call createTeam when
// the row has no bundle_team_id. A retried connect reuses the existing team.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";
import {
  createTeam as bundleCreateTeam,
  createPortalLink as bundleCreatePortalLink,
} from "./_lib/bundle.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Where bundle returns the agent after the hosted portal flow. Prefer the
// request's own origin (so preview and prod each return to themselves), fall
// back to the request host, then to the known prod app URL.
function redirectUrlFrom(req) {
  const origin = req.headers?.origin;
  if (origin) return `${origin}/?social=connected`;
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host  = req.headers?.["x-forwarded-host"] || req.headers?.host;
  if (host) return `${proto}://${host}/?social=connected`;
  return "https://app.milestonemediaphotography.com/?social=connected";
}

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase      = depsOverride?.supabase      || defaultSupabase();
  const createTeam    = depsOverride?.createTeam    || bundleCreateTeam;
  const createPortal  = depsOverride?.createPortal  || bundleCreatePortalLink;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 1b. Subscription gate (admins exempt) ──
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("role, subscription_status, full_name")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[social-connect] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Load existing connection row (one per agent) ──
    const { data: existing, error: connErr } = await supabase
      .from("agent_social_connections")
      .select("id, bundle_team_id, connection_status")
      .eq("agent_id", authUser.id)
      .maybeSingle();
    if (connErr) {
      console.error("[social-connect] connection lookup error:", connErr);
      return res.status(500).json({ error: "connection lookup failed", details: connErr.message });
    }

    // ── 3. Ensure a bundle team (idempotent: only create if none stored) ──
    let teamId = existing?.bundle_team_id || null;
    if (!teamId) {
      const teamName = `Milestone — ${agentRow.full_name || authUser.email || authUser.id}`;
      let team;
      try {
        team = await createTeam({ name: teamName });
      } catch (e) {
        console.error("[social-connect] bundle create-team failed:", e?.status, e?.message);
        return res.status(502).json({ error: "could not create social workspace", details: e?.message });
      }
      teamId = team.id;

      // Upsert our row with the new team id + pending status. onConflict on the
      // UNIQUE agent_id so a concurrent/retried connect never duplicates.
      const { error: upErr } = await supabase
        .from("agent_social_connections")
        .upsert(
          {
            agent_id:          authUser.id,
            bundle_team_id:    teamId,
            connection_status: "pending",
            updated_at:        new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );
      if (upErr) {
        console.error("[social-connect] connection upsert error:", upErr);
        return res.status(500).json({ error: "could not save connection", details: upErr.message });
      }
    }

    // ── 4. Mint a hosted portal link for Instagram ──
    let portalUrl;
    try {
      portalUrl = await createPortal({
        teamId,
        redirectUrl: redirectUrlFrom(req),
        socialAccountTypes: ["INSTAGRAM"],
      });
    } catch (e) {
      console.error("[social-connect] bundle create-portal-link failed:", e?.status, e?.message);
      return res.status(502).json({ error: "could not start Instagram connection", details: e?.message });
    }

    return res.status(200).json({ portalUrl, status: "pending" });
  } catch (err) {
    console.error("[social-connect] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
