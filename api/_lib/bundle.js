// bundle.social API adapter (Stage 1 — agent connection flow).
//
// Single place that talks to api.bundle.social. The org-level API key is a
// server-side secret read ONLY here as process.env.BUNDLE_API_KEY and sent as
// the `x-api-key` header (bundle's auth scheme — confirmed against the live
// OpenAPI at /swagger-json, securityScheme ApiKeyAuth: { in: header, name:
// x-api-key }). The key value never appears in code and is added separately
// in the Vercel dashboard.
//
// Provider-swappable by design, matching api/_lib/mortgageRates.js: callers
// use the three named functions (createTeam / createPortalLink /
// getSocialAccountByType) and never construct bundle URLs themselves.
//
// Endpoints used (base https://api.bundle.social, all x-api-key auth):
//   POST /api/v1/team/                          → create-team    → { id, name, ... }
//   POST /api/v1/social-account/create-portal-link → { url }
//   GET  /api/v1/social-account/by-type?type=&teamId= → social account | null
//
// The leading underscore on the parent folder marks this as a private helper,
// not a deployable Vercel function.

import { INSTAGRAM_MAX_CAROUSEL_IMAGES } from "../../shared/carouselPosting.js";

const BUNDLE_API_BASE = "https://api.bundle.social/api/v1";

// App platform slug → bundle social-account type. bundle's account-type enum is
// upper-cased network names (confirmed against the live OpenAPI for INSTAGRAM;
// FACEBOOK/THREADS follow the same convention). Centralised here so the connect
// + status endpoints never hardcode a bundle type — they speak app slugs and let
// the adapter translate. Facebook Stage 1 adds 'facebook'; 'threads' is listed
// as a forward hook for the later Threads stage.
export const PLATFORM_TO_BUNDLE_TYPE = {
  instagram: "INSTAGRAM",
  facebook:  "FACEBOOK",
  threads:   "THREADS",
  linkedin:  "LINKEDIN",
};

/**
 * Translate an app platform slug ('instagram'|'facebook'|'threads') to its
 * bundle social-account type ('INSTAGRAM'|'FACEBOOK'|'THREADS'). Throws a
 * BundleApiError on an unknown slug so a bad value fails fast at the adapter
 * boundary rather than reaching bundle.
 *
 * @param {string} platform
 * @returns {string} bundle account type
 */
export function platformToBundleType(platform) {
  const type = PLATFORM_TO_BUNDLE_TYPE[String(platform || "").toLowerCase()];
  if (!type) throw new BundleApiError(`unsupported platform: ${platform}`, { status: 0 });
  return type;
}

/**
 * Error thrown by bundleFetch on a non-OK response. Carries the HTTP status
 * and the parsed/raw bundle error body so callers can map to their own codes.
 */
export class BundleApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "BundleApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Low-level bundle.social request. Sets the x-api-key header from
 * process.env.BUNDLE_API_KEY, sends/parses JSON, and normalizes failures into
 * a BundleApiError. A `fetchImpl` override seam lets unit tests inject a mock
 * without a real key or network.
 *
 * @param {string} path        path under /api/v1 (e.g. "/team/")
 * @param {object} [opts]
 * @param {string} [opts.method="GET"]
 * @param {object} [opts.body]            JSON body (omitted for GET)
 * @param {string} [opts.apiKey]          override the env key (tests)
 * @param {typeof fetch} [opts.fetchImpl] override fetch (tests)
 * @returns {Promise<any>} parsed JSON response body
 */
export async function bundleFetch(path, { method = "GET", body, apiKey, fetchImpl } = {}) {
  const key = apiKey || process.env.BUNDLE_API_KEY;
  if (!key) throw new BundleApiError("BUNDLE_API_KEY is not set", { status: 0 });

  const doFetch = fetchImpl || fetch;
  const url = `${BUNDLE_API_BASE}${path}`;

  const init = {
    method,
    headers: {
      "x-api-key": key,
      "Accept": "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await doFetch(url, init);
  } catch (err) {
    throw new BundleApiError(`bundle request failed: ${err?.message || err}`, { status: 0 });
  }

  const text = await res.text().catch(() => "");
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }

  if (!res.ok) {
    const msg = (parsed && parsed.message) || res.statusText || `HTTP ${res.status}`;
    throw new BundleApiError(`bundle ${method} ${path} failed: ${res.status} ${msg}`, {
      status: res.status,
      body: parsed,
    });
  }

  return parsed;
}

