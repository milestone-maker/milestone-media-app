#!/usr/bin/env node

// ============================================================
// Live test for the schools adapter (Stage 4 schools sub-step 1).
//
// Hits the REAL (free, keyless) US Census geocoder and Urban Institute
// NCES CCD directory. No DB, no writes, no deploy. Proves the read path
// and prints enough raw detail to sanity-check the results.
//
// Run:  node scripts/test-schools-adapter.mjs
// ============================================================

import {
  geocodeAddress,
  fetchSchoolsInCounty,
  getNearbySchools,
} from "../api/_lib/schools.js";

function hr(t) { console.log("\n" + "─".repeat(60) + "\n" + t); }

// ── 1. The literal demo address from the brief ───────────────────────
// NOTE: "2410 Prosperity Dr" is a fictional sample listing and is NOT in
// the Census address database, so it geocodes to no match → []. This
// doubles as a real "unmatched address" case.
hr('getNearbySchools("2410 Prosperity Dr, Prosper, TX 75078")');
{
  const ADDR = "2410 Prosperity Dr, Prosper, TX 75078";
  const geo = await geocodeAddress(ADDR);
  console.log("geocode:", JSON.stringify(geo));
  const list = await getNearbySchools(ADDR);
  console.log("nearby schools:", JSON.stringify(list));
  console.log(geo ? "" : "→ address not in Census DB (fictional demo address) → [] as expected");
}

// ── 2. A REAL, geocodable Prosper address — so the schools list can be
//    sanity-checked against actual nearby schools. (Prosper Town Hall.)
hr('DEMO with a real Prosper address: "160 W First St, Prosper, TX 75078"');
{
  const ADDR = "160 W First St, Prosper, TX 75078";

  const geo = await geocodeAddress(ADDR);
  console.log("geocode result:", JSON.stringify(geo));

  // Show the directory year used + which filter path worked, and the raw
  // shape of one returned candidate (pre-orchestration).
  const candidates = await fetchSchoolsInCounty({
    state_fips:  geo.state_fips,
    county_fips: geo.county_fips,
  });
  console.log("candidate count (county directory rows w/ coords):", candidates.length);
  console.log("raw shape of one candidate:", JSON.stringify(candidates[0], null, 2));

  const list = await getNearbySchools(ADDR);
  hr("FINAL nearby-schools list (nearest 3 per level):");
  for (const s of list) {
    console.log(`  ${s.level.padEnd(11)} | ${s.type.padEnd(7)} | ${s.distance_mi.toFixed(1)} mi | ${s.name}`);
  }
  console.log(`\n(${list.length} schools total)`);
}

// ── 3. Garbage address → [] without throwing ─────────────────────────
hr('getNearbySchools("asdf not a real address zzz") — expect [] no throw');
{
  let threw = false, result;
  try {
    result = await getNearbySchools("asdf not a real address zzz");
  } catch (e) {
    threw = true;
    console.log("✗ THREW:", e.message);
  }
  console.log("result:", JSON.stringify(result), "| threw:", threw);
  console.log(!threw && Array.isArray(result) && result.length === 0
    ? "✓ returned [] gracefully"
    : "✗ unexpected");
  process.exit(threw ? 1 : 0);
}
