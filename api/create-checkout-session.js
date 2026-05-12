// Vercel Serverless Function — Start a Stripe Checkout session for a subscription
// POST /api/create-checkout-session
//   Body:    { tier: "starter"|"pro"|"elite", period: "monthly"|"annual" }
//   Headers: Authorization: Bearer <supabase access token>
//
// Flow:
//   1. Resolve the agent from the auth token.
//   2. Find-or-create the agent's Stripe customer (by saved customer ID
//      first, then by email), persisting the customer ID on the agent
//      record so the webhook can correlate later.
//   3. Look up the right price ID from pricing.json for this (tier, period).
//   4. Create a Stripe Checkout session in subscription mode and return its URL.
//
// Style mirrors create-invoice.js and publish-microsite.js: same Stripe init,
// same CORS header set, dependency-injection third arg on the handler so
// the unit tests can supply mocks without monkey-patching the module.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_PATH = resolve(__dirname, "..", "public", "pricing.json");

const PUBLIC_APP_BASE = "https://app.milestonemediaphotography.com";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Load the real Stripe + Supabase clients and the pricing config.
// Split out so the unit tests can pass `deps` directly and never reach
// here. In production the handler calls this with no override.
async function buildRealDeps() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const pricing = JSON.parse(await readFile(PRICING_PATH, "utf8"));
  return { stripe, supabase, pricing };
}

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. Authenticate ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { stripe, supabase, pricing } = depsOverride || await buildRealDeps();

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Validate request body ──
    const { tier, period } = req.body || {};
    const validTiers = ["starter", "pro", "elite"];
    const validPeriods = ["monthly", "annual"];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `invalid tier "${tier}" — must be one of ${validTiers.join(", ")}` });
    }
    if (!validPeriods.includes(period)) {
      return res.status(400).json({ error: `invalid period "${period}" — must be one of ${validPeriods.join(", ")}` });
    }

    // ── 3. Resolve price ID from pricing.json ──
    const priceId = pricing.stripeIds?.subscriptionPrices?.[period]?.[tier];
    if (!priceId) {
      return res.status(400).json({
        error: `no Stripe price configured for ${tier}/${period} — run scripts/setup-stripe-subscriptions.mjs`,
      });
    }

    // ── 4. Fetch agent record ──
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", authUser.id)
      .single();
    if (agentErr || !agent) {
      return res.status(404).json({ error: "agent profile not found" });
    }

    // ── 5. Find or create Stripe customer ──
    //    Priority: saved customer ID on agent > email lookup > create new
    let customerId = agent.stripe_customer_id || null;

    if (!customerId) {
      const existing = await stripe.customers.list({
        email: agent.email,
        limit: 1,
      });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const created = await stripe.customers.create({
          email: agent.email,
          name: agent.full_name || undefined,
          metadata: { milestone_agent_id: agent.id },
        });
        customerId = created.id;
      }

      // Persist on the agent record so the webhook can correlate.
      const { error: linkErr } = await supabase
        .from("agents")
        .update({ stripe_customer_id: customerId })
        .eq("id", agent.id);
      if (linkErr) {
        console.error("agent.stripe_customer_id update error:", linkErr.message);
        // Not fatal — checkout can proceed; webhook will retry the link.
      }
    }

    // ── 6. Create Stripe Checkout session ──
    const successUrl = `${PUBLIC_APP_BASE}/?subscription=success&tier=${encodeURIComponent(tier)}&period=${encodeURIComponent(period)}`;
    const cancelUrl  = `${PUBLIC_APP_BASE}/?subscription=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        milestone_agent_id: agent.id,
        milestone_tier: tier,
        milestone_period: period,
      },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
