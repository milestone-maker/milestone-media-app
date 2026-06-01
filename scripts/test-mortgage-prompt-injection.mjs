#!/usr/bin/env node

// ============================================================
// Unit test for the mortgage section in buildSystemPrompt()
// (Stage 4 sub-step 2). Calls buildSystemPrompt directly with synthetic
// inputs — no DB, no network, no Anthropic call.
//
// Asserts:
//   1. financing ENABLED  + fresh rates → mortgage section present, both
//      rate values present, "qualified lender" + "not a quote" present.
//   2. financing DISABLED + fresh rates → NO mortgage section, neither
//      rate value leaks.
//   3. financing ENABLED  + null rates  → NO mortgage section, deferral
//      wording present.
//
// Run:  node scripts/test-mortgage-prompt-injection.mjs
// ============================================================

import { buildSystemPrompt } from "../api/microsite-chat.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const FRESH = { as_of_date: "2026-05-28", rate_30yr: 6.53, rate_15yr: 5.87 };

const baseArgs = {
  agentDisplayName: "Tyshawn Miles",
  brokerageName:    "Milestone Realty",
  brokerageAbout:   null,
  propertyData:     { address: "2410 Prosperity Dr", price: "$750,000", beds: 4 },
  comps:            [],
  visitor:          null,
};

function withTopics(financing) {
  return {
    listing: true, schools: true, commute: true, comps: true, financing,
  };
}

// ── 1. financing ENABLED + fresh rates → section present ─────────────
console.log("financing ENABLED + fresh rates:");
{
  const out = buildSystemPrompt({ ...baseArgs, topicsEnabled: withTopics(true), mortgageRates: FRESH });
  check("contains 'CURRENT MORTGAGE RATES'", out.includes("CURRENT MORTGAGE RATES"));
  check("contains human-readable date 'May 28, 2026'", out.includes("May 28, 2026"), "got date formatting wrong");
  check("contains 30-year value 6.53", out.includes("6.53"));
  check("contains 15-year value 5.87", out.includes("5.87"));
  check("contains 'qualified lender'", out.includes("qualified lender"));
  check("contains 'not a quote'", out.includes("not a quote"));
}

// ── 2. financing DISABLED + fresh rates → no leak ────────────────────
console.log("\nfinancing DISABLED + fresh rates (no leak):");
{
  const out = buildSystemPrompt({ ...baseArgs, topicsEnabled: withTopics(false), mortgageRates: FRESH });
  check("does NOT contain 'CURRENT MORTGAGE RATES'", !out.includes("CURRENT MORTGAGE RATES"));
  check("does NOT contain 30-year value 6.53", !out.includes("6.53"));
  check("does NOT contain 15-year value 5.87", !out.includes("5.87"));
}

// ── 3. financing ENABLED + null rates → defer, no section ────────────
console.log("\nfinancing ENABLED + null rates (stale/missing → defer):");
{
  const out = buildSystemPrompt({ ...baseArgs, topicsEnabled: withTopics(true), mortgageRates: null });
  check("does NOT contain 'CURRENT MORTGAGE RATES'", !out.includes("CURRENT MORTGAGE RATES"));
  check("does NOT contain rate values", !out.includes("6.53") && !out.includes("5.87"));
  check("deferral wording present (defer to the agent)", /defer to the agent/i.test(out));
}

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
