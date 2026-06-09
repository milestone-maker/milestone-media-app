// ============================================================
// CANONICAL carousel-posting limits — single source of truth.
// ============================================================
// Isomorphic & PURE: imports nothing, touches no environment (no DB, fetch,
// React). Imported by BOTH
//   • the serverless endpoint  (api/social-post.js — backstop on imageUrls)
//   • the client UI            (src/views/Content/CarouselView.jsx — pre-post
//                               gate, and a node test of the pure check)
// so the UI gate and the server backstop can never disagree on the cap.

// Instagram's maximum images in a single carousel post. Raised from 10 to 20
// in 2024; bundle.social passes the post through to the IG Graph API, so this
// is the binding limit. Keep this the ONLY place the number lives.
export const INSTAGRAM_MAX_CAROUSEL_IMAGES = 20;

/**
 * The number of images a carousel WOULD compose to, without composing.
 * Mirrors carouselCompose.buildSlideSequence(): each source slide emits one
 * card, plus one photo when the slide has a photo_url. Keep in sync with that
 * sequence logic.
 *
 * @param {Array<{photo_url?: string}>} slides
 * @returns {number}
 */
export function carouselImageCount(slides) {
  if (!Array.isArray(slides)) return 0;
  return slides.reduce((n, s) => n + 1 + (s && s.photo_url ? 1 : 0), 0);
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
