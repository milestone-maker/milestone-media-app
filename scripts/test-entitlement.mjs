#!/usr/bin/env node
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
    name: "Pro subscriber + own booking, invoice NOT paid → denied (invoice still required)",
    user: alice,
    subscription: { tier: "pro", status: "active" },
    booking: bookingFor(alice.id, { invoice_paid: false, selected_package: "essential", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /invoice has not been paid/i },
  },
];

// ── Run ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = checkMicrositeEntitlement(c.user, c.booking, c.subscription);
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
