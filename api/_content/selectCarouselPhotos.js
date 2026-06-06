// Pure, deterministic photo selection for the photo-driven walkthrough_carousel.
//
// Given a listing's photo_labels rows, returns an ordered selection ready for
// both prompt-building (deriving slide_subjects from the chosen rooms/features)
// and positional zipping (attaching photo_url onto the model's slides). No IO,
// no side effects — fully unit-testable.
//
// Selection rules (Stage 4 — required rooms, locked):
//   • Includable photo: agent_corrected === true (always), OR confidence >= 0.70.
//   • Best within a category: prefer agent_corrected, then highest confidence,
//     then lowest sort_order.
//   • COVER: best drone, else best front_facade, else null (caller falls back
//     to the listing/microsite hero_img). The cover's category is NOT repeated
//     as a subject slide.
//   • SUBJECT SLIDES: a FIXED required-room walk (no cap, no fill), best photo
//     per category in this exact order, skipping any room with no includable
//     photo:
//       front_facade (only when it is NOT the cover — i.e. when a drone covers,
//                     so the facade always appears: as cover without a drone,
//                     as the first beat with one),
//       living, kitchen, primary_bedroom, primary_bathroom,
//       backyard — ONLY when a pool is detected.
//     Exactly this set — dining and every non-listed category are excluded.
//   • POOL: case-insensitive substring "pool" in the features of ANY includable
//     photo for the listing.
//   • FINAL slide reuses the cover photo.

export const CAROUSEL_CATEGORY_ORDER = [
  "drone",
  "front_facade",
  "backyard",
  "living",
  "dining",
  "kitchen",
  "primary_bedroom",
  "primary_bathroom",
];

// Required subject rooms, in carousel order. backyard is appended conditionally
// (pool only). front_facade is skipped automatically when it is the cover.
const REQUIRED_SUBJECT_ORDER = [
  "front_facade",
  "living",
  "kitchen",
  "primary_bedroom",
  "primary_bathroom",
];

const CONFIDENCE_FLOOR = 0.7;

function includable(l) {
  if (!l || typeof l.photo_url !== "string" || !l.photo_url) return false;
  if (l.agent_corrected === true) return true;
  return typeof l.confidence === "number" && l.confidence >= CONFIDENCE_FLOOR;
}

// Best-first comparator within a category.
function bestFirst(a, b) {
  const corrected = (b.agent_corrected === true ? 1 : 0) - (a.agent_corrected === true ? 1 : 0);
  if (corrected) return corrected;
  const conf = (typeof b.confidence === "number" ? b.confidence : -Infinity)
             - (typeof a.confidence === "number" ? a.confidence : -Infinity);
  if (conf) return conf;
  return (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity);
}

const keyOf = (l) => (l.id != null ? `id:${l.id}` : `url:${l.photo_url}`);

// True when any includable photo's features mention a pool (free-text signal).
function hasPool(labels) {
  return labels.some(
    (l) =>
      Array.isArray(l.features) &&
      l.features.some((f) => typeof f === "string" && /pool/i.test(f))
  );
}

/**
 * @param {Array<object>} photoLabels  rows from public.photo_labels
 * @returns {{
 *   coverPhoto: { photo_url: string, category: string } | null,
 *   subjectSlides: Array<{ photo_url: string, category: string, features: string[] }>,
 *   finalPhotoUrl: string | null,
 * }}
 */
export function selectCarouselPhotos(photoLabels) {
  const labels = Array.isArray(photoLabels) ? photoLabels.filter(includable) : [];

  // Group by category (only the carousel categories; 'other'/unlisted dropped).
  const byCat = new Map(CAROUSEL_CATEGORY_ORDER.map((c) => [c, []]));
  for (const l of labels) {
    if (byCat.has(l.category)) byCat.get(l.category).push(l);
  }
  for (const c of CAROUSEL_CATEGORY_ORDER) byCat.get(c).sort(bestFirst);

  // COVER: best drone, else best front_facade, else null.
  let coverRow = null;
  let coverCategory = null;
  if (byCat.get("drone").length) { coverRow = byCat.get("drone")[0]; coverCategory = "drone"; }
  else if (byCat.get("front_facade").length) { coverRow = byCat.get("front_facade")[0]; coverCategory = "front_facade"; }

  const used = new Set();
  if (coverRow) used.add(keyOf(coverRow));

  // Required-room subject walk: best per category in order, skip empties.
  // backyard appended only when a pool is detected. front_facade is skipped
  // when it is the cover (so it appears exactly once — as cover or first beat).
  const subjectOrder = hasPool(labels)
    ? [...REQUIRED_SUBJECT_ORDER, "backyard"]
    : REQUIRED_SUBJECT_ORDER;

  const subjectSlides = [];
  for (const cat of subjectOrder) {
    if (cat === coverCategory) continue; // facade-as-cover isn't repeated
    const top = byCat.get(cat).find((l) => !used.has(keyOf(l)));
    if (top) {
      used.add(keyOf(top));
      subjectSlides.push({
        photo_url: top.photo_url,
        category: cat,
        features: Array.isArray(top.features) ? top.features : [],
      });
    }
  }

  return {
    coverPhoto: coverRow ? { photo_url: coverRow.photo_url, category: coverCategory } : null,
    subjectSlides,
    finalPhotoUrl: coverRow ? coverRow.photo_url : null,
  };
}

export default selectCarouselPhotos;
