// Vercel Serverless Function — Server-mediated booking creation
// POST /api/create-booking
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    full booking payload (address, sqft_tier, booking_mode,
//            selected_package | selected_services, selected_addons,
//            booking_date, booking_time, client_*, etc.)
//
// Replaces the four-call client orchestration that Book/index.jsx used
// to run (direct supabase insert + calendar + send-email + create-invoice).
// Centralizing it here lets the server decide credit eligibility, do the
// subtotal recompute, and skip invoice generation when a credit fully
// covers the package portion.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { packageCoveredByTier } from "./_lib/credits.js";

// ── module-load deps (overridable via depsOverride for tests) ────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

let _pricingCache = null;
function defaultPricing() {
  if (!_pricingCache) {
    const p = pathResolve(process.cwd(), "public", "pricing.json");
    _pricingCache = JSON.parse(readFileSync(p, "utf8"));
  }
  return _pricingCache;
}

// Subscription statuses that count as "active" for credit purposes.
// Matches ACTIVE_STATUSES in src/views/Subscriptions/index.jsx.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// ── pure helpers ─────────────────────────────────────────────────────

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

/**
 * Compute the booking subtotal in dollars from a payload, splitting the
 * package contribution from add-ons/services so the caller can zero out
 * just the package portion when a credit applies.
 *
 * Returns { packageAmount, servicesAmount, addonsAmount, total }.
 */
export function computeBreakdown(payload, pricing) {
  const { booking_mode, selected_package, selected_services, selected_addons, sqft_tier } = payload || {};
  let packageAmount = 0;
  let servicesAmount = 0;
  let addonsAmount = 0;

  if (booking_mode === "package") {
    if (selected_package === "essential" && sqft_tier) {
      packageAmount = pricing.essentialPricing?.[sqft_tier] || 0;
    } else if (selected_package === "signature") {
      packageAmount = pricing.packages?.find(p => p.name === "Signature")?.priceValue || 0;
    } else if (selected_package === "luxury") {
      packageAmount = pricing.packages?.find(p => p.name === "Luxury")?.priceValue || 0;
    }
  } else if (booking_mode === "individual") {
    for (const key of (selected_services || [])) {
      const svc = pricing.individualServices?.[key];
      if (!svc) continue;
      if (typeof svc.fixedPrice === "number") servicesAmount += svc.fixedPrice;
      else if (svc.priceByTier && sqft_tier) servicesAmount += svc.priceByTier[sqft_tier] || 0;
    }
  }

  for (const a of (selected_addons || [])) {
    const def = (pricing.addons || []).find(x => x.id === a.id);
    if (!def) continue;
    const qty = typeof a.qty === "number" && a.qty > 0 ? a.qty : 1;
    addonsAmount += def.price * (def.hasQty ? qty : 1);
  }

  return {
    packageAmount,
    servicesAmount,
    addonsAmount,
    total: packageAmount + servicesAmount + addonsAmount,
  };
}

/**
 * Build the create-invoice / send-email service+addon name lists from a
 * payload — mirrors the shape Book/index.jsx used to assemble.
 */
function buildItemLists(payload, pricing) {
  const { booking_mode, selected_package, selected_services, selected_addons, sqft_tier } = payload || {};
  const services = [];
  let packageName = null;

  if (booking_mode === "package") {
    if (selected_package === "essential") packageName = "Essential";
    if (selected_package === "signature") packageName = "Signature";
    if (selected_package === "luxury")    packageName = "Luxury";
  } else if (booking_mode === "individual") {
    for (const key of (selected_services || [])) {
      const svc = pricing.individualServices?.[key];
      if (!svc) continue;
      const price =
        typeof svc.fixedPrice === "number" ? svc.fixedPrice
        : (svc.priceByTier && sqft_tier ? (svc.priceByTier[sqft_tier] || 0) : 0);
      services.push({ name: svc.name, price });
    }
  }

  const addons = [];
  for (const a of (selected_addons || [])) {
    const def = (pricing.addons || []).find(x => x.id === a.id);
    if (!def) continue;
    const qty = typeof a.qty === "number" && a.qty > 0 ? a.qty : 1;
    addons.push({ name: def.name, price: def.price * (def.hasQty ? qty : 1) });
  }

  return { packageName, services, addons };
}

// ── main handler ─────────────────────────────────────────────────────

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = depsOverride?.supabase || defaultSupabase();
  const pricing  = depsOverride?.pricing  || defaultPricing();
  const fetchFn  = depsOverride?.fetch    || globalThis.fetch;

  try {
    // ── 1. Auth ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Resolve agent (tier + status) ──
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, email, full_name, role, subscription_tier, subscription_status")
      .eq("id", authUser.id)
      .single();
    if (agentErr || !agent) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }

    // ── 3. Decide credit eligibility ──
    const payload = req.body || {};

    // Normalize contact emails. The booking-ownership-claim machinery is
    // case-insensitive end-to-end; store canonical lowercase to keep RLS
    // and downstream joins simple.
    if (typeof payload.client_email === "string") {
      payload.client_email = payload.client_email.trim().toLowerCase();
    }
    if (typeof payload.cc_email === "string") {
      payload.cc_email = payload.cc_email.trim().toLowerCase();
      if (!payload.cc_email) payload.cc_email = null;
    }

    const subActive = ACTIVE_STATUSES.has(agent.subscription_status);
    const tier = agent.subscription_tier;
    const isPackageMode = payload.booking_mode === "package";
    const coversPackage = isPackageMode && packageCoveredByTier(tier, payload.selected_package);

    // Fetch current period credit row only if we might use it
    let creditRow = null;
    let creditsRemaining = 0;
    if (subActive && coversPackage) {
      const nowIso = new Date().toISOString();
      const { data: row, error: rowErr } = await supabase
        .from("credit_ledger")
        .select("id, credits_granted, credits_consumed")
        .eq("agent_id", agent.id)
        .lte("period_start", nowIso)
        .gte("period_end", nowIso)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rowErr) {
        console.error("[create-booking] credit_ledger fetch error:", rowErr);
      } else if (row) {
        creditRow = row;
        creditsRemaining = (row.credits_granted || 0) - (row.credits_consumed || 0);
      }
    }

    let shouldUseCredit = subActive && coversPackage && creditRow && creditsRemaining >= 1;

    // ── 4. Compute subtotal server-side ──
    const breakdown = computeBreakdown(payload, pricing);
    let subtotal = breakdown.total;

    // ── 5. If eligible, attempt conditional decrement ──
    let appliedLedgerId = null;
    if (shouldUseCredit) {
      const prevConsumed = creditRow.credits_consumed || 0;
      // Optimistic concurrency: only succeed if credits_consumed hasn't
      // moved since we read it. If zero rows come back, someone else
      // burned the last credit between our read and our write —
      // fall back to transactional.
      const { data: updated, error: updateErr } = await supabase
        .from("credit_ledger")
        .update({ credits_consumed: prevConsumed + 1 })
        .eq("id", creditRow.id)
        .eq("credits_consumed", prevConsumed)
        .lt("credits_consumed", creditRow.credits_granted)
        .select("id, credits_granted, credits_consumed");
      if (updateErr) {
        console.error("[create-booking] credit decrement error:", updateErr);
        shouldUseCredit = false;
      } else if (!Array.isArray(updated) || updated.length === 0) {
        // Race lost — recompute at full transactional price.
        console.log(`[create-booking] race lost on credit_ledger ${creditRow.id} for agent ${agent.id}; falling back`);
        shouldUseCredit = false;
      } else {
        appliedLedgerId = creditRow.id;
        creditRow = updated[0];
        creditsRemaining = (updated[0].credits_granted || 0) - (updated[0].credits_consumed || 0);
        // Package portion is now free — final total is just addons.
        subtotal = breakdown.addonsAmount;
      }
    }

    // ── 6. Insert booking with server-computed values ──
    // Resolve booking owner:
    //   - Default: caller's uid (existing behavior).
    //   - If caller is staff (admin) AND a client_email is provided AND that
    //     email already belongs to an existing agent, target that agent's uid
    //     so the booking is owned by the rightful client from minute one.
    //   - Non-staff callers can never reassign ownership by contact email.
    //   - If no existing agent matches, keep agent_id = caller's uid; the
    //     verification-gated claim trigger will transfer ownership when the
    //     client signs up.
    let bookingAgentId = agent.id;
    if (agent.role === "admin" && payload.client_email) {
      const { data: existingClient } = await supabase
        .from("agents")
        .select("id")
        .ilike("email", payload.client_email)
        .maybeSingle();
      if (existingClient?.id) {
        bookingAgentId = existingClient.id;
      }
    }

    const bookingInsert = {
      source: "app",
      agent_id: bookingAgentId,
      client_name: payload.client_name,
      client_email: payload.client_email,
      client_phone: payload.client_phone || null,
      address: payload.address,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      sqft_tier: payload.sqft_tier,
      access_method: payload.access_method || "lockbox",
      booking_mode: payload.booking_mode,
      selected_package: payload.booking_mode === "package" ? payload.selected_package : null,
      selected_services: payload.selected_services || [],
      selected_addons: payload.selected_addons || [],
      booking_date: payload.booking_date,
      booking_time: payload.booking_time,
      subtotal,
      credit_consumed: shouldUseCredit,
      credit_ledger_id: appliedLedgerId,
      // A credit-covered booking is paid-for at insert time — the
      // subscription credit is the payment. Without this, the microsite
      // entitlement check would still gate on a never-arriving invoice.
      ...(shouldUseCredit ? { invoice_paid: true } : {}),
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("bookings")
      .insert(bookingInsert)
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("[create-booking] booking insert error:", insertErr);
      return res.status(500).json({ error: "booking insert failed", details: insertErr?.message });
    }

    // ── 7. Fire side-effect calls (non-blocking, same as old client flow) ──
    const protocol = (req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = req.headers?.host || "localhost";
    const baseUrl = depsOverride?.baseUrl || `${protocol}://${host}`;

    const { packageName, services, addons } = buildItemLists(payload, pricing);
    const addressOneLine = `${payload.address}, ${payload.city}, ${payload.state} ${payload.zip}`;

    // Calendar
    let calendarEventId = null;
    try {
      const calRes = await fetchFn(`${baseUrl}/api/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bookingInsert, booking_id: inserted.id }),
      });
      const calJson = await calRes.json().catch(() => ({}));
      calendarEventId = calJson?.eventId || calJson?.id || null;
    } catch (calErr) {
      console.error("[create-booking] calendar sync error (non-blocking):", calErr);
    }

    // Email
    try {
      await fetchFn(`${baseUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: {
            clientName: payload.client_name,
            clientEmail: payload.client_email,
            clientPhone: payload.client_phone,
            agentEmail: agent.email,
            agentName: agent.full_name || agent.email,
            address: addressOneLine,
            sqftTier: payload.sqft_tier,
            accessMethod: payload.access_method,
            date: payload.booking_date,
            time: payload.booking_time,
            packageName,
            services,
            addons,
            total: subtotal,
            creditApplied: shouldUseCredit,
          },
        }),
      });
    } catch (emailErr) {
      console.error("[create-booking] email send error (non-blocking):", emailErr);
    }

    // Invoice — ONLY if the final total is greater than zero.
    let stripeInvoiceId = null;
    if (subtotal > 0) {
      try {
        const invRes = await fetchFn(`${baseUrl}/api/create-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking: {
              clientName: payload.client_name,
              clientEmail: payload.client_email,
              clientPhone: payload.client_phone,
              address: addressOneLine,
              sqftTier: payload.sqft_tier,
              accessMethod: payload.access_method,
              date: payload.booking_date,
              time: payload.booking_time,
              packageName: shouldUseCredit ? null : packageName,
              services,
              addons,
              total: subtotal,
            },
          }),
        });
        const invJson = await invRes.json().catch(() => ({}));
        stripeInvoiceId = invJson?.invoiceId || null;
        if (stripeInvoiceId) {
          await supabase
            .from("bookings")
            .update({ stripe_invoice_id: stripeInvoiceId })
            .eq("id", inserted.id);
        }
      } catch (invErr) {
        console.error("[create-booking] invoice error (non-blocking):", invErr);
      }
    }

    return res.status(200).json({
      bookingId: inserted.id,
      subtotal,
      creditConsumed: shouldUseCredit,
      creditsRemaining: shouldUseCredit ? creditsRemaining : null,
      calendarEventId,
      stripeInvoiceId,
    });
  } catch (err) {
    console.error("[create-booking] fatal:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
