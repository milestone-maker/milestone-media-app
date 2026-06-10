// Vercel Serverless Function — list the agent's social posts.
// GET /api/social-posts            → all of the caller's social_posts rows
// GET /api/social-posts?contentId= → narrowed to one carousel
//   Headers: Authorization: Bearer <supabase access token>
//   Returns: { posts: [ { id, content_id, platform, status, scheduled_for,
//                         canceled_at, bundle_post_id, error_message,
//                         created_at } ] }
//
// Stage 3c groundwork: powers the "upcoming scheduled posts" list and the
// inline "already scheduled?" warning + reconciliation in 3c-2. Deliberately a
// DUMB READ — it returns every row for the agent (including canceled/past); the
// frontend decides what to surface. The optional contentId filter is used by
// the per-carousel checks in 3c-2.
//
// Auth + gating mirror api/social-status.js EXACTLY:
//   1. CORS + method guard (GET)
//   2. Bearer auth → supabase.auth.getUser
//   3. Subscription gate (admins exempt) via _lib/subscription.isSubscribed
//   4. Service-role load of social_posts, explicitly scoped to agent_id =
//      auth.uid() (same effect as the table's RLS self-select policy).
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROW_COLUMNS =
  "id, content_id, platform, status, scheduled_for, canceled_at, bundle_post_id, error_message, created_at";

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

// contentId may arrive via req.query (Vercel) or be embedded in the URL.
function contentIdFrom(req) {
  const fromQuery = req.query?.contentId;
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;
  try {
    const url = new URL(req.url, "http://localhost");
    const v = url.searchParams.get("contentId");
    return v || null;
  } catch {
    return null;
  }
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

  const supabase = depsOverride?.supabase || defaultSupabase();

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
      console.error("[social-posts] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Read the agent's rows (optionally narrowed to one carousel) ──
    // scheduled_for desc (nulls last) then created_at desc, so the soonest /
    // most-recent intent surfaces first.
    let query = supabase
      .from("social_posts")
      .select(ROW_COLUMNS)
      .eq("agent_id", authUser.id);

    const contentId = contentIdFrom(req);
    if (contentId) query = query.eq("content_id", contentId);

    const { data: rows, error: rowsErr } = await query
      .order("scheduled_for", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (rowsErr) {
      console.error("[social-posts] list error:", rowsErr);
      return res.status(500).json({ error: "could not load posts", details: rowsErr.message });
    }

    return res.status(200).json({ posts: rows || [] });
  } catch (err) {
    console.error("[social-posts] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
