// Vercel Serverless Function — publish generated content to the agent's
// connected Instagram (carousel) or Facebook (photo album) via bundle.social.
// POST /api/social-post
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { contentId, platform?, postDate?,
//              imageUrls?: [ordered public Supabase Storage URLs] }
//   Returns: { trackingId, postId, status, scheduledFor }
//
// Per platform:
//   • INSTAGRAM (default): the client composes the carousel, uploads the slide
//     images to the public `carousel-posts` bucket, and passes the ordered
//     PUBLIC URLs as imageUrls. (Option C — store-first.)
//   • FACEBOOK: the SERVER builds a photo album from the listing's RAW photos —
//     reusing the SAME Instagram photo selection (selectCarouselPhotos over
//     photo_labels) but taking each chosen photo's raw photo_url (NO carousel
//     compositing). imageUrls from the client is ignored for FB.
//
// Both paths: validate each image URL is a public Supabase Storage URL on an
// allowed host, hand each to bundle (/upload/from-url → upload id), then create
// one post (type POST, ordered uploadIds) via the platform-generalized
// createPost.
//
// Connection: read from agent_platform_connections by (agent_id, platform) for
// BOTH platforms — FB: platform='facebook'; IG: platform='instagram' (Stage 1
// backfilled + mirrors it). The legacy agent_social_connections table stays in
// place (still mirror-written) and is NOT read here anymore — flag for later
// cleanup once nothing reads it.
//
// Caption:
//   • IG: the stored generated_content.caption is already IG-ready (hashtags
//     merged in at generation); posted verbatim.
//   • FB: the stored caption carries a microsite PLACEHOLDER TOKEN. We re-resolve
//     the listing's LIVE microsite URL here and substitute it for the token
//     (insert the live link, or drop the token line if no live microsite), so a
//     microsite published/retired AFTER generation is reflected at post time.
//     A caption with no token (legacy pre-token row) is posted unchanged.
//
// Posting is IMMEDIATE or SCHEDULED. bundle's status enum is ["DRAFT","SCHEDULED"]
// with no "publish now", so immediate = status "SCHEDULED" with postDate = now.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUNDLE_API_KEY.

import { createClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "./_lib/subscription.js";
import {
  createUploadFromUrl as bundleCreateUploadFromUrl,
  createPost as bundleCreatePost,
  setChannel as bundleSetChannel,
} from "./_lib/bundle.js";
import { INSTAGRAM_MAX_CAROUSEL_IMAGES } from "../shared/carouselPosting.js";
import { facebookAlbumUrls } from "./_content/selectCarouselPhotos.js";
import { resolvePublishedMicrositeUrl, substituteMicrositeToken } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Hard ceiling on images per post — shared with the IG UI gate. Also used to cap
// the FB album (bundle/Facebook album limits are in the same ballpark).
const MAX_IMAGES = INSTAGRAM_MAX_CAROUSEL_IMAGES;

// The custom domain fronts the whole Supabase project (incl. Storage) — see
// src/supabaseClient.js — so client-generated getPublicUrl() URLs use THIS
// host, while the server env SUPABASE_URL is the raw *.supabase.co host. Allow
// both so the locked client flow's URLs (and raw listing photo URLs) pass.
//
// HARDENING: the project's raw Storage host is ALSO listed explicitly. Every
// stored listing photo (published-media bucket) lives on this host, and the
// prod SUPABASE_URL env is "Sensitive" (its value isn't always introspectable),
// so anchoring the allowlist to SUPABASE_URL alone risks silently emptying the
// FB album if that env ever points at the custom domain instead of the raw
// host. Listing the project host as a constant makes the allowlist env-proof.
const PROJECT_STORAGE_HOST = "cbpnjuotoxtmefmedpmj.supabase.co";
const EXTRA_STORAGE_HOSTS = ["auth.milestonemediaphotography.com", PROJECT_STORAGE_HOST];
const PUBLIC_STORAGE_PATH = "/storage/v1/object/public/";

const SCHEDULE_BUFFER_MS = 3 * 60 * 1000; // 3 minutes

// Allowed target networks — mirrors the social_posts.platform CHECK (036).
const ALLOWED_PLATFORMS = ["instagram", "facebook", "threads", "linkedin"];
const DEFAULT_PLATFORM = "instagram";

// Human label for user-facing strings (so they're not Instagram-only).
function platformDisplay(p) {
  if (p === "facebook") return "Facebook";
  if (p === "threads")  return "Threads";
  if (p === "linkedin") return "LinkedIn";
  return "Instagram";
}

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

// Build the Facebook album: the CURATED default set (facebookAlbumUrls — cover,
// the subject-room walk, and the ungated backyard) FIRST, then the agent's
// hand-picked EXTRA photos appended in selection order. De-duped (extras already
// in the curated set are skipped) and host-filtered — every URL, curated or
// added, must be a first-party public Storage URL. NO cap on the agent's
// additions. Returns [] when nothing usable survives.
function buildFacebookAlbum(photoLabels, extraPhotoUrls = []) {
  const seen = new Set();
  const album = [];
  const add = (url) => {
    if (typeof url !== "string" || seen.has(url) || !isAllowedStorageUrl(url)) return;
    seen.add(url);
    album.push(url);
  };
  for (const url of facebookAlbumUrls(photoLabels)) add(url);                    // curated defaults first
  for (const url of (Array.isArray(extraPhotoUrls) ? extraPhotoUrls : [])) add(url); // agent additions, in order
  return album;
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

  const supabase     = depsOverride?.supabase     || defaultSupabase();
  const createUpload = depsOverride?.createUpload || bundleCreateUploadFromUrl;
  const createPost   = depsOverride?.createPost   || bundleCreatePost;
  const resolveMicrositeUrl = depsOverride?.resolveMicrositeUrl || resolvePublishedMicrositeUrl;
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
      .select("role, subscription_status, is_beta, beta_expires_at")
      .eq("id", authUser.id)
      .maybeSingle();
    if (agentErr) {
      console.error("[social-post] agent lookup error:", agentErr);
      return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
    }
    if (!agentRow) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (agentRow.role !== "admin" && !hasFeatureAccess(agentRow)) {
      return res.status(402).json({ error: "subscription_required" });
    }

    // ── 2. Validate request body ──
    const body = req.body || {};
    const { contentId } = body;
    if (!contentId || typeof contentId !== "string") {
      return res.status(400).json({ error: "contentId is required" });
    }

    // Platform — default instagram. Validated against the DB CHECK vocabulary.
    const platform = body.platform === undefined || body.platform === null
      ? DEFAULT_PLATFORM
      : body.platform;
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${ALLOWED_PLATFORMS.join(", ")}` });
    }
    const isFacebook = platform === "facebook";
    const isLinkedIn = platform === "linkedin";

    // Per-platform image policy:
    //   • Instagram requires client-supplied imageUrls (the composed carousel).
    //   • Facebook builds its album server-side, so imageUrls is ignored for FB.
    //   • LinkedIn (MVP) allows text-only OR a single image. We deliberately
    //     reject >1 here so the post path can't be used to push an unbuilt IG
    //     carousel through the LinkedIn flow before the LinkedIn-native
    //     composition is designed.
    let clientImageUrls = null;
    if (isFacebook) {
      // handled below — server resolves the album from photo_labels
    } else if (isLinkedIn) {
      const imageUrls = body.imageUrls;
      if (imageUrls === undefined || imageUrls === null) {
        clientImageUrls = []; // text-only post
      } else {
        if (!Array.isArray(imageUrls)) {
          return res.status(400).json({ error: "imageUrls must be an array (LinkedIn allows 0 or 1)" });
        }
        if (imageUrls.length > 1) {
          return res.status(400).json({ error: "LinkedIn currently supports at most 1 image per post" });
        }
        for (const url of imageUrls) {
          if (!isAllowedStorageUrl(url)) {
            return res.status(400).json({ error: "imageUrls must be public Supabase Storage URLs for this project" });
          }
        }
        clientImageUrls = imageUrls;
      }
    } else {
      const imageUrls = body.imageUrls;
      if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ error: "imageUrls must be a non-empty array" });
      }
      if (imageUrls.length > MAX_IMAGES) {
        return res.status(400).json({ error: `too many images (max ${MAX_IMAGES})` });
      }
      for (const url of imageUrls) {
        if (!isAllowedStorageUrl(url)) {
          return res.status(400).json({ error: "imageUrls must be public Supabase Storage URLs for this project" });
        }
      }
      clientImageUrls = imageUrls;
    }

    // LinkedIn requires the agent to choose a target channel (personal profile
    // or admined company page) at post time. Bundle's /post/ doesn't take an
    // account selector — instead we call POST /social-account/set-channel
    // BEFORE /post/, and the channelId is also persisted to the connection row
    // as the sticky default. Validate it here so the rest of the flow can
    // trust its presence.
    let linkedInChannelId = null;
    if (isLinkedIn) {
      const cid = body.channelId;
      if (typeof cid !== "string" || !cid.trim()) {
        return res.status(400).json({ error: "channelId is required for LinkedIn — pick a target channel" });
      }
      linkedInChannelId = cid.trim();
    }

    // ── 2b. Resolve the effective postDate (immediate vs scheduled) ──
    const nowMs = now().getTime();
    const earliestMs = nowMs + SCHEDULE_BUFFER_MS;
    let effectivePostDate;

    if (body.postDate === undefined || body.postDate === null) {
      effectivePostDate = new Date(earliestMs).toISOString();
    } else {
      if (typeof body.postDate !== "string") {
        return res.status(400).json({ error: "postDate must be an ISO 8601 string" });
      }
      const parsedMs = Date.parse(body.postDate);
      if (Number.isNaN(parsedMs)) {
        return res.status(400).json({ error: "postDate is not a valid date" });
      }
      if (parsedMs < earliestMs) {
        return res.status(400).json({
          error: `postDate must be at least ${Math.round(SCHEDULE_BUFFER_MS / 60000)} minutes in the future`,
        });
      }
      effectivePostDate = new Date(parsedMs).toISOString();
    }

    // ── 3. Require a connected account for this platform (agent_platform_connections) ──
    // bundle_channel_id is meaningful only for linkedin (sticky default channel).
    const { data: conn, error: connErr } = await supabase
      .from("agent_platform_connections")
      .select("bundle_team_id, connection_status, bundle_channel_id")
      .eq("agent_id", authUser.id)
      .eq("platform", platform)
      .maybeSingle();
    if (connErr) {
      console.error("[social-post] connection lookup error:", connErr);
      return res.status(500).json({ error: "connection lookup failed", details: connErr.message });
    }
    if (!conn || !conn.bundle_team_id || conn.connection_status !== "connected") {
      return res.status(409).json({ error: `${platformDisplay(platform)} not connected` });
    }
    const teamId = conn.bundle_team_id;

    // ── 4. Load + ownership-check the generated content (+ listing_id for FB) ──
    const { data: content, error: contentErr } = await supabase
      .from("generated_content")
      .select("id, agent_id, listing_id, caption")
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

    // ── 4b. Resolve the album (IG: client carousel; FB: server-built from raw photos) ──
    let imageUrls = clientImageUrls;
    if (isFacebook) {
      const { data: photoLabels, error: plErr } = await supabase
        .from("photo_labels")
        .select("*")
        .eq("listing_id", content.listing_id)
        .order("sort_order", { ascending: true });
      if (plErr) {
        console.error("[social-post] photo_labels fetch error:", plErr);
        return res.status(500).json({ error: "could not load listing photos", details: plErr.message });
      }
      // Album resolution. PREFERRED: the agent's EXPLICIT ordered album
      // (albumPhotoUrls) — their final selection from the result-panel editor.
      // Each URL must pass the host allowlist AND belong to THIS listing's
      // classified photos (photo_labels.photo_url) — only the listing's own
      // analyzed photos can post. De-duped, order preserved.
      // FALLBACK (back-compat): no album → curated default + legacy extraPhotoUrls.
      const listingUrlSet = new Set((photoLabels || []).map((l) => l && l.photo_url).filter(Boolean));
      if (Array.isArray(body.albumPhotoUrls) && body.albumPhotoUrls.length > 0) {
        const seen = new Set();
        const out = [];
        for (const u of body.albumPhotoUrls) {
          if (typeof u === "string" && !seen.has(u) && isAllowedStorageUrl(u) && listingUrlSet.has(u)) {
            seen.add(u);
            out.push(u);
          }
        }
        imageUrls = out;
      } else {
        const extraPhotoUrls = Array.isArray(body.extraPhotoUrls) ? body.extraPhotoUrls : [];
        imageUrls = buildFacebookAlbum(photoLabels, extraPhotoUrls);
      }
      // NO-PHOTOS GUARD: the album is built from CLASSIFIED photos (photo_labels).
      // If a listing has none usable, we do NOT send a bare text-only Facebook
      // post — block with an actionable message so the agent runs photo analysis
      // first. We deliberately do NOT auto-classify inline here (vision calls
      // risk the serverless timeout); auto-classify-on-delivery is future work.
      if (imageUrls.length === 0) {
        return res.status(409).json({
          error: "This listing's photos haven't been analyzed yet — run photo analysis on the listing before posting to Facebook.",
          code: "no_photos",
        });
      }
    }

    // ── 4c. Resolve the post caption ──
    // FB + LinkedIn: substitute the microsite token with the LIVE url
    // (or drop the line). IG: caption verbatim (no token in IG captions).
    let text = typeof content.caption === "string" ? content.caption : "";
    if (isFacebook || isLinkedIn) {
      const liveUrl = await resolveMicrositeUrl(supabase, content.listing_id);
      text = substituteMicrositeToken(text, liveUrl);
    }

    // ── 4d. Open a tracking row (pending) for this attempt ──
    let trackingId = null;
    {
      const { data: tracked, error: insErr } = await supabase
        .from("social_posts")
        .insert({
          agent_id:      authUser.id,
          content_id:    contentId,
          image_urls:    imageUrls,
          status:        "pending",
          scheduled_for: effectivePostDate,
          platform,
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

    // ── 5. Ingest each image into bundle, preserving order (skipped if no media) ──
    const UPLOAD_CONCURRENCY = 3;
    const uploadIds = new Array(imageUrls.length);
    if (imageUrls.length > 0) {
      try {
        let nextIndex = 0;
        const worker = async () => {
          for (let i = nextIndex++; i < imageUrls.length; i = nextIndex++) {
            const upload = await createUpload({ teamId, url: imageUrls[i] });
            uploadIds[i] = upload.id;
          }
        };
        const workerCount = Math.min(UPLOAD_CONCURRENCY, imageUrls.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
      } catch (e) {
        console.error("[social-post] bundle upload failed:", e?.status, e?.message);
        await markFailed(`could not upload images to ${platformDisplay(platform)} provider`);
        return res.status(502).json({ error: `could not upload images to ${platformDisplay(platform)} provider`, details: e?.message });
      }
    }

    // ── 5b. LinkedIn channel binding note ──────────────────────────────
    // We do NOT call /social-account/set-channel here. bundle.social's
    // set-channel is a one-shot BIND used at the OAuth-portal step;
    // calling it on an already-bound LinkedIn account returns:
    //   400 "This team already has a Linkedin account connected. Please
    //        disconnect it first."
    // (Observed verbatim from bundle on the preview deploy, 2026-06-22.)
    // Bundle pairs it with /social-account/unset-channel for switching,
    // but unset is disconnect-shaped — it would force the agent through
    // a reconnect on every target change. Until we verify a runtime
    // switch path, the post goes to whatever channel is CURRENTLY
    // ACTIVE on the agent's bundle connection (chosen at connect time).
    // The UI surfaces which channel is active and offers a "reconnect
    // to switch" affordance for the others. The chosen
    // `linkedInChannelId` is still validated above and persisted below
    // as the sticky preference so the picker remembers it across visits.
    void linkedInChannelId; // referenced for clarity; not sent to bundle here

    // ── 6. Create the post (immediate or scheduled) ──
    let post;
    try {
      post = await createPost({
        teamId,
        title: `Milestone ${platformDisplay(platform)} · ${effectivePostDate.slice(0, 10)}`, // bundle dashboard label, NOT the caption
        postDate: effectivePostDate,
        status: "SCHEDULED", // no publish-now status; immediate = SCHEDULED at now+buffer
        text,
        uploadIds,
        platform,
      });
    } catch (e) {
      console.error("[social-post] bundle create-post failed:", e?.status, e?.message);
      await markFailed(`could not create ${platformDisplay(platform)} post`);
      return res.status(502).json({ error: `could not create ${platformDisplay(platform)} post`, details: e?.message });
    }

    // ── 6b. LinkedIn: persist the chosen channel as the sticky default. ────
    // Best-effort — the post already succeeded; a failure to write the sticky
    // default just means the next visit won't pre-pick this target. Don't
    // surface the error to the caller.
    if (isLinkedIn && linkedInChannelId && conn.bundle_channel_id !== linkedInChannelId) {
      const { error: stickyErr } = await supabase
        .from("agent_platform_connections")
        .update({ bundle_channel_id: linkedInChannelId, updated_at: new Date().toISOString() })
        .eq("agent_id", authUser.id)
        .eq("platform", "linkedin");
      if (stickyErr) console.error("[social-post] sticky channel persist failed (continuing):", stickyErr);
    }

    // ── 7. Record success ──
    if (trackingId) {
      const { error: okErr } = await supabase
        .from("social_posts")
        .update({ status: "submitted", bundle_post_id: post.id, updated_at: new Date().toISOString() })
        .eq("id", trackingId);
      if (okErr) console.error("[social-post] tracking success-update error:", okErr);
    }

    return res.status(200).json({
      trackingId,
      postId: post.id,
      status: post.status || "SCHEDULED",
      scheduledFor: effectivePostDate,
    });
  } catch (err) {
    console.error("[social-post] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
