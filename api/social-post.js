// Vercel Serverless Function — publish a generated carousel to the agent's
// connected Instagram via bundle.social (Stage 2a).
// POST /api/social-post
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { contentId, imageUrls: [ordered public Supabase Storage URLs] }
//   Returns: { postId, status }
//
// Image approach is locked as Option C: a (later) client chunk composes the
// carousel, uploads the images to a PUBLIC Supabase Storage bucket, and passes
// the resulting public URLs here. This endpoint trusts those URLs only after
// confirming they are on this project's Supabase Storage public host, hands
// each to bundle (/upload/from-url → upload id), then creates one Instagram
// carousel post (type POST, ordered uploadIds). Server-only — no UI, no
// storage write, no migration in this chunk.
//
// Auth + gating mirror api/social-connect.js EXACTLY:
//   1. CORS + method guard
//   2. Bearer auth → supabase.auth.getUser
//   3. Subscription gate (admins exempt) via _lib/subscription.isSubscribed
//   4. Service-role load of agent_social_connections + generated_content
//
// Caption: the stored generated_content.caption is already IG-ready — the
// generation pipeline's canonicalizeHashtags() merges the hashtags[] block
// INTO the caption as its trailing paragraph. So the post text is the caption
// verbatim; we deliberately do NOT re-append hashtags[] (that would duplicate
// them).
//
// Posting is IMMEDIATE. bundle's status enum is ["DRAFT","SCHEDULED"] with no
// "publish now" value, so immediate = status "SCHEDULED" with postDate = now.
// postDate/status flow through createPost as params, so Stage 3 scheduling
// reuses this path with a future date.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { isSubscribed } from "./_lib/subscription.js";
import {
  createUploadFromUrl as bundleCreateUploadFromUrl,
  createPost as bundleCreatePost,
} from "./_lib/bundle.js";
import { INSTAGRAM_MAX_CAROUSEL_IMAGES } from "../shared/carouselPosting.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Instagram's hard ceiling on carousel items — shared with the UI gate so the
// two can never disagree. A backstop against handing bundle an oversized post.
const MAX_CAROUSEL_IMAGES = INSTAGRAM_MAX_CAROUSEL_IMAGES;

// The custom domain fronts the whole Supabase project (incl. Storage) — see
// src/supabaseClient.js — so client-generated getPublicUrl() URLs use THIS
// host, while the server env SUPABASE_URL is the raw *.supabase.co host. Allow
// both so the locked client flow's URLs pass the trust check.
const EXTRA_STORAGE_HOSTS = ["auth.milestonemediaphotography.com"];
const PUBLIC_STORAGE_PATH = "/storage/v1/object/public/";

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

function allowedStorageHosts() {
  const hosts = new Set(EXTRA_STORAGE_HOSTS);
  try { hosts.add(new URL(SUPABASE_URL).host); } catch { /* ignore */ }
  return hosts;
}

