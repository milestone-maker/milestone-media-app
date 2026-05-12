// Credit policy + ledger writer for Milestone subscription credits.
//
// Pure functions (tierAllowance / tierRank / compareTiers / computeRenewalGrant)
// encode the policy from the spec. Effectful functions
// (grantCreditsFromInvoice / handleTierChange) take a supabase client as an
// argument so the unit tests can pass a mock without monkey-patching.
//
// Imported by api/stripe-webhook.js and exercised in isolation by
// scripts/test-credit-ledger.mjs.

// ── Pure policy ──────────────────────────────────────────────────────

/** Credits per billing period for each tier. Teams has no auto-grant. */
export function tierAllowance(tier) {
  switch (tier) {
    case "starter": return 1;
    case "pro":     return 2;
    case "elite":   return 4;
    default:        return 0; // teams, null, unknown
  }
}

/** Ordinal rank for tier comparison. Teams is incomparable (null). */
export function tierRank(tier) {
  switch (tier) {
    case "starter": return 1;
    case "pro":     return 2;
    case "elite":   return 3;
    default:        return null; // teams / unknown — incomparable
  }
}

/**
 * Compare two tiers.
 * Returns "same" if equal, "upgrade" if new rank is strictly higher,
 * "downgrade" if new rank is lower OR either tier is incomparable
 * (Teams). The Teams-as-downgrade rule is from the spec — admin
 * handles those transitions manually, so the safe behaviour is no-op.
 */
export function compareTiers(oldTier, newTier) {
  if (oldTier === newTier) return "same";
  const a = tierRank(oldTier);
  const b = tierRank(newTier);
  if (a === null || b === null) return "downgrade";
  if (b > a) return "upgrade";
  return "downgrade";
}

/**
 * Compute the credits to grant on a renewal.
 *
 * @param {string} tier               new period's tier
 * @param {number} prevUnusedCredits  unused credits from the previous period (granted − consumed)
 * @returns {{ credits_granted: number, rolled_over: number }}
 */
export function computeRenewalGrant(tier, prevUnusedCredits = 0) {
  const allowance = tierAllowance(tier);
  // Only Starter rolls over. Pro and Elite forfeit unused credits at period end.
  let rolledOver = 0;
  if (tier === "starter") {
    rolledOver = Math.max(0, Math.min(1, prevUnusedCredits || 0));
  }
  return {
    credits_granted: allowance + rolledOver,
    rolled_over: rolledOver,
  };
}

// ── Effectful helpers (supabase client passed in) ─────────────────────

/**
 * Determine the tier in effect on a subscription invoice by reading the
 * milestone_tier metadata off the first line item's price. Falls back
 * to agent.subscription_tier if metadata is absent.
 */
function tierFromInvoice(invoice, agent) {
  const fromPrice = invoice?.lines?.data?.[0]?.price?.metadata?.milestone_tier;
  if (fromPrice) return fromPrice;
  return agent?.subscription_tier || null;
}

/**
 * Read epoch (seconds) → ISO string. Returns null on null/undefined.
 */
function epochToIso(s) {
  if (s === null || s === undefined) return null;
  return new Date(s * 1000).toISOString();
}

/**
 * Grant credits for a renewal invoice. Idempotent: if a row for this
 * agent + period_start already exists, the unique constraint causes
 * insert to fail, and we swallow the conflict.
 *
 * Returns one of:
 *   { ok: true, inserted: true,  row }
 *   { ok: true, inserted: false, reason: "no-agent" | "no-tier" | "no-period" | "no-allowance" | "duplicate" }
 */
