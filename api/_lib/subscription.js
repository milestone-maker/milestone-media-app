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
 * Literal "has an active Stripe subscription" check. Use this when the
 * answer must reflect Stripe state ONLY. For feature gating, use
 * hasFeatureAccess() — it also accepts an active beta grant.
 *
 * @param {{ subscription_status?: string|null } | null | undefined} agent
 *        An agents row loaded server-side (must include subscription_status).
 * @returns {boolean} true when the agent's subscription_status is active.
 */
export function isSubscribed(agent) {
  return !!agent && ACTIVE_STATUSES.has(agent.subscription_status);
}

/**
 * Active beta check, mirroring the rule in shared/micrositeAccess.js:
 * is_beta = true AND (beta_expires_at IS NULL OR beta_expires_at > now()).
 * Null/absent beta_expires_at = never expires (demo-account convention).
 *
 * @param {{ is_beta?: boolean, beta_expires_at?: string|Date|null } | null | undefined} agent
 * @returns {boolean}
 */
export function hasActiveBeta(agent) {
  if (!agent || agent.is_beta !== true) return false;
  const exp = agent.beta_expires_at;
  if (exp === null || exp === undefined) return true;
  return new Date(exp).getTime() > Date.now();
}

/**
 * Unified "may use a subscriber feature" gate. True when the agent has
 * either an active Stripe subscription OR an active beta grant. Server-
 * side feature endpoints (content-generate, social-post, classify-photos,
 * etc.) should call this rather than isSubscribed() directly.
 *
 * @param {{ subscription_status?: string|null, is_beta?: boolean, beta_expires_at?: string|Date|null } | null | undefined} agent
 * @returns {boolean}
 */
export function hasFeatureAccess(agent) {
  return isSubscribed(agent) || hasActiveBeta(agent);
}
