// Server-side subscription check.
//
// Single source of truth for "is this agent subscribed" on the server.
// The status set mirrors ACTIVE_STATUSES in src/views/Subscriptions/index.jsx
// and src/lib/subscription.js — keep all three in sync.
//
// Tier-agnostic: any tier counts as long as the status is active/grace.
// `past_due` is treated as active (Stripe grace period) — matching the
// Subscriptions view and the microsite entitlement check.
//
// Like the other _lib helpers, the leading underscore on the parent folder
// signals this is a private helper, not a deployable Vercel function.

// Subscription statuses that count as "active for gating purposes".
export const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

/**
 * @param {{ subscription_status?: string|null } | null | undefined} agent
 *        An agents row loaded server-side (must include subscription_status).
 * @returns {boolean} true when the agent's subscription_status is active.
 */
export function isSubscribed(agent) {
  return !!agent && ACTIVE_STATUSES.has(agent.subscription_status);
}
