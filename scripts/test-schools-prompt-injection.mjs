#!/usr/bin/env node

// ============================================================
// Unit test for the SCHOOLS block in buildSystemPrompt()
// (Stage 4 schools sub-step 2). Synthetic inputs — no DB, no network.
//
// Asserts:
//   1. schools ENABLED + schools present → block appears with the
//      disclaimer + school lines; ratings/scores/demographics framed only
//      as UNAVAILABLE (no "publicly available academic ratings" claim).
//   2. schools DISABLED + present → no block, no school name leaks.
//   3. schools ENABLED + empty/absent → no block, deferral wording intact.
//
// Run:  node scripts/test-schools-prompt-injection.mjs
// ============================================================

import { buildSystemPrompt } from "../api/microsite-chat.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const SCHOOLS = [
  { name: "Judy Rucker El",  level: "elementary", type: "public",  distance_mi: 0.5 },
  { name: "Reynolds Middle", level: "middle",     type: "public",  distance_mi: 0.6 },
  { name: "Prosper H S",     level: "high",        type: "public",  distance_mi: 1.8 },
];

const baseArgs = {
  agentDisplayName: "Tyshawn Miles",
  brokerageName:    "Milestone Realty",
  brokerageAbout:   null,
  comps:            [],
  visitor:          null,
  mortgageRates:    null,
};

function topics(schools) {
  return { listing: true, schools, commute: true, comps: true, financing: true };
}

// ── 1. schools ENABLED + present → block appears ─────────────────────
console.log("schools ENABLED + present:");
{
  const out = buildSystemPrompt({
    ...baseArgs,
    propertyData: { address: "2410 Prosperity Dr", schools: SCHOOLS },
    topicsEnabled: topics(true),
  });
  check("contains 'NEARBY SCHOOLS'", out.includes("NEARBY SCHOOLS"));
  check("disclaimer: 'NOT a statement of attendance zones'", out.includes("NOT a statement of attendance zones"));
  check("disclaimer: confirm zoning with district", out.includes("confirm enrollment eligibility and zoning directly with the school district"));
  check("disclaimer: no demographics/scores/ratings", out.includes("do NOT have school demographics, test scores, or quality ratings"));
  check("school line: Judy Rucker El (elementary, public, 0.5 mi)", out.includes("- Judy Rucker El (elementary, public, 0.5 mi)"));
  check("school line: Reynolds Middle (middle, public, 0.6 mi)", out.includes("- Reynolds Middle (middle, public, 0.6 mi)"));
  check("school line: Prosper H S (high, public, 1.8 mi)", out.includes("- Prosper H S (high, public, 1.8 mi)"));
  check("does NOT claim 'publicly available academic ratings'", !out.includes("publicly available academic ratings"));
}

// ── 2. schools DISABLED + present → no block, no leak ────────────────
console.log("\nschools DISABLED + present (no leak):");
{
  const out = buildSystemPrompt({
    ...baseArgs,
    propertyData: { address: "2410 Prosperity Dr", schools: SCHOOLS },
    topicsEnabled: topics(false),
  });
  check("does NOT contain 'NEARBY SCHOOLS'", !out.includes("NEARBY SCHOOLS"));
  check("does NOT leak 'Judy Rucker El'", !out.includes("Judy Rucker El"));
  check("does NOT leak 'Reynolds Middle'", !out.includes("Reynolds Middle"));
  check("does NOT leak 'Prosper H S'", !out.includes("Prosper H S"));
}

// ── 3. schools ENABLED + empty/absent → no block, defer intact ───────
console.log("\nschools ENABLED + empty array:");
{
  const out = buildSystemPrompt({
    ...baseArgs,
    propertyData: { address: "2410 Prosperity Dr", schools: [] },
    topicsEnabled: topics(true),
  });
  check("does NOT contain 'NEARBY SCHOOLS'", !out.includes("NEARBY SCHOOLS"));
  check("deferral wording present ('defer to the agent')", /defer to the agent/i.test(out));
}

console.log("\nschools ENABLED + schools key absent:");
{
  const out = buildSystemPrompt({
    ...baseArgs,
    propertyData: { address: "2410 Prosperity Dr" }, // no schools key
    topicsEnabled: topics(true),
  });
  check("does NOT contain 'NEARBY SCHOOLS'", !out.includes("NEARBY SCHOOLS"));
  check("deferral wording present", /defer to the agent/i.test(out));
}

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
