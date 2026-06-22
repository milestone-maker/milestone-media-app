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

// Cap constant (bundle.social enforces 10 at its create-post boundary).
check("cap constant is 10", INSTAGRAM_MAX_CAROUSEL_IMAGES === 10);

// carouselImageCount: one combined image per source slide (combined photo+caption format).
check("count: 1 per slide regardless of photo_url", carouselImageCount(slidesWithPhotos(3)) === 3);
check("count: card-only slide still counts = 1", carouselImageCount([{ statement: "x" }]) === 1);
check("count: mixed slides still count by length", carouselImageCount([{ photo_url: "u" }, { statement: "x" }]) === 2);
check("count: empty/invalid → 0", carouselImageCount([]) === 0 && carouselImageCount(null) === 0 && carouselImageCount(undefined) === 0);

// checkCarouselImageCap: ok within range (8 slides = 8 images).
{
  const r = checkCarouselImageCap(slidesWithPhotos(8));
  check("8 slides → ok", r.ok === true && r.count === 8 && r.cap === 10);
  check("ok → no message", r.message === "");
}

// At exactly the cap (10 slides = 10 images) → still ok.
{
  const r = checkCarouselImageCap(slidesWithPhotos(10));
  check("exactly cap (10) → ok", r.ok === true && r.count === 10);
}

// Over the cap (11 slides = 11 images) → blocked with a clear message.
{
  const r = checkCarouselImageCap(slidesWithPhotos(11));
  check("over cap (11) → not ok", r.ok === false && r.count === 11);
  check("over cap → names limit and count", r.message.includes("10") && r.message.includes("11") && /trim/i.test(r.message));
}

// Empty → not ok with a clear message.
{
  const r = checkCarouselImageCap([]);
  check("empty → not ok", r.ok === false && r.count === 0);
  check("empty → has a message", r.message.length > 0);
}

// Custom cap override honored.
{
  // 5 slides, custom cap of 4 → blocked at 5 images.
  const r = checkCarouselImageCap(slidesWithPhotos(5), 4);
  check("custom cap honored", r.ok === false && r.cap === 4 && r.count === 5);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
