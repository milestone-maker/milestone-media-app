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

console.log("");
console.log(`Result: ${passed} passed, ${failed} failed (out of ${cases.length})`);
if (failed > 0) process.exit(1);
console.log("✓ Entitlement helper is valid");
