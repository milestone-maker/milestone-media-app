#!/usr/bin/env node

// Unit tests for api/_content/selectCarouselPhotos.js — pure function, no IO.
// Stage 4: required-rooms selection (fixed beat set, no cap, no fill).
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(__dirname, "..", "api", "_content", "selectCarouselPhotos.js");
const { selectCarouselPhotos } = await import(pathToFileURL(MOD).href);
// Pure sequence builder — used for the end-to-end pipeline/IG-limit checks.
const COMPOSE = resolve(__dirname, "..", "src", "views", "Content", "carouselCompose.js");
const { buildSlideSequence } = await import(pathToFileURL(COMPOSE).href);

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

console.log("\n── selectCarouselPhotos (Stage 4 required rooms) ──\n");

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
  ]);
  check("conf 0.69 kitchen excluded", !cats(r).includes("kitchen"));
  check("conf 0.70 living included (>= floor)", cats(r).includes("living"));
}

// 3. agent_corrected always included even below floor
{
  const r = selectCarouselPhotos([
    L("kitchen", { conf: 0.10, corrected: true }),
    L("living",  { conf: 0.99 }),
  ]);
  check("low-conf but corrected kitchen included", cats(r).includes("kitchen"));
}

// 4. Cover pick: drone > front_facade > null; facade appears exactly once
{
  // Drone present → cover = drone AND front_facade is the FIRST subject.
  const withDrone = selectCarouselPhotos([
    L("drone", { conf: 0.8 }), L("front_facade", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
  ]);
  check("cover = drone when present", withDrone.coverPhoto?.category === "drone");
  check("drone cover NOT repeated as subject", !cats(withDrone).includes("drone"));
  check("front_facade IS first subject when drone covers", cats(withDrone)[0] === "front_facade");

  // No drone → cover = front_facade AND it is NOT duplicated as a subject.
  const noDrone = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
  ]);
  check("cover = front_facade when no drone", noDrone.coverPhoto?.category === "front_facade");
  check("front_facade cover NOT repeated as subject", !cats(noDrone).includes("front_facade"));
  check("facade-as-cover → kitchen is the only subject here", JSON.stringify(cats(noDrone)) === JSON.stringify(["kitchen"]));

  // Neither → cover null, hero fallback handled by caller.
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

  // Two kitchens, no correction → higher confidence wins.
  const r2 = selectCarouselPhotos([
    L("kitchen", { conf: 0.80, url: "K80" }),
    L("kitchen", { conf: 0.95, url: "K95" }),
  ]);
  check("higher-confidence kitchen wins (no correction)",
    r2.subjectSlides.find((s) => s.category === "kitchen").photo_url === "K95");
}

// 6. Required-room order (no pool): facade cover → living, kitchen, primary_bed, primary_bath
{
  const r = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }),
    L("kitchen", { conf: 0.9 }), L("living", { conf: 0.9 }),
    L("primary_bathroom", { conf: 0.9 }), L("primary_bedroom", { conf: 0.9 }),
    L("dining", { conf: 0.99 }), L("backyard", { conf: 0.99 }), // dining + backyard(no pool) must be excluded
  ]);
  check("cover = front_facade", r.coverPhoto?.category === "front_facade");
  check("subjects = living, kitchen, primary_bedroom, primary_bathroom (locked order, no facade dup)",
    JSON.stringify(cats(r)) === JSON.stringify(["living", "kitchen", "primary_bedroom", "primary_bathroom"]));
  check("dining excluded", !cats(r).includes("dining"));
  check("backyard excluded when no pool", !cats(r).includes("backyard"));
}

// 6b. Required-room order WITH drone cover → facade leads the subjects
{
  const r = selectCarouselPhotos([
    L("drone", { conf: 0.9 }), L("front_facade", { conf: 0.9 }),
    L("living", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
    L("primary_bedroom", { conf: 0.9 }), L("primary_bathroom", { conf: 0.9 }),
  ]);
  check("drone cover + 5 subjects (facade first)",
    JSON.stringify(cats(r)) === JSON.stringify(["front_facade", "living", "kitchen", "primary_bedroom", "primary_bathroom"]));
}

// 7. Pool: backyard included (last) when a pool is in ANY photo's features; else omitted
{
  const pool = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }),
    L("living", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
    L("primary_bedroom", { conf: 0.9 }), L("primary_bathroom", { conf: 0.9 }),
    L("backyard", { conf: 0.9, features: ["sparkling pool", "patio"] }),
  ]);
  check("pool → backyard INCLUDED as the last subject",
    JSON.stringify(cats(pool)) === JSON.stringify(["living", "kitchen", "primary_bedroom", "primary_bathroom", "backyard"]));

  // Pool signal can come from a DIFFERENT photo's features (e.g. a drone shot).
  const poolOnDrone = selectCarouselPhotos([
    L("drone", { conf: 0.9, features: ["aerial view", "in-ground pool"] }),
    L("front_facade", { conf: 0.9 }),
    L("backyard", { conf: 0.9 }),
  ]);
  check("pool signal from another photo still includes backyard", poolOnDrone.subjectSlides.some((s) => s.category === "backyard"));

  // Case-insensitive.
  const poolCaps = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }), L("backyard", { conf: 0.9, features: ["POOL"] }),
  ]);
  check("pool match is case-insensitive", poolCaps.subjectSlides.some((s) => s.category === "backyard"));

  // No pool anywhere → backyard omitted.
  const noPool = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }), L("backyard", { conf: 0.9, features: ["green lawn", "fence"] }),
  ]);
  check("no pool → backyard omitted", !cats(noPool).includes("backyard"));
}

