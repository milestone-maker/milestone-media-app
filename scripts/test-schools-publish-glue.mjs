#!/usr/bin/env node

// ============================================================
// Glue test for the publish-side schools bake (Stage 4 schools sub-step 2).
//
// Reproduces EXACTLY how publish-microsite.js assembles the full address
// from the baked fields (street + the city field that holds city/state/zip)
// and calls getNearbySchools, then confirms property_data.schools would be
// populated with the clean { name, level, type, distance_mi } shape.
//
// Hits the real (free, keyless) Census + NCES APIs. No DB, no publish, no
// deploy.
//
// Run:  node scripts/test-schools-publish-glue.mjs
// ============================================================

import { getNearbySchools } from "../api/_lib/schools.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Mirror publish-microsite.js's assembly verbatim.
function assembleFullAddress(propertyData) {
  return [propertyData.address, propertyData.city]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(", ");
}

const CLEAN_KEYS = ["name", "level", "type", "distance_mi"];
function isCleanSchool(s) {
  const keys = Object.keys(s).sort();
  return (
    JSON.stringify(keys) === JSON.stringify([...CLEAN_KEYS].sort()) &&
    typeof s.name === "string" && s.name.length > 0 &&
    ["elementary", "middle", "high"].includes(s.level) &&
    ["public", "charter"].includes(s.type) &&
    typeof s.distance_mi === "number" && Number.isFinite(s.distance_mi)
  );
}

// ── A real, geocodable booking-style address → schools populated ─────
console.log("Real booking-style address (street + city/state/zip field):");
{
  const propertyData = { address: "160 W First St", city: "Prosper, Texas, 75078" };
  const full = assembleFullAddress(propertyData);
  console.log("  assembled full address:", JSON.stringify(full));
  check("assembled as 'street, city, state, zip'", full === "160 W First St, Prosper, Texas, 75078");

  const schools = await getNearbySchools(full);
  console.log("  baked schools count:", schools.length);
  check("schools array is populated (>0)", schools.length > 0, "geocode/NCES returned nothing");
  check("every entry has the clean shape (exactly name/level/type/distance_mi)",
    schools.every(isCleanSchool),
    "found a malformed entry: " + JSON.stringify(schools.find((s) => !isCleanSchool(s))));
  console.log("  sample baked entries:");
  for (const s of schools.slice(0, 4)) console.log("   ", JSON.stringify(s));
}

// ── The fictional demo address → clean empty array, no throw ─────────
console.log("\nFictional demo address (not in Census DB) → []:");
{
  const propertyData = { address: "2410 Prosperity Dr", city: "Prosper, Texas, 75078" };
  const full = assembleFullAddress(propertyData);
  let threw = false, schools;
  try { schools = await getNearbySchools(full); } catch { threw = true; }
  check("returns an array", Array.isArray(schools));
  check("array is empty (address not geocodable)", (schools || []).length === 0);
  check("did not throw", !threw);
}

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
