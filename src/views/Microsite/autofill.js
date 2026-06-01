// Pure autofill helpers for the microsite publish flow.
//
// When a listing/booking source row resolves, the form fields are populated
// from it — UNLESS we're restoring a previously-published microsite for edit,
// in which case the saved (curated) values must survive untouched. That
// suppression is the fix for the Bug A clobber that silently rewrote
// property_data.address on republish.
//
// Extracted from MicrositeView so the behavior is unit-testable without a
// React renderer: the component calls these from its source effects, and
// scripts/test-microsite-edit-autofill.mjs drives the same functions.

// Next form-state when a listing source row resolves.
// skipAutofill=true → return `data` unchanged (preserve edit-loaded fields).
export function applyListingAutofill(data, listing, skipAutofill) {
  if (skipAutofill) return data;
  return {
    ...data,
    address: listing.address || "",
    city: listing.city || "",
    price: listing.price || "",
    beds: listing.beds ? String(listing.beds) : "",
    baths: listing.baths ? String(listing.baths) : "",
    sqft: listing.sqft ? String(listing.sqft) : "",
    matterportUrl: listing.matterport_url || "",
    videoUrl: listing.youtube_url || "",
  };
}

// Next form-state when a booking source row resolves.
// skipAutofill=true → return `data` unchanged (preserve edit-loaded fields).
export function applyBookingAutofill(data, booking, skipAutofill) {
  if (skipAutofill) return data;
  return {
    ...data,
    address: booking.address || "",
    city: [booking.city, booking.state, booking.zip].filter(Boolean).join(", ") || "",
    agentName: booking.client_name || "",
    matterportUrl: "",
    videoUrl: "",
  };
}
