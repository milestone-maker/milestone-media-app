import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { PRICING } from "../../lib/pricing";

// ──────────────────────────────────────────────────────────────────────
// Subscriptions view
//
// Two states, driven by the agent's subscription_status column:
//
//   • No active subscription → render tier picker (Starter / Pro / Elite)
//     with a monthly/annual toggle. Clicking Subscribe POSTs to
//     /api/create-checkout-session and redirects to the returned URL.
//
//   • Active subscription (status ∈ trialing / active / past_due) →
//     render the current-plan summary panel with a Manage button that
//     POSTs to /api/create-portal-session and redirects to the portal.
//
// On mount, inspect window.location.search for a `subscription` query
// parameter (Stripe redirects back here after checkout). If success,
// show a welcome banner and poll the agents row for up to 30 s waiting
// for the webhook to land the subscription fields. If cancelled, show a
// reassuring banner above the tier cards.
// ──────────────────────────────────────────────────────────────────────

// Subscription statuses that count as "active for UI purposes"
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// Promo / pricing config (centralized)
const ANNUAL_DISCOUNT_PCT = PRICING.promos?.annualPrepay?.discountPercent ?? 15;
const ANNUAL_MULT = 12 * (1 - ANNUAL_DISCOUNT_PCT / 100);
const TIER_ORDER = ["starter", "pro", "elite"];

// Display label for a stored tier slug. The slug stays starter/pro/elite in
// Stripe + the DB; only the user-facing name changes. Must not be derived by
// capitalizing the slug — that would show "Pro" while the card says "Team".
const TIER_DISPLAY_LABEL = { starter: "Solo", pro: "Team", elite: "Brokerage", teams: "Teams" };

function statusColor(status) {
  if (status === "active" || status === "trialing") return "#4ade80";
  if (status === "past_due") return "#f59e0b";
  return "rgba(255,255,255,0.4)";
}
function statusLabel(status) {
  if (!status) return "—";
  if (status === "past_due") return "Past due";
  if (status === "trialing") return "Trialing";
  if (status === "active") return "Active";
  if (status === "canceled") return "Canceled";
  return status;
}

function formatRenewDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch { return iso; }
}

function moneyUsd(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Math.round(n).toLocaleString();
}

