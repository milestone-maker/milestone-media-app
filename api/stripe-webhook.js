// Vercel Serverless Function — Stripe webhook handler
// POST /api/stripe-webhook
//   Handles two distinct flows:
//
//   1. Per-shoot invoices (the original flow)
//      invoice.payment_succeeded with a matching booking row by
//      stripe_invoice_id → set booking.invoice_paid = true to unlock
//      media downloads for the agent.
//
//   2. Subscriptions (added in foundation phase 2)
//      checkout.session.completed       (mode=subscription)  — link Stripe customer to agent by email
//      customer.subscription.created    — record tier, status, period, period_end, started_at
//      customer.subscription.updated    — refresh tier, status, period, period_end
//      customer.subscription.deleted    — set status=canceled, preserve customer_id + started_at
//      invoice.payment_failed           (subscription)        — set status=past_due
//      invoice.payment_succeeded        (subscription)        — set status=active, refresh period_end
//
// If a subscription event references a Stripe customer ID that does not
// match any agent (e.g. webhook fires before the checkout-completion
// handler has linked the customer), the event is logged and we return
// 200 so Stripe does not retry.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY       — Stripe secret key (already set)
//   STRIPE_WEBHOOK_SECRET   — Signing secret from the Stripe webhook endpoint
//   SUPABASE_URL            — https://cbpnjuotoxtmefmedpmj.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Service role key from Supabase dashboard (bypasses RLS)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { grantCreditsFromInvoice, handleTierChange } from "./_lib/credits.js";

// Must disable Vercel's body parser so we can verify the raw Stripe signature
export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Read the raw request body as a Buffer (required for Stripe signature verification)
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ──────────────────────────────────────────────────────────────────────
// Subscription helpers
// ──────────────────────────────────────────────────────────────────────

// Convert a unix epoch (seconds) to an ISO timestamp string for Postgres.
function epochToIso(s) {
  if (!s && s !== 0) return null;
  return new Date(s * 1000).toISOString();
}

// Pull the tier id and period off a subscription's first item by price metadata.
// Setup script writes:  metadata.milestone_tier   ∈ "starter" | "pro" | "elite"
//                       metadata.milestone_period ∈ "monthly" | "annual"
function tierAndPeriodFromSubscription(subscription) {
  const item = subscription.items?.data?.[0];
  const meta = item?.price?.metadata || {};
  return {
    tier: meta.milestone_tier || null,
    period: meta.milestone_period || null,
  };
}

// Patch the matching agent row. Returns { matched: bool }.
async function updateAgentByCustomerId(supabase, customerId, patch, label) {
  if (!customerId) return { matched: false };
  const { data, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    console.error(`[${label}] supabase update error:`, error.message);
    throw error;
  }
  const matched = (data || []).length > 0;
  if (!matched) {
    console.warn(`[${label}] no agent found for stripe_customer_id=${customerId} — returning 200 anyway`);
  } else {
    console.log(`[${label}] updated agent ${data[0].id}`);
  }
  return { matched };
}

// ──────────────────────────────────────────────────────────────────────
// Per-shoot invoice flow (existing behavior — kept intact)
// ──────────────────────────────────────────────────────────────────────
async function handlePerShootInvoicePaid(supabase, invoice) {
  const { data: bookings, error: fetchError } = await supabase
    .from("bookings")
    .select("id, address")
    .eq("stripe_invoice_id", invoice.id);

  if (fetchError) {
    console.error("Supabase fetch error:", fetchError.message);
    throw fetchError;
  }

  if (!bookings || bookings.length === 0) {
    // Not a per-shoot invoice — return null so caller can fall through to subscription handling.
    return null;
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ invoice_paid: true })
    .eq("stripe_invoice_id", invoice.id);

  if (updateError) {
    console.error("Supabase update error:", updateError.message);
    throw updateError;
  }

  console.log(`✅ Media unlocked for booking ${bookings[0].id} (${bookings[0].address})`);
  return { matched: true };
}

// ──────────────────────────────────────────────────────────────────────
// Subscription event handlers
// ──────────────────────────────────────────────────────────────────────

// checkout.session.completed (mode === "subscription"):
// link the Stripe customer ID to the agent by email.
async function handleCheckoutCompleted(supabase, session) {
  if (session.mode !== "subscription") {
    console.log("checkout.session.completed — non-subscription mode, ignoring");
    return;
  }
  const customerId = session.customer;
  const email = (session.customer_email || session.customer_details?.email || "").toLowerCase();
  if (!customerId || !email) {
    console.warn("checkout.session.completed — missing customer or email");
    return;
  }

  // Find the agent by email and set stripe_customer_id if not already set
  const { data: agent } = await supabase
    .from("agents")
    .select("id, stripe_customer_id")
    .ilike("email", email)
    .maybeSingle();

  if (!agent) {
    console.warn(`checkout.session.completed — no agent for email ${email}`);
    return;
  }
  if (agent.stripe_customer_id && agent.stripe_customer_id !== customerId) {
    console.warn(`checkout.session.completed — agent ${agent.id} already has a different stripe_customer_id`);
    return;
  }
  if (!agent.stripe_customer_id) {
    const { error } = await supabase
      .from("agents")
      .update({ stripe_customer_id: customerId })
      .eq("id", agent.id);
    if (error) throw error;
    console.log(`[checkout.completed] linked agent ${agent.id} ↔ customer ${customerId}`);
  }
}

