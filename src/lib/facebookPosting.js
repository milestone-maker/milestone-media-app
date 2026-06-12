// Pure, DOM-free helpers for the Facebook post/schedule control. Importable by
// both the React FB post bar and node tests (mirrors src/lib/postScheduling.js).
//
// The Facebook flow is much simpler than Instagram's: the client does NOT
// composite or upload anything — it just POSTs the content id + platform + an
// optional postDate, and the SERVER builds the photo album and re-resolves the
// microsite link. These helpers build that request body and interpret the
// response, so the UI logic stays testable without a browser.

import { centralWallClockToUtcIso, SCHEDULE_BUFFER_MS } from "./postScheduling.js";

/**
 * Build the POST /api/social-post request body for a Facebook post.
 *
 * @param {object} args
 * @param {string} args.contentId       generated_content id
 * @param {'now'|'schedule'|'smart'} args.mode
 * @param {string} [args.scheduleLocal] datetime-local value (Central wall clock) for mode 'schedule'
 * @param {{postDate:string,label:string}|null} [args.smartSlot] for mode 'smart'
 * @param {string[]} [args.extraPhotoUrls] agent-selected extra photo URLs to append to the album
 * @param {Date}   [args.now]           injectable clock (tests)
 * @returns {{ body: object } | { error: string }}
 */
export function buildFacebookPostRequest({ contentId, mode, scheduleLocal, smartSlot, extraPhotoUrls = [], now = new Date() } = {}) {
  if (!contentId) return { error: "Missing content to post." };
  const base = { contentId, platform: "facebook" };
  // Agent-added album photos (beyond the curated default set). Only attach when
  // non-empty so the absent case is byte-identical to the original request.
  if (Array.isArray(extraPhotoUrls) && extraPhotoUrls.length > 0) base.extraPhotoUrls = extraPhotoUrls;

  if (mode === "now") return { body: base };

  if (mode === "schedule") {
    const iso = centralWallClockToUtcIso(scheduleLocal);
    if (!iso) return { error: "Pick a date and time to schedule." };
    if (new Date(iso).getTime() < now.getTime() + SCHEDULE_BUFFER_MS) {
      return { error: "Pick a time a few minutes from now or later." };
    }
    return { body: { ...base, postDate: iso } };
  }

  if (mode === "smart") {
    if (!smartSlot?.postDate) return { error: "No recommended time available right now — pick one manually." };
    return { body: { ...base, postDate: smartSlot.postDate } };
  }

  return { error: "Choose how you'd like to post." };
}

/**
 * Interpret the /api/social-post response into a UI outcome.
 *
 * @param {number} status  HTTP status
 * @param {object} body    parsed JSON body (may be {})
 * @returns {{ kind: 'success'|'blocked'|'conflict'|'error', message?: string, scheduledFor?: string|null, postId?: string|null }}
 */
export function interpretFacebookPostResponse(status, body) {
  if (status === 200) {
    return { kind: "success", scheduledFor: body?.scheduledFor || null, postId: body?.postId || null };
  }
  // No-photos guard — actionable, distinct from a generic failure.
  if (status === 409 && body?.code === "no_photos") {
    return { kind: "blocked", message: body?.error || "This listing's photos haven't been analyzed yet — run photo analysis before posting to Facebook." };
  }
  // Other 409s (e.g. not connected) — surface the server message.
  if (status === 409) {
    return { kind: "conflict", message: typeof body?.error === "string" ? body.error : "This can't be posted right now." };
  }
  const msg = typeof body?.error === "string" ? body.error : `Couldn't post (${status}).`;
  return { kind: "error", message: msg };
}
