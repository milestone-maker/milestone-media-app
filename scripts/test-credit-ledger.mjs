#!/usr/bin/env node
// Unit tests for the credit-ledger logic.
// No real Stripe or database — both clients are mocks. Tests cover:
//   • pure policy: tier allowance, ranks, rollover math
//   • grantCreditsFromInvoice across Starter / Pro / Elite renewal scenarios
//   • idempotency on re-delivery (unique-constraint conflict swallowed)
//   • handleTierChange for upgrade / downgrade / same / unknown customer
//
// Run from the milestone-media-app repo root:
//   node scripts/test-credit-ledger.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CREDITS_PATH = resolve(REPO_ROOT, "api", "_lib", "credits.js");

const mod = await import(pathToFileURL(CREDITS_PATH).href);
const {
  tierAllowance,
  tierRank,
  compareTiers,
  computeRenewalGrant,
  grantCreditsFromInvoice,
  handleTierChange,
} = mod;

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// ── Pure policy ──────────────────────────────────────────────────────
console.log("Pure policy:");
check("tierAllowance starter = 1", tierAllowance("starter") === 1);
check("tierAllowance pro = 2",     tierAllowance("pro")     === 2);
check("tierAllowance elite = 4",   tierAllowance("elite")   === 4);
check("tierAllowance teams = 0",   tierAllowance("teams")   === 0);
check("tierAllowance unknown = 0", tierAllowance("garbage") === 0);

check("tierRank starter=1, pro=2, elite=3",
  tierRank("starter") === 1 && tierRank("pro") === 2 && tierRank("elite") === 3);
check("tierRank teams = null (incomparable)", tierRank("teams") === null);

check("compareTiers starter→starter = same", compareTiers("starter", "starter") === "same");
check("compareTiers starter→pro = upgrade",  compareTiers("starter", "pro") === "upgrade");
check("compareTiers pro→elite = upgrade",    compareTiers("pro", "elite") === "upgrade");
check("compareTiers elite→pro = downgrade",  compareTiers("elite", "pro") === "downgrade");
check("compareTiers pro→starter = downgrade", compareTiers("pro", "starter") === "downgrade");
check("compareTiers anything→teams = downgrade (incomparable, safe)",
  compareTiers("pro", "teams") === "downgrade" && compareTiers("starter", "teams") === "downgrade");
check("compareTiers teams→pro = downgrade (incomparable, safe)",
  compareTiers("teams", "pro") === "downgrade");

check("computeRenewalGrant starter, 0 prev = {granted:1, rolled:0}",
  JSON.stringify(computeRenewalGrant("starter", 0)) === JSON.stringify({ credits_granted: 1, rolled_over: 0 }));
check("computeRenewalGrant starter, 1 prev = {granted:2, rolled:1}",
  JSON.stringify(computeRenewalGrant("starter", 1)) === JSON.stringify({ credits_granted: 2, rolled_over: 1 }));
check("computeRenewalGrant starter, 5 prev (cap) = {granted:2, rolled:1}",
  JSON.stringify(computeRenewalGrant("starter", 5)) === JSON.stringify({ credits_granted: 2, rolled_over: 1 }));
check("computeRenewalGrant pro, 99 prev = {granted:2, rolled:0} (no rollover)",
  JSON.stringify(computeRenewalGrant("pro", 99)) === JSON.stringify({ credits_granted: 2, rolled_over: 0 }));
check("computeRenewalGrant elite, 10 prev = {granted:4, rolled:0} (no rollover)",
  JSON.stringify(computeRenewalGrant("elite", 10)) === JSON.stringify({ credits_granted: 4, rolled_over: 0 }));
console.log("");