// customer.subscription.created / updated:
// store tier, status, billing period, period_end, started_at (created only).
// On .updated, also detect tier changes and adjust the credit ledger
// BEFORE writing the new tier to the agent record.
async function handleSubscriptionCreatedOrUpdated(supabase, subscription, label) {
  const { tier: newTier, period } = tierAndPeriodFromSubscription(subscription);

  // For .updated events, read the OLD tier from the agent record before
  // we overwrite it. We need this to decide upgrade vs downgrade.
  let oldTier = null;
  if (label === "subscription.updated") {
    const { data: existing } = await supabase
      .from("agents")
      .select("subscription_tier")
      .eq("stripe_customer_id", subscription.customer)
      .maybeSingle();
    oldTier = existing?.subscription_tier || null;
  }

  const patch = {
    stripe_subscription_id: subscription.id,
    subscription_tier: newTier,
    subscription_status: subscription.status,
    billing_period: period,
    current_period_end: epochToIso(subscription.current_period_end),
  };
  // Only set subscription_started_at on first creation, never overwrite.
  if (label === "subscription.created") {
    patch.subscription_started_at = epochToIso(subscription.start_date || subscription.created);
  }
  await updateAgentByCustomerId(supabase, subscription.customer, patch, label);

  // Tier-change credit adjustment (upgrade replaces current row, downgrade no-op).
  if (label === "subscription.updated" && oldTier && newTier) {
    await handleTierChange(supabase, subscription.customer, oldTier, newTier);
  }
}

// customer.subscription.deleted:
// status → canceled, period_end → event's value, preserve customer_id + started_at.
async function handleSubscriptionDeleted(supabase, subscription) {
  const patch = {
    subscription_status: "canceled",
    current_period_end: epochToIso(subscription.current_period_end),
    // Explicitly clear the subscription ID since this one is gone.
    stripe_subscription_id: null,
  };
  await updateAgentByCustomerId(supabase, subscription.customer, patch, "subscription.deleted");
}

// invoice.payment_failed (subscription invoice):
// status → past_due.
async function handleSubscriptionInvoiceFailed(supabase, invoice) {
  await updateAgentByCustomerId(
    supabase,
    invoice.customer,
    { subscription_status: "past_due" },
    "invoice.payment_failed (sub)"
  );
}

// invoice.payment_succeeded (subscription invoice):
// status → active, refresh current_period_end from the invoice's period,
// THEN grant credits for the new billing period (idempotent — re-deliveries
// hit the credit_ledger unique constraint and are absorbed).
async function handleSubscriptionInvoicePaid(supabase, invoice) {
  // invoice.lines.data[0].period.end is the period this invoice covers
  const periodEndEpoch =
    invoice.lines?.data?.[0]?.period?.end ||
    invoice.period_end ||
    null;
  const patch = {
    subscription_status: "active",
    current_period_end: epochToIso(periodEndEpoch),
  };
  await updateAgentByCustomerId(
    supabase,
    invoice.customer,
    patch,
    "invoice.payment_succeeded (sub)"
  );

  // Grant credits for the new period. Pure helper handles tier lookup,
  // rollover policy (Starter only, cap 1), and unique-constraint
  // duplicate detection for re-delivered events.
  await grantCreditsFromInvoice(supabase, invoice);
}

// ──────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed: " + err.message });
  }

  const supabase = getSupabase();

  try {
    switch (event.type) {
      // ── per-shoot invoice paid (and subscription invoice paid) ──
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        console.log(`invoice.payment_succeeded — invoice ${invoice.id}`);

        // Try per-shoot match first; if a booking matches, we're done.
        const perShoot = await handlePerShootInvoicePaid(supabase, invoice);
        if (perShoot) break;

        // No booking match — if it's a subscription invoice, treat as subscription event.
        if (invoice.subscription || invoice.billing_reason?.startsWith("subscription_")) {
          await handleSubscriptionInvoicePaid(supabase, invoice);
        } else {
          console.log(`No booking found for invoice ${invoice.id} and not a subscription — skipping`);
        }
        break;
      }

      // ── subscription invoice payment failed ──
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log(`invoice.payment_failed — invoice ${invoice.id}`);
        if (invoice.subscription || invoice.billing_reason?.startsWith("subscription_")) {
          await handleSubscriptionInvoiceFailed(supabase, invoice);
        } else {
          console.log("invoice.payment_failed not tied to a subscription — skipping");
        }
        break;
      }

      // ── checkout completed (subscription only) ──
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(`checkout.session.completed — session ${session.id} (mode=${session.mode})`);
        await handleCheckoutCompleted(supabase, session);
        break;
      }

      // ── subscription created or updated ──
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const label = event.type.replace("customer.", "");
        console.log(`${event.type} — subscription ${subscription.id} status=${subscription.status}`);
        await handleSubscriptionCreatedOrUpdated(supabase, subscription, label);
        break;
      }

      // ── subscription deleted ──
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log(`customer.subscription.deleted — subscription ${subscription.id}`);
        await handleSubscriptionDeleted(supabase, subscription);
        break;
      }

      default:
        // No-op — acknowledge so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler error: " + err.message });
  }

  return res.status(200).json({ received: true });
}
