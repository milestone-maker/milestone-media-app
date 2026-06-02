#!/usr/bin/env node

// ============================================================
// Test for the publish-side coordinate baking (Stage 4 commute sub-step 1).
//
// Proves the schools.js refactor is non-breaking AND surfaces coordinates:
//   • geocodeAddress + getNearbySchoolsFromGeo together yield BOTH a
//     coordinates {lat,lng} and a schools list.
//   • that schools list is IDENTICAL to what getNearbySchools returns for the
//     same address (the refactor did not change schools output).
//
// Hits the real (free, keyless) Census + NCES APIs. No DB, no publish.
//
// Run:  node scripts/test-coordinate-baking.mjs
// ============================================================

import {
  geocodeAddress,
  getNearbySchoolsFromGeo,
  getNearbySchools,
} from "../api/_lib/schools.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const ADDRESS = "160 W First St, Prosper, TX 75078";

// ── geocode once → coordinates + schools-from-geo ────────────────────
const geo = await geocodeAddress(ADDRESS);
console.log("geocode:", JSON.stringify(geo));
check("geocode returned a result", !!geo);
check("coordinates present (finite lat/lng)",
  geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng));

const coordinates = geo ? { lat: geo.lat, lng: geo.lng } : null;
console.log("baked coordinates:", JSON.stringify(coordinates));

const schoolsFromGeo = await getNearbySchoolsFromGeo(geo);
console.log("schools-from-geo count:", schoolsFromGeo.length);

// ── equivalence: same as the old single-call path ───────────────────
const schoolsFromAddress = await getNearbySchools(ADDRESS);
check("schools list is non-empty", schoolsFromGeo.length > 0);
check("getNearbySchoolsFromGeo === getNearbySchools (identical output)",
  JSON.stringify(schoolsFromGeo) === JSON.stringify(schoolsFromAddress),
  "refactor changed schools output");

console.log("\nbaked schools (sample):");
for (const s of schoolsFromGeo.slice(0, 4)) console.log("  ", JSON.stringify(s));

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
