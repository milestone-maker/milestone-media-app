#!/usr/bin/env node

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// UI ACCESS test for the microsite editor's micrositeAccessible gate.
//
// The editor (src/views/Microsite/index.jsx) computes micrositeAccessible
// by feeding canWriteMicrosite() a set of inputs derived from profile +
// the selected booking/listing. This test reproduces that EXACT input
// mapping (mirrored from the component) and asserts the resulting
// access decision for the three fixtures called out in the plan. It
// guards the UI's contract with the shared rule without standing up a
// full React/jsdom render.
//
//   node scripts/test-microsite-ui-access.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULE_PATH = resolve(__dirname, "..", "shared", "micrositeAccess.js");
const { canWriteMicrosite } = await import(RULE_PATH);

// Mirror of the component's micrositeAccessible computation (index.jsx).
// profile = useAuth().profile (agents row). myMicrosites = owner-scoped rows.
function uiMicrositeAccessible({ profile, sourceType, selectedBooking, selectedListing, selectedBookingId, publishedSlug, myMicrosites = [] }) {
  const invoicePaid = sourceType === "booking" ? !!selectedBooking?.invoice_paid : true;
  const isBeta = profile?.is_beta === true;
  const hasExistingMicrosite =
    (!!selectedBookingId && myMicrosites.some(m => m.property_data?.booking_id === selectedBookingId)) ||
    (!!publishedSlug && myMicrosites.some(m => m.slug === publishedSlug));
  return canWriteMicrosite({
    role: profile?.role || null,
    isBeta,
    hasExistingMicrosite,
    subscriptionTier: profile?.subscription_tier ?? null,
    subscriptionStatus: profile?.subscription_status ?? null,
    selectedPackage:
      sourceType === "booking"
        ? (selectedBooking?.selected_package ?? null)
        : (selectedListing?.package ?? null),
    selectedAddons:
      sourceType === "booking"
        ? (selectedBooking?.selected_addons ?? [])
        : (selectedListing?.microsite_addon === true ? ["microsite"] : []),
    invoicePaid,
  }).allowed;
}

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Fixture 1 — the 1954 Toronto / Pro case: signature booking, no addons,
// paid, Pro/active, with an existing owned microsite loaded for edit.
// micrositeAccessible MUST be true (paywall hidden).
{
  const accessible = uiMicrositeAccessible({
    profile: { role: "agent", is_beta: false, subscription_tier: "pro", subscription_status: "active" },
    sourceType: "booking",
    selectedBookingId: "booking-toronto",
    selectedBooking: { id: "booking-toronto", selected_package: "signature", selected_addons: [], invoice_paid: true },
    publishedSlug: "1954-toronto-57402083",
    myMicrosites: [{ slug: "1954-toronto-57402083", property_data: { booking_id: "booking-toronto" } }],
  });
  check("Toronto/Pro fixture → accessible (paywall hidden)", accessible === true);
}

// Fixture 2 — Starter agent, signature booking, no addons, no existing
// microsite. Paywall MUST still show (not accessible).
{
  const accessible = uiMicrositeAccessible({
    profile: { role: "agent", is_beta: false, subscription_tier: "starter", subscription_status: "active" },
    sourceType: "booking",
    selectedBookingId: "booking-new",
    selectedBooking: { id: "booking-new", selected_package: "signature", selected_addons: [], invoice_paid: true },
    publishedSlug: null,
    myMicrosites: [],
  });
  check("Starter + non-luxury + no existing microsite → NOT accessible (paywall shows)", accessible === false);
}

// Fixture 3 — beta agent always sees the editor, even on an unpaid
// non-microsite booking with no subscription.
{
  const accessible = uiMicrositeAccessible({
    profile: { role: "agent", is_beta: true, subscription_tier: null, subscription_status: null },
    sourceType: "booking",
    selectedBookingId: "booking-any",
    selectedBooking: { id: "booking-any", selected_package: "essential", selected_addons: [], invoice_paid: false },
    publishedSlug: null,
    myMicrosites: [],
  });
  check("beta agent → accessible regardless of package/invoice", accessible === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log("✓ UI micrositeAccessible mapping is correct");
