// Maps a microsite's baked property_data (+ agent_id) → a public.listings
// payload. Shared by the publish endpoint (Stage A: publish also creates &
// links a listing) and Stage B's backfill, so the mapping lives in one place.
//
// In the target model a published microsite IS a listing (1:1). The microsite
// remains the source of truth; the listings row is an additive mirror that the
// Content tab reads (its query is scoped to listings by agent_id).
//
// Column types (public.listings, verified against the live schema):
//   beds                   integer   → parseInt, null when blank/non-numeric
//   baths                  numeric   → parseFloat (migration 026), null when blank
//   sqft, price            text      → passed through as-is
//   features, media_types  jsonb     → arrays passed through
//   address/city/neighborhood/description/hero_img/matterport_url/status  text
//
// property_data uses the snake_case keys baked by api/publish-microsite.js
// (address, city, price, beds, baths, sqft, description, features,
//  media_types, hero_img, matterport_url, …). neighborhood is not baked today,
// so it maps to null.

// Coerce a maybe-string ("4", "", null, "2500") into an integer or null.
// listings.beds is int4 — a non-numeric or blank value must become null
// rather than NaN (which Postgres would reject).
function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Coerce a maybe-string ("3.5", "5", "", null) into a number or null.
// listings.baths is numeric (migration 026 widened it from int4), so
// fractional baths must be preserved — parseFloat, not parseInt.
function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a public.listings insert/update payload from a microsite.
 *
 * Does NOT set id, created_at, or any link column — the caller decides
 * insert (add created_at) vs update (leave created_at untouched), and owns
 * the microsite.listing_id linkage.
 *
 * @param {object}  args
 * @param {object}  args.propertyData  microsite.property_data (baked snake_case)
 * @param {string}  args.agentId       microsite.agent_id (owner of the row)
 * @returns {object} listings column → value payload
 */
export function listingPayloadFromMicrosite({ propertyData, agentId }) {
  const pd = propertyData || {};
  return {
    agent_id:       agentId,
    address:        pd.address || null,
    city:           pd.city || null,
    price:          pd.price || null,
    beds:           toIntOrNull(pd.beds),
    baths:          toNumberOrNull(pd.baths),
    sqft:           pd.sqft || null,
    neighborhood:   pd.neighborhood || null,
    description:    pd.description || null,
    features:       Array.isArray(pd.features) ? pd.features : [],
    media_types:    Array.isArray(pd.media_types) ? pd.media_types : [],
    hero_img:       pd.hero_img || null,
    matterport_url: pd.matterport_url || null,
    // A published microsite is "Live" — a status StatusBadge already renders.
    status:         "Live",
  };
}
