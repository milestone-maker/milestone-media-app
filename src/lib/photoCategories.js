// Map a photo_labels.category enum value to a human display label, shared by
// the FB album preview (result panel + Post modal + lightbox). Pure + DOM-free
// so it's node-testable. The enum (migration 029) is:
//   front_facade, backyard, drone, living, dining, kitchen,
//   primary_bedroom, primary_bathroom, other
// Unknown/empty values fall back to a title-cased version of the slug (or a
// generic "Photo" when there's nothing usable).

const CATEGORY_LABELS = {
  drone:            "Drone",
  front_facade:     "Facade",
  backyard:         "Backyard",
  living:           "Living Room",
  dining:           "Dining Room",
  kitchen:          "Kitchen",
  primary_bedroom:  "Primary Bedroom",
  primary_bathroom: "Primary Bathroom",
  other:            "Photo",
};

/**
 * @param {string} category a photo_labels.category value
 * @returns {string} human label (title-cased fallback for unmapped, "Photo" when empty)
 */
export function categoryLabel(category) {
  if (typeof category === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) {
    return CATEGORY_LABELS[category];
  }
  if (typeof category === "string" && category.trim()) {
    return category.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Photo";
}

export { CATEGORY_LABELS };
