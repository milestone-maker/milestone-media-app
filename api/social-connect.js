// Vercel Serverless Function — start the bundle.social connect flow for a
// given platform (Instagram or Facebook).
// POST /api/social-connect
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { platform?: 'instagram' | 'facebook' }   (default 'instagram')
//   Returns: { portalUrl, status, platform }
//
// Purpose: ensure the calling agent has a bundle "team", then mint a hosted
// portal link the agent opens to connect the requested network. Facebook
// Stage 1 — multi-platform connection foundation. No posting here.
//
// Per-platform model (Facebook Stage 1):
//   • Canonical store is public.agent_platform_connections, one row per
//     (agent_id, platform). An agent maps to exactly ONE bundle team; that team
//     id is the SAME across the agent's platform rows (bundle teams hold several
//     accounts), so we discover an existing team from ANY of the agent's rows
//     before creating a new one.
//   • Instagram MIRROR: the legacy public.agent_social_connections (1:1) is
//     still read by api/social-post.js this stage, so when we (first-)connect
//     Instagram we also upsert that legacy row. This keeps the existing
//     Instagram posting path working unchanged.
//
// Auth + gating mirror the prior Instagram-only version EXACTLY:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. Feature-access gate (admins exempt) via _lib/subscription.hasFeatureAccess
//   4. Service-role load/upsert of agent_platform_connections for auth.uid()
//   5. Idempotent create-team (only when the agent has no team on any row),
//      then create-portal-link scoped to the requested platform
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "./_lib/subscription.js";
import {
  createTeam as bundleCreateTeam,
  createPortalLink as bundleCreatePortalLink,
} from "./_lib/bundle.js";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

// Networks an agent can connect today. Mirrors the platform CHECK on
// agent_platform_connections (migration 040) and social_posts (036). Only
// instagram + facebook are surfaced in Stage 1; threads is a forward hook.
const ALLOWED_PLATFORMS = ["instagram", "facebook", "threads", "linkedin"];
const DEFAULT_PLATFORM = "instagram";

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
// back to the request host, then to the known prod app URL. Carries the
// platform so the app reopens the right card on return.
function redirectUrlFrom(req, platform) {
  const qs = `?social=connected&platform=${encodeURIComponent(platform)}`;
  const origin = req.headers?.origin;
  if (origin) return `${origin}/${qs}`;
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host  = req.headers?.["x-forwarded-host"] || req.headers?.host;
  if (host) return `${proto}://${host}/${qs}`;
  return `${PUBLIC_APP_BASE}/${qs}`;
}

async function handler(req, res, depsOverride) {
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
      .select("role, subscription_status, full_name, is_beta, beta_expires_at")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[social-connect] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !hasFeatureAccess(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 1c. Resolve + validate the target platform (default instagram) ──
    const body = req.body || {};
    const platform = body.platform === undefined || body.platform === null
      ? DEFAULT_PLATFORM
      : body.platform;
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${ALLOWED_PLATFORMS.join(", ")}` });
    }

    // ── 2. Load the agent's existing per-platform rows ──
    // We need (a) this platform's own row and (b) any row carrying a team id,
    // since one bundle team backs all of an agent's platforms.
    const { data: rows, error: rowsErr } = await supabase
      .from("agent_platform_connections")
      .select("id, platform, bundle_team_id, connection_status")
      .eq("agent_id", authUser.id);
    if (rowsErr) {
      console.error("[social-connect] connections lookup error:", rowsErr);
      return res.status(500).json({ error: "connection lookup failed", details: rowsErr.message });
    }
    const agentRows   = Array.isArray(rows) ? rows : [];
    const platformRow = agentRows.find((r) => r.platform === platform) || null;

    // ── 3. Ensure a bundle team (idempotent: reuse any existing team id) ──
    let teamId =
      platformRow?.bundle_team_id ||
      agentRows.find((r) => r.bundle_team_id)?.bundle_team_id ||
      null;

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
    }

    // ── 3b. Upsert the per-platform row to pending (unless it already exists
    //        with a team id — an idempotent reconnect leaves its status as-is).
    const needPlatformUpsert = !platformRow || !platformRow.bundle_team_id;
    if (needPlatformUpsert) {
      const { error: upErr } = await supabase
        .from("agent_platform_connections")
        .upsert(
          {
            agent_id:          authUser.id,
            platform,
            bundle_team_id:    teamId,
            connection_status: "pending",
            updated_at:        new Date().toISOString(),
          },
          { onConflict: "agent_id,platform" }
        );
      if (upErr) {
        console.error("[social-connect] platform connection upsert error:", upErr);
        return res.status(500).json({ error: "could not save connection", details: upErr.message });
      }

      // Instagram MIRROR → legacy agent_social_connections (still read by
      // api/social-post.js). Only on the same condition we wrote the platform
      // row, so a backfilled/connected legacy row is never downgraded to pending.
      if (platform === "instagram") {
        const { error: legacyErr } = await supabase
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
        if (legacyErr) {
          // Non-fatal: the canonical per-platform row is already saved. Log and
          // continue so the connect flow isn't blocked by the legacy mirror.
          console.error("[social-connect] legacy mirror upsert error (continuing):", legacyErr);
        }
      }
    }

    // ── 4. Mint a hosted portal link scoped to the requested platform ──
    let portalUrl;
    try {
      portalUrl = await createPortal({
        teamId,
        redirectUrl: redirectUrlFrom(req, platform),
        platforms: [platform],
      });
    } catch (e) {
      console.error("[social-connect] bundle create-portal-link failed:", e?.status, e?.message);
      return res.status(502).json({ error: `could not start ${platform} connection`, details: e?.message });
    }

    return res.status(200).json({ portalUrl, status: "pending", platform });
  } catch (err) {
    console.error("[social-connect] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
