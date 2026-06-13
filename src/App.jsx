import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";
import AdminView from "./views/Admin";
import BookingsManagerView from "./views/Bookings";
import ShowcaseView from "./views/Showcase";
import BookView from "./views/Book";
import ContentView from "./views/Content";
import MicrositeView from "./views/Microsite";
import AnalyticsView from "./views/Analytics";
import SubscriptionsView from "./views/Subscriptions";
import InstagramView from "./views/Instagram";
// Shared modules — see src/lib/ for the why. These extractions broke
// a circular import that App.jsx had with every view (App imported
// the views; the views imported pricing/auth/UI symbols back from App).
// Production minification turned that cycle into a TDZ runtime error.
import { PRICING, PACKAGES, SQFT_TIERS, ESSENTIAL_PRICING, INDIVIDUAL_SERVICES, ADDONS, SUBSCRIPTIONS, PROMOS, STRIPE_IDS } from "./lib/pricing";
import { AuthContext, useAuth } from "./lib/auth";
import { isSubscribed } from "./lib/subscription";
import { MEDIA_ICONS, THEMES, StatusBadge, PackageBadge } from "./lib/ui";
import MicrositeRenderer from "./components/MicrositeRenderer";
import VoiceProfileModal from "./components/VoiceProfileModal";

const NAV = ["Showcase", "Book", "My Media", "Analytics"];

// LISTINGS and RELA_PHOTOS removed — all listing data now fetched from Supabase

