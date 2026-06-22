// ============================================================
// CANONICAL carousel-posting limits — single source of truth.
// ============================================================
// Isomorphic & PURE: imports nothing, touches no environment (no DB, fetch,
// React). Imported by BOTH
//   • the serverless endpoint  (api/social-post.js — backstop on imageUrls)
//   • the client UI            (src/views/Content/CarouselView.jsx — pre-post
//                               gate, and a node test of the pure check)
// so the UI gate and the server backstop can never disagree on the cap.

// Instagram's maximum images in a single carousel post. bundle.social enforces
// 10 at its create-post boundary (the IG Graph API's effective cap), returning
// a 400 "Max 10 upload(s) allowed" on data.INSTAGRAM.uploadIds. Keep this the
// ONLY place the number lives.
export const INSTAGRAM_MAX_CAROUSEL_IMAGES = 10;

/**
 * The number of images an Instagram carousel WOULD compose to, without
 * composing. Mirrors carouselCompose.buildSlideSequenceCombined(): one
 * combined photo+caption image per source slide. (The legacy split into
 * card + photo pairs is no longer used for Instagram.)
 *
 * @param {Array<{photo_url?: string}>} slides
 * @returns {number}
 */
export function carouselImageCount(slides) {
  if (!Array.isArray(slides)) return 0;
  return slides.length;
}

/**
 * Pure cap check for the would-be carousel. Returns whether it can be posted,
 * the computed image count, the cap, and a user-facing message when blocked.
 *
 * @param {Array} slides
 * @param {number} [cap=INSTAGRAM_MAX_CAROUSEL_IMAGES]
 * @returns {{ ok: boolean, count: number, cap: number, message: string }}
 */
export function checkCarouselImageCap(slides, cap = INSTAGRAM_MAX_CAROUSEL_IMAGES) {
  const count = carouselImageCount(slides);
  let message = "";
  if (count === 0) {
    message = "There are no slides to post.";
  } else if (count > cap) {
    message = `Instagram allows up to ${cap} images; this carousel has ${count} — trim it to post.`;
  }
  return { ok: count > 0 && count <= cap, count, cap, message };
}