/**
 * Create a bundle team for an agent. Returns the created team. bundle does NOT
 * dedupe by name, so idempotency is the caller's responsibility — only call
 * this when the agent has no stored bundle_team_id.
 *
 * @param {{ name: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createTeam({ name, fetchImpl, apiKey } = {}) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 3) throw new BundleApiError("team name must be at least 3 characters", { status: 0 });
  // bundle caps team name at 80 chars.
  const safeName = trimmed.slice(0, 80);
  const team = await bundleFetch("/team/", { method: "POST", body: { name: safeName }, fetchImpl, apiKey });
  if (!team || !team.id) throw new BundleApiError("bundle create-team returned no team id", { status: 502, body: team });
  return team;
}

/**
 * Create a hosted portal link the agent opens to connect a social account.
 * `redirectUrl` is where bundle returns the agent after the portal flow.
 *
 * Platform selection (back-compatible):
 *   • `platforms` — app slugs (['facebook'], ['instagram',...]). When supplied,
 *     they are translated to bundle types via platformToBundleType. This is the
 *     preferred input so callers speak app slugs, not bundle types.
 *   • `socialAccountTypes` — raw bundle types. Honoured when `platforms` is
 *     absent. Defaults to ["INSTAGRAM"] so existing Instagram callers that pass
 *     neither argument behave exactly as before.
 *
 * @param {{ teamId: string, redirectUrl?: string, platforms?: string[], socialAccountTypes?: string[], fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<string>} the portal URL
 */
export async function createPortalLink({ teamId, redirectUrl, platforms, socialAccountTypes = ["INSTAGRAM"], fetchImpl, apiKey } = {}) {
  if (!teamId) throw new BundleApiError("teamId is required for create-portal-link", { status: 0 });
  const types = Array.isArray(platforms) && platforms.length
    ? platforms.map(platformToBundleType)
    : socialAccountTypes;
  const body = { teamId, socialAccountTypes: types };
  if (redirectUrl) body.redirectUrl = redirectUrl;
  const out = await bundleFetch("/social-account/create-portal-link", { method: "POST", body, fetchImpl, apiKey });
  if (!out || !out.url) throw new BundleApiError("bundle create-portal-link returned no url", { status: 502, body: out });
  return out.url;
}

/**
 * Fetch a team's connected social account of a given type. Returns the account
 * object (with username/displayName) when connected, or null when none exists.
 * bundle returns 404 for "no such account" — treated here as null, not error.
 *
 * @param {{ teamId: string, type?: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, username?: string|null, displayName?: string|null }|null>}
 */
