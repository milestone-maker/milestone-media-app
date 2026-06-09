#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for shared/carouselPosting.js — the pure carousel-posting cap.
// Pure module, no deps. Verifies the shared cap constant, the image-count
// derivation (mirrors buildSlideSequence: 1 card + 1 photo-if-photo_url per
// slide), and the cap-check message/ok logic used by BOTH the UI gate and the
// endpoint backstop.
//
//   node scripts/test-carousel-posting.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MOD_PATH  = resolve(REPO_ROOT, "shared", "carouselPosting.js");

const { INSTAGRAM_MAX_CAROUSEL_IMAGES, carouselImageCount, checkCarouselImageCap } =
  await import(pathToFileURL(MOD_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Build a slides array of n slides that each HAVE a photo (→ 2 images each).
const slidesWithPhotos = (n) => Array.from({ length: n }, (_, i) => ({ statement: `s${i}`, photo_url: `https://x/${i}.jpg` }));

console.log("\n── shared/carouselPosting.js — carousel cap ──\n");

// Cap constant (Instagram allows 20 since the 2024 increase).
check("cap constant is 20", INSTAGRAM_MAX_CAROUSEL_IMAGES === 20);

// carouselImageCount: 1 card + 1 photo per slide WITH a photo_url.
check("count: 2 per photo-bearing slide", carouselImageCount(slidesWithPhotos(3)) === 6);
check("count: card-only slide (no photo_url) = 1", carouselImageCount([{ statement: "x" }]) === 1);
check("count: mixed (1 with photo, 1 without) = 3", carouselImageCount([{ photo_url: "u" }, { statement: "x" }]) === 3);
check("count: empty/invalid → 0", carouselImageCount([]) === 0 && carouselImageCount(null) === 0 && carouselImageCount(undefined) === 0);

// checkCarouselImageCap: ok within range.
{
  const r = checkCarouselImageCap(slidesWithPhotos(5)); // 10 images
  check("5 photo-slides (10 imgs) → ok", r.ok === true && r.count === 10 && r.cap === 20);
  check("ok → no message", r.message === "");
}

// At exactly the cap (10 photo-slides = 20 images) → still ok.
{
  const r = checkCarouselImageCap(slidesWithPhotos(10)); // 20 images
  check("exactly cap (20) → ok", r.ok === true && r.count === 20);
}

// Over the cap (11 photo-slides = 22 images) → blocked with a clear message.
{
  const r = checkCarouselImageCap(slidesWithPhotos(11)); // 22 images
  check("over cap (22) → not ok", r.ok === false && r.count === 22);
  check("over cap → names limit and count", r.message.includes("20") && r.message.includes("22") && /trim/i.test(r.message));
}

// Empty → not ok with a clear message.
{
  const r = checkCarouselImageCap([]);
  check("empty → not ok", r.ok === false && r.count === 0);
  check("empty → has a message", r.message.length > 0);
}

// Custom cap override honored.
{
  const r = checkCarouselImageCap(slidesWithPhotos(3), 4); // 6 images, cap 4
  check("custom cap honored", r.ok === false && r.cap === 4 && r.count === 6);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
