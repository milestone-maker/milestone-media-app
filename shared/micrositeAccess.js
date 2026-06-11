// ============================================================
// CANONICAL microsite write/access rule — single source of truth.
// ============================================================
// Isomorphic & PURE: this module imports nothing and touches no
// environment (no DB, Stripe, fs, fetch, React). It is imported by BOTH
//   • the serverless endpoint  (api/_lib/entitlement.js → api/publish-microsite.js)
//   • the client editor UI      (src/views/Microsite/index.jsx)
// so the three layers can never disagree on "who may edit a microsite."
//
// The Postgres RLS function public.agent_can_write_microsite(jsonb) in
// supabase/migrations/20250101000031_microsite_beta_and_existing_access.sql
// is the third enforcement layer. It MIRRORS this rule by contract — when
// you change the condition here, change the migration's SQL to match, and
// update scripts/test-entitlement.mjs (which asserts JS↔RLS parity).
//
// ── THE UNIFIED CONDITION ──────────────────────────────────────────────
// An agent may write/access a microsite for a booking when ANY of:
//   (1) role = 'admin', OR
//   (2) is_beta = true, OR
//   (3) an existing microsite row for this booking is owned by the agent
//       (edit / re-publish of something already created), OR
//   (4) Pro/Elite subscription with status in {trialing, active, past_due}, OR
//   (5) (selected_package = 'luxury' OR microsite add-on in selected_addons)
//       AND invoice_paid = true.
//
// Ownership (agent_id = auth.uid()) is ALWAYS required and is enforced by
// each caller, NOT by this rule:
//   • the endpoint checks booking.agent_id === user.id (and passes only an
//     owner-matched existingMicrosite),
//   • the UI computes hasExistingMicrosite from owner-matched rows,
//   • RLS uses auth.uid() in every branch / policy.
// Paths 1–4 do NOT require invoice_paid; only path 5 does.

// Subscription tiers whose plan includes microsite publishing on every
// booking. Starter is deliberately excluded (Essential shoots only).
export const MICROSITE_TIERS = new Set(["pro", "elite"]);

// ── CANONICAL "LIVE microsite" definition — single source of truth ──────
// A microsite is LIVE when it is published AND has not been retired.
// Retirement ("mark sold / take down") sets published = false AND
// retired_at, so either condition failing makes a microsite non-live.
// This is the JS mirror of the SQL predicate MICROSITE_LIVE_SQL below and
// of the column comment in migration 038. The live-cap (step 2) counts
// LIVE microsites per agent — reuse isMicrositeLive() / MICROSITE_LIVE_SQL
// everywhere so the three layers can never disagree on "what counts."
//
// @param {{ published?: boolean, retired_at?: string|null }} m  a microsites row
// @returns {boolean}
export function isMicrositeLive(m) {
  if (!m) return false;
  return m.published === true && (m.retired_at === null || m.retired_at === undefined);
}

// SQL predicate form of isMicrositeLive(), for endpoint count queries and
// any RLS/SQL that must agree with the JS rule. Embed against the microsites
// table (e.g. `where agent_id = $1 and ${MICROSITE_LIVE_SQL}`).
export const MICROSITE_LIVE_SQL = "published = true and retired_at is null";

// ── PER-TIER LIVE-MICROSITE CAP — single source of truth ────────────────
// Max number of CONCURRENT live microsites a tier may have. Keyed by the
// INTERNAL subscription slug (starter/pro/elite) — these are unchanged by
// the Solo/Team/Brokerage display rename; the slugs still live in Stripe
// metadata + agents.subscription_tier. The numbers mirror the pricing.json
// "4 / 8 / 16 included microsites" card copy:
//   starter → Solo → 4,  pro → Team → 8,  elite → Brokerage → 16.
//
// ONLY these three tiers are capped. Any tier NOT listed here (a custom /
// enterprise / future arrangement, or no subscription at all) has NO cap —
// it is handled manually outside the system and must NEVER be auto-blocked.
// Read a cap with micrositeCapForTier(): it returns the number for a capped
// tier, or null for "no cap."
//
// The cap is a CONCURRENT-active limit (retire one to free a slot), NOT a
// per-period allotment. It is enforced in THREE places that must agree:
//   • this module          (withinMicrositeCap — the rule),
//   • api/publish-microsite (counts live rows, applies the rule on NEW publish),
//   • migration 039 RLS fn  (SQL CASE mirrors these numbers + MICROSITE_LIVE_SQL).
// When you change a number here, change the SQL CASE in migration 039 to match.
export const MICROSITE_CAP = { starter: 4, pro: 8, elite: 16 };