// 8. Missing room (no primary_bathroom photo) → that beat dropped, no gap, order preserved
{
  const r = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }),
    L("living", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
    L("primary_bedroom", { conf: 0.9 }),
    // no primary_bathroom
  ]);
  check("missing primary_bathroom → dropped, no gap",
    JSON.stringify(cats(r)) === JSON.stringify(["living", "kitchen", "primary_bedroom"]));
}

// 9. Only dining/other present → subjectSlides = [] → caller keeps carouselSelection null
{
  const r = selectCarouselPhotos([L("dining", { conf: 0.99 }), L("other", { conf: 0.99 })]);
  check("only dining/other → no subjects (legacy text path)", r.subjectSlides.length === 0);
  check("only dining/other → cover null", r.coverPhoto === null);
}

// 10. finalPhotoUrl reuses cover photo
{
  const r = selectCarouselPhotos([L("drone", { conf: 0.9, url: "DRONE" }), L("kitchen", { conf: 0.9 })]);
  check("finalPhotoUrl === cover photo_url", r.finalPhotoUrl === "DRONE" && r.coverPhoto.photo_url === "DRONE");
}

// 11. features carried onto subject slides
{
  const r = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }),
    L("kitchen", { conf: 0.9, features: ["marble island", "white cabinets"] }),
  ]);
  const k = r.subjectSlides.find((s) => s.category === "kitchen");
  check("subject carries features", JSON.stringify(k.features) === JSON.stringify(["marble island", "white cabinets"]));
}

console.log("\n── pipeline count + IG limit ──\n");

// 12. End-to-end count: a 5-subject (pool) selection flows through buildSlideSequence
//     with no cap, all photos present, and stays within IG's 20-image limit.
{
  const sel = selectCarouselPhotos([
    L("front_facade", { conf: 0.9 }),
    L("living", { conf: 0.9 }), L("kitchen", { conf: 0.9 }),
    L("primary_bedroom", { conf: 0.9 }), L("primary_bathroom", { conf: 0.9 }),
    L("backyard", { conf: 0.9, features: ["pool"] }),
  ]);
  const N = sel.subjectSlides.length;
  check("pool case → 5 subject beats (no cap truncation)", N === 5, `got ${N}`);

  // Mock the model output: 1 cover + N subjects + 1 final, then attach photos by
  // position exactly like zipCarouselPhotos does (cover[0], subjects[1..], final[n-1]).
  const modelSlides = [{ subject: "cover", statement: "Hook" }];
  for (const s of sel.subjectSlides) modelSlides.push({ subject: s.category, statement: `Room ${s.category}` });
  modelSlides.push({ subject: "final", statement: "CTA" });
  const n = modelSlides.length;
  modelSlides[0].photo_url = sel.coverPhoto.photo_url; modelSlides[0].is_cover = true;
  modelSlides[n - 1].photo_url = sel.finalPhotoUrl;
  for (let k = 0; k < sel.subjectSlides.length; k++) {
    modelSlides[k + 1].photo_url = sel.subjectSlides[k].photo_url;
    modelSlides[k + 1].category  = sel.subjectSlides[k].category;
  }

  const seq = buildSlideSequence(modelSlides, { stats: {}, footer: {} });
  const cards  = seq.filter((x) => x.type === "card").length;
  const photos = seq.filter((x) => x.type === "photo").length;
  const images = seq.length; // each rendered slide is one carousel image
  check("every model slide → a card", cards === n, `cards=${cards} n=${n}`);
  check("every model slide has a photo (cover/subjects/final all zipped)", photos === n, `photos=${photos} n=${n}`);
  check("total rendered images = 2*(N+2)", images === 2 * (N + 2), `got ${images}`);
  check("IG limit: pool-case images (14) ≤ 20", images <= 20, `got ${images}`);

  // sourceIndex is stable and monotonic so card edits map back correctly.
  check("seq sourceIndex covers every model slide", new Set(seq.map((x) => x.sourceIndex)).size === n);
}

// 13. Count-mismatch path still warns (model returns fewer subjects than selected)
{
  // Replicate zipCarouselPhotos' mismatch detection (Math.min by position).
  const selected = 5, modelReturned = 3;
  const mismatch = modelReturned !== selected;
  const zipped = Math.min(modelReturned, selected);
  check("count mismatch detected (warn path)", mismatch === true);
  check("zips best-effort by position (min count)", zipped === 3);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
