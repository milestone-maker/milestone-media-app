// Client-side subscription check.
//
// Single source of truth for "is this agent subscribed" on the front end.
// The status set mirrors ACTIVE_STATUSES in src/views/Subscriptions/index.jsx
// and api/_lib/subscription.js — keep all three in sync.
//
// Tier-agnostic: any tier counts as long as the status is active/grace.
// `past_due` is treated as active (Stripe grace period) — matching the
// Subscriptions view and the microsite entitlement check.

// Subscription statuses that count as "active for gating purposes".
export const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

/**
 * @param {{ subscription_status?: string|null } | null | undefined} profile
 *        Typically useAuth().profile (the agents row, select *).
 * @returns {boolean} true when the profile's subscription_status is active.
 */
export function isSubscribed(profile) {
  return !!profile && ACTIVE_STATUSES.has(profile.subscription_status);
}
