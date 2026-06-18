// Vercel Serverless Function — Open the Stripe customer portal for an agent
// POST /api/create-portal-session
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    (none required)
//
// Returns a Stripe billing portal URL that the client redirects the
// browser to. Agents use the portal to update payment methods, view
// invoices, and cancel subscriptions. Plan switches are not enabled in
// the portal — that flow will be added later.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

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

function buildRealDeps() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return { stripe, supabase };
}

async function handler(req, res, depsOverride) {
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

    const { stripe, supabase } = depsOverride || buildRealDeps();

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Fetch agent record ──
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, stripe_customer_id")
      .eq("id", authUser.id)
      .single();
    if (agentErr || !agent) {
      return res.status(404).json({ error: "agent profile not found" });
    }

    if (!agent.stripe_customer_id) {
      return res.status(400).json({
        error: "no subscription yet — subscribe first before managing a subscription",
      });
    }

    // ── 3. Create billing portal session ──
    const portal = await stripe.billingPortal.sessions.create({
      customer: agent.stripe_customer_id,
      return_url: `${PUBLIC_APP_BASE}/?subscription=portal_return`,
    });

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error("create-portal-session error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