// ── Supabase mock factory ────────────────────────────────────────────
function makeSupabase({ agent, prevCreditRow, currentCreditRow, insertError, updateError } = {}) {
  const calls = {
    selectAgents: [],
    selectPrevCredits: [],
    selectCurrentCredits: [],
    inserts: [],
    updates: [],
  };

  // Builder for chainable .from() queries
  function chain(table) {
    const q = { table, _filters: [], _order: null, _limit: null };

    q.select = (cols) => { q._cols = cols; return q; };
    q.eq     = (col, val) => { q._filters.push(["eq", col, val]); return q; };
    q.lte    = (col, val) => { q._filters.push(["lte", col, val]); return q; };
    q.gte    = (col, val) => { q._filters.push(["gte", col, val]); return q; };
    q.order  = (col, opts) => { q._order = [col, opts]; return q; };
    q.limit  = (n) => { q._limit = n; return q; };

    q.maybeSingle = async () => {
      if (table === "agents") {
        calls.selectAgents.push({ filters: q._filters });
        return { data: agent || null, error: null };
      }
      if (table === "credit_ledger") {
        // "Previous" row query: just eq(agent_id) + order by period_end desc, limit 1
        const hasOnlyAgentFilter = q._filters.length === 1 && q._filters[0][0] === "eq" && q._filters[0][1] === "agent_id";
        if (hasOnlyAgentFilter) {
          calls.selectPrevCredits.push({ filters: q._filters });
          return { data: prevCreditRow || null, error: null };
        }
        // "Current" row query: agent_id + period_start ≤ now ≤ period_end
        calls.selectCurrentCredits.push({ filters: q._filters });
        return { data: currentCreditRow || null, error: null };
      }
      return { data: null, error: null };
    };

    q.single = q.maybeSingle;

    q.insert = (row) => {
      calls.inserts.push({ table, row });
      const result = {
        select: () => ({
          maybeSingle: async () => {
            if (insertError) return { data: null, error: insertError };
            return { data: { id: "row_" + Math.random().toString(36).slice(2, 9), ...row }, error: null };
          },
        }),
      };
      return result;
    };

    q.update = (patch) => {
      calls.updates.push({ table, patch, filters: [] });
      const u = { _filters: [] };
      u.eq = (col, val) => {
        u._filters.push(["eq", col, val]);
        calls.updates[calls.updates.length - 1].filters = u._filters;
        return u;
      };
      u.then = (resolve) => resolve({ error: updateError || null });
      return u;
    };

    return q;
  }

  return {
    calls,
    from: (table) => chain(table),
  };
}

function invoiceFor({ customerId = "cus_x", tier, periodStartEpoch = 1_700_000_000, periodEndEpoch = 1_702_592_000 } = {}) {
  return {
    id: "in_" + Math.random().toString(36).slice(2, 9),
    customer: customerId,
    lines: {
      data: [{
        period: { start: periodStartEpoch, end: periodEndEpoch },
        price: { metadata: tier ? { milestone_tier: tier } : {} },
      }],
    },
  };
}

// ── grantCreditsFromInvoice tests ────────────────────────────────────
console.log("grantCreditsFromInvoice:");

{
  // Starter, no previous unused
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "starter" },
    prevCreditRow: null,
  });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "starter" }));
  const insert = supabase.calls.inserts[0]?.row;
  check("starter renewal, no prev → inserts row",
    out.inserted === true && !!insert, JSON.stringify(out));
  check("  granted=1, rollover_in=0",
    insert?.credits_granted === 1 && insert?.rollover_in === 0);
  check("  credits_consumed=0", insert?.credits_consumed === 0);
  check("  tier_in_effect=starter", insert?.tier_in_effect === "starter");
}

{
  // Starter, 1 unused going in
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "starter" },
    prevCreditRow: { credits_granted: 1, credits_consumed: 0 },
  });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "starter" }));
  const insert = supabase.calls.inserts[0]?.row;
  check("starter renewal, 1 unused → granted=2, rollover_in=1",
    out.inserted === true && insert?.credits_granted === 2 && insert?.rollover_in === 1);
}

{
  // Starter, 5 unused (defensive cap)
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "starter" },
    prevCreditRow: { credits_granted: 5, credits_consumed: 0 },
  });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "starter" }));
  const insert = supabase.calls.inserts[0]?.row;
  check("starter renewal, 5 unused → granted=2, rollover_in=1 (capped)",
    out.inserted === true && insert?.credits_granted === 2 && insert?.rollover_in === 1);
}

{
  // Pro renewal — no rollover even with leftover credits
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "pro" },
    prevCreditRow: { credits_granted: 2, credits_consumed: 0 },
  });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "pro" }));
  const insert = supabase.calls.inserts[0]?.row;
  check("pro renewal → granted=2, rollover_in=0",
    out.inserted === true && insert?.credits_granted === 2 && insert?.rollover_in === 0);
}

