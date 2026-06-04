// Pure, deterministic photo selection for the photo-driven walkthrough_carousel.
//
// Given a listing's photo_labels rows, returns an ordered selection ready for
// both prompt-building (deriving slide_subjects from the chosen rooms/features)
// and positional zipping (attaching photo_url onto the model's slides). No IO,
// no side effects — fully unit-testable.
//
// Selection rules (locked):
//   • Includable photo: agent_corrected === true (always), OR confidence >= 0.70.
//   • Category order (cover candidates + subject order; 'other' excluded):
//       drone, front_facade, backyard, living, dining, kitchen,
//       primary_bedroom, primary_bathroom
//   • Best within a category: prefer agent_corrected, then highest confidence,
//     then lowest sort_order.
//   • COVER: best drone, else best front_facade, else null (caller falls back
//     to the listing/microsite hero_img). The cover's category is NOT repeated
//     as a subject slide.
//   • SUBJECT SLIDES: one best photo per present category in the locked order,
//     excluding the cover's category.
//   • FILL: if fewer than MAX_PHOTO_SLIDES subject slides, add additional
//     photos from the showcase categories (kitchen, living, backyard,
//     primary_bedroom — in that priority), one extra per category per pass
//     (round-robin), next-best by confidence, until MAX_PHOTO_SLIDES.
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

const SHOWCASE_FILL_PRIORITY = ["kitchen", "living", "backyard", "primary_bedroom"];
const CONFIDENCE_FLOOR = 0.7;
// Default subject-photo budget. Style B (statement-then-reveal) passes a smaller
// budget (~3) since each beat costs two carousel slots (card + photo); a future
// Style A can pass a larger one. Parameterized via opts.maxSubjects.
const MAX_PHOTO_SLIDES = 8;

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

/**
 * @param {Array<object>} photoLabels  rows from public.photo_labels
 * @returns {{
 *   coverPhoto: { photo_url: string, category: string } | null,
 *   subjectSlides: Array<{ photo_url: string, category: string, features: string[] }>,
 *   finalPhotoUrl: string | null,
 * }}
 */
export function selectCarouselPhotos(photoLabels, opts = {}) {
  const maxSubjects = Number.isInteger(opts.maxSubjects) && opts.maxSubjects >= 0
    ? opts.maxSubjects
    : MAX_PHOTO_SLIDES;
  const labels = Array.isArray(photoLabels) ? photoLabels.filter(includable) : [];

  // Group by category (only the eight carousel categories; 'other' dropped).
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

  // SUBJECT SLIDES: one best per present category in order, excluding cover cat,
  // up to the budget (maxSubjects).
  const subjectSlides = [];
  for (const cat of CAROUSEL_CATEGORY_ORDER) {
    if (subjectSlides.length >= maxSubjects) break;
    if (cat === coverCategory) continue;
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

  // FILL: round-robin over showcase categories, next-best each pass, until budget.
  if (subjectSlides.length > 0) {
    let added = true;
    while (subjectSlides.length < maxSubjects && added) {
      added = false;
      for (const cat of SHOWCASE_FILL_PRIORITY) {
        if (subjectSlides.length >= maxSubjects) break;
        const next = byCat.get(cat).find((l) => !used.has(keyOf(l)));
        if (next) {
          used.add(keyOf(next));
          subjectSlides.push({
            photo_url: next.photo_url,
            category: cat,
            features: Array.isArray(next.features) ? next.features : [],
          });
          added = true;
        }
      }
    }
  }

  // Hard cap (defensive; the loop already bounds it).
  if (subjectSlides.length > maxSubjects) subjectSlides.length = maxSubjects;

  return {
    coverPhoto: coverRow ? { photo_url: coverRow.photo_url, category: coverCategory } : null,
    subjectSlides,
    finalPhotoUrl: coverRow ? coverRow.photo_url : null,
  };
}

export default selectCarouselPhotos;
