#!/usr/bin/env node
// Idempotent Stripe product + price + coupon setup for Milestone subscriptions.
//
// Reads the subscription tiers from public/pricing.json, finds or creates
// the Stripe products (Starter / Pro / Elite — Teams is custom quote and
// is skipped), finds or creates monthly + annual prices for each, finds
// or creates the first-month intro coupon, and writes every resulting
// Stripe ID back into pricing.json under the stripeIds key.
//
// All "find or create" lookups use metadata tags so re-runs never
// duplicate. The script is safe to re-run.
//
// Required env:
//   STRIPE_SECRET_KEY  — live Stripe secret key (existing var)
//
// Optional env:
//   MILESTONE_DRY_RUN=1  — exit before any Stripe call. Used by smoke tests
//                          to verify the script parses cleanly.
//
// Run from the milestone-media-app repo root:
//   node scripts/setup-stripe-subscriptions.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "public", "pricing.json");

// ── Dry-run gate ─────────────────────────────────────────────────────
// Smoke tests set this so they can verify the file parses without
// making any Stripe API calls. This MUST be checked before the Stripe
// client is constructed.
if (process.env.MILESTONE_DRY_RUN) {
  console.log("MILESTONE_DRY_RUN is set — exiting before any Stripe call. The script parsed cleanly.");
  process.exit(0);
}

// ── Warning + cancellation window ────────────────────────────────────
console.log("");
console.log("⚠️  This script makes changes to the LIVE Stripe account.");
console.log("    It will create products, prices, and a coupon if they don't");
console.log("    already exist, and write their IDs back into pricing.json.");
console.log("    No subscriptions will be created. No card will be charged.");
console.log("    Press Ctrl-C in the next 3 seconds to cancel.");
console.log("");
await new Promise(r => setTimeout(r, 3000));

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("✗ STRIPE_SECRET_KEY is not set. Aborting.");
  process.exit(1);
}

// Dynamic import so we don't construct Stripe during dry-run / parse-only
const { default: Stripe } = await import("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Load pricing config ──────────────────────────────────────────────
const cfgRaw = await readFile(CONFIG_PATH, "utf8");
const cfg = JSON.parse(cfgRaw);

const TIERS_TO_PROVISION = ["starter", "pro", "elite"];
const METADATA_KEY = "milestone_tier";       // identifies our products
const PERIOD_KEY   = "milestone_period";     // identifies monthly vs annual
const COUPON_KEY   = "milestone_intro";      // identifies the intro coupon

// 15% off annual prepay = pay 85% of 12 months
const ANNUAL_DISCOUNT_MULTIPLIER = 12 * (1 - cfg.promos.annualPrepay.discountPercent / 100);

// Round dollars-with-cents to whole cents (integer)
function dollarsToCents(amount) {
  return Math.round(amount * 100);
}

// ── Helper: find-or-create product ───────────────────────────────────
async function findOrCreateProduct(tierId, tierName) {
  // Search through existing products by metadata tag.
  // Use search if available, fall back to list+filter.
  try {
    const search = await stripe.products.search({
      query: `metadata['${METADATA_KEY}']:'${tierId}' AND active:'true'`,
      limit: 5,
    });
    if (search.data.length > 0) {
      console.log(`  reused product for ${tierId}: ${search.data[0].id}`);
      return search.data[0];
    }
  } catch (e) {
    // Search API may not be available on all accounts; fall back to list
    const list = await stripe.products.list({ limit: 100, active: true });
    const existing = list.data.find(p => p.metadata?.[METADATA_KEY] === tierId);
    if (existing) {
      console.log(`  reused product for ${tierId}: ${existing.id}`);
      return existing;
    }
  }

  const product = await stripe.products.create({
    name: `Milestone ${tierName} Subscription`,
    description: `Milestone Media & Photography — ${tierName} subscription tier`,
    metadata: { [METADATA_KEY]: tierId },
  });
  console.log(`  created product for ${tierId}: ${product.id}`);
  return product;
}

// ── Helper: find-or-create recurring price ───────────────────────────
async function findOrCreatePrice(product, tierId, period, unitAmountCents) {
  const prices = await stripe.prices.list({ product: product.id, limit: 100, active: true });
  const existing = prices.data.find(p =>
    p.metadata?.[PERIOD_KEY] === period && p.recurring && p.unit_amount === unitAmountCents
  );
  if (existing) {
    console.log(`  reused ${period} price for ${tierId}: ${existing.id} (${unitAmountCents / 100} USD)`);
    return existing;
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: unitAmountCents,
    recurring: { interval: period === "annual" ? "year" : "month" },
    metadata: { [METADATA_KEY]: tierId, [PERIOD_KEY]: period },
  });
  console.log(`  created ${period} price for ${tierId}: ${price.id} (${unitAmountCents / 100} USD)`);
  return price;
}

