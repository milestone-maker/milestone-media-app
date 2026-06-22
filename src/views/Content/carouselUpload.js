// Client-side compose-and-store for the carousel posting flow (Stage 2b).
//
// Bridges the in-browser compositor (carouselCompose.js) to the server posting
// endpoint (api/social-post.js): it composes the carousel images, uploads each
// to the public `carousel-posts` Storage bucket, and returns the ordered list
// of PUBLIC URLs. Those URLs are what /api/social-post receives and hands to
// bundle.social's /upload/from-url. (Option C — store-first.)
//
// Upload pattern mirrors App.jsx / VoiceProfileModal:
//   supabase.storage.from(bucket).upload(path, blob, { contentType, upsert })
//   supabase.storage.from(bucket).getPublicUrl(path)
//
// Object path: carousel-posts/{agentId}/{contentId}/{NN_card.png|NN_photo.jpg}
//   • first segment = agentId → satisfies the bucket's own-folder RLS policy
//   • upsert:true → re-posting the same content overwrites, never duplicates
//
// composeCarousel and the supabase client are INJECTABLE (deps override) so
// tests run without a real canvas or network.

// NOTE: explicit .js extensions (Vite resolves these fine) so this module is
// importable under raw Node for the standalone test runner, like api/ modules.
import { supabase } from "../../supabaseClient.js";
import { composeCarousel as defaultComposeCarousel } from "./carouselCompose.js";

export const CAROUSEL_BUCKET = "carousel-posts";

/**
 * Compose the carousel and upload every slide image to public Storage, in
 * order. Returns the ordered array of public URLs (one per composed slide).
 *
 * Throws on any failure (missing ids, nothing composed, or any upload/url
 * error) — never returns a partial list, so the caller can trust a resolved
 * value as a complete, ordered set.
 *
 * @param {object} args
 * @param {Array}  args.slides        carousel slides (same as composeCarousel)
 * @param {object} [args.stats]
 * @param {object} [args.footer]
 * @param {object} [args.brandTokens]
 * @param {string} args.agentId       owning agent id (must equal auth.uid())
 * @param {string} args.contentId     generated_content id (groups the images)
 * @param {object} [deps]             test seam
 * @param {Function} [deps.composeCarousel]
 * @param {object}   [deps.supabase]
 * @returns {Promise<string[]>} ordered public URLs
 */
export async function composeAndUploadCarousel(
  { slides, stats, footer, brandTokens, agentId, contentId, platform = "instagram" } = {},
  deps = {}
) {
  const compose = deps.composeCarousel || defaultComposeCarousel;
  const sb       = deps.supabase || supabase;

  if (!agentId)   throw new Error("agentId is required to upload carousel images");
  if (!contentId) throw new Error("contentId is required to upload carousel images");

  const files = await compose({ slides, stats, footer, brandTokens, platform });
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Nothing to upload — no slides composed.");
  }

  const urls = [];
  for (const file of files) {
    const path = `${agentId}/${contentId}/${file.name}`;
    const { error: upErr } = await sb.storage
      .from(CAROUSEL_BUCKET)
      .upload(path, file.blob, { contentType: file.blob?.type, upsert: true });
    if (upErr) {
      throw new Error(`Failed to upload carousel image ${file.name}: ${upErr.message || upErr}`);
    }

    const { data } = sb.storage.from(CAROUSEL_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      throw new Error(`Could not get a public URL for ${file.name}`);
    }
    urls.push(data.publicUrl);
  }

  return urls;
}
