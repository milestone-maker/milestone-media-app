#!/usr/bin/env node

// Fail loudly so CI catches any divergence.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// JS↔RLS PARITY TEST for the microsite write/access condition.
//
// The decision is enforced in three layers (UI, endpoint, Postgres RLS).
// The first two share ONE implementation: shared/micrositeAccess.js
// (canWriteMicrosite). The third is the SQL function
// public.agent_can_write_microsite() in
//   supabase/migrations/20250101000031_microsite_beta_and_existing_access.sql
//
// SQL can't be imported, so this test keeps a hand-written REFERENCE of the
// RLS predicate (rlsAgentCanWrite, below) that mirrors that migration's
// logic line-for-line, and asserts it agrees with the shared JS rule across
// an exhaustive truth table. If someone edits one layer without the other,
// this test fails.
//
// SCOPE: agent paths only (beta / existing / subscription / package).
//   • role='admin' is deliberately EXCLUDED — admin is enforced by separate
//     "Admins can ..." RLS policies, NOT by agent_can_write_microsite(), so
//     it is not part of the function's parity surface.
//   • Ownership (agent_id = auth.uid()) is a precondition both layers apply
//     OUTSIDE this rule (endpoint guard / RLS auth.uid()); the truth table
//     assumes ownership holds, matching how canWriteMicrosite is fed.
//
//   node scripts/test-microsite-access-parity.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULE_PATH = resolve(__dirname, "..", "shared", "micrositeAccess.js");
const { canWriteMicrosite, hasMicrositeAddon } = await import(RULE_PATH);

// ── Reference mirror of migration 031's agent_can_write_microsite() ──
// Returns true iff the SQL function would return true, given that the
// caller owns the booking/microsite (the auth.uid() preconditions). Keep
// this in lock-step with the migration's SQL.
function rlsAgentCanWrite({
  isBeta,
  hasExistingMicrosite,
  subscriptionTier,
  subscriptionStatus,
  selectedPackage,
  selectedAddons,
  invoicePaid,
}) {
  // (2) beta branch
  if (isBeta === true) return true;
  // (3) existing-microsite branch (owner-scoped in SQL via m.agent_id = auth.uid())
  if (hasExistingMicrosite === true) return true;
  // (4) Pro/Elite active/grace subscription — no invoice
  const subOk =
    ["pro", "elite"].includes(subscriptionTier) &&
    ["trialing", "active", "past_due"].includes(subscriptionStatus);
  if (subOk) return true;
  // (5) luxury package OR microsite add-on, AND invoice paid
  const pkgLuxury = (selectedPackage || "").toLowerCase() === "luxury";
  const addon = hasMicrositeAddon(selectedAddons);
  if (invoicePaid === true && (pkgLuxury || addon)) return true;
  return false;
}

// ── Exhaustive truth table over the agent-path dimensions ──────────────
const BOOL = [false, true];
const TIERS = [null, "starter", "pro", "elite", "teams"];
const STATUSES = [null, "trialing", "active", "past_due", "canceled", "incomplete"];
const PACKAGES = [null, "essential", "signature", "luxury", "Luxury"];
const ADDON_SETS = [[], ["microsite"], [{ id: "microsite", qty: 1 }], ["amenities"]];

let passed = 0;
let failed = 0;
let total = 0;
const mismatches = [];

for (const isBeta of BOOL)
for (const hasExistingMicrosite of BOOL)
for (const subscriptionTier of TIERS)
for (const subscriptionStatus of STATUSES)
for (const selectedPackage of PACKAGES)
for (const selectedAddons of ADDON_SETS)
for (const invoicePaid of BOOL) {
  total++;
  const input = {
    role: "agent",
    isBeta,
    hasExistingMicrosite,
    subscriptionTier,
    subscriptionStatus,
    selectedPackage,
    selectedAddons,
    invoicePaid,
  };
  const js = canWriteMicrosite(input).allowed;
  const rls = rlsAgentCanWrite(input);
  if (js === rls) {
    passed++;
  } else {
    failed++;
    if (mismatches.length < 10) mismatches.push({ input, js, rls });
  }
}

console.log(`Parity over ${total} input combinations: ${passed} agree, ${failed} diverge`);
if (failed > 0) {
  console.log("\nFirst divergences (JS rule vs RLS reference):");
  for (const m of mismatches) {
    console.log(`  ✗ js=${m.js} rls=${m.rls}  ${JSON.stringify(m.input)}`);
  }
  process.exit(1);
}
console.log("✓ Shared JS rule and RLS reference agree on every agent-path input");
