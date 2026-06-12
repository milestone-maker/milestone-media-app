#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for src/lib/photoCategories.js (category → display label) and the
// FB album-labeling data path: the curated album (facebookAlbumUrls) mapped to
// per-photo category labels — exactly what the result-panel strip + Post modal
// render. DOM-free (React rendering + the lightbox open/close are verified on
// the preview; the repo has no jsdom harness).
//
//   node scripts/test-photo-categories.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATS = resolve(__dirname, "..", "src", "lib", "photoCategories.js");
const SEL  = resolve(__dirname, "..", "api", "_content", "selectCarouselPhotos.js");
const { categoryLabel } = await import(pathToFileURL(CATS).href);
const { facebookAlbumUrls } = await import(pathToFileURL(SEL).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

console.log("\n── photoCategories.categoryLabel ──\n");

// Every enum value (migration 029) → its mapped label.
const MAP = {
  drone: "Drone",
  front_facade: "Facade",
  backyard: "Backyard",
  living: "Living Room",
  dining: "Dining Room",
  kitchen: "Kitchen",
  primary_bedroom: "Primary Bedroom",
  primary_bathroom: "Primary Bathroom",
  other: "Photo",
};
for (const [cat, label] of Object.entries(MAP)) {
  check(`${cat} → "${label}"`, categoryLabel(cat) === label, categoryLabel(cat));
}

// Unmapped category → title-cased fallback.
check('unmapped "garage" → "Garage"', categoryLabel("garage") === "Garage");
check('unmapped "home_office" → "Home Office"', categoryLabel("home_office") === "Home Office");
check('unmapped "media-room" → "Media Room"', categoryLabel("media-room") === "Media Room");

// Empty / missing → generic "Photo".
check('"" → "Photo"', categoryLabel("") === "Photo");
check("null → \"Photo\"", categoryLabel(null) === "Photo");
check("undefined → \"Photo\"", categoryLabel(undefined) === "Photo");

console.log("\n── FB album labels (the data the strip + modal render) ──\n");
{
  const L = (category, url) => ({ id: url, listing_id: "x", photo_url: url, category, features: [], confidence: 0.95, agent_corrected: false, sort_order: 0 });
  const pool = [
    L("drone", "d"), L("front_facade", "f"), L("living", "l"), L("kitchen", "k"),
    L("primary_bedroom", "pb"), L("primary_bathroom", "ba"), L("backyard", "by"),
    L("dining", "dn"), // excluded from curated album
  ];
  // Mirror the strip: curated urls → rows → labels.
  const byUrl = new Map(pool.map((p) => [p.photo_url, p]));
  const curated = facebookAlbumUrls(pool).map((u) => byUrl.get(u) || { photo_url: u, category: "" });
  const labels = curated.map((p) => categoryLabel(p.category));
  check("curated labels in order", JSON.stringify(labels) === JSON.stringify(["Drone", "Facade", "Living Room", "Kitchen", "Primary Bedroom", "Primary Bathroom", "Backyard"]));
  check("no raw 'default' text — labels are categories", !labels.includes("default") && !labels.includes(""));
  check("dining excluded from curated album", !curated.some((p) => p.category === "dining"));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
