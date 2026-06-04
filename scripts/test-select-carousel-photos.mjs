#!/usr/bin/env node

// Unit tests for api/_content/selectCarouselPhotos.js — pure function, no IO.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(__dirname, "..", "api", "_content", "selectCarouselPhotos.js");
const { selectCarouselPhotos } = await import(pathToFileURL(MOD).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Helper to make a label row.
let _id = 0;
function L(category, { conf = 0.9, corrected = false, sort = 0, url, features = [] } = {}) {
  _id += 1;
  return {
    id: `L${_id}`, listing_id: "x", photo_url: url || `https://cdn/${category}-${_id}.jpg`,
    category, confidence: conf, agent_corrected: corrected, sort_order: sort, features,
  };
}
const cats = (r) => r.subjectSlides.map((s) => s.category);

console.log("\n── selectCarouselPhotos ──\n");

// 1. Empty / non-array input → empty selection
{
  const r = selectCarouselPhotos([]);
  check("empty → coverPhoto null", r.coverPhoto === null);
  check("empty → no subject slides", r.subjectSlides.length === 0);
  check("empty → finalPhotoUrl null", r.finalPhotoUrl === null);
  const r2 = selectCarouselPhotos(null);
  check("null input → empty", r2.subjectSlides.length === 0 && r2.coverPhoto === null);
}

// 2. Confidence floor: < 0.70 excluded unless agent_corrected
{
  const r = selectCarouselPhotos([
    L("kitchen", { conf: 0.69 }),
    L("living",  { conf: 0.70 }),
    L("dining",  { conf: 0.95 }),
  ]);
  check("conf 0.69 kitchen excluded", !cats(r).includes("kitchen"));
  check("conf 0.70 living included (>= floor)", cats(r).includes("living"));
  check("conf 0.95 dining included", cats(r).includes("dining"));
}

// 3. agent_corrected always included even below floor
{
  const r = selectCarouselPhotos([
    L("kitchen", { conf: 0.10, corrected: true }),
    L("living",  { conf: 0.99 }),
  ]);
  check("low-conf but corrected kitchen included", cats(r).includes("kitchen"));
}

// 4. Cover pick: drone > front_facade > null; cover category excluded from subjects
{
  const withDrone = selectCarouselPhotos([
    L("drone", { conf: 0.8 }), L("front_facade", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
  ]);
  check("cover = drone when present", withDrone.coverPhoto?.category === "drone");
  check("cover drone NOT repeated as subject", !cats(withDrone).includes("drone"));
  check("front_facade still a subject (not cover)", cats(withDrone).includes("front_facade"));

  const noDrone = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
  ]);
  check("cover = front_facade when no drone", noDrone.coverPhoto?.category === "front_facade");
  check("front_facade cover NOT repeated as subject", !cats(noDrone).includes("front_facade"));

  const neither = selectCarouselPhotos([L("kitchen", { conf: 0.9 }), L("living", { conf: 0.9 })]);
  check("cover null when no drone/front", neither.coverPhoto === null);
  check("finalPhotoUrl null when no cover", neither.finalPhotoUrl === null);
}

// 5. Best-within-category: corrected > confidence > sort_order
{
  const r = selectCarouselPhotos([
    L("kitchen", { conf: 0.80, sort: 1, url: "K-conf80" }),
    L("kitchen", { conf: 0.99, sort: 9, url: "K-conf99" }),
    L("kitchen", { conf: 0.50, corrected: true, sort: 5, url: "K-corrected" }),
  ]);
  const firstKitchen = r.subjectSlides.find((s) => s.category === "kitchen");
  check("corrected kitchen wins as the category's best", firstKitchen.photo_url === "K-corrected");
}

// 6. Subject order follows locked category order
{
  const r = selectCarouselPhotos([
    L("kitchen", { conf: 0.9 }), L("backyard", { conf: 0.9 }),
    L("living", { conf: 0.9 }), L("dining", { conf: 0.9 }),
  ]);
  check("subjects in locked order (backyard, living, dining, kitchen)",
    JSON.stringify(cats(r)) === JSON.stringify(["backyard", "living", "dining", "kitchen"]));
}

// 7. 'other' excluded entirely
{
  const r = selectCarouselPhotos([L("other", { conf: 0.99 }), L("kitchen", { conf: 0.9 })]);
  check("'other' never a subject", !cats(r).includes("other"));
  check("only kitchen subject", cats(r).length === 1 && cats(r)[0] === "kitchen");
}

// 8. Fill from showcase categories (round-robin priority) up to 8, then cap
{
  // 8 kitchens, 8 livings — all qualifying. One each becomes the primary
  // subject slide; fill should add extras up to 8 total, kitchen/living
  // priority. (No cover here → all are subjects.)
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(L("kitchen", { conf: 0.9 - i * 0.01, sort: i, url: `K${i}` }));
  for (let i = 0; i < 8; i++) rows.push(L("living",  { conf: 0.9 - i * 0.01, sort: i, url: `Lv${i}` }));
  const r = selectCarouselPhotos(rows);
  check("capped at 8 subject slides", r.subjectSlides.length === 8, `got ${r.subjectSlides.length}`);
  const k = cats(r).filter((c) => c === "kitchen").length;
  const lv = cats(r).filter((c) => c === "living").length;
  check("fill drew from kitchen + living", k >= 1 && lv >= 1 && (k + lv) === 8);
  // Round-robin priority: kitchen leads each pass → kitchen count >= living count.
  check("kitchen priority >= living in round-robin fill", k >= lv, `k=${k} lv=${lv}`);
}

// 9. finalPhotoUrl reuses cover photo
{
  const r = selectCarouselPhotos([L("drone", { conf: 0.9, url: "DRONE" }), L("kitchen", { conf: 0.9 })]);
  check("finalPhotoUrl === cover photo_url", r.finalPhotoUrl === "DRONE" && r.coverPhoto.photo_url === "DRONE");
}

// 10. features carried onto subject slides
{
  const r = selectCarouselPhotos([L("kitchen", { conf: 0.9, features: ["marble island", "white cabinets"] })]);
  check("subject carries features", JSON.stringify(r.subjectSlides[0].features) === JSON.stringify(["marble island", "white cabinets"]));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
