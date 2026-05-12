import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth, PACKAGES, SQFT_TIERS, ESSENTIAL_PRICING, INDIVIDUAL_SERVICES, ADDONS } from "../../App";

// Subscription statuses considered "active" for credit purposes.
// Matches ACTIVE_STATUSES in Subscriptions/index.jsx and the server endpoint.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// Mirror of api/_lib/credits.js packageCoveredByTier. Duplicated client-side
// so the UI can render coverage state without a network round-trip per click.
function packageCoveredByTier(tier, pkg) {
  if (!tier || !pkg) return false;
  const map = {
    starter: ["essential"],
    pro:     ["essential", "signature"],
    elite:   ["essential", "signature", "luxury"],
  };
  return (map[tier] || []).includes(pkg);
}

// Index → package slug used by the server.
const PACKAGE_SLUGS = ["essential", "signature", "luxury"];
const TIER_LABEL = { starter: "Starter", pro: "Pro", elite: "Elite" };

function BookView() {
  const { user } = useAuth();
  // ── State ──
  const [step, setStep] = useState(1);
  const [bookingMode, setBookingMode] = useState(null); // "package" | "individual"
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Texas");
  const [zip, setZip] = useState("");
  const [sqftTier, setSqftTier] = useState("");
  const [accessMethod, setAccessMethod] = useState("");
  const [selectedPackage, setSelectedPackage] = useState(null); // 0,1,2
  const [selectedServices, setSelectedServices] = useState({});
  const [selectedAddons, setSelectedAddons] = useState({});
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [busySlots, setBusySlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [booked, setBooked] = useState(false);
  const [bookedResult, setBookedResult] = useState(null); // { creditConsumed, creditsRemaining, subtotal }
  const [bookingError, setBookingError] = useState(null);
  const [processing, setProcessing] = useState(false);

  // ── Subscription / credit state ──
  const [subTier, setSubTier] = useState(null);
  const [subStatus, setSubStatus] = useState(null);
  const [creditRow, setCreditRow] = useState(null); // { credits_granted, credits_consumed }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: agent } = await supabase
        .from("agents")
        .select("subscription_tier, subscription_status")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setSubTier(agent?.subscription_tier || null);
      setSubStatus(agent?.subscription_status || null);

      if (agent && ACTIVE_STATUSES.has(agent.subscription_status)) {
        const nowIso = new Date().toISOString();
        const { data: row } = await supabase
          .from("credit_ledger")
          .select("id, credits_granted, credits_consumed, tier_in_effect")
          .eq("agent_id", user.id)
          .lte("period_start", nowIso)
          .gte("period_end", nowIso)
          .order("period_end", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) setCreditRow(row || null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const STEPS = ["Address", "Services", "Add-ons", "Schedule", "Review & Pay"];

  // ── Credit helpers ──
  const subActive = !!subStatus && ACTIVE_STATUSES.has(subStatus);
  const creditsRemaining = creditRow
    ? Math.max(0, (creditRow.credits_granted || 0) - (creditRow.credits_consumed || 0))
    : 0;
  const hasCreditsLeft = creditsRemaining >= 1;

  // Will a credit apply to the *current* booking selection?
  const creditWillApply = (() => {
    if (bookingMode !== "package") return false;
    if (selectedPackage === null) return false;
    if (!subActive || !hasCreditsLeft) return false;
    return packageCoveredByTier(subTier, PACKAGE_SLUGS[selectedPackage]);
  })();

  // Per-card coverage helper for step-2 messaging
  const coverageStateFor = (pkgIndex) => {
    const slug = PACKAGE_SLUGS[pkgIndex];
    if (!subActive) return "no-sub";
    const covered = packageCoveredByTier(subTier, slug);
    if (covered && hasCreditsLeft) return "covered";
    if (covered && !hasCreditsLeft) return "no-credits";
    return "above-tier";
  };

  // Fetch Google Calendar busy slots when date changes
  useEffect(() => {
    if (!selectedDate) { setBusySlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    fetch(`/api/calendar?date=${selectedDate}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setBusySlots(data.busySlots || []); })
      .catch(() => { if (!cancelled) setBusySlots([]); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [selectedDate]);

  const isSlotBusy = (slotLabel) => {
    if (!busySlots.length || !selectedDate) return false;
    const parts = slotLabel.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!parts) return false;
    let h = parseInt(parts[1]);
    const m = parseInt(parts[2]);
    if (parts[3].toUpperCase() === "PM" && h !== 12) h += 12;
    if (parts[3].toUpperCase() === "AM" && h === 12) h = 0;
    const slotStart = new Date(`${selectedDate}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`);
    const slotEnd = new Date(slotStart.getTime() + 2 * 60 * 60 * 1000);
    return busySlots.some(b => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return slotStart < bEnd && slotEnd > bStart;
    });
  };

  // ── Helpers ──
  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8, padding: "13px 16px", color: "#fff",
    fontFamily: "'Jost', sans-serif", fontSize: 14, outline: "none",
    boxSizing: "border-box", colorScheme: "dark", transition: "border-color 0.2s",
  };
  const labelStyle = {
    fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, display: "block",
  };

  const getServicePrice = (svc) => {
    if (svc.fixedPrice !== undefined) return svc.fixedPrice;
    if (svc.priceByTier && sqftTier) return svc.priceByTier[sqftTier];
    return null;
  };

  // ── Total calc (credit-aware) ──
  // Returns { packageAmount, servicesAmount, addonsAmount, total }.
  // When a credit applies, packageAmount becomes 0 in the total.
  const calcBreakdown = () => {
    let packageAmount = 0;
    let servicesAmount = 0;
    let addonsAmount = 0;

    if (bookingMode === "package") {
      if (selectedPackage === 0 && sqftTier) packageAmount = ESSENTIAL_PRICING[sqftTier] || 0;
      else if (selectedPackage !== null) packageAmount = PACKAGES[selectedPackage]?.priceValue || 0;
    } else if (bookingMode === "individual") {
      Object.keys(selectedServices).forEach(key => {
        if (selectedServices[key]) {
          const svc = INDIVIDUAL_SERVICES[key];
          const p = getServicePrice(svc);
          if (p) servicesAmount += p;
        }
      });
    }
    ADDONS.forEach(a => {
      const val = selectedAddons[a.id];
      if (val) {
        if (a.hasQty) addonsAmount += a.price * (typeof val === "number" ? val : 1);
        else if (val === true) addonsAmount += a.price;
      }
    });

    const effectivePackage = creditWillApply ? 0 : packageAmount;
    return {
      packageAmount,
      effectivePackage,
      servicesAmount,
      addonsAmount,
      total: effectivePackage + servicesAmount + addonsAmount,
    };
  };
  const calcTotal = () => calcBreakdown().total;

  const canProceed = () => {
    if (step === 1) return address.trim() && city.trim() && zip.trim() && sqftTier;
    if (step === 2) {
      if (bookingMode === "package") return selectedPackage !== null;
      if (bookingMode === "individual") return Object.values(selectedServices).some(v => v);
      return false;
    }
    if (step === 3) return true;
    if (step === 4) return selectedDate && selectedTime;
    if (step === 5) return clientName.trim() && clientEmail.trim() && clientEmail.includes("@");
    return true;
  };

  const handleBook = async () => {
    setProcessing(true);
    setBookingError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const selSvcs = bookingMode === "individual"
        ? Object.keys(selectedServices).filter(k => selectedServices[k])
        : [];
      const selAddons = [];
      ADDONS.forEach(a => {
        if (selectedAddons[a.id]) {
          selAddons.push({ id: a.id, qty: typeof selectedAddons[a.id] === "number" ? selectedAddons[a.id] : 1 });
        }
      });

      const payload = {
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone || null,
        address, city, state, zip,
        sqft_tier: sqftTier,
        access_method: accessMethod || "lockbox",
        booking_mode: bookingMode,
        selected_package: bookingMode === "package" ? PACKAGE_SLUGS[selectedPackage] : null,
        selected_services: selSvcs,
        selected_addons: selAddons,
        booking_date: selectedDate,
        booking_time: selectedTime,
      };

      const res = await fetch("/api/create-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Booking failed");

      setBookedResult({
        bookingId: data.bookingId,
        creditConsumed: !!data.creditConsumed,
        creditsRemaining: data.creditsRemaining,
        subtotal: data.subtotal,
      });
      setBooked(true);
    } catch (err) {
      console.error("Booking error:", err);
      setBookingError(err.message || "Something went wrong. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const resetBooking = () => {
    setStep(1); setBookingMode(null); setAddress(""); setCity(""); setState("Texas");
    setZip(""); setSqftTier(""); setAccessMethod(""); setSelectedPackage(null);
    setSelectedServices({}); setSelectedAddons({}); setSelectedDate(""); setSelectedTime("");
    setClientName(""); setClientEmail(""); setClientPhone("");
    setBooked(false); setBookedResult(null); setProcessing(false);
  };

  const TIME_SLOTS = [
    "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM",
    "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM",
  ];

  // ── BOOKED STATE ──
  if (booked) {
    const pkgName = bookingMode === "package" ? PACKAGES[selectedPackage]?.name : "Individual Services";
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>✨</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 40, color: "#c9a84c", marginBottom: 12 }}>
          You're Booked!
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.6)", fontSize: 15, marginBottom: 8 }}>
          Your {pkgName} session for {address}, {city} {state} {zip} is confirmed.
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 8 }}>
          {selectedDate} at {selectedTime}
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", marginBottom: 8 }}>
          Total: ${(bookedResult?.subtotal ?? calcTotal()).toLocaleString()}
        </div>
        {bookedResult?.creditConsumed && (
          <div style={{
            fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e5c97e",
            marginBottom: 32, letterSpacing: "0.04em",
          }}>
            1 credit used. You have {bookedResult.creditsRemaining ?? 0} credit{(bookedResult.creditsRemaining ?? 0) === 1 ? "" : "s"} remaining this period.
          </div>
        )}
        {!bookedResult?.creditConsumed && (
          <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 32 }}>
            We'll reach out within 24 hours to finalize details.
          </div>
        )}
        <button onClick={resetBooking} style={{
          background: "transparent", border: "1px solid rgba(201,168,76,0.5)",
          color: "#c9a84c", padding: "12px 28px", borderRadius: 8,
          fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.1em",
          textTransform: "uppercase", cursor: "pointer",
        }}>Book Another Listing</button>
      </div>
    );
  }

  const breakdown = calcBreakdown();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 6 }}>
          Book a Session
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
          Premium real estate media, delivered in 24–48 hours.
        </div>
      </div>

      {/* Running total bar */}
      {(step >= 2) && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
          borderRadius: 10, padding: "12px 20px",
        }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {address}, {city}
          </div>
          {creditWillApply ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                $0 (package) + ${breakdown.addonsAmount.toLocaleString()} add-ons
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", fontWeight: 700 }}>
                ${breakdown.total.toLocaleString()}
              </div>
            </div>
          ) : (
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", fontWeight: 700 }}>
              ${breakdown.total.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Step indicators */}
      <div style={{ display: "flex", gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: step > i + 1 ? "#c9a84c" : step === i + 1 ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.05)",
              border: step >= i + 1 ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600,
              color: step > i + 1 ? "#0a1628" : step === i + 1 ? "#c9a84c" : "rgba(255,255,255,0.3)",
              transition: "all 0.3s", marginBottom: 6,
            }}>{step > i + 1 ? "✓" : i + 1}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: step === i + 1 ? "#c9a84c" : "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "center" }}>{s}</div>
          </div>
        ))}
      </div>

      {/* ═══════════ STEP 1: ADDRESS ═══════════ */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
            <div>
              <label style={labelStyle}>Street Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St" style={inputStyle} />
            </div>
            <div style={{ width: 80 }}>
              <label style={labelStyle}>Unit #</label>
              <input placeholder="Apt" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px", gap: 12 }}>
            <div>
              <label style={labelStyle}>City</label>
              <input value={city} onChange={e => setCity(e.target.value)} placeholder="Dallas" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <select value={state} onChange={e => setState(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="Texas">Texas</option>
                <option value="Oklahoma">Oklahoma</option>
                <option value="Arkansas">Arkansas</option>
                <option value="Louisiana">Louisiana</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Zip</label>
              <input value={zip} onChange={e => setZip(e.target.value)} placeholder="75201" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Property Size</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {SQFT_TIERS.map(t => (
                <button key={t.value} onClick={() => setSqftTier(t.value)} style={{
                  padding: "12px 4px", borderRadius: 8, cursor: "pointer",
                  border: sqftTier === t.value ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                  background: sqftTier === t.value ? "rgba(201,168,76,0.1)" : "rgba(255,255,255,0.03)",
                  color: sqftTier === t.value ? "#c9a84c" : "rgba(255,255,255,0.5)",
                  fontFamily: "'Jost', sans-serif", fontSize: 11, textAlign: "center",
                  transition: "all 0.2s", lineHeight: 1.3,
                }}>{t.label}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Method of Access</label>
            <input value={accessMethod} onChange={e => setAccessMethod(e.target.value)} placeholder="Lockbox code, agent, seller, etc." style={inputStyle} />
          </div>
        </div>
      )}

      {/* ═══════════ STEP 2: SERVICE SELECTION ═══════════ */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 0, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
            {["package", "individual"].map(m => (
              <button key={m} onClick={() => { setBookingMode(m); if (m === "package") setSelectedServices({}); if (m === "individual") setSelectedPackage(null); }} style={{
                flex: 1, padding: "14px", border: "none", cursor: "pointer",
                background: bookingMode === m ? "#c9a84c" : "rgba(255,255,255,0.03)",
                color: bookingMode === m ? "#0a1628" : "rgba(255,255,255,0.5)",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600,
                letterSpacing: "0.1em", textTransform: "uppercase", transition: "all 0.2s",
              }}>{m === "package" ? "Packages" : "Individual Services"}</button>
            ))}
          </div>

          {/* PACKAGES view */}
          {bookingMode === "package" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PACKAGES.map((p, i) => {
                const isEssential = i === 0;
                const cov = coverageStateFor(i);
                const showAsCovered = cov === "covered";
                const priceDisplay = showAsCovered
                  ? "$0"
                  : (isEssential
                      ? (sqftTier ? `$${ESSENTIAL_PRICING[sqftTier]}` : "Select sqft")
                      : p.price);
                let coverageNote = null;
                if (cov === "covered")     coverageNote = `Covered by your ${TIER_LABEL[subTier] || subTier} subscription`;
                else if (cov === "no-credits") coverageNote = "You've used all your credits this period";
                else if (cov === "above-tier") coverageNote = `Your ${TIER_LABEL[subTier] || subTier} subscription doesn't cover this tier`;
                return (
                  <div key={p.name} onClick={() => setSelectedPackage(i)} style={{
                    border: selectedPackage === i ? `2px solid ${p.color}` : "2px solid rgba(255,255,255,0.08)",
                    borderRadius: 12, padding: 20, cursor: "pointer",
                    background: selectedPackage === i ? `rgba(${p.color === "#c9a84c" ? "201,168,76" : p.color === "#e5c97e" ? "229,201,126" : "143,163,177"},0.06)` : "rgba(255,255,255,0.02)",
                    position: "relative", transition: "all 0.2s",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: p.color }}>{p.name}</div>
                        {p.popular && (
                          <span style={{
                            background: "#c9a84c", color: "#0a1628",
                            fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                            letterSpacing: "0.1em", textTransform: "uppercase",
                            padding: "2px 8px", borderRadius: 4,
                          }}>Most Popular</span>
                        )}
                        {showAsCovered && (
                          <span style={{
                            background: "rgba(201,168,76,0.15)", color: "#e5c97e",
                            border: "1px solid rgba(229,201,126,0.4)",
                            fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                            letterSpacing: "0.1em", textTransform: "uppercase",
                            padding: "2px 8px", borderRadius: 4,
                          }}>1 credit</span>
                        )}
                      </div>
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>{p.desc}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: coverageNote ? 8 : 0 }}>
                        {p.features.map(f => (
                          <span key={f} style={{
                            fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.6)",
                            background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: 4,
                          }}>✓ {f}</span>
                        ))}
                      </div>
                      {coverageNote && (
                        <div style={{
                          fontFamily: "'Jost', sans-serif", fontSize: 10,
                          color: cov === "covered" ? "#e5c97e" : "rgba(255,255,255,0.35)",
                          letterSpacing: "0.04em",
                        }}>
                          {coverageNote}
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: "#fff", fontWeight: 700, marginLeft: 16, textAlign: "right", whiteSpace: "nowrap" }}>
                      {priceDisplay}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* INDIVIDUAL SERVICES view */}
          {bookingMode === "individual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(INDIVIDUAL_SERVICES).map(([key, svc]) => {
                const price = getServicePrice(svc);
                const isSelected = !!selectedServices[key];
                return (
                  <div key={key} onClick={() => setSelectedServices(prev => ({ ...prev, [key]: !prev[key] }))} style={{
                    border: isSelected ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                    borderRadius: 10, padding: 16, cursor: "pointer",
                    background: isSelected ? "rgba(201,168,76,0.06)" : "rgba(255,255,255,0.02)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    transition: "all 0.2s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                      <div style={{ fontSize: 24 }}>{svc.icon}</div>
                      <div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: isSelected ? "#c9a84c" : "#fff", fontWeight: 500 }}>{svc.name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{svc.desc}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: isSelected ? "#c9a84c" : "#fff", fontWeight: 700 }}>
                        {price !== null ? `$${price}` : "—"}
                      </div>
                      <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        border: isSelected ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.2)",
                        background: isSelected ? "#c9a84c" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, color: "#0a1628", transition: "all 0.2s",
                      }}>{isSelected ? "✓" : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ STEP 3: ADD-ONS ═══════════ */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff", marginBottom: 4 }}>
            Enhance Your Shoot
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
            Optional add-ons to take your listing further. Skip if not needed.
          </div>
          {ADDONS.map(a => {
            const isSelected = !!selectedAddons[a.id];
            return (
              <div key={a.id} onClick={() => {
                if (a.hasQty) {
                  setSelectedAddons(prev => prev[a.id] ? { ...prev, [a.id]: undefined } : { ...prev, [a.id]: 1 });
                } else {
                  setSelectedAddons(prev => ({ ...prev, [a.id]: !prev[a.id] }));
                }
              }} style={{
                border: isSelected ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                borderRadius: 10, padding: 16, cursor: "pointer",
                background: isSelected ? "rgba(201,168,76,0.06)" : "rgba(255,255,255,0.02)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "all 0.2s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                  <div style={{ fontSize: 22 }}>{a.icon}</div>
                  <div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: isSelected ? "#c9a84c" : "#fff", fontWeight: 500 }}>{a.name}</div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{a.desc}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {a.hasQty && isSelected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => setSelectedAddons(prev => ({ ...prev, [a.id]: Math.max(1, (prev[a.id] || 1) - 1) }))} style={{
                        width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
                        background: "transparent", color: "#fff", cursor: "pointer", fontSize: 14,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>−</button>
                      <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#fff", minWidth: 20, textAlign: "center" }}>{selectedAddons[a.id]}</span>
                      <button onClick={() => setSelectedAddons(prev => ({ ...prev, [a.id]: Math.min(a.maxQty || 10, (prev[a.id] || 1) + 1) }))} style={{
                        width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
                        background: "transparent", color: "#fff", cursor: "pointer", fontSize: 14,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>+</button>
                    </div>
                  )}
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: isSelected ? "#c9a84c" : "#fff", fontWeight: 700, whiteSpace: "nowrap" }}>
                    ${a.price}{a.unit || ""}
                  </div>
                  <div style={{
                    width: 22, height: 22, borderRadius: 6,
                    border: isSelected ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.2)",
                    background: isSelected ? "#c9a84c" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, color: "#0a1628", transition: "all 0.2s",
                  }}>{isSelected ? "✓" : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════ STEP 4: SCHEDULE ═══════════ */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff" }}>
            Choose a Date & Time
          </div>
          <div>
            <label style={labelStyle}>Preferred Shoot Date</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Preferred Time {loadingSlots && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>(checking availability...)</span>}</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {TIME_SLOTS.map(t => {
                const busy = isSlotBusy(t);
                return (
                <button key={t} onClick={() => !busy && setSelectedTime(t)} disabled={busy} style={{
                  padding: "12px", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer",
                  border: selectedTime === t ? "2px solid #c9a84c" : busy ? "2px solid rgba(255,0,0,0.15)" : "2px solid rgba(255,255,255,0.08)",
                  background: selectedTime === t ? "rgba(201,168,76,0.1)" : busy ? "rgba(255,0,0,0.05)" : "rgba(255,255,255,0.03)",
                  color: selectedTime === t ? "#c9a84c" : busy ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.6)",
                  fontFamily: "'Jost', sans-serif", fontSize: 13, textAlign: "center",
                  transition: "all 0.2s", opacity: busy ? 0.5 : 1,
                  textDecoration: busy ? "line-through" : "none",
                }}>{t}</button>
                );
              })}
            </div>
          </div>
          <div style={{
            background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)",
            borderRadius: 8, padding: 12,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Availability synced with Google Calendar — greyed-out slots are already booked.
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ STEP 5: REVIEW & PAY ═══════════ */}
      {step === 5 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff" }}>
            Review Your Booking
          </div>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20 }}>
            {/* Property */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Property</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#fff" }}>{address}, {city}, {state} {zip}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{SQFT_TIERS.find(t => t.value === sqftTier)?.label}</div>
            </div>
            {/* Services */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Services</div>
              {bookingMode === "package" && selectedPackage !== null && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>
                    {PACKAGES[selectedPackage].name} Package
                    {creditWillApply && (
                      <span style={{ color: "#e5c97e", fontSize: 11, marginLeft: 8 }}>
                        (covered by {TIER_LABEL[subTier] || subTier} subscription)
                      </span>
                    )}
                  </span>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", fontWeight: 600 }}>
                    ${creditWillApply ? 0 : (selectedPackage === 0 ? (ESSENTIAL_PRICING[sqftTier] || 0) : (PACKAGES[selectedPackage]?.priceValue || 0))}
                  </span>
                </div>
              )}
              {bookingMode === "individual" && Object.entries(selectedServices).filter(([, v]) => v).map(([key]) => {
                const svc = INDIVIDUAL_SERVICES[key];
                const price = getServicePrice(svc);
                return (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{svc.name}</span>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", fontWeight: 600 }}>${price}</span>
                  </div>
                );
              })}
            </div>
            {/* Add-ons */}
            {ADDONS.some(a => selectedAddons[a.id]) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Add-ons</div>
                {ADDONS.filter(a => selectedAddons[a.id]).map(a => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>
                      {a.name}{a.hasQty ? ` × ${selectedAddons[a.id]}` : ""}
                    </span>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", fontWeight: 600 }}>
                      ${a.hasQty ? a.price * selectedAddons[a.id] : a.price}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Schedule */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Schedule</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#fff" }}>{selectedDate} at {selectedTime}</div>
            </div>
            {/* Total */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 16, borderTop: "2px solid rgba(201,168,76,0.3)" }}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>Total</span>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", fontWeight: 700 }}>${breakdown.total.toLocaleString()}</span>
            </div>
          </div>
          {/* Contact info */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: 16, marginBottom: 12,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Contact Information</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="text" placeholder="Full Name *" value={clientName} onChange={e => setClientName(e.target.value)} style={inputStyle} />
              <input type="email" placeholder="Email Address *" value={clientEmail} onChange={e => setClientEmail(e.target.value)} style={inputStyle} />
              <input type="tel" placeholder="Phone Number" value={clientPhone} onChange={e => setClientPhone(e.target.value)} style={inputStyle} />
            </div>
          </div>
          {/* Payment note */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: 16,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Payment</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              {creditWillApply && breakdown.total === 0
                ? `No charge for this booking — covered entirely by your ${TIER_LABEL[subTier] || subTier} subscription credit.`
                : "Payment processing will be available soon. Your booking will be confirmed and invoiced separately."}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ NAV BUTTONS ═══════════ */}
      <div style={{ display: "flex", gap: 12 }}>
        {bookingError && (
          <div style={{
            width: "100%", marginBottom: 8, padding: "12px 16px",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 8, color: "#f87171",
            fontFamily: "'Jost', sans-serif", fontSize: 13,
          }}>
            ⚠ {bookingError}
          </div>
        )}
        {step > 1 && (
          <button onClick={() => { setBookingError(null); setStep(s => s - 1); }} style={{
            flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.6)", padding: "14px", borderRadius: 8,
            fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer",
          }}>← Back</button>
        )}
        <button
          onClick={() => step < 5 ? setStep(s => s + 1) : handleBook()}
          disabled={!canProceed() || processing}
          style={{
            flex: 2, background: canProceed() ? "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)" : "rgba(255,255,255,0.08)",
            border: "none", borderRadius: 8, padding: "14px",
            fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 13,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: canProceed() ? "#0a1628" : "rgba(255,255,255,0.3)",
            cursor: canProceed() ? "pointer" : "not-allowed",
            opacity: processing ? 0.7 : 1, transition: "all 0.2s",
          }}>
          {processing ? "Processing..." : step === 5 ? "Confirm Booking ✓" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

export default BookView;