// Cap for a given tier slug, or null when the tier is not one of the three
// capped tiers (unknown / custom / enterprise / null → no cap). The SQL
// mirror in migration 039 is a CASE with the same three numbers and ELSE
// NULL — keep them identical.
export function micrositeCapForTier(tier) {
  if (tier && Object.prototype.hasOwnProperty.call(MICROSITE_CAP, tier)) {
    return MICROSITE_CAP[tier];
  }
  return null;
}

// Pure cap rule: may the agent create ONE MORE live microsite?
// • Tier HAS a cap entry  → true when liveCount is strictly below the cap.
// • Tier has NO cap entry → always true (custom/enterprise/unknown tiers are
//   never auto-blocked; they are handled manually outside the system).
//
// CRITICAL — NEW-CREATE ONLY. This gate applies solely to creating a NEW
// microsite. Editing / re-publishing a microsite the agent ALREADY owns is
// fully exempt: callers must NOT invoke this for re-publish, and the
// endpoint/RLS only count+cap on the new-insert path. canWriteMicrosite()'s
// binary entitlement is unchanged; this is an extra layer on top.
//
// @param {{ tier?: string|null, liveCount?: number }} input
// @returns {boolean}
export function withinMicrositeCap({ tier = null, liveCount = 0 } = {}) {
  const cap = micrositeCapForTier(tier);
  if (cap === null) return true;   // no cap for this tier → never blocked
  return (liveCount || 0) < cap;
}

// Subscription statuses treated as active for gating (past_due = grace).
export const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// Denial reason strings. Re-used by the endpoint's 403 body so the UI and
// API speak with one voice.
export const REASON_NO_MICROSITE =
  "this booking doesn't include a microsite — add the microsite add-on, or subscribe to Team or Brokerage to include microsites with every booking";
export const REASON_INVOICE_UNPAID = "invoice has not been paid yet";

/**
 * Does the agent's booking include a microsite add-on?
 * Handles both stored shapes: a bare string "microsite", or an object
 * { id: "microsite", qty: N }.
 * @param {Array<any>} addons
 * @returns {boolean}
 */
export function hasMicrositeAddon(addons) {
  if (!Array.isArray(addons)) return false;
  return addons.some((a) => {
    if (typeof a === "string") return a === "microsite";
    if (a && typeof a === "object") return a.id === "microsite";
    return false;
  });
}

/**
 * The one rule. Pure function of already-resolved, owner-scoped inputs.
 *
 * @param {Object} input
 * @param {string|null} [input.role]              agent role ('admin' | 'agent')
 * @param {boolean}     [input.isBeta]            agents.is_beta
 * @param {boolean}     [input.hasExistingMicrosite] true when a microsite row
 *        for THIS booking already exists AND is owned by the calling agent
 * @param {string|null} [input.subscriptionTier]   agents.subscription_tier
 * @param {string|null} [input.subscriptionStatus] agents.subscription_status
 * @param {string|null} [input.selectedPackage]    booking.selected_package
 * @param {Array<any>}  [input.selectedAddons]     booking.selected_addons
 * @param {boolean}     [input.invoicePaid]        booking.invoice_paid
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canWriteMicrosite({
  role = null,
  isBeta = false,
  hasExistingMicrosite = false,
  subscriptionTier = null,
  subscriptionStatus = null,
  selectedPackage = null,
  selectedAddons = [],
  invoicePaid = false,
} = {}) {
  // (1) admin — global bypass.
  if (role === "admin") return { allowed: true };

  // (2) beta — first-class full microsite access, treated like admin.
  if (isBeta === true) return { allowed: true };

  // (3) existing microsite owned by the agent — always editable/re-publishable.
  if (hasExistingMicrosite === true) return { allowed: true };

  // (4) Pro/Elite subscription in an active/grace status. No invoice required.
  if (MICROSITE_TIERS.has(subscriptionTier) && ACTIVE_STATUSES.has(subscriptionStatus)) {
    return { allowed: true };
  }

  // (5) booking-level entitlement (luxury package OR microsite add-on) AND paid.
  const pkgLuxury = (selectedPackage || "").toLowerCase() === "luxury";
  const addon = hasMicrositeAddon(selectedAddons);
  if ((pkgLuxury || addon) && invoicePaid) {
    return { allowed: true };
  }

  // Denied — pick the most actionable reason. If the only thing missing on
  // the booking-entitlement path is payment, say so; otherwise the booking
  // simply doesn't include a microsite.
  if ((pkgLuxury || addon) && !invoicePaid) {
    return { allowed: false, reason: REASON_INVOICE_UNPAID };
  }
  return { allowed: false, reason: REASON_NO_MICROSITE };
}