function SubscriptionsView() {
  const { user } = useAuth();
  const [agent, setAgent] = useState(null);
  const [creditRow, setCreditRow] = useState(null); // current period's credit_ledger row, or null
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("monthly"); // "monthly" | "annual"
  const [redirecting, setRedirecting] = useState(false);
  const [banner, setBanner] = useState(null); // { type: "success" | "cancelled" | "info", text }
  const pollIntervalRef = useRef(null);
  const pollDeadlineRef = useRef(0);

  // ── Initial agent fetch ─────────────────────────────────────────
  const fetchAgent = async () => {
    if (!user?.id) return null;
    const { data, error } = await supabase
      .from("agents")
      .select("id, full_name, email, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, billing_period, current_period_end, subscription_started_at, founding_member")
      .eq("id", user.id)
      .single();
    if (error) {
      console.error("agents fetch error:", error);
      return null;
    }
    return data;
  };

  // ── Current-period credit row ───────────────────────────────────
  // Returns the credit_ledger row whose period_start ≤ now ≤ period_end,
  // or null if none exists yet (subscription just started).
  const fetchCurrentCreditRow = async (agentId) => {
    if (!agentId) return null;
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("credit_ledger")
      .select("id, period_start, period_end, tier_in_effect, credits_granted, credits_consumed, rollover_in")
      .eq("agent_id", agentId)
      .lte("period_start", nowIso)
      .gte("period_end", nowIso)
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("credit_ledger fetch error:", error);
      return null;
    }
    return data;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const a = await fetchAgent();
      if (cancelled) return;
      setAgent(a);
      if (a?.id) {
        const cr = await fetchCurrentCreditRow(a.id);
        if (!cancelled) setCreditRow(cr);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Handle query-param return from Stripe ─────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("subscription");
    if (!s) return;

    if (s === "success") {
      setBanner({ type: "success", text: "Welcome aboard! We're getting your subscription set up — this usually takes just a moment." });
      // Poll the agents row every 2 s for up to 30 s waiting for the webhook
      // to populate subscription fields.
      pollDeadlineRef.current = Date.now() + 30000;
      pollIntervalRef.current = setInterval(async () => {
        if (Date.now() > pollDeadlineRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setBanner({ type: "info", text: "We're still processing your subscription. Refresh in a moment and it should show here." });
          return;
        }
        const a = await fetchAgent();
        if (a && ACTIVE_STATUSES.has(a.subscription_status)) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setAgent(a);
          const cr = await fetchCurrentCreditRow(a.id);
          setCreditRow(cr);
          setBanner({ type: "success", text: "You're subscribed! Your plan is active." });
        }
      }, 2000);
    } else if (s === "cancelled") {
      setBanner({ type: "cancelled", text: "No worries — you can subscribe anytime." });
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subscribe / Manage handlers ─────────────────────────────────
  const handleSubscribe = async (tierId) => {
    setRedirecting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) {
        alert("Your session expired. Please sign in again.");
        setRedirecting(false);
        return;
      }
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier: tierId, period }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert("Could not start checkout: " + (body.error || res.statusText));
        setRedirecting(false);
        return;
      }
      const { url } = await res.json();
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      alert("Could not start checkout. Please try again.");
      setRedirecting(false);
    }
  };

  const handleManage = async () => {
    setRedirecting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) {
        alert("Your session expired. Please sign in again.");
        setRedirecting(false);
        return;
      }
      const res = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert("Could not open billing portal: " + (body.error || res.statusText));
        setRedirecting(false);
        return;
      }
      const { url } = await res.json();
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      alert("Could not open billing portal. Please try again.");
      setRedirecting(false);
    }
  };

  // ── Derived state ───────────────────────────────────────────────
  const hasActive = !!agent && ACTIVE_STATUSES.has(agent.subscription_status);

  // ── Render ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontFamily: "'Jost', sans-serif" }}>
        Loading subscription…
      </div>
    );
  }

  const Banner = banner && (
    <div style={{
      background: banner.type === "success" ? "rgba(74,222,128,0.08)"
        : banner.type === "cancelled" ? "rgba(255,255,255,0.04)"
        : "rgba(201,168,76,0.08)",
      border: `1px solid ${banner.type === "success" ? "rgba(74,222,128,0.3)"
        : banner.type === "cancelled" ? "rgba(255,255,255,0.1)"
        : "rgba(201,168,76,0.3)"}`,
      borderRadius: 12,
      padding: "14px 18px",
      marginBottom: 24,
      fontFamily: "'Jost', sans-serif",
      fontSize: 13,
      color: banner.type === "success" ? "#4ade80"
        : banner.type === "cancelled" ? "rgba(255,255,255,0.6)"
        : "#c9a84c",
    }}>
      {banner.text}
    </div>
  );

  if (hasActive) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {Banner}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: "#fff", marginBottom: 6 }}>
            Your Subscription
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            Manage payment, view invoices, or cancel through the Stripe billing portal.
          </div>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: 28,
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                Current Plan
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#c9a84c", fontWeight: 700, lineHeight: 1.1 }}>
                {TIER_DISPLAY_LABEL[agent.subscription_tier] || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
                Billed {agent.billing_period || "monthly"}
              </div>
            </div>
            <span style={{
              padding: "5px 12px",
              borderRadius: 16,
              background: `${statusColor(agent.subscription_status)}22`,
              color: statusColor(agent.subscription_status),
              border: `1px solid ${statusColor(agent.subscription_status)}55`,
              fontFamily: "'Jost', sans-serif",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}>
              {statusLabel(agent.subscription_status)}
            </span>
          </div>

          <div style={{
            paddingTop: 18,
            borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}>
            <div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                Renews
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#fff" }}>
                {formatRenewDate(agent.current_period_end)}
              </div>
            </div>
            {agent.subscription_started_at && (
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                  Started
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#fff" }}>
                  {formatRenewDate(agent.subscription_started_at)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Credits panel ─────────────────────────────────────────── */}
        {agent.subscription_status === "past_due" && (
          <div style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 14,
            fontFamily: "'Jost', sans-serif",
            fontSize: 12,
            color: "#f59e0b",
            lineHeight: 1.5,
          }}>
            ⚠ Payment failed on your last billing cycle. Your credits are still usable for now,
            but they will become unavailable if the issue isn't resolved. Update your payment
            method in the billing portal.
          </div>
        )}

        {(() => {
          // Three sub-states inside the active view:
          //   1. creditRow exists       → show real numbers
          //   2. no creditRow yet       → show tier allowance muted with "first cycle" note
          //   3. tier has no allowance  → don't bother (Teams falls here)
          const tierAllowanceMap = { starter: 1, pro: 2, elite: 4 };
          const baseAllowance = tierAllowanceMap[agent.subscription_tier] ?? 0;
          if (!creditRow && baseAllowance === 0) return null;

          const granted = creditRow ? creditRow.credits_granted : baseAllowance;
          const consumed = creditRow ? creditRow.credits_consumed : 0;
          const remaining = Math.max(0, granted - consumed);
          const hasRealRow = !!creditRow;

          return (
            <div style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: 24,
              marginBottom: 20,
              opacity: hasRealRow ? 1 : 0.7,
            }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                Shoots remaining this period
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 56, color: "#c9a84c", fontWeight: 700, lineHeight: 1 }}>
                  {remaining}
                </span>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                  of {granted} total this period
                </span>
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                Renews on {formatRenewDate(agent.current_period_end)}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                Each booking uses one credit at or below your tier's level.
                {!hasRealRow && " Credits will appear here after your first billing cycle completes."}
              </div>
            </div>
          );
        })()}

        <button onClick={handleManage} disabled={redirecting} style={{
          width: "100%",
          background: redirecting ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
          border: "none",
          borderRadius: 10,
          padding: "15px",
          fontFamily: "'Jost', sans-serif",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#0a1628",
          cursor: redirecting ? "wait" : "pointer",
        }}>
          {redirecting ? "Opening…" : "Manage Subscription ↗"}
        </button>
      </div>
    );
  }

  // ── No-active-subscription state: tier picker ─────────────────
  const tierCardsData = TIER_ORDER.map(id => PRICING.subscriptions.find(s => s.id === id)).filter(Boolean);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {Banner}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: "#fff", marginBottom: 6 }}>
          Subscriptions
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.55)", maxWidth: 640 }}>
          Pick a plan that fits how often you list. Every plan bundles shoots, content automation,
          and microsite access into one monthly rate so you stop juggling per-shoot invoicing.
        </div>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", justifyContent: "center", margin: "24px 0 28px" }}>
        <div style={{
          display: "flex",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 4,
        }}>
          {["monthly", "annual"].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "8px 22px",
                borderRadius: 9,
                border: "none",
                cursor: "pointer",
                background: period === p ? "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)" : "transparent",
                color: period === p ? "#0a1628" : "rgba(255,255,255,0.6)",
                fontFamily: "'Jost', sans-serif",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                transition: "all 0.2s",
              }}>
              {p === "annual" ? `Annual (save ${ANNUAL_DISCOUNT_PCT}%)` : p}
            </button>
          ))}
        </div>
      </div>

      {/* Tier cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {tierCardsData.map(tier => {
          const monthly = tier.monthlyPrice;
          const annualBilled = monthly ? +(monthly * ANNUAL_MULT).toFixed(2) : null;
          const annualPerMonth = annualBilled ? annualBilled / 12 : null;
          const isPro = tier.id === "pro";
          return (
            <div key={tier.id} style={{
              background: isPro ? "rgba(201,168,76,0.07)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${isPro ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 14,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              position: "relative",
            }}>
              {isPro && (
                <div style={{
                  position: "absolute",
                  top: -10,
                  right: 16,
                  background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
                  color: "#0a1628",
                  fontFamily: "'Jost', sans-serif",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  padding: "3px 10px",
                  borderRadius: 4,
                }}>Most Popular</div>
              )}

              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", fontWeight: 700, lineHeight: 1 }}>
                  {tier.name}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34, color: "#fff", fontWeight: 700 }}>
                    {period === "annual" ? moneyUsd(annualPerMonth) : moneyUsd(monthly)}
                  </span>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>
                    / month
                  </span>
                </div>
                {period === "annual" && annualBilled && (
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#4ade80", marginTop: 4 }}>
                    {moneyUsd(annualBilled)} billed annually
                    {" — save "}{moneyUsd((monthly * 12) - annualBilled)}/yr
                  </div>
                )}
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {(tier.includes || []).map(inc => (
                  <li key={inc} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                    <span style={{ color: "#c9a84c", flexShrink: 0 }}>✓</span>
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(tier.id)}
                disabled={redirecting}
                style={{
                  marginTop: "auto",
                  background: redirecting ? "rgba(201,168,76,0.3)" : (isPro ? "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)" : "rgba(201,168,76,0.12)"),
                  color: isPro ? "#0a1628" : "#c9a84c",
                  border: isPro ? "none" : "1px solid rgba(201,168,76,0.4)",
                  borderRadius: 9,
                  padding: "12px",
                  fontFamily: "'Jost', sans-serif",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: redirecting ? "wait" : "pointer",
                }}>
                {redirecting ? "Redirecting…" : "Subscribe"}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 28,
        padding: "16px 18px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
        fontFamily: "'Jost', sans-serif",
        fontSize: 11,
        color: "rgba(255,255,255,0.4)",
        lineHeight: 1.6,
      }}>
        Looking for Teams (8+ listings / month)? <a href="mailto:smiles@milestonemediaphoto.com" style={{ color: "#c9a84c", textDecoration: "underline" }}>Get a custom quote</a>.
        First month {PRICING.promos?.firstMonth?.discountPercent ?? 50}% off available at checkout — apply the promo code on the Stripe page.
      </div>
    </div>
  );
}

export default SubscriptionsView;