// True only for an https URL on an allowed Supabase host whose path is the
// public Storage object path. Rejects arbitrary external URLs so we never hand
// bundle something untrusted.
function isAllowedStorageUrl(value) {
  if (typeof value !== "string" || !value) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (!u.pathname.includes(PUBLIC_STORAGE_PATH)) return false;
  return allowedStorageHosts().has(u.host);
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
  const createUpload = depsOverride?.createUpload || bundleCreateUploadFromUrl;
  const createPost   = depsOverride?.createPost   || bundleCreatePost;
  const now          = depsOverride?.now          || (() => new Date());

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
      console.error("[social-post] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !isSubscribed(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate request body ──
    const body = req.body || {};
    const { contentId } = body;
    const imageUrls = body.imageUrls;

    if (!contentId || typeof contentId !== "string") {
      return res.status(400).json({ error: "contentId is required" });
    }
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ error: "imageUrls must be a non-empty array" });
    }
    if (imageUrls.length > MAX_CAROUSEL_IMAGES) {
      return res.status(400).json({ error: `too many images (max ${MAX_CAROUSEL_IMAGES})` });
    }
    for (const url of imageUrls) {
      if (!isAllowedStorageUrl(url)) {
        return res.status(400).json({ error: "imageUrls must be public Supabase Storage URLs for this project" });
      }
    }

    // ── 3. Require a connected Instagram (team + status) ──
    const { data: conn, error: connErr } = await supabase
      .from("agent_social_connections")
      .select("bundle_team_id, connection_status")
      .eq("agent_id", authUser.id)
      .maybeSingle();
    if (connErr) {
      console.error("[social-post] connection lookup error:", connErr);
      return res.status(500).json({ error: "connection lookup failed", details: connErr.message });
    }
    if (!conn || !conn.bundle_team_id || conn.connection_status !== "connected") {
      return res.status(409).json({ error: "Instagram not connected" });
    }
    const teamId = conn.bundle_team_id;

    // ── 4. Load + ownership-check the generated content ──
    const { data: content, error: contentErr } = await supabase
      .from("generated_content")
      .select("id, agent_id, caption")
      .eq("id", contentId)
      .maybeSingle();
    if (contentErr) {
      console.error("[social-post] content lookup error:", contentErr);
      return res.status(500).json({ error: "content lookup failed", details: contentErr.message });
    }
    if (!content) return res.status(404).json({ error: "content not found" });
    if (content.agent_id !== authUser.id) {
      return res.status(403).json({ error: "content does not belong to caller" });
    }

    // Caption is already IG-ready (hashtags merged in at generation time).
    const text = typeof content.caption === "string" ? content.caption : "";

    // ── 4b. Open a tracking row (pending) for this attempt ──
    // Best-effort: a tracking write must never change the user-facing outcome,
    // but we keep the id so we can mark it submitted/failed below.
    let trackingId = null;
    {
      const { data: tracked, error: insErr } = await supabase
        .from("social_posts")
        .insert({
          agent_id:   authUser.id,
          content_id: contentId,
          image_urls: imageUrls,
          status:     "pending",
        })
        .select("id")
        .maybeSingle();
      if (insErr) console.error("[social-post] tracking insert error:", insErr);
      else trackingId = tracked?.id ?? null;
    }

    const markFailed = async (message) => {
      if (!trackingId) return;
      const { error: upErr } = await supabase
        .from("social_posts")
        .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
        .eq("id", trackingId);
      if (upErr) console.error("[social-post] tracking fail-update error:", upErr);
    };

    // ── 5. Ingest each image into bundle, preserving order ──
    const uploadIds = [];
    try {
      for (const url of imageUrls) {
        const upload = await createUpload({ teamId, url });
        uploadIds.push(upload.id);
      }
    } catch (e) {
      console.error("[social-post] bundle upload failed:", e?.status, e?.message);
      await markFailed("could not upload images to Instagram provider");
      return res.status(502).json({ error: "could not upload images to Instagram provider", details: e?.message });
    }

    // ── 6. Create the Instagram carousel post (immediate) ──
    const nowIso = now().toISOString();
    let post;
    try {
      post = await createPost({
        teamId,
        title: `Milestone carousel · ${nowIso.slice(0, 10)}`, // bundle dashboard label, NOT the IG caption
        postDate: nowIso,
        status: "SCHEDULED", // immediate: SCHEDULED + postDate now (no publish-now status exists)
        text,
        uploadIds,
      });
    } catch (e) {
      console.error("[social-post] bundle create-post failed:", e?.status, e?.message);
      await markFailed("could not create Instagram post");
      return res.status(502).json({ error: "could not create Instagram post", details: e?.message });
    }

    // ── 7. Record success ──
    if (trackingId) {
      const { error: okErr } = await supabase
        .from("social_posts")
        .update({ status: "submitted", bundle_post_id: post.id, updated_at: new Date().toISOString() })
        .eq("id", trackingId);
      if (okErr) console.error("[social-post] tracking success-update error:", okErr);
    }

    return res.status(200).json({ trackingId, postId: post.id, status: post.status || "SCHEDULED" });
  } catch (err) {
    console.error("[social-post] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
