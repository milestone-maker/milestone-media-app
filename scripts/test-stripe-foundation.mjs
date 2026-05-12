#!/usr/bin/env node
// Smoke test for the Stripe-subscription foundation work.
// Does NOT touch Stripe, the database, or any external service.
//
// What it checks:
//   1. The new SQL migration (011) adds every expected column and
//      includes the three check constraints (tier, status, period).
//   2. The setup script parses cleanly and honors MILESTONE_DRY_RUN by
//      exiting before any Stripe API call.
//   3. The webhook file parses cleanly as an ES module and exports a
//      default handler function.
//
// Run from the milestone-media-app repo root:
//   node scripts/test-stripe-foundation.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MIGRATION_PATH = resolve(REPO_ROOT, "supabase", "011_agent_stripe_billing.sql");
const SETUP_PATH     = resolve(REPO_ROOT, "scripts", "setup-stripe-subscriptions.mjs");
const WEBHOOK_PATH   = resolve(REPO_ROOT, "api", "stripe-webhook.js");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── 1. Migration content ─────────────────────────────────────────────
console.log("Migration (supabase/011_agent_stripe_billing.sql):");
const sql = await readFile(MIGRATION_PATH, "utf8");
const expectedCols = [
  "stripe_customer_id",
  "stripe_subscription_id",
  "subscription_tier",
  "subscription_status",
  "billing_period",
  "current_period_end",
  "founding_member",
  "subscription_started_at",
];
for (const col of expectedCols) {
  check(`adds column ${col}`, sql.includes(col));
}
check("tier check constraint present",
  /subscription_tier.*check[\s\S]+starter[\s\S]+pro[\s\S]+elite[\s\S]+teams/i.test(sql));
check("status check constraint present (incl. all standard Stripe statuses)",
  /subscription_status.*check[\s\S]+trialing[\s\S]+active[\s\S]+past_due[\s\S]+canceled[\s\S]+incomplete[\s\S]+incomplete_expired[\s\S]+unpaid[\s\S]+paused/i.test(sql));
check("period check constraint present (monthly/annual)",
  /billing_period.*check[\s\S]+monthly[\s\S]+annual/i.test(sql));
check("unique index on stripe_customer_id",
  /create unique index[\s\S]+stripe_customer_id/i.test(sql));
check("unique index on stripe_subscription_id",
  /create unique index[\s\S]+stripe_subscription_id/i.test(sql));
console.log("");

// ── 2. Setup script — dry-run parse check ────────────────────────────
console.log("Setup script (scripts/setup-stripe-subscriptions.mjs):");
// Run as a child process so its top-level `await new Promise(setTimeout,3000)`
// and the dry-run exit can both fire without dragging this script along.
const run = spawnSync(process.execPath, [SETUP_PATH], {
  env: { ...process.env, MILESTONE_DRY_RUN: "1" },
  encoding: "utf8",
  timeout: 10000,
});
check("setup script parses & exits cleanly in dry-run mode", run.status === 0,
  `exit=${run.status}, stderr="${(run.stderr || "").trim().slice(0, 200)}"`);
check("setup script printed dry-run notice",
  /MILESTONE_DRY_RUN.*exiting before any Stripe call/i.test(run.stdout || ""));
console.log("");

// ── 3. Webhook module ────────────────────────────────────────────────
console.log("Webhook (api/stripe-webhook.js):");
// The webhook constructs `new Stripe(process.env.STRIPE_SECRET_KEY)` at
// module load. Provide a placeholder so the import doesn't throw —
// nothing will actually be sent because we never call the handler.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_for_smoke_only";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

let webhookMod;
let webhookErr;
try {
  webhookMod = await import(pathToFileURL(WEBHOOK_PATH).href);
} catch (e) {
  webhookErr = e;
}
check("webhook module imports without error", !webhookErr,
  webhookErr ? webhookErr.message : "");
check("webhook exports a default handler function",
  webhookMod && typeof webhookMod.default === "function");
check("webhook still disables Vercel body parser (config.api.bodyParser === false)",
  webhookMod?.config?.api?.bodyParser === false);

console.log("");

// ── Summary ──────────────────────────────────────────────────────────
console.log(`Result: ${passed} passed, ${failed} failed (out of ${passed + failed})`);
if (failed > 0) process.exit(1);
console.log("✓ Stripe foundation smoke tests pass");
