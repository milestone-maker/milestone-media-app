// Reusable entitlement check for microsite publishing.
//
// Imported by /api/publish-microsite.js and exercised in isolation by
// scripts/test-entitlement.mjs.
//
// The leading underscore on the parent folder (_lib) signals to Vercel
// and to humans that this is a private helper, not a deployable function.
// Vercel only auto-routes files directly under /api/. This file is not
// reachable as an HTTP endpoint.
//
// ─── FUTURE: subscription gating ──────────────────────────────────────
// When the subscription billing phase ships, an additional branch will
// go right after the admin check below: if the user has an active
// microsite-eligible subscription (Pro, Elite, or Teams), they are
// entitled regardless of booking-level invoice/package state. That
// branch will read a `subscription_status` (and possibly
// `subscription_tier`) column from the agents table that does not exist
// yet. Until those columns are added, entitlement is gated on
// booking-level state only.
// ──────────────────────────────────────────────────────────────────────

/**
 * Decide whether the given user is entitled to publish a microsite for
 * the given booking.
 *
 * @param {{ id: string, role?: string }} user
 * @param {{ agent_id: string, invoice_paid: boolean,
 *           selected_package?: string, selected_addons?: any[] } | null} booking
 * @returns {{ entitled: boolean, reason?: string }}
 */
export function checkMicrositeEntitlement(user, booking) {
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

  // Invoice must be paid
  if (!booking.invoice_paid) {
    return { entitled: false, reason: "invoice has not been paid yet" };
  }

  // Package tier OR microsite add-on
  const pkg = (booking.selected_package || "").toLowerCase();
  const hasLuxury = pkg === "luxury";

  const addons = Array.isArray(booking.selected_addons) ? booking.selected_addons : [];
  const hasMicrositeAddon = addons.some(a => {
    if (typeof a === "string") return a === "microsite";
    if (a && typeof a === "object") return a.id === "microsite";
    return false;
  });

  if (!hasLuxury && !hasMicrositeAddon) {
    return {
      entitled: false,
      reason: "this booking does not include a microsite — add the microsite add-on to enable publishing",
    };
  }

  return { entitled: true };
}