export async function grantCreditsFromInvoice(supabase, invoice) {
  if (!invoice?.customer) {
    return { ok: true, inserted: false, reason: "no-customer" };
  }

  // 1. Find the agent
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id, subscription_tier")
    .eq("stripe_customer_id", invoice.customer)
    .maybeSingle();
  if (agentErr) throw agentErr;
  if (!agent) {
    console.warn(`[credits.grant] no agent for stripe_customer_id=${invoice.customer}`);
    return { ok: true, inserted: false, reason: "no-agent" };
  }

  // 2. Determine tier + period boundaries
  const tier = tierFromInvoice(invoice, agent);
  if (!tier) {
    console.warn(`[credits.grant] could not determine tier for invoice ${invoice.id}`);
    return { ok: true, inserted: false, reason: "no-tier" };
  }
  const periodStartEpoch = invoice?.lines?.data?.[0]?.period?.start;
  const periodEndEpoch   = invoice?.lines?.data?.[0]?.period?.end;
  if (!periodStartEpoch || !periodEndEpoch) {
    console.warn(`[credits.grant] invoice ${invoice.id} missing period bounds`);
    return { ok: true, inserted: false, reason: "no-period" };
  }
  const period_start = epochToIso(periodStartEpoch);
  const period_end   = epochToIso(periodEndEpoch);

  // 3. Compute rollover from previous period (Starter only — but we
  //    fetch unconditionally and let computeRenewalGrant decide).
  let prevUnused = 0;
  const { data: prevRow } = await supabase
    .from("credit_ledger")
    .select("credits_granted, credits_consumed")
    .eq("agent_id", agent.id)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevRow) {
    prevUnused = Math.max(0, (prevRow.credits_granted || 0) - (prevRow.credits_consumed || 0));
  }

  const { credits_granted, rolled_over } = computeRenewalGrant(tier, prevUnused);

  // Teams (or any tier with zero allowance and no rollover) → don't bother inserting
  if (credits_granted === 0) {
    return { ok: true, inserted: false, reason: "no-allowance" };
  }

  // 4. Insert new ledger row; unique constraint absorbs re-deliveries.
  const insert = {
    agent_id: agent.id,
    period_start,
    period_end,
    tier_in_effect: tier,
    credits_granted,
    credits_consumed: 0,
    rollover_in: rolled_over,
  };
  const { data: inserted, error: insertErr } = await supabase
    .from("credit_ledger")
    .insert(insert)
    .select()
    .maybeSingle();

  if (insertErr) {
    // Postgres duplicate-key code is 23505. supabase-js surfaces it on
    // .code. If that's the failure, this is a re-delivery — swallow.
    if (insertErr.code === "23505" || /duplicate key|unique/i.test(insertErr.message || "")) {
      console.log(`[credits.grant] re-delivery for agent ${agent.id} period ${period_start} — already granted`);
      return { ok: true, inserted: false, reason: "duplicate" };
    }
    throw insertErr;
  }

  console.log(`[credits.grant] granted ${credits_granted} credits (rolled over ${rolled_over}) to agent ${agent.id} for ${tier} period starting ${period_start}`);
  return { ok: true, inserted: true, row: inserted };
}

/**
 * Adjust the agent's CURRENT period credit row when the subscription
 * tier changes mid-cycle.
 *
 *   upgrade   → replace current row's tier, replace granted count with
 *               the new tier's full allowance, reset consumed to 0.
 *               Unused credits from the old tier are forfeited.
 *   downgrade → no-op. Agent keeps existing credits through period end.
 *   same      → no-op.
 *
 * Returns:
 *   { ok: true, action: "upgrade" | "downgrade" | "same" | "no-agent" | "no-row" }
 */
export async function handleTierChange(supabase, customerId, oldTier, newTier) {
  const verdict = compareTiers(oldTier, newTier);
  if (verdict === "same")      return { ok: true, action: "same" };
  if (verdict === "downgrade") return { ok: true, action: "downgrade" };

  // Upgrade path: find agent + their current row
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (agentErr) throw agentErr;
  if (!agent) {
    console.warn(`[credits.tierChange] no agent for stripe_customer_id=${customerId}`);
    return { ok: true, action: "no-agent" };
  }

  const nowIso = new Date().toISOString();
  const { data: currentRow, error: rowErr } = await supabase
    .from("credit_ledger")
    .select("id, period_start, period_end")
    .eq("agent_id", agent.id)
    .lte("period_start", nowIso)
    .gte("period_end", nowIso)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rowErr) throw rowErr;
  if (!currentRow) {
    console.warn(`[credits.tierChange] no current period row for agent ${agent.id} — upgrade noted, next renewal will use the new tier`);
    return { ok: true, action: "no-row" };
  }

  const newAllowance = tierAllowance(newTier);
  const { error: updateErr } = await supabase
    .from("credit_ledger")
    .update({
      tier_in_effect: newTier,
      credits_granted: newAllowance,
      credits_consumed: 0,
      // Tier-change replacement is not a rollover — clear that audit field.
      rollover_in: 0,
    })
    .eq("id", currentRow.id);
  if (updateErr) throw updateErr;

  console.log(`[credits.tierChange] upgraded agent ${agent.id}: ${oldTier} → ${newTier}, replaced current row with ${newAllowance} credits`);
  return { ok: true, action: "upgrade" };
}
