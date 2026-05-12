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
    expect: { entitled: false, reasonMatch: /does not include a microsite/i },
  },
  {
    name: "agent + own booking, paid, Signature, no addons → denied (no microsite)",
    user: alice,
    booking: bookingFor(alice.id, { invoice_paid: true, selected_package: "signature", selected_addons: [] }),
    expect: { entitled: false, reasonMatch: /does not include a microsite/i },
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
];

// ── Run ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = checkMicrositeEntitlement(c.user, c.booking);
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