// ── Helper: find-or-create intro coupon ──────────────────────────────
async function findOrCreateIntroCoupon() {
  const percent = cfg.promos.firstMonth.discountPercent;
  // Coupons API: list all and filter by metadata
  const list = await stripe.coupons.list({ limit: 100 });
  const existing = list.data.find(c =>
    c.metadata?.[COUPON_KEY] === "first_month" &&
    c.duration === "once" &&
    c.percent_off === percent
  );
  if (existing) {
    console.log(`  reused intro coupon: ${existing.id} (${percent}% off, once)`);
    return existing;
  }

  const coupon = await stripe.coupons.create({
    name: "Milestone First Month Intro",
    percent_off: percent,
    duration: "once",
    metadata: { [COUPON_KEY]: "first_month" },
  });
  console.log(`  created intro coupon: ${coupon.id} (${percent}% off, once)`);
  return coupon;
}

// ── Main flow ────────────────────────────────────────────────────────
console.log("Setting up Milestone Stripe subscriptions...");
console.log("");

// 1. Show the math before doing anything
console.log("Planned amounts (per tier):");
const planned = {};
for (const sub of cfg.subscriptions) {
  if (!TIERS_TO_PROVISION.includes(sub.id)) {
    console.log(`  ${sub.id.padEnd(8)} — skipped (${sub.customQuote ? "custom quote" : "no monthly price"})`);
    continue;
  }
  const monthly = sub.monthlyPrice;
  const annualBilled = +(monthly * ANNUAL_DISCOUNT_MULTIPLIER).toFixed(2);
  planned[sub.id] = { monthly, annualBilled };
  console.log(
    `  ${sub.id.padEnd(8)} — monthly $${monthly.toFixed(2)}, ` +
    `annual prepay $${annualBilled.toFixed(2)} ` +
    `(= $${monthly} × 12 × ${(1 - cfg.promos.annualPrepay.discountPercent / 100).toFixed(2)})`
  );
}
console.log("");

// 2. Provision products + prices
const created = { products: {}, monthly: {}, annual: {} };
for (const sub of cfg.subscriptions) {
  if (!TIERS_TO_PROVISION.includes(sub.id)) continue;
  console.log(`Tier: ${sub.id}`);
  const product = await findOrCreateProduct(sub.id, sub.name);
  created.products[sub.id] = product.id;

  const monthlyCents = dollarsToCents(sub.monthlyPrice);
  const monthlyPrice = await findOrCreatePrice(product, sub.id, "monthly", monthlyCents);
  created.monthly[sub.id] = monthlyPrice.id;

  const annualCents = dollarsToCents(planned[sub.id].annualBilled);
  const annualPrice = await findOrCreatePrice(product, sub.id, "annual", annualCents);
  created.annual[sub.id] = annualPrice.id;
  console.log("");
}

// 3. Provision intro coupon
console.log("Intro coupon:");
const introCoupon = await findOrCreateIntroCoupon();
console.log("");

// 4. Write IDs back into pricing.json
//    Update only the stripeIds slots. Preserve everything else.
cfg.stripeIds = cfg.stripeIds || {};
cfg.stripeIds.subscriptions = cfg.stripeIds.subscriptions || {};
cfg.stripeIds.subscriptionPrices = cfg.stripeIds.subscriptionPrices || { monthly: {}, annual: {} };
cfg.stripeIds.subscriptionPrices.monthly = cfg.stripeIds.subscriptionPrices.monthly || {};
cfg.stripeIds.subscriptionPrices.annual = cfg.stripeIds.subscriptionPrices.annual || {};
cfg.stripeIds.coupons = cfg.stripeIds.coupons || {};

for (const tierId of TIERS_TO_PROVISION) {
  cfg.stripeIds.subscriptions[tierId] = created.products[tierId];
  cfg.stripeIds.subscriptionPrices.monthly[tierId] = created.monthly[tierId];
  cfg.stripeIds.subscriptionPrices.annual[tierId] = created.annual[tierId];
}
cfg.stripeIds.coupons.firstMonth = introCoupon.id;
cfg.lastUpdated = new Date().toISOString().slice(0, 10);

await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
console.log(`Wrote IDs back to ${CONFIG_PATH}`);
console.log("");

// 5. Final summary
console.log("═══════════════════════════════════════════════════════════");
console.log("  SUMMARY — Stripe subscription setup complete");
console.log("═══════════════════════════════════════════════════════════");
console.log("");
console.log("Products:");
for (const t of TIERS_TO_PROVISION) console.log(`  ${t.padEnd(8)}  ${created.products[t]}`);
console.log("");
console.log("Monthly prices:");
for (const t of TIERS_TO_PROVISION) console.log(`  ${t.padEnd(8)}  ${created.monthly[t]}`);
console.log("");
console.log("Annual prices (15% off prepay):");
for (const t of TIERS_TO_PROVISION) console.log(`  ${t.padEnd(8)}  ${created.annual[t]}`);
console.log("");
console.log(`Intro coupon (${cfg.promos.firstMonth.discountPercent}% off, once):`);
console.log(`            ${introCoupon.id}`);
console.log("");
console.log("✓ Done. No subscriptions were created, no cards were charged.");