// ============================================================
// AUTH VIEW — Login / Sign Up
// ============================================================
function AuthView() {
  const [mode, setMode] = useState("login"); // login | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const inputStyle = {
    width: "100%", padding: "14px 16px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
    color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14,
    outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
  };

  const labelStyle = {
    fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, display: "block",
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (mode === "signup") {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(error.message);
      } else if (signUpData?.user) {
        // Create agent profile row so the app can load their profile
        const { error: profileError } = await supabase.from("agents").upsert({
          id: signUpData.user.id,
          full_name: fullName,
          email: email,
          role: "agent",
        }, { onConflict: "id" });
        if (profileError) console.error("Error creating agent profile:", profileError);
        // If session exists (email confirm disabled), user is auto-logged-in
        if (signUpData.session) {
          // Auth state change listener will handle the rest
        } else {
          setMessage("Check your email for a confirmation link!");
        }
      }
    } else if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) setError(error.message);
      else setMessage("Password reset link sent to your email!");
    }
    setLoading(false);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080c16", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Jost', sans-serif", padding: "40px 24px",
    }}>
      {/* Background */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse at 20% 20%, rgba(201,168,76,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(10,22,40,0.8) 0%, transparent 60%)",
      }} />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <img src="/icons/icon-192.png" alt="Milestone Media" style={{
            width: 72, height: 72, borderRadius: "50%",
            border: "2px solid rgba(201,168,76,0.3)", marginBottom: 16,
          }} />
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", letterSpacing: "0.04em" }}>
            Milestone
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 4 }}>
            Media & Photography
          </div>
        </div>

        {/* Auth Card */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: 28,
        }}>
          <div style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff",
            textAlign: "center", marginBottom: 24,
          }}>
            {mode === "login" ? "Welcome Back" : mode === "signup" ? "Create Account" : "Reset Password"}
          </div>

          {/* Google Sign-in */}
          {mode !== "forgot" && (
            <>
              <button onClick={handleGoogleSignIn} disabled={loading} style={{
                width: "100%", padding: "12px 16px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14,
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10, transition: "all 0.2s",
                opacity: loading ? 0.6 : 1,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div style={{
                display: "flex", alignItems: "center", gap: 12, margin: "20px 0",
              }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>OR</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
              </div>
            </>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {mode === "signup" && (
              <div>
                <label style={labelStyle}>Full Name</label>
                <input
                  type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="Tyshawn Miles" style={inputStyle} required
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="agent@example.com" style={inputStyle} required
              />
            </div>

            {mode !== "forgot" && (
              <div>
                <label style={labelStyle}>Password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" style={inputStyle} required minLength={6}
                />
              </div>
            )}

            {error && (
              <div style={{
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 13,
              }}>{error}</div>
            )}

            {message && (
              <div style={{
                background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
                borderRadius: 8, padding: "10px 14px", color: "#4ade80", fontSize: 13,
              }}>{message}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: "14px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg, #c9a84c, #e5c97e)", color: "#080c16",
              fontFamily: "'Jost', sans-serif", fontSize: 14, fontWeight: 600,
              letterSpacing: "0.06em", cursor: "pointer", transition: "all 0.2s",
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
            </button>
          </form>

          {/* Mode switches */}
          <div style={{ marginTop: 20, textAlign: "center" }}>
            {mode === "login" && (
              <>
                <button onClick={() => { setMode("forgot"); setError(""); setMessage(""); }} style={{
                  background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                  fontSize: 12, cursor: "pointer", fontFamily: "'Jost', sans-serif",
                }}>Forgot password?</button>
                <div style={{ marginTop: 12, color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                  Don't have an account?{" "}
                  <button onClick={() => { setMode("signup"); setError(""); setMessage(""); }} style={{
                    background: "none", border: "none", color: "#c9a84c",
                    fontSize: 13, cursor: "pointer", fontFamily: "'Jost', sans-serif", fontWeight: 600,
                  }}>Sign Up</button>
                </div>
              </>
            )}
            {mode === "signup" && (
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); setMessage(""); }} style={{
                  background: "none", border: "none", color: "#c9a84c",
                  fontSize: 13, cursor: "pointer", fontFamily: "'Jost', sans-serif", fontWeight: 600,
                }}>Sign In</button>
              </div>
            )}
            {mode === "forgot" && (
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                <button onClick={() => { setMode("login"); setError(""); setMessage(""); }} style={{
                  background: "none", border: "none", color: "#c9a84c",
                  fontSize: 13, cursor: "pointer", fontFamily: "'Jost', sans-serif", fontWeight: 600,
                }}>Back to Sign In</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 24, color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
          Milestone Media & Photography — DFW
        </div>
      </div>
    </div>
  );
}



// THEME_LAYOUT moved to src/lib/ui.jsx alongside THEMES so both the
// public render and the in-app preview consume the same map.

// ============================================================
// PUBLIC MICROSITE PAGE (no authentication required)
// ============================================================
//
// Thin wrapper: fetches the microsite snapshot + the agent's branding,
// then delegates all rendering to <MicrositeRenderer mode="live"/>.
// Same renderer is used by MicrositePreview in the editor, so what the
// agent sees in preview is what visitors see live.

function PublicMicrosite() {
  const [microsite, setMicrosite] = useState(null);
  const [agentBranding, setAgentBranding] = useState(null);
  const [brokerageName, setBrokerageName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const slug = window.location.pathname.replace("/p/", "").split("/")[0];

  useEffect(() => {
    const fetchMicrosite = async () => {
      try {
        const { data: msData, error: fetchError } = await supabase
          .from("microsites")
          .select("*")
          .eq("slug", slug)
          .eq("published", true)
          .single();

        if (fetchError || !msData) {
          setError("Microsite not found");
          setLoading(false);
          return;
        }

        setMicrosite(msData);

        // Stage 6 white-label: prefer branding snapshotted into property_data
        // at publish time. The agents / agent_voice_profiles tables are NOT
        // anon-readable, so for a real anonymous visitor the snapshot is the
        // only source that resolves. The live reads below remain as a fallback
        // for authenticated self-preview and pre-snapshot legacy microsites.
        const pd = msData.property_data || {};
        const hasSnapshot = !!(pd.agency_name || pd.agency_logo_url || pd.profile_photo_url);
        if (hasSnapshot) {
          setAgentBranding({
            full_name:         pd.agent_name || "",
            agency_name:       pd.agency_name || "",
            agency_logo_url:   pd.agency_logo_url || "",
            profile_photo_url: pd.profile_photo_url || "",
          });
        }
        if (pd.brokerage_name) setBrokerageName(pd.brokerage_name);

        if (msData.agent_id) {
          const [{ data: ab }, { data: vp }] = await Promise.all([
            supabase
              .from("agents")
              .select("full_name, agency_name, agency_logo_url, profile_photo_url")
              .eq("id", msData.agent_id)
              .single(),
            supabase
              .from("agent_voice_profiles")
              .select("brokerage_name")
              .eq("agent_id", msData.agent_id)
              .limit(1)
              .maybeSingle(),
          ]);
          // Fallback only — never overwrite a resolved snapshot.
          if (ab && !hasSnapshot) setAgentBranding(ab);
          if (vp?.brokerage_name && !pd.brokerage_name) setBrokerageName(vp.brokerage_name);
        }

        setLoading(false);
      } catch (err) {
        setError("Error loading microsite");
        setLoading(false);
      }
    };
    fetchMicrosite();
  }, [slug]);

  // ── Stage 6a white-label: reflect the agent's brand in the browser tab ──
  // Sets the document title + favicon to the agent's agency branding while a
  // published microsite is mounted, and restores the Milestone defaults on
  // unmount so navigating back into the dashboard never leaves an agent's
  // brand stuck in the tab.
  useEffect(() => {
    const iconEl = document.querySelector('link[rel="icon"]');
    const appleEl = document.querySelector('link[rel="apple-touch-icon"]');

    // Capture originals so cleanup restores exactly what was there.
    const origTitle = document.title;
    const origIconHref = iconEl ? iconEl.getAttribute("href") : null;
    const origAppleHref = appleEl ? appleEl.getAttribute("href") : null;

    const agencyName = agentBranding?.agency_name;
    const address = microsite?.property_data?.address;
    const logoUrl = agentBranding?.agency_logo_url;

    if (agencyName && address) {
      document.title = `${agencyName} — ${address}`;
    } else if (agencyName) {
      document.title = agencyName;
    } else {
      document.title = "Milestone Media & Photography";
    }

    if (logoUrl) {
      if (iconEl) iconEl.setAttribute("href", logoUrl);
      if (appleEl) appleEl.setAttribute("href", logoUrl);
    }

    return () => {
      document.title = origTitle;
      if (iconEl && origIconHref !== null) iconEl.setAttribute("href", origIconHref);
      if (appleEl && origAppleHref !== null) appleEl.setAttribute("href", origAppleHref);
    };
  }, [agentBranding, microsite]);

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0f0f1a", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16,
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#C9A84C",
          animation: "pulse 1.5s ease-in-out infinite",
        }}>Loading...</div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
      </div>
    );
  }

  if (error || !microsite) {
    return (
      <div style={{
        minHeight: "100vh", background: "#1a1a1a", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 20,
      }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 80, color: "#9ca3af", fontWeight: 700 }}>404</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff", textAlign: "center" }}>
          Microsite not found
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
          This property microsite is no longer available.
        </div>
      </div>
    );
  }

  return (
    <MicrositeRenderer
      microsite={microsite.property_data || {}}
      theme={microsite.theme}
      agentBranding={agentBranding}
      mode="live"
      micrositeId={microsite.id}
      listingId={microsite.property_data?.listing_id || microsite.listing_id}
      micrositeSlug={microsite.slug}
      brokerageName={brokerageName}
      sold={microsite.sold_at ? { soldAt: microsite.sold_at, soldPrice: microsite.sold_price } : null}
    />
  );
}

// ============================================================
// EDIT PROFILE & BRANDING MODAL
// ============================================================
// Mirror of DEFAULT_BRAND_TOKENS (src/views/Content/carouselCompose.js) —
// used to seed the brand color/font pickers. Mirrored rather than imported
// to avoid pulling a view module into App.jsx (circular-import sensitivity,
// see the import note at the top of this file).
const CAROUSEL_BRAND_DEFAULTS = {
  bgColor:      "#FBF7EE",
  textColor:    "#1A1A1A",
  mutedColor:   "#6B6256",
  accentColor:  "#C9A84C",
  fontHeadline: "Cormorant Garamond",
  fontBody:     "Jost",
};
const BRAND_FONT_OPTIONS = ["Cormorant Garamond", "Jost"];

function EditProfileModal({ onClose }) {
  const { user, profile, fetchProfile } = useAuth();

  // ── Personal info
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [businessAddress, setBusinessAddress] = useState(profile?.business_address || "");

  // ── Agency branding
  const [agencyName, setAgencyName] = useState(profile?.agency_name || "");

  // ── Brand tokens (color/font picker — consumed by the carousel composer)
  const [brandBgColor, setBrandBgColor]       = useState(profile?.brand_bg_color      ?? CAROUSEL_BRAND_DEFAULTS.bgColor);
  const [brandTextColor, setBrandTextColor]   = useState(profile?.brand_text_color    ?? CAROUSEL_BRAND_DEFAULTS.textColor);
  const [brandMutedColor, setBrandMutedColor] = useState(profile?.brand_muted_color   ?? CAROUSEL_BRAND_DEFAULTS.mutedColor);
  const [brandAccentColor, setBrandAccentColor] = useState(profile?.brand_accent_color ?? CAROUSEL_BRAND_DEFAULTS.accentColor);
  const [brandFontHeadline, setBrandFontHeadline] = useState(profile?.brand_font_headline ?? CAROUSEL_BRAND_DEFAULTS.fontHeadline);
  const [brandFontBody, setBrandFontBody]     = useState(profile?.brand_font_body     ?? CAROUSEL_BRAND_DEFAULTS.fontBody);

  // ── Brokerage info (consumed by the microsite chat assistant)
  const [brokerageAbout, setBrokerageAbout] = useState(profile?.brokerage_about || "");
  const [brokerageUrl, setBrokerageUrl] = useState(profile?.brokerage_url || "");
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(profile?.agency_logo_url || null);

  // ── Profile photo
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(profile?.profile_photo_url || profile?.avatar_url || null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef(null);
  const photoInputRef = useRef(null);

  const pickFile = (file, setFile, setPreview) => {
    if (!file) return;
    setFile(file);
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const uploadBranding = async (file, fileName) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `${user.id}/${fileName}.${ext}`;
    await supabase.storage.from("agent-branding").remove([path]).catch(() => {});
    const { error } = await supabase.storage.from("agent-branding").upload(path, file, { contentType: file.type, upsert: true });
    if (error) { console.error("Upload error:", error); return null; }
    const { data } = supabase.storage.from("agent-branding").getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
  };

  const handleSave = async () => {
    setSaving(true);
    const updates = {
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      business_address: businessAddress.trim() || null,
      agency_name: agencyName.trim() || null,
      brand_bg_color: brandBgColor || null,
      brand_text_color: brandTextColor || null,
      brand_muted_color: brandMutedColor || null,
      brand_accent_color: brandAccentColor || null,
      brand_font_headline: brandFontHeadline || null,
      brand_font_body: brandFontBody || null,
      brokerage_about: brokerageAbout.trim() || null,
      brokerage_url: brokerageUrl.trim() || null,
    };
    if (logoFile) {
      const url = await uploadBranding(logoFile, "logo");
      if (url) updates.agency_logo_url = url;
    }
    if (photoFile) {
      const url = await uploadBranding(photoFile, "photo");
      if (url) { updates.profile_photo_url = url; updates.avatar_url = url; }
    }
    const { error } = await supabase.from("agents").update(updates).eq("id", user.id);
    if (error) { alert("Save failed: " + error.message); setSaving(false); return; }
    await fetchProfile(user.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1400);
  };

  const clearLogo = async () => {
    setLogoFile(null); setLogoPreview(null);
    await supabase.from("agents").update({ agency_logo_url: null }).eq("id", user.id);
    await fetchProfile(user.id);
  };

  const inputSt = {
    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, padding: "11px 14px", color: "#fff",
    fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none", boxSizing: "border-box",
    transition: "border-color 0.2s",
  };
  const labelSt = {
    fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 7, display: "block",
  };
  const sectionTitle = (icon, text) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#C9A84C", fontWeight: 600 }}>{icon} {text}</div>
      <div style={{ flex: 1, height: 1, background: "rgba(201,168,76,0.2)" }} />
    </div>
  );
  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "24px 0" }} />;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#0e1220", border: "1px solid rgba(201,168,76,0.18)",
        borderRadius: 18, width: "100%", maxWidth: 520,
        boxShadow: "0 40px 100px rgba(0,0,0,0.9)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* ── Modal header ── */}
        <div style={{
          padding: "24px 28px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Avatar preview */}
            <div style={{
              width: 52, height: 52, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
              background: "rgba(201,168,76,0.12)", border: "2px solid rgba(201,168,76,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }} onClick={() => photoInputRef.current?.click()}>
              {photoPreview
                ? <img src={photoPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 22, color: "#c9a84c" }}>👤</span>
              }
            </div>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 600, lineHeight: 1.1 }}>
                {fullName || profile?.full_name || "Your Profile"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", marginTop: 2 }}>
                {user?.email}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: "auto", padding: "24px 28px 28px", flex: 1 }}>

          {/* ── SECTION: Personal Info ── */}
          {sectionTitle("👤", "Personal Info")}

          {/* Profile photo upload */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelSt}>Profile Photo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                background: "rgba(201,168,76,0.1)", border: "2px solid rgba(201,168,76,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {photoPreview
                  ? <img src={photoPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 24, color: "#c9a84c" }}>👤</span>
                }
              </div>
              <div>
                <input ref={photoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => pickFile(e.target.files[0], setPhotoFile, setPhotoPreview)} />
                <button onClick={() => photoInputRef.current?.click()} style={{
                  background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
                  color: "#c9a84c", borderRadius: 7, padding: "7px 14px", cursor: "pointer",
                  fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.05em",
                }}>{photoPreview ? "Change Photo" : "Upload Photo"}</button>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.22)", marginTop: 5 }}>
                  Shown in the contact card on your microsites
                </div>
              </div>
            </div>
          </div>

          {/* Full name */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Full Name</label>
            <input style={inputSt} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" />
          </div>

          {/* Phone */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Phone Number</label>
            <input style={inputSt} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(214) 555-0100" type="tel" />
          </div>

          {/* Email — read-only */}
          <div style={{ marginBottom: 0 }}>
            <label style={labelSt}>Email Address</label>
            <input
              style={{ ...inputSt, color: "rgba(255,255,255,0.4)", cursor: "not-allowed" }}
              value={user?.email || ""}
              readOnly
            />
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 5 }}>
              Email is tied to your login — contact support to change it
            </div>
          </div>

          {divider}

          {/* ── SECTION: Business ── */}
          {sectionTitle("🏢", "Business")}

          <div style={{ marginBottom: 0 }}>
            <label style={labelSt}>Business Address</label>
            <input style={inputSt} value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} placeholder="123 Main St, Dallas, TX 75201" />
          </div>

          {divider}

          {/* ── SECTION: Agency Branding ── */}
          {sectionTitle("✦", "Agency Branding")}
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 18, lineHeight: 1.6 }}>
            Your logo or agency name replaces "Milestone Media" on all your published microsites.
          </div>

          {/* Agency Logo */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelSt}>Agency Logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 110, height: 60, borderRadius: 8, overflow: "hidden", flexShrink: 0,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {logoPreview
                  ? <img src={logoPreview} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: 6 }} />
                  : <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "center", padding: 6 }}>No logo yet</span>
                }
              </div>
              <div style={{ flex: 1 }}>
                <input ref={logoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => pickFile(e.target.files[0], setLogoFile, setLogoPreview)} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => logoInputRef.current?.click()} style={{
                    background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
                    color: "#c9a84c", borderRadius: 7, padding: "7px 14px", cursor: "pointer",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.05em",
                  }}>{logoPreview ? "Change Logo" : "Upload Logo"}</button>
                  {logoPreview && (
                    <button onClick={clearLogo} style={{
                      background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
                      color: "#f87171", borderRadius: 7, padding: "7px 12px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 11,
                    }}>Remove</button>
                  )}
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 5 }}>
                  PNG with transparent background works best
                </div>
              </div>
            </div>
          </div>

          {/* Agency Name */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelSt}>Agency Name <span style={{ color: "rgba(255,255,255,0.2)" }}>— text fallback if no logo</span></label>
            <input
              style={inputSt}
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              placeholder="e.g. Compass Real Estate · Keller Williams DFW"
            />
          </div>

          {/* Brand Colors & Fonts — applied to your generated content carousels */}
          <div style={{ marginBottom: 0 }}>
            <label style={labelSt}>Brand Colors &amp; Fonts <span style={{ color: "rgba(255,255,255,0.2)" }}>— used on your content carousels</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 4 }}>
              {[
                { label: "Background", value: brandBgColor,     setter: setBrandBgColor },
                { label: "Text",       value: brandTextColor,   setter: setBrandTextColor },
                { label: "Muted",      value: brandMutedColor,  setter: setBrandMutedColor },
                { label: "Accent",     value: brandAccentColor, setter: setBrandAccentColor },
              ].map(({ label, value, setter }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="color"
                    value={value}
                    onChange={e => setter(e.target.value)}
                    aria-label={`${label} color`}
                    style={{
                      width: 38, height: 32, padding: 0, border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6, background: "transparent", cursor: "pointer", flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.75)" }}>{label}</div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{value}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 12 }}>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Headline Font</div>
                <select style={inputSt} value={brandFontHeadline} onChange={e => setBrandFontHeadline(e.target.value)}>
                  {BRAND_FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Body Font</div>
                <select style={inputSt} value={brandFontBody} onChange={e => setBrandFontBody(e.target.value)}>
                  {BRAND_FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </div>

          {divider}

          {/* ── SECTION: Brokerage ── */}
          {sectionTitle("💬", "Brokerage")}
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 18, lineHeight: 1.6 }}>
            Used by the AI chat assistant on your microsites so it can speak about your brokerage.
          </div>

          {/* About the brokerage */}
          {(() => {
            const wordCount = brokerageAbout.trim() ? brokerageAbout.trim().split(/\s+/).length : 0;
            const overLimit = wordCount > 500;
            return (
              <div style={{ marginBottom: 18 }}>
                <label style={labelSt}>About the Brokerage</label>
                <textarea
                  style={{ ...inputSt, height: 120, resize: "vertical", lineHeight: 1.5 }}
                  value={brokerageAbout}
                  onChange={e => setBrokerageAbout(e.target.value)}
                  placeholder="A short description of your brokerage — what you specialize in, the markets you serve, what sets your team apart."
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, gap: 12 }}>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
                    A short description of your brokerage shown to visitors in the chat assistant. Helps the chat feel like part of your team.
                  </span>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: overLimit ? "#f87171" : "rgba(255,255,255,0.25)", whiteSpace: "nowrap" }}>
                    {wordCount} / 200–500 words
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Brokerage website */}
          <div style={{ marginBottom: 0 }}>
            <label style={labelSt}>Brokerage Website</label>
            <input
              style={inputSt}
              type="url"
              value={brokerageUrl}
              onChange={e => setBrokerageUrl(e.target.value)}
              placeholder="https://yourbrokerage.com"
            />
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 5 }}>
              Optional. Used by the chat assistant when relevant.
            </div>
          </div>

        </div>

        {/* ── Sticky footer with save button ── */}
        <div style={{
          padding: "16px 28px 20px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0,
          background: "#0e1220",
        }}>
          <button onClick={handleSave} disabled={saving || saved} style={{
            width: "100%", padding: "14px 0", borderRadius: 10, cursor: saving || saved ? "default" : "pointer",
            background: saved ? "rgba(74,222,128,0.15)" : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
            color: saved ? "#4ade80" : "#0a1628",
            fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase",
            border: saved ? "1px solid rgba(74,222,128,0.35)" : "none",
            transition: "all 0.25s",
          }}>
            {saved ? "✓ Profile Saved!" : saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP SHELL (responsive: desktop sidebar + mobile bottom nav)
// ============================================================
function AppShell() {
  const { user, profile, signOut, fetchProfile } = useAuth();
  const [tabRaw, setTabRaw] = useState(0);
  // Off-nav views (reachable from the profile dropdown or a URL param,
  // not from the main nav). When set, it overrides the nav-driven view.
  const [extraView, setExtraView] = useState(null);
  // Wrap setTab so any nav-driven navigation clears the off-nav view.
  const setTab = (n) => { setTabRaw(n); setExtraView(null); };
  const tab = tabRaw;
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showVoiceProfile, setShowVoiceProfile] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // If we land here via a Stripe-redirect URL (?subscription=...), open
  // the Subscriptions view on mount so the user sees the success / cancel
  // banner without having to navigate.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("subscription")) setExtraView("Subscriptions");
    // bundle.social returns the agent here after the hosted connect portal.
    if (params.has("social")) setExtraView("Instagram");
  }, []);

  const handleBook = () => setTab(1);
  const isAdmin = profile?.role === "admin";

  const baseNavItems = [
    { label: "Showcase", icon: "✦" },
    { label: "Book", icon: "+" },
    { label: "Content", icon: "⊞" },
    { label: "Analytics", icon: "↗" },
    { label: "Microsite", icon: "🌐" },
  ];
  const navItems = isAdmin
    ? [...baseNavItems, { label: "Bookings", icon: "📋" }, { label: "Admin", icon: "⚙" }]
    : [...baseNavItems, { label: "Bookings", icon: "📋" }];

  const viewMap = {
    Showcase: <ShowcaseView onBook={handleBook} />,
    Book: <BookView />,
    Content: <ContentView />,
    Analytics: <AnalyticsView />,
    Microsite: <MicrositeView />,
    // Subscriptions is reachable only from the profile dropdown — not in navItems.
    Subscriptions: <SubscriptionsView />,
    // Instagram (Connected Accounts) — off-nav, profile dropdown only.
    Instagram: <InstagramView />,
    Bookings: <BookingsManagerView />,
    ...(isAdmin && { Admin: <AdminView /> }),
  };
  // If extraView is set (off-nav route like Subscriptions), it takes precedence.
  const activeView = extraView
    ? (viewMap[extraView] ?? null)
    : (viewMap[navItems[tab]?.label] ?? null);

  const ProfileDropdown = showProfile && (
    <div style={{
      position: "absolute", top: 48, right: 0, width: 260,
      background: "#0e1220", border: "1px solid rgba(201,168,76,0.15)",
      borderRadius: 14, zIndex: 50,
      boxShadow: "0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(201,168,76,0.06)",
      overflow: "hidden",
    }}>
      {/* Profile summary row */}
      <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
            background: "rgba(201,168,76,0.12)", border: "1.5px solid rgba(201,168,76,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {profile?.profile_photo_url || profile?.avatar_url
              ? <img src={profile.profile_photo_url || profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontSize: 18, color: "#c9a84c" }}>👤</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F0EDE8", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {profile?.full_name || "Agent"}
            </div>
            <div style={{ fontSize: 10, color: "#8A8680", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.email}
            </div>
            {profile?.role === "admin" && (
              <span style={{
                display: "inline-block", marginTop: 4, padding: "1px 7px",
                borderRadius: 4, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600,
                background: "rgba(201,168,76,0.15)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.25)",
              }}>Admin</span>
            )}
          </div>
        </div>
      </div>

      {/* Edit profile CTA */}
      <div style={{ padding: "10px 12px 6px" }}>
        <button
          onClick={() => { setShowEditProfile(true); setShowProfile(false); }}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 9,
            border: "1px solid rgba(201,168,76,0.25)",
            background: "rgba(201,168,76,0.07)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 16 }}>✎</span>
          <div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", fontWeight: 600, letterSpacing: "0.03em" }}>Edit Profile & Branding</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Photo · contact info · agency logo</div>
          </div>
        </button>
      </div>

      {/* Voice Profile CTA */}
      <div style={{ padding: "0 12px 6px" }}>
        <button
          onClick={() => {
            setShowProfile(false);
            // Gate behind an active subscription (admins exempt). Unsubscribed
            // non-admins are routed to the subscription page instead of the modal.
            if (!isAdmin && !isSubscribed(profile)) { setExtraView("Subscriptions"); return; }
            setShowVoiceProfile(true);
          }}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 9,
            border: "1px solid rgba(201,168,76,0.25)",
            background: "rgba(201,168,76,0.07)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 16 }}>🗣</span>
          <div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", fontWeight: 600, letterSpacing: "0.03em" }}>Voice Profile</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>The voice your AI content is written in</div>
          </div>
        </button>
      </div>

      {/* Subscriptions */}
      <div style={{ padding: "0 12px 6px" }}>
        <button
          onClick={() => { setExtraView("Subscriptions"); setShowProfile(false); }}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 9,
            border: "1px solid rgba(201,168,76,0.18)",
            background: "rgba(201,168,76,0.04)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 16 }}>◈</span>
          <div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", fontWeight: 600, letterSpacing: "0.03em" }}>Subscriptions</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Manage plan · billing · invoices</div>
          </div>
        </button>
      </div>

      {/* Instagram (Connected Accounts) */}
      <div style={{ padding: "0 12px 6px" }}>
        <button
          onClick={() => {
            setShowProfile(false);
            // Gate behind an active subscription (admins exempt), mirroring
            // Voice Profile — unsubscribed non-admins go to the plan page.
            if (!isAdmin && !isSubscribed(profile)) { setExtraView("Subscriptions"); return; }
            setExtraView("Instagram");
          }}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 9,
            border: "1px solid rgba(201,168,76,0.18)",
            background: "rgba(201,168,76,0.04)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: 16 }}>🔗</span>
          <div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", fontWeight: 600, letterSpacing: "0.03em" }}>Connected Accounts</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Instagram · Facebook — connect to post</div>
          </div>
        </button>
      </div>

      {/* Sign out */}
      <div style={{ padding: "6px 12px 12px" }}>
        <button onClick={signOut} style={{
          width: "100%", padding: "10px 14px", borderRadius: 9, border: "none",
          background: "rgba(239,68,68,0.08)", color: "#f87171",
          fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer",
          fontWeight: 500, letterSpacing: "0.04em", textAlign: "center",
        }}>Sign Out</button>
      </div>
    </div>
  );

  // ===================== DESKTOP LAYOUT =====================
  // ===================== DESKTOP LAYOUT — Back Office Dashboard =====================
  if (isDesktop) {
    return (
      <div style={{ minHeight: "100vh", background: "#080c16", fontFamily: "'Jost', sans-serif" }}>
        {/* Background texture */}
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
          background: "radial-gradient(ellipse at 20% 20%, rgba(201,168,76,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(10,22,40,0.8) 0%, transparent 60%)",
        }} />

        {/* ── TOP NAVIGATION BAR ── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 20,
          background: "rgba(8,12,22,0.95)", backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            maxWidth: 1200, margin: "0 auto",
            padding: "0 40px", height: 64,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, cursor: "pointer" }} onClick={() => setTab(0)}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>
                Milestone{" "}
              </span>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c", letterSpacing: "0.02em" }}>
                Media
              </span>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>
                {" "}& Photography
              </span>
            </div>

            {/* Nav links */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {navItems.map((n, i) => (
                <button key={n.label} onClick={() => setTab(i)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 16px", position: "relative",
                  fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 400,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: tab === i ? "#c9a84c" : "rgba(255,255,255,0.6)",
                  transition: "color 0.2s",
                }}>
                  {n.label}
                  {tab === i && (
                    <span style={{
                      position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                      width: 24, height: 2, background: "#c9a84c", borderRadius: 1,
                    }} />
                  )}
                </button>
              ))}

              {/* Divider */}
              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 8px" }} />

              {/* Profile / avatar */}
              <div style={{ position: "relative" }}>
                <div onClick={() => setShowProfile(!showProfile)} style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 8px",
                  borderRadius: 8, transition: "background 0.2s",
                }}>
                  <img src={profile?.avatar_url || "/icons/icon-192.png"} alt="" style={{
                    width: 32, height: 32, borderRadius: "50%", objectFit: "cover",
                    border: "1px solid rgba(201,168,76,0.3)",
                  }} />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 12, color: "#F0EDE8", fontWeight: 500, lineHeight: 1.2 }}>
                      {profile?.full_name?.split(" ")[0] || "Agent"}
                    </div>
                    <div style={{ fontSize: 9, color: "#8A8680", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {profile?.role === "admin" ? "Admin" : "Agent"}
                    </div>
                  </div>
                </div>
                {ProfileDropdown}
              </div>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT AREA ── */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Page header section */}
          <div style={{
            maxWidth: 1200, margin: "0 auto", padding: "40px 40px 0",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{
                fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#c9a84c",
                letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 8,
              }}>
                {isAdmin && navItems[tab]?.label === "Admin" ? "Admin Portal" : "Agent Portal"}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: "#fff", lineHeight: 1.1 }}>
                {navItems[tab].label}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {profile?.role === "admin" && (
                <span style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em",
                  textTransform: "uppercase", fontWeight: 600,
                  background: "rgba(201,168,76,0.15)", color: "#c9a84c",
                  border: "1px solid rgba(201,168,76,0.3)",
                }}>Admin</span>
              )}
              <div style={{ fontSize: 13, color: "#8A8680" }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </div>
            </div>
          </div>

          {/* Divider — gold accent line like website sections */}
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 40px" }}>
            <div style={{ height: 1, background: "rgba(201,168,76,0.15)", marginTop: 24 }} />
          </div>

          {/* Content */}
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 40px 80px" }}>
            {activeView}
          </div>
        </div>
      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
      {showVoiceProfile && <VoiceProfileModal onClose={() => setShowVoiceProfile(false)} />}
    </div>
    );
  }

  // ===================== MOBILE LAYOUT =====================
  return (
    <div style={{
      minHeight: "100vh", background: "#080c16",
      fontFamily: "'Jost', sans-serif",
    }}>
      {/* Subtle background texture */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse at 20% 20%, rgba(201,168,76,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(10,22,40,0.8) 0%, transparent 60%)",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "0 0 100px" }}>
        {/* Header */}
        <div style={{
          padding: "28px 24px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", letterSpacing: "0.04em", lineHeight: 1 }}>
              Milestone
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 2 }}>
              Media & Photography
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <img
              src={profile?.avatar_url || "/icons/icon-192.png"}
              alt="Profile"
              onClick={() => setShowProfile(!showProfile)}
              style={{
                width: 36, height: 36, borderRadius: "50%", objectFit: "cover",
                border: "1px solid rgba(201,168,76,0.3)", cursor: "pointer",
              }}
            />
            {ProfileDropdown}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "28px 24px" }}>
          {activeView}
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 10,
        background: "rgba(8,12,22,0.95)", backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", maxWidth: 480, margin: "0 auto",
      }}>
        {navItems.map((n, i) => (
          <button key={n.label} onClick={() => setTab(i)} style={{
            flex: 1, background: "none", border: "none", padding: "14px 8px 18px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            cursor: "pointer",
          }}>
            <span style={{ fontSize: 18, color: tab === i ? "#c9a84c" : "rgba(255,255,255,0.25)", transition: "color 0.2s" }}>{n.icon}</span>
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: tab === i ? "#c9a84c" : "rgba(255,255,255,0.25)", transition: "color 0.2s" }}>{n.label}</span>
            {tab === i && <span style={{ width: 20, height: 2, background: "#c9a84c", borderRadius: 2, position: "absolute", bottom: 8 }} />}
          </button>
        ))}
      </div>
      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
      {showVoiceProfile && <VoiceProfileModal onClose={() => setShowVoiceProfile(false)} />}
    </div>
  );
}

// ============================================================
// ROOT APP — Auth provider wrapper
// ============================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Jost:wght@300;400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    setTimeout(() => setMounted(true), 100);
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data);
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  if (!mounted) return null;

  // Check for public microsite route (/p/slug)
  if (window.location.pathname.startsWith("/p/")) {
    return <PublicMicrosite />;
  }

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#080c16", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16,
      }}>
        <img src="/icons/icon-192.png" alt="" style={{ width: 56, height: 56, borderRadius: "50%", opacity: 0.8 }} />
        <div style={{
          fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c",
          animation: "pulse 1.5s ease-in-out infinite",
        }}>Loading...</div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, signOut, fetchProfile }}>
      <div style={{ opacity: mounted ? 1 : 0, transition: "opacity 0.4s ease" }}>
        {user ? <AppShell /> : <AuthView />}
      </div>
    </AuthContext.Provider>
  );
}
