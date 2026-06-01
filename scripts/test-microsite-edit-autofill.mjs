// Regression test for the edit-load autofill clobber (Bug A).
//
// Background: re-opening a published microsite for edit used to overwrite the
// curated property_data (address/city/agent/tour/video) with the raw
// listing/booking source row, silently rewriting it on republish — that's how
// 2410-luxury's address got replaced with an unrelated booking's address.
//
// The fix routes both source effects through applyListingAutofill /
// applyBookingAutofill, gated by skipAutofillRef. This test drives those exact
// helpers to assert:
//   1. On edit-load (skipAutofill=true) curated fields SURVIVE unchanged, even
//      when the source row holds a different (wrong) address.
//   2. A deliberate dropdown pick (skipAutofill=false) DOES re-apply autofill.

import { applyListingAutofill, applyBookingAutofill } from "../src/views/Microsite/autofill.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// The curated form state restored from a published microsite's property_data.
function curated() {
  return {
    address: "2410 Luxury Ave",
    city: "Prosper, Texas, 75078",
    price: "1,500,450",
    beds: "5", baths: "5", sqft: "3800",
    description: "Custom luxury home…",
    agentName: "Tyshawn Miles",
    agentPhone: "2109922014",
    heroImg: "https://example/hero.jpg",
    heroMediaId: "c8dcaa8c-416c-4e07-865d-2819c486bf25",
    features: ["Open Floor Plan", "Custom Kitchen", "Large Lot", ""],
    mediaTypes: ["Photos", "Drone", "3D Tour"],
    matterportUrl: "https://www.zillow.com/view-imx/abc/",
    videoUrl: "https://example/tour.mp4",
  };
}

// A source row whose fields DIFFER from the curated values — the wrong booking
// (the real-world cause: a stray "2410 …" booking owned by another account).
const wrongBooking = {
  id: "01a78a45", address: "2410 Frank Henderson Jr Dr",
  city: "Dallas", state: "TX", zip: "75201", client_name: "Someone Else",
};
const wrongListing = {
  id: "08ab7829", address: "2410 Foxtrail Dr.", city: "Dallas, TX",
  price: "999,000", beds: 3, baths: 2, sqft: 1800,
  matterport_url: "https://other/tour", youtube_url: "https://other/yt",
};

// ── 1. Edit-load suppresses the clobber ──────────────────────────────
console.log("Edit-load (skipAutofill=true) preserves curated fields:");
{
  const before = curated();
  const afterBooking = applyBookingAutofill(before, wrongBooking, true);
  check("booking: address unchanged",  afterBooking.address === "2410 Luxury Ave", afterBooking.address);
  check("booking: city unchanged",     afterBooking.city === "Prosper, Texas, 75078");
  check("booking: agentName unchanged", afterBooking.agentName === "Tyshawn Miles");
  check("booking: matterportUrl unchanged", afterBooking.matterportUrl === "https://www.zillow.com/view-imx/abc/");
  check("booking: videoUrl unchanged", afterBooking.videoUrl === "https://example/tour.mp4");
  check("booking: returns same object (no-op)", afterBooking === before);

  const afterListing = applyListingAutofill(before, wrongListing, true);
  check("listing: address unchanged",  afterListing.address === "2410 Luxury Ave", afterListing.address);
  check("listing: price unchanged",    afterListing.price === "1,500,450");
  check("listing: beds unchanged",     afterListing.beds === "5");
  check("listing: matterportUrl unchanged", afterListing.matterportUrl === "https://www.zillow.com/view-imx/abc/");
  check("listing: videoUrl unchanged", afterListing.videoUrl === "https://example/tour.mp4");
  check("listing: returns same object (no-op)", afterListing === before);
}

// ── 2. The clobber-without-guard proves the gate is what protects ────
// (skipAutofill=false reproduces the OLD buggy overwrite — confirms the test
// would actually catch a regression where the gate stops being honored.)
console.log("\nDeliberate pick (skipAutofill=false) re-applies autofill:");
{
  const before = curated();
  const afterBooking = applyBookingAutofill(before, wrongBooking, false);
  check("booking: address now from source", afterBooking.address === "2410 Frank Henderson Jr Dr");
  check("booking: city joined from source",  afterBooking.city === "Dallas, TX, 75201");
  check("booking: agentName from client_name", afterBooking.agentName === "Someone Else");
  check("booking: tour cleared",  afterBooking.matterportUrl === "");
  check("booking: video cleared", afterBooking.videoUrl === "");
  check("booking: non-source fields preserved (price/beds)", afterBooking.price === "1,500,450" && afterBooking.beds === "5");

  const afterListing = applyListingAutofill(before, wrongListing, false);
  check("listing: address now from source", afterListing.address === "2410 Foxtrail Dr.");
  check("listing: price now from source",   afterListing.price === "999,000");
  check("listing: beds stringified from source", afterListing.beds === "3");
  check("listing: tour/video from source",  afterListing.matterportUrl === "https://other/tour" && afterListing.videoUrl === "https://other/yt");
}

// ── 3. End-to-end edit→republish: the published address survives ─────
// The publish payload sends propertyData.address = data.address. Simulate the
// edit-load + an incidental effect re-fire (bookings refetch) and assert the
// address that would be persisted is the curated one, not the source's.
console.log("\nEdit → (re-fire) → republish keeps the saved address:");
{
  let data = curated();
  // edit-load: effect runs with the microsite's OWN booking (correct addr) under skip=true
  const ownBooking = { id: "a7d908f3", address: "2410 Luxury Ave", city: "Prosper", client_name: "Tyshawn Miles" };
  data = applyBookingAutofill(data, ownBooking, true);
  // incidental re-fire while still editing (e.g. bookings list resettles) — still skipped
  data = applyBookingAutofill(data, ownBooking, true);
  // a stray wrong booking row resolving during the edit session must NOT bleed in
  data = applyBookingAutofill(data, wrongBooking, true);
  const publishedAddress = data.address; // handlePublish maps propertyData.address = data.address
  check("republished address is the curated value", publishedAddress === "2410 Luxury Ave", publishedAddress);
  check("republished address is NOT the stray booking", publishedAddress !== "2410 Frank Henderson Jr Dr");
}

console.log(`\n${passed} passed / ${passed + failed} total`);
process.exit(failed ? 1 : 0);
