// Vercel Serverless Function — read back the agent's Instagram connection.
// GET /api/social-status
//   Headers: Authorization: Bearer <supabase access token>
//   Returns: { status, username }
//
// Purpose: the Instagram view polls this after the agent returns from bundle's
// hosted portal. Loads the agent's connection row; if a bundle team exists,
// asks bundle whether an Instagram account is connected and, when it is,
// persists status='connected' + username + connected_at so later loads are
// instant. Stage 1 — read-back is required, not optional.
//
// Auth + gating mirror api/social-connect.js / content-regenerate-slide.js:
//   1. CORS + method guard (GET)
//   2. Bearer auth → supabase.auth.getUser
//   3. Subscription gate (admins exempt) via _lib/subscription.isSubscribed
//   4. Service-role load of agent_social_connections; bundle by-type lookup
//
// Never throws to the client on a bundle hiccup: a failed bundle lookup
// returns the last-known stored status rather than a 5xx, so polling degrades
// gracefully.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";
import { getSocialAccountByType as bundleGetAccount } from "./_lib/bundle.js";

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function usernameFrom(account) {
  return account?.username || account?.displayName || account?.userUsername || null;
}

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase   = depsOverride?.supabase   || defaultSupabase();
  const getAccount = depsOverride?.getAccount || bundleGetAccount;

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
      .select("role, subscription_status")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[social-status] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Load the connection row ──
    const { data: conn, error: connErr } = await supabase
      .from("agent_social_connections")
      .select("bundle_team_id, connection_status, connected_username")
      .eq("agent_id", authUser.id)
      .maybeSingle();
    if (connErr) {
      console.error("[social-status] connection lookup error:", connErr);
      return res.status(500).json({ error: "connection lookup failed", details: connErr.message });
    }

    // No row or no team yet → not connected.
    if (!conn || !conn.bundle_team_id) {
      return res.status(200).json({ status: "none", username: null });
    }

    // ── 3. Ask bundle whether an Instagram account is connected ──
    let account;
    try {
      account = await getAccount({ teamId: conn.bundle_team_id, type: "INSTAGRAM" });
    } catch (e) {
      // Degrade gracefully: return last-known stored status on a bundle error.
      console.error("[social-status] bundle by-type lookup failed:", e?.status, e?.message);
      return res.status(200).json({
        status:   conn.connection_status || "pending",
        username: conn.connected_username || null,
      });
    }

    if (account) {
      const username = usernameFrom(account);
      // Persist the connected state so subsequent loads don't need bundle.
      const { error: upErr } = await supabase
        .from("agent_social_connections")
        .update({
          connection_status: "connected",
          connected_username: username,
          connected_at:       new Date().toISOString(),
          updated_at:         new Date().toISOString(),
        })
        .eq("agent_id", authUser.id);
      if (upErr) console.error("[social-status] connected update error:", upErr);
      return res.status(200).json({ status: "connected", username });
    }

    // Team exists but no Instagram account yet → still pending.
    return res.status(200).json({
      status:   conn.connection_status === "connected" ? "pending" : (conn.connection_status || "pending"),
      username: null,
    });
  } catch (err) {
    console.error("[social-status] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