export async function getSocialAccountByType({ teamId, type = "INSTAGRAM", fetchImpl, apiKey } = {}) {
  if (!teamId) throw new BundleApiError("teamId is required for by-type lookup", { status: 0 });
  const qs = `?type=${encodeURIComponent(type)}&teamId=${encodeURIComponent(teamId)}`;
  try {
    const acct = await bundleFetch(`/social-account/by-type${qs}`, { method: "GET", fetchImpl, apiKey });
    // bundle may return null / empty for "not connected".
    return acct && acct.id ? acct : null;
  } catch (err) {
    if (err instanceof BundleApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Set the active channel on a social account that exposes multiple posting
 * targets under ONE connection (LinkedIn personal profile + admined company
 * pages; also relevant for FB Pages, IG with multiple Business accounts, and
 * YouTube channels). bundle resolves the per-channel target on the next /post/
 * from whatever channel is currently active — so for LinkedIn we call this
 * immediately before createPost when the agent picks a target.
 *
 * Endpoint: POST /api/v1/social-account/set-channel
 * Body:    { type, teamId, channelId }
 * bundle's swagger description (verbatim): "Needed only for some social account
 * types - Youtube, Instagram, Facebook and Linkedin."
 *
 * `type` is a bundle account type (e.g. "LINKEDIN") — callers pass either that
 * directly or an app slug via platformToBundleType. For app-slug ergonomics
 * symmetric with createPost, this helper accepts a `platform` slug as an
 * alternative; it translates internally so call sites stay slug-friendly.
 *
 * @param {{ teamId: string, channelId: string, type?: string, platform?: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<any>} bundle's updated social-account response
 */
export async function setChannel({ teamId, channelId, type, platform, fetchImpl, apiKey } = {}) {
  if (!teamId)    throw new BundleApiError("teamId is required for set-channel", { status: 0 });
  if (!channelId) throw new BundleApiError("channelId is required for set-channel", { status: 0 });
  const bundleType = type || (platform ? platformToBundleType(platform) : null);
  if (!bundleType) throw new BundleApiError("type or platform is required for set-channel", { status: 0 });
  return bundleFetch("/social-account/set-channel", {
    method: "POST",
    body: { type: bundleType, teamId, channelId },
    fetchImpl,
    apiKey,
  });
}

// ── Posting (Stage 2) ────────────────────────────────────────────────

/**
 * Ingest a publicly-reachable image URL into bundle's media library. bundle
 * fetches the URL server-side and returns an upload record whose `id` is later
 * referenced by createPost. The caller is responsible for ensuring `url` is a
 * trusted, public URL (the api/social-post endpoint restricts these to this
 * project's Supabase Storage public host).
 *
 * @param {{ teamId: string, url: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, url?: string|null, type?: string }>} the upload record
 */
export async function createUploadFromUrl({ teamId, url, fetchImpl, apiKey } = {}) {
  if (!url) throw new BundleApiError("url is required for upload/from-url", { status: 0 });
  const body = { url };
  if (teamId) body.teamId = teamId;
  const upload = await bundleFetch("/upload/from-url", { method: "POST", body, fetchImpl, apiKey });
  if (!upload || !upload.id) throw new BundleApiError("bundle upload/from-url returned no id", { status: 502, body: upload });
  return upload;
}

/**
 * Create a post for the team's connected account on `platform`, targeting by
 * team + type (no socialAccountId needed). Both Instagram and Facebook use the
 * same `data.<TYPE> = { type:"POST", text, uploadIds }` shape — confirmed
 * against bundle's live OpenAPI (POST /api/v1/post/): data.FACEBOOK accepts
 * type (POST|REEL|STORY), text, uploadIds[], plus optional mediaItems/link/etc.
 * An Instagram CAROUSEL or a Facebook ALBUM is a type:"POST" with multiple
 * ordered uploadIds. For Facebook the microsite link rides INSIDE the caption
 * text (the album is the media), so no separate `link` field is set.
 *
 * `postDate` and `status` are parameters so scheduling reuses this by passing a
 * future ISO date with status "SCHEDULED". bundle's status enum is
 * ["DRAFT","SCHEDULED"] — there is NO "publish now" status, so IMMEDIATE
 * publishing = status "SCHEDULED" with postDate ≈ now (the caller decides).
 *
 * @param {{ teamId: string, title: string, postDate: string, status?: string, text: string, uploadIds: string[], platform?: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, status?: string }>} the created post
 */
export async function createPost({ teamId, title, postDate, status = "SCHEDULED", text, uploadIds, platform = "instagram", fetchImpl, apiKey } = {}) {
  if (!teamId) throw new BundleApiError("teamId is required for create-post", { status: 0 });
  const bundleType = platformToBundleType(platform); // INSTAGRAM / FACEBOOK / THREADS / LINKEDIN
  const isFacebook = bundleType === "FACEBOOK";
  const isLinkedIn = bundleType === "LINKEDIN";
  // Instagram REQUIRES media (≥1 upload). Facebook + LinkedIn allow text-only
  // posts (FB album path always sends media in practice; LinkedIn MVP supports
  // a single image OR pure text).
  if (!Array.isArray(uploadIds) || (uploadIds.length === 0 && !isFacebook && !isLinkedIn)) {
    throw new BundleApiError("uploadIds must be a non-empty array for create-post", { status: 0 });
  }
  const rawUploadIds = Array.isArray(uploadIds) ? uploadIds : [];
  // Belt-and-suspenders: bundle/IG cap carousel uploads at INSTAGRAM_MAX_CAROUSEL_IMAGES.
  // The pre-flight gate in shared/carouselPosting.js should already enforce this client-side;
  // this cap prevents a missed gate from producing a confusing 400 from bundle.
  const safeUploadIds = bundleType === "INSTAGRAM"
    ? rawUploadIds.slice(0, INSTAGRAM_MAX_CAROUSEL_IMAGES)
    : rawUploadIds;
  const body = {
    teamId,
    title: title || "Milestone carousel",
    postDate,
    status,
    socialAccountTypes: [bundleType],
    data: {
      [bundleType]: {
        type: "POST",
        text: text || "",
        uploadIds: safeUploadIds,
      },
    },
  };
  const post = await bundleFetch("/post/", { method: "POST", body, fetchImpl, apiKey });
  if (!post || !post.id) throw new BundleApiError("bundle create-post returned no id", { status: 502, body: post });
  return post;
}

/**
 * Delete a post by its bundle post id (DELETE /post/{id}). Used to cancel a
 * still-upcoming scheduled post before it fires. bundle returns no meaningful
 * body on success (often 204); bundleFetch throws a BundleApiError on any
 * non-2xx, which the caller maps to a clean message. Returns true on success.
 *
 * @param {{ postId: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<boolean>}
 */
export async function deletePost({ postId, fetchImpl, apiKey } = {}) {
  if (!postId) throw new BundleApiError("postId is required for delete-post", { status: 0 });
  await bundleFetch(`/post/${encodeURIComponent(postId)}`, { method: "DELETE", fetchImpl, apiKey });
  return true;
}
