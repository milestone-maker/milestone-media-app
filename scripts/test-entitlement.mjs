#!/usr/bin/env node

// Fail loudly: any unhandled error in this test script must
// translate to a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });
// Unit-tests the microsite entitlement helper in isolation.
// No DB / Stripe / email / storage calls — pure-function asserts.
//
// Run from the milestone-media-app repo root:
//   node scripts/test-entitlement.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = resolve(__dirname, "..", "api", "_lib", "entitlement.js");

const { checkMicrositeEntitlement } = await import(HELPER_PATH);

const SHARED_PATH = resolve(__dirname, "..", "shared", "micrositeAccess.js");
const { withinMicrositeCap, micrositeCapForTier } = await import(SHARED_PATH);

// ── Fixtures ──────────────────────────────────────────────────────────
const admin = { id: "admin-uuid", role: "admin" };
const alice = { id: "agent-alice", role: "agent" };
const bob   = { id: "agent-bob",   role: "agent" };

function bookingFor(agentId, opts = {}) {
  return {
    id: "booking-1",
    agent_id: agentId,
    invoice_paid: opts.invoice_paid ?? false,
    selected_package: opts.selected_package ?? null,
    selected_addons: opts.selected_addons ?? [],
  };
}

// ── Test cases ────────────────────────────────────────────────────────
const cases = [
  {
    name: "admin user + any booking → entitled",
    user: admin,
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential" }),
    expect: { entitled: true },
  },
  {
    name: "agent + booking they don't own → denied (ownership)",
    user: alice,
    booking: bookingFor(bob.id, { invoice_paid: true, selected_package: "luxury" }),
    expect: { entitled: false, reasonMatch: /does not belong to you/i },
  },
  {
    name: "agent + own booking, invoice not paid → denied (invoice)",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "luxury" }),
    expect: { entitled: false, reasonMatch: /invoice has not been paid/i },
  },
  {
    name: "agent + own booking, paid, Essential, no addons → denied (no microsite)",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /(does not|doesn't) include a microsite/i },
  },
  {
    name: "agent + own booking, paid, Signature, no addons → denied (no microsite)",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "signature", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /(does not|doesn't) include a microsite/i },
  },
  {
    name: "agent + own booking, paid, Signature, microsite as string → entitled",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "signature", selected_addons: ["microsite"] }),
    expect: { entitled: true },
  },
  {
    name: "agent + own booking, paid, Signature, microsite as object → entitled",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "signature", selected_addons: [{ id: "microsite", qty: 1 }] }),
    expect: { entitled: true },
  },
  {
    name: "agent + own booking, paid, Luxury, no addons → entitled",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "luxury", selected_addons: [] }),
    expect: { entitled: true },
  },

  // ── Subscription-path cases (added in migration 014 / Stripe final) ──
  {
    name: "Pro subscriber + own booking, paid, Essential, no addons → entitled (subscription path)",
    user: alice,
    subscription: { tier: "pro", status: "active" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },
  {
    name: "Elite subscriber + own booking, paid, Essential, no addons → entitled (subscription path)",
    user: alice,
    subscription: { tier: "elite", status: "active" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },
  {
    name: "Starter subscriber + own booking, paid, Essential, no addons → denied (Starter excluded)",
    user: alice,
    subscription: { tier: "starter", status: "active" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /does not include a microsite|doesn't include a microsite/i },
  },
  {
    name: "Pro but status canceled → denied",
    user: alice,
    subscription: { tier: "pro", status: "canceled" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /does not include a microsite|doesn't include a microsite/i },
  },
  {
    name: "Pro but status incomplete → denied",
    user: alice,
    subscription: { tier: "pro", status: "incomplete" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /does not include a microsite|doesn't include a microsite/i },
  },
  {
    name: "Pro with past_due → entitled (grace period)",
    user: alice,
    subscription: { tier: "pro", status: "past_due" },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },
  {
    name: "Pro subscriber + someone else's booking → denied (ownership trumps)",
    user: alice,
    subscription: { tier: "pro", status: "active" },
    booking: bookingFor(bob.id, { invoice_paid: true, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /does not belong to you/i },
  },
  {
    // Policy change (migration 031 / shared rule): subscription path (4) no
    // longer requires invoice_paid. A Pro/active agent is entitled even on an
    // unpaid, non-microsite booking.
    name: "Pro subscriber + own booking, invoice NOT paid → entitled (sub path needs no invoice)",
    user: alice,
    subscription: { tier: "pro", status: "active" },
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },

  // ── Beta path (2) ──────────────────────────────────────────────────
  {
    name: "beta agent + own booking, Essential, no addons, unpaid → entitled (beta path)",
    user: alice,
    opts: { isBeta: true },
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },
  {
    name: "beta agent + someone else's booking → entitled (beta is trusted, bypasses ownership like admin)",
    user: alice,
    opts: { isBeta: true },
    booking: bookingFor(bob.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },

  // ── Existing-microsite path (3) ────────────────────────────────────
  {
    name: "existing microsite owned by agent + Starter + unpaid + Essential → entitled (existing path)",
    user: alice,
    subscription: { tier: "starter", status: "active" },
    opts: { existingMicrosite: { agent_id: alice.id } },
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: true },
  },
  {
    name: "existing microsite owned by SOMEONE ELSE + own booking, Essential, unpaid → denied",
    user: alice,
    opts: { existingMicrosite: { agent_id: bob.id } },
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /(does not|doesn't) include a microsite/i },
  },

  // ── The exact 1954 Toronto production fixture ──────────────────────
  // signature package, no addons, invoice paid, Pro/active subscription,
  // and an existing owned microsite → must ALLOW (this is the bug we fixed).
  {
    name: "1954 Toronto: signature, [] addons, paid, pro/active, existing owned row → entitled",
    user: alice,
    subscription: { tier: "pro", status: "active" },
    opts: { existingMicrosite: { agent_id: alice.id } },
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "signature", selected_addons: [] }),
    expect: { entitled: true },
  },
];

// ── Run ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = checkMicrositeEntitlement(c.user, c.booking, c.subscription, c.opts);
  const want = c.expect;
  let ok = got.entitled === want.entitled;
  if (ok && want.reasonMatch) {
    ok = !!got.reason && want.reasonMatch.test(got.reason);
  }
  if (ok) {
    console.log(`  ✓ ${c.name}`);
    passed++;
  } else {
    console.log(`  ✗ ${c.name}`);
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
    failed++;
  }
}

// ── Per-tier live-microsite cap (withinMicrositeCap) ───────────────────
// The cap is the NEW-create gate layered on top of the binary entitlement.
// These assert the pure rule + the no-cap-tier behavior + the exemption.
const capCases = [
  // capped tiers: under cap → allowed, at/over cap → blocked
  { name: "starter under cap (3 < 4) → allowed",  args: { tier: "starter", liveCount: 3 }, want: true },
  { name: "starter at cap (4 >= 4) → blocked",    args: { tier: "starter", liveCount: 4 }, want: false },
  { name: "starter over cap (5 >= 4) → blocked",  args: { tier: "starter", liveCount: 5 }, want: false },
  { name: "pro under cap (7 < 8) → allowed",      args: { tier: "pro", liveCount: 7 },     want: true },
  { name: "pro at cap (8) → blocked",             args: { tier: "pro", liveCount: 8 },     want: false },
  { name: "elite under cap (15 < 16) → allowed",  args: { tier: "elite", liveCount: 15 },  want: true },
  { name: "elite at cap (16) → blocked",          args: { tier: "elite", liveCount: 16 },  want: false },
  // no-cap tiers: ALWAYS allowed regardless of count
  { name: "teams (no cap entry) at 999 → allowed",      args: { tier: "teams", liveCount: 999 },      want: true },
  { name: "enterprise (no cap entry) at 999 → allowed", args: { tier: "enterprise", liveCount: 999 }, want: true },
  { name: "null tier (no subscription) at 999 → allowed", args: { tier: null, liveCount: 999 },       want: true },
];
for (const c of capCases) {
  const got = withinMicrositeCap(c.args);
  if (got === c.want) { console.log(`  ✓ cap: ${c.name}`); passed++; }
  else { console.log(`  ✗ cap: ${c.name}\n      expected ${c.want}, got ${got}`); failed++; }
}

// micrositeCapForTier: numbers for the three, null for everything else
const capLookup = [
  ["starter", 4], ["pro", 8], ["elite", 16], ["teams", null], ["enterprise", null], [null, null],
];
for (const [tier, want] of capLookup) {
  const got = micrositeCapForTier(tier);
  if (got === want) { console.log(`  ✓ cap-lookup: ${tier} → ${want}`); passed++; }
  else { console.log(`  ✗ cap-lookup: ${tier} → expected ${want}, got ${got}`); failed++; }
}

// Exemption: an existing owned microsite stays entitled (binary rule) even
// for a capped tier — the cap is never applied to re-publish/edit. (The
// endpoint enforces the new-create-only gate; checkMicrositeEntitlement
// itself is cap-free and must keep returning entitled here.)
{
  const got = checkMicrositeEntitlement(
    alice,
    bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    { tier: "starter", status: "active" },
    { existingMicrosite: { agent_id: alice.id } },
  );
  if (got.entitled === true) { console.log("  ✓ cap-exempt: existing owned microsite stays entitled (no cap on re-publish)"); passed++; }
  else { console.log(`  ✗ cap-exempt: existing owned microsite should stay entitled, got ${JSON.stringify(got)}`); failed++; }
}

console.log("");
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ Entitlement helper + live-microsite cap are valid");
