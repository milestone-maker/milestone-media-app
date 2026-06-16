// Reusable entitlement check for microsite publishing.
//
// Imported by /api/publish-microsite.js and exercised in isolation by
// scripts/test-entitlement.mjs.
//
// The decision logic itself lives in the canonical, isomorphic rule
// module shared/micrositeAccess.js — the SAME module the client editor UI
// imports. This file is the server-side adapter: it enforces the
// authorization preconditions (authenticated user, booking exists,
// ownership) and wraps the rule's denial reason into the { entitled,
// reason } shape the endpoint returns as a 403 body.
//
// The leading underscore on the parent folder (_lib) signals to Vercel
// and to humans that this is a private helper, not a deployable function.
// Vercel only auto-routes files directly under /api/. This file is not
// reachable as an HTTP endpoint.

import { canWriteMicrosite } from "../../shared/micrositeAccess.js";

/**
 * Decide whether the given user is entitled to publish a microsite for
 * the given booking.
 *
 * Admins and beta agents are trusted and bypass the ownership gate
 * (mirroring how admin has always worked). For every other path,
 * ownership of the booking is required, and an existing microsite only
 * counts when it is owned by the calling agent.
 *
 * @param {{ id: string, role?: string }} user
 * @param {{ agent_id: string, invoice_paid: boolean,
 *           selected_package?: string, selected_addons?: any[] } | null} booking
 * @param {{ tier?: string|null, status?: string|null } | null} [subscription]
 *        Optional subscription state for the calling agent. Pro/Elite with
 *        an active/trialing/past_due status includes microsites on every
 *        booking (no invoice required).
 * @param {{ isBeta?: boolean,
 *           betaExpiresAt?: string|Date|null,
 *           existingMicrosite?: { agent_id?: string } | null }} [opts]
 *        isBeta: the agents.is_beta flag. betaExpiresAt: agents.beta_expires_at
 *        — null/undefined = never expires; a past instant means the beta grant
 *        no longer applies (the caller falls through to other access paths in
 *        canWriteMicrosite — it is NOT an outright deny). existingMicrosite: a
 *        microsite row already saved for this booking (or null) — only honored
 *        when it is owned by `user`.
 * @returns {{ entitled: boolean, reason?: string }}
 */
export function checkMicrositeEntitlement(user, booking, subscription = null, opts = {}) {
  if (!user) {
    return { entitled: false, reason: "no authenticated user" };
  }

  const isBeta = opts.isBeta === true;
  const betaExpiresAt = opts.betaExpiresAt ?? null;
  const betaActive =
    isBeta &&
    (betaExpiresAt === null || new Date(betaExpiresAt).getTime() > Date.now());
  // Only an ACTIVE beta (not an expired one) is trusted to bypass the
  // ownership gate, mirroring the JS rule. Admin is always trusted.
  const trusted = user.role === "admin" || betaActive;

  // Ownership preconditions apply to everyone EXCEPT trusted roles
  // (admin/beta), which may act on any booking — preserving the
  // long-standing admin bypass and extending it to beta.
  if (!trusted) {
    if (!booking) {
      return { entitled: false, reason: "booking not found" };
    }
    if (booking.agent_id !== user.id) {
      return { entitled: false, reason: "this booking does not belong to you" };
    }
  }

  // An existing microsite only counts toward access when the calling agent
  // owns it (path 3). A missing row, or one owned by someone else, is false.
  const existing = opts.existingMicrosite || null;
  const hasExistingMicrosite = !!existing && existing.agent_id === user.id;

  const { allowed, reason } = canWriteMicrosite({
    role: user.role || null,
    isBeta,
    betaExpiresAt,
    hasExistingMicrosite,
    subscriptionTier: subscription?.tier ?? null,
    subscriptionStatus: subscription?.status ?? null,
    selectedPackage: booking?.selected_package ?? null,
    selectedAddons: booking?.selected_addons ?? [],
    invoicePaid: !!booking?.invoice_paid,
  });

  return allowed ? { entitled: true } : { entitled: false, reason };
}