{
  // Elite renewal — no rollover
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "elite" },
    prevCreditRow: { credits_granted: 4, credits_consumed: 1 },
  });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "elite" }));
  const insert = supabase.calls.inserts[0]?.row;
  check("elite renewal → granted=4, rollover_in=0",
    out.inserted === true && insert?.credits_granted === 4 && insert?.rollover_in === 0);
}

{
  // Re-delivery of the same renewal event — unique-constraint conflict
  const dupeError = { code: "23505", message: "duplicate key value violates unique constraint" };
  const supabase = makeSupabase({
    agent: { id: "agent-1", subscription_tier: "starter" },
    prevCreditRow: null,
    insertError: dupeError,
  });
  let threw = false;
  let out;
  try { out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "starter" })); }
  catch (e) { threw = true; }
  check("re-delivery (duplicate unique key) does not throw", !threw);
  check("re-delivery returns inserted=false, reason=duplicate",
    out?.inserted === false && out?.reason === "duplicate");
}

{
  // Unknown customer (no agent match)
  const supabase = makeSupabase({ agent: null });
  const out = await grantCreditsFromInvoice(supabase, invoiceFor({ tier: "starter" }));
  check("unknown customer → no-agent, no insert",
    out.inserted === false && out.reason === "no-agent" && supabase.calls.inserts.length === 0);
}

console.log("");

// ── handleTierChange tests ───────────────────────────────────────────
console.log("handleTierChange:");

{
  // Upgrade Starter → Pro: current row replaced with 2 credits
  const supabase = makeSupabase({
    agent: { id: "agent-1" },
    currentCreditRow: { id: "row-1", period_start: "2026-01-01", period_end: "2026-02-01" },
  });
  const out = await handleTierChange(supabase, "cus_1", "starter", "pro");
  check("starter→pro upgrade → action=upgrade", out.action === "upgrade");
  const up = supabase.calls.updates[0];
  check("  update targets credit_ledger", up?.table === "credit_ledger");
  check("  sets tier_in_effect=pro, credits_granted=2, credits_consumed=0, rollover_in=0",
    up?.patch?.tier_in_effect === "pro" &&
    up?.patch?.credits_granted === 2 &&
    up?.patch?.credits_consumed === 0 &&
    up?.patch?.rollover_in === 0);
  check("  update filtered by current row id",
    up?.filters?.some(([op, col, val]) => op === "eq" && col === "id" && val === "row-1"));
}

{
  // Upgrade Pro → Elite: current row replaced with 4 credits
  const supabase = makeSupabase({
    agent: { id: "agent-2" },
    currentCreditRow: { id: "row-2", period_start: "2026-01-01", period_end: "2026-02-01" },
  });
  const out = await handleTierChange(supabase, "cus_2", "pro", "elite");
  check("pro→elite upgrade → action=upgrade", out.action === "upgrade");
  const up = supabase.calls.updates[0];
  check("  sets credits_granted=4",
    up?.patch?.credits_granted === 4 && up?.patch?.tier_in_effect === "elite");
}

{
  // Downgrade Pro → Starter: no-op
  const supabase = makeSupabase({
    agent: { id: "agent-3" },
    currentCreditRow: { id: "row-3", period_start: "2026-01-01", period_end: "2026-02-01" },
  });
  const out = await handleTierChange(supabase, "cus_3", "pro", "starter");
  check("pro→starter downgrade → action=downgrade, no DB writes",
    out.action === "downgrade" && supabase.calls.updates.length === 0);
}

{
  // No tier change
  const supabase = makeSupabase({ agent: { id: "agent-4" } });
  const out = await handleTierChange(supabase, "cus_4", "pro", "pro");
  check("no tier change → action=same, no DB writes",
    out.action === "same" && supabase.calls.updates.length === 0);
}

{
  // Unknown customer
  const supabase = makeSupabase({ agent: null });
  const out = await handleTierChange(supabase, "cus_ghost", "starter", "pro");
  check("unknown customer → returns no-agent, no DB writes",
    out.action === "no-agent" && supabase.calls.updates.length === 0);
}

console.log("");

// ── Summary ──────────────────────────────────────────────────────────
console.log(`Result: ${passed} passed, ${failed} failed (out of ${passed + failed})`);
if (failed > 0) process.exit(1);
console.log("✓ Credit-ledger unit tests pass");
