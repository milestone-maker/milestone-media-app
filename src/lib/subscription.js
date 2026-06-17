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
 * Literal "has an active Stripe subscription" check. Use this when the
 * answer must reflect Stripe state ONLY (e.g. the Subscriptions view's
 * Subscribe-vs-Manage toggle, or per-shoot credit eligibility in Book).
 * For feature gating, use hasFeatureAccess() — it also accepts an
 * active beta grant.
 *
 * @param {{ subscription_status?: string|null } | null | undefined} profile
 *        Typically useAuth().profile (the agents row, select *).
 * @returns {boolean} true when the profile's subscription_status is active.
 */
export function isSubscribed(profile) {
  return !!profile && ACTIVE_STATUSES.has(profile.subscription_status);
}

/**
 * Active beta check, mirroring the rule in shared/micrositeAccess.js
 * (the unified microsite-access condition): is_beta = true AND
 * (beta_expires_at IS NULL OR beta_expires_at > now()). Null/absent
 * beta_expires_at = never expires (demo-account convention). Once
 * beta_expires_at is in the past, this returns false and the caller
 * naturally falls through to the subscription check.
 *
 * @param {{ is_beta?: boolean, beta_expires_at?: string|Date|null } | null | undefined} profile
 * @returns {boolean}
 */
export function hasActiveBeta(profile) {
  if (!profile || profile.is_beta !== true) return false;
  const exp = profile.beta_expires_at;
  if (exp === null || exp === undefined) return true;
  return new Date(exp).getTime() > Date.now();
}

/**
 * Unified "may use a subscriber feature" gate. True when the agent has
 * either an active Stripe subscription OR an active beta grant. This is
 * the helper UI gates (voice profile, connected accounts, Content tab,
 * server-side feature endpoints) should call. NOT a literal subscription
 * check — for that, use isSubscribed().
 *
 * @param {{ subscription_status?: string|null, is_beta?: boolean, beta_expires_at?: string|Date|null } | null | undefined} profile
 * @returns {boolean}
 */
export function hasFeatureAccess(profile) {
  return isSubscribed(profile) || hasActiveBeta(profile);
}
