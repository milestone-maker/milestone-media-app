// Vercel Serverless Function — cancel a still-upcoming scheduled post.
// POST /api/social-cancel
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { id }   (the social_posts row id)
//   Returns: { post }  (the updated row) | { error } on failure
//
// Stage 3c: deletes the post from bundle.social, then marks the row
// canceled_at = now(). canceled_at is set ONLY after bundle confirms the
// delete, so a non-null canceled_at always means the post really was dropped.
//
// Guards (ALL must hold, else a clean 4xx and NO bundle call):
//   • the row belongs to the authenticated agent (else 404)
//   • status === 'submitted'      (only a submitted post is live at bundle)
//   • bundle_post_id is non-null  (nothing to delete otherwise)
//   • canceled_at is still null   (not already canceled)
//   • scheduled_for is strictly in the future (a past post has already gone
//     out — bundle can't un-publish it, so we reject with a clear message)
//
// Auth + gating mirror api/social-status.js. Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";
import { deletePost as bundleDeletePost } from "./_lib/bundle.js";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
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

  const supabase   = depsOverride?.supabase   || defaultSupabase();
  const deletePost = depsOverride?.deletePost || bundleDeletePost;
  const now        = depsOverride?.now         || (() => new Date());

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
      console.error("[social-cancel] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate body ──
    const body = req.body || {};
    const { id } = body;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "id is required" });
    }

    // ── 3. Load + ownership-check the row ──
    const { data: post, error: postErr } = await supabase
      .from("social_posts")
      .select(ROW_COLUMNS + ", agent_id")
      .eq("id", id)
      .maybeSingle();
    if (postErr) {
      console.error("[social-cancel] post lookup error:", postErr);
      return res.status(500).json({ error: "post lookup failed", details: postErr.message });
    }
    if (!post || post.agent_id !== authUser.id) {
      // Don't leak existence of another agent's row.
      return res.status(404).json({ error: "post not found" });
    }

    // ── 4. Guards (each a clean 4xx, no bundle call) ──
    if (post.canceled_at) {
      return res.status(409).json({ error: "This post is already canceled." });
    }
    if (post.status !== "submitted" || !post.bundle_post_id) {
      return res.status(409).json({ error: "This post can't be canceled — it isn't a scheduled post." });
    }
    const scheduledMs = post.scheduled_for ? Date.parse(post.scheduled_for) : NaN;
    if (Number.isNaN(scheduledMs) || scheduledMs <= now().getTime()) {
      return res.status(409).json({
        error: "This post has already gone out and can't be canceled automatically.",
      });
    }

    // ── 5. Delete at bundle FIRST — only mark canceled if bundle confirms ──
    try {
      await deletePost({ postId: post.bundle_post_id });
    } catch (e) {
      console.error("[social-cancel] bundle delete failed:", e?.status, e?.message);
      return res.status(502).json({ error: "Could not cancel the post with Instagram provider. Please try again.", details: e?.message });
    }

    // ── 6. Record the cancellation ──
    const canceledAtIso = now().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from("social_posts")
      .update({ canceled_at: canceledAtIso, updated_at: canceledAtIso })
      .eq("id", id)
      .select(ROW_COLUMNS)
      .maybeSingle();
    if (upErr) {
      // bundle delete succeeded but our write failed — surface it; the row is
      // still 'submitted' but the post is gone at bundle. Safe to retry: the
      // guards will then reject (no bundle_post_id? no — it's still set, but a
      // retry's bundle delete will 404, handled as a provider error).
      console.error("[social-cancel] canceled update error:", upErr);
      return res.status(500).json({ error: "Post was canceled but the record could not be updated.", details: upErr.message });
    }

    return res.status(200).json({ post: updated });
  } catch (err) {
    console.error("[social-cancel] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
