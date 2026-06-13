// Shared microsite-link helpers for the Facebook content + posting flow.
//
// The Facebook microsite link is NOT baked as a live URL at generation time —
// instead a stable PLACEHOLDER TOKEN is inserted at the link slot (after the
// CTA lead-in, before the trailing hashtag block). The live URL is substituted
//   • at DISPLAY time (Content tab) — for show/copy, and
//   • at POST time (api/social-post.js FB path) — the authoritative substitution
//     just before the caption is sent to bundle.
// This way a microsite published (or retired) AFTER generation is reflected at
// post time, instead of freezing a generation-time snapshot into the caption.
//
// Shared by api/content-generate.js (insert token) and api/social-post.js
// (re-resolve + substitute). Kept in api/_lib so it is not a deployable route.

// Public host that fronts published microsite pages (/p/{slug}). THE single
// source of truth for the app base across the backend — every other api/* file
// imports this rather than re-declaring its own literal. Env-overridable
// (PUBLIC_APP_BASE) with the production host as the default, so with no env var
// set the value is byte-for-byte identical to the previous hardcoded literal.
export const PUBLIC_APP_BASE =
  process.env.PUBLIC_APP_BASE || "https://app.milestonemediaphotography.com";

// Stable sentinel inserted at the microsite-link slot in a Facebook caption.
// Distinct, URL-unsafe, and unlikely to collide with model text. Always sits
// alone on its own line (inserted as "\n" + token).
export const MICROSITE_TOKEN = "[[MILESTONE_MICROSITE_URL]]";

/**
 * Resolve the LIVE published microsite URL for a listing, or null when none.
 *
 * The listing↔microsite join: api/publish-microsite.js additively mirrors each
 * published microsite into a public.listings row and sets microsites.listing_id
 * back to it, so the reverse lookup finds the microsite that produced the
 * listing the Content tab shows. LIVE = published = true AND retired_at IS NULL
 * (migration 038). The mirror is best-effort, so this can legitimately return
 * null (mirror failed at publish, or the listing wasn't microsite-sourced).
 * listing_id is not unique on microsites → take the most recently created live one.
 */
export async function resolvePublishedMicrositeUrl(supabase, listingId) {
  if (!listingId) return null;
  const { data, error } = await supabase
    .from("microsites")
    .select("slug")
    .eq("listing_id", listingId)
    .eq("published", true)
    .is("retired_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[microsite] lookup error (continuing without link):", error);
    return null;
  }
  return data?.slug ? `${PUBLIC_APP_BASE}/p/${data.slug}` : null;
}

/**
 * Append the microsite placeholder token to a caption, on its own line right
 * after the model's final CTA lead-in (which ends in a colon). The trailing
 * hashtag block is appended AFTER this by canonicalizeHashtags. No-ops if
 * caption isn't a non-empty string or already contains the token.
 */
export function appendMicrositeToken(caption) {
  if (typeof caption !== "string" || !caption) return caption;
  if (caption.includes(MICROSITE_TOKEN)) return caption;
  return caption.replace(/\s+$/, "") + "\n" + MICROSITE_TOKEN;
}

/**
 * Substitute the microsite token in a caption with the live URL:
 *   • url present → replace the token with the URL (the link line stays).
 *   • url null    → drop the token's entire line (the CTA lead-in remains, the
 *                   blank line + hashtags below are preserved).
 *   • no token (legacy pre-token captions) → returned unchanged.
 * Pure; safe to call on any caption.
 */
export function substituteMicrositeToken(caption, url) {
  if (typeof caption !== "string" || !caption.includes(MICROSITE_TOKEN)) return caption;
  if (url) return caption.split(MICROSITE_TOKEN).join(url);
  // Drop the token line: remove a leading newline + the token (how it was
  // inserted). Falls back to a bare token removal if no preceding newline.
  return caption.includes("\n" + MICROSITE_TOKEN)
    ? caption.split("\n" + MICROSITE_TOKEN).join("")
    : caption.split(MICROSITE_TOKEN).join("");
}
