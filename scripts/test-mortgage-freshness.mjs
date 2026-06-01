#!/usr/bin/env node

// ============================================================
// Unit test for isRateFresh() (Stage 4 sub-step 2).
//
// Pure function, no DB, no network. Asserts the 16-day inclusive
// freshness boundary: fresh at 0/5/16 days, stale at 17/30 days.
//
// Run:  node scripts/test-mortgage-freshness.mjs
// ============================================================

import { isRateFresh } from "../api/_lib/mortgageRates.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Fixed reference "now" (UTC) so the test is deterministic.
const NOW = new Date("2026-06-01T12:00:00Z");

// Build a YYYY-MM-DD that is `daysAgo` whole days before NOW (UTC).
function dateDaysAgo(daysAgo) {
  const ms = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

console.log("isRateFresh — fresh within 16 days (inclusive):");
check("age 0 days → fresh",  isRateFresh(dateDaysAgo(0),  NOW) === true);
check("age 5 days → fresh",  isRateFresh(dateDaysAgo(5),  NOW) === true);
check("age 16 days → fresh (boundary, inclusive)", isRateFresh(dateDaysAgo(16), NOW) === true);

console.log("\nisRateFresh — stale beyond 16 days:");
check("age 17 days → stale", isRateFresh(dateDaysAgo(17), NOW) === false);
check("age 30 days → stale", isRateFresh(dateDaysAgo(30), NOW) === false);

console.log("\nisRateFresh — degenerate inputs:");
check("null date → stale",      isRateFresh(null, NOW) === false);
check("garbage date → stale",   isRateFresh("not-a-date", NOW) === false);

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
