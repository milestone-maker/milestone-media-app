#!/usr/bin/env node

// ============================================================
// Live test for the mortgage-rate refresh write path (Stage 4).
//
// Unlike the mocked suites in scripts/, this one hits the REAL FRED API
// and the REAL shared Supabase database — it proves the full write path
// locally without deploying. It:
//   1. Loads .env.local (FRED_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY).
//   2. Builds a service-role supabase client.
//   3. Calls refreshMortgageRates(supabase) and prints the result.
//   4. Reads mortgage_rates back and prints the most recent row.
//
// Run twice: the first run inserts (status 'inserted'), the second
// returns 'already-current' (idempotency — no duplicate row).
//
// Run:
//   node scripts/test-mortgage-refresh.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local (no dotenv dependency in this repo) ──────────────
function loadEnvLocal() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "..", ".env.local");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error(`Could not read ${path}. Run: vercel env pull .env.local`);
    process.exit(1);
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

// Import the adapter AFTER env is loaded (it reads process.env.FRED_API_KEY).
const { refreshMortgageRates } = await import("../api/_lib/mortgageRates.js");

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FRED_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("── Calling refreshMortgageRates() ─────────────────────────");
const result = await refreshMortgageRates(supabase);
console.log("Result:", JSON.stringify(result, null, 2));

if (result.status === "error") {
  console.error("\n✗ Refresh returned an error — see message above.");
  process.exit(1);
}

console.log("\n── Reading mortgage_rates back (most recent row) ──────────");
const { data: latest, error: readErr } = await supabase
  .from("mortgage_rates")
  .select("id, as_of_date, rate_30yr, rate_15yr, source, fetched_at")
  .order("as_of_date", { ascending: false })
  .limit(1)
  .maybeSingle();

if (readErr) {
  console.error("✗ Readback failed:", readErr.message);
  process.exit(1);
}
if (!latest) {
  console.error("✗ No rows found in mortgage_rates after refresh.");
  process.exit(1);
}

console.log("Most recent row:", JSON.stringify(latest, null, 2));

// Sanity checks on the seeded values.
const plausible =
  Number(latest.rate_30yr) > 0 && Number(latest.rate_30yr) < 25 &&
  Number(latest.rate_15yr) > 0 && Number(latest.rate_15yr) < 25;
console.log(`\nPlausibility (0 < rate < 25): ${plausible ? "✓ pass" : "✗ FAIL"}`);
console.log(`Status: ${result.status}`);
console.log(
  result.status === "already-current"
    ? "→ Idempotency confirmed: no new row inserted for this survey week."
    : "→ Inserted a fresh row. Run again to confirm 'already-current'."
);

process.exit(plausible ? 0 : 1);
