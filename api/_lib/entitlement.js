// Reusable entitlement check for microsite publishing.
//
// Imported by /api/publish-microsite.js and exercised in isolation by
// scripts/test-entitlement.mjs.
//
// The leading underscore on the parent folder (_lib) signals to Vercel
// and to humans that this is a private helper, not a deployable function.
// Vercel only auto-routes files directly under /api/. This file is not
// reachable as an HTTP endpoint.

// Subscription tiers that include microsite publishing on every booking.
const MICROSITE_TIERS = new Set(["pro", "elite"]);
// Subscription statuses considered "active for entitlement purposes".
// Matches ACTIVE_STATUSES used elsewhere; past_due is in grace.
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

/**
 * Decide whether the given user is entitled to publish a microsite for
 * the given booking.
 *
 * @param {{ id: string, role?: string }} user
 * @param {{ agent_id: string, invoice_paid: boolean,
 *           selected_package?: string, selected_addons?: any[] } | null} booking
 * @param {{ tier?: string|null, status?: string|null } | null} [subscription]
 *        Optional subscription state for the calling agent. When the
 *        agent is on Pro or Elite with an active/trialing/past_due
 *        status, microsite publishing is included with every booking.
 * @returns {{ entitled: boolean, reason?: string }}
 */
export function checkMicrositeEntitlement(user, booking, subscription = null) {
  if (!user) {
    return { entitled: false, reason: "no authenticated user" };
  }

  // Admins bypass everything.
  if (user.role === "admin") {
    return { entitled: true };
  }

  if (!booking) {
    return { entitled: false, reason: "booking not found" };
  }

  // Ownership
  if (booking.agent_id !== user.id) {
    return { entitled: false, reason: "this booking does not belong to you" };
  }

  // Invoice must be paid (credit-covered bookings have invoice_paid set
  // to true at insert time — see api/create-booking.js).
  if (!booking.invoice_paid) {
    return { entitled: false, reason: "invoice has not been paid yet" };
  }

  // Booking-level microsite signals
  const pkg = (booking.selected_package || "").toLowerCase();
  const hasLuxury = pkg === "luxury";
  const addons = Array.isArray(booking.selected_addons) ? booking.selected_addons : [];
  const hasMicrositeAddon = addons.some(a => {
    if (typeof a === "string") return a === "microsite";
    if (a && typeof a === "object") return a.id === "microsite";
    return false;
  });

  // Subscription-level entitlement
  const hasMicrositeSub =
    !!subscription &&
    MICROSITE_TIERS.has(subscription.tier) &&
    ACTIVE_STATUSES.has(subscription.status);

  if (!hasLuxury && !hasMicrositeAddon && !hasMicrositeSub) {
    return {
      entitled: false,
      reason: "this booking doesn't include a microsite — add the microsite add-on, or subscribe to Pro or Elite to include microsites with every booking",
    };
  }

  return { entitled: true };
}
