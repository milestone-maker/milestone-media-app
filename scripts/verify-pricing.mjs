#!/usr/bin/env node

// Fail loudly: any unhandled error in this test script must
// translate to a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });
// Smoke test for the centralized pricing config.
// Reads public/pricing.json and asserts the price values that the
// business depends on. Does NOT touch the database, Stripe, email,
// or the calendar.
//
// Run from the milestone-media-app repo root:
//   node scripts/verify-pricing.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "public", "pricing.json");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const raw = await readFile(CONFIG_PATH, "utf8").catch(err => {
  fail(`Could not read ${CONFIG_PATH}: ${err.message}`);
});
let cfg;
try { cfg = JSON.parse(raw); } catch (e) { fail("pricing.json is not valid JSON: " + e.message); }

// 1. Packages — Signature 549, Luxury 1095
const sig = cfg.packages.find(p => p.name === "Signature");
const lux = cfg.packages.find(p => p.name === "Luxury");
assert(sig, "Signature package not found in pricing.packages");
assert(lux, "Luxury package not found in pricing.packages");
assert(sig.priceValue === 549, `Signature priceValue should be 549, got ${sig.priceValue}`);
assert(lux.priceValue === 1095, `Luxury priceValue should be 1095, got ${lux.priceValue}`);

// 2. Essential sqft tiers — 185 / 205 / 225 / 250 / 275
const expectedEssential = { under_1500: 185, "1501_2500": 205, "2501_3500": 225, "3501_4500": 250, over_4501: 275 };
for (const [tier, expected] of Object.entries(expectedEssential)) {
  const actual = cfg.essentialPricing?.[tier];
  assert(actual === expected, `essentialPricing.${tier} should be ${expected}, got ${actual}`);
}

// 3. Microsite add-on price — 150
const microsite = (cfg.addons || []).find(a => a.id === "microsite");
assert(microsite, "microsite add-on not found in addons");
assert(microsite.price === 150, `microsite add-on price should be 150, got ${microsite.price}`);

// 4. Subscriptions — Starter 349, Pro 899, Elite 1899
const subs = cfg.subscriptions || [];
const findSub = (id) => subs.find(s => s.id === id);
const starter = findSub("starter");
const pro = findSub("pro");
const elite = findSub("elite");
assert(starter && starter.monthlyPrice === 349, `Starter subscription should be 349/mo, got ${starter?.monthlyPrice}`);
assert(pro && pro.monthlyPrice === 899, `Pro subscription should be 899/mo, got ${pro?.monthlyPrice}`);
assert(elite && elite.monthlyPrice === 1899, `Elite subscription should be 1899/mo, got ${elite?.monthlyPrice}`);

// 5. Every individual service has either fixedPrice OR priceByTier with all five tiers
const TIER_KEYS = ["under_1500", "1501_2500", "2501_3500", "3501_4500", "over_4501"];
for (const [id, svc] of Object.entries(cfg.individualServices || {})) {
  const hasFixed = typeof svc.fixedPrice === "number";
  const hasTiers = svc.priceByTier && typeof svc.priceByTier === "object";
  assert(hasFixed || hasTiers, `service "${id}" is missing both fixedPrice and priceByTier`);
  if (hasTiers) {
    for (const t of TIER_KEYS) {
      assert(typeof svc.priceByTier[t] === "number", `service "${id}".priceByTier.${t} must be a number`);
    }
  }
}

console.log("✓ Pricing config is valid");
