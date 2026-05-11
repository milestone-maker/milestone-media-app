import { useState, useEffect, useRef, createContext, useContext } from "react";
import { supabase } from "./supabaseClient";
import AdminView from "./views/Admin";
import BookingsManagerView from "./views/Bookings";
import ShowcaseView from "./views/Showcase";
import BookView from "./views/Book";
import MediaView from "./views/Media";
import MicrositeView from "./views/Microsite";

const NAV = ["Showcase", "Book", "My Media", "Analytics"];

// LISTINGS and RELA_PHOTOS removed — all listing data now fetched from Supabase

export const PACKAGES = [
  {
    name: "Essential",
    price: "Pricing depends on square footage",
    color: "#8fa3b1",
    features: ["Professional Photography", "3D Virtual Tour with Floor Plan"],
    desc: "Crystal-clear stills that stop the scroll.",
  },
  {
    name: "Signature",
    price: "$549",
    color: "#c9a84c",
    features: ["Everything in Essential +", "Drone Photos & Video", "Social Media Reels"],
    desc: "The complete digital listing presence.",
    popular: true,
  },
  {
    name: "Luxury",
    price: "$1,095",
    color: "#e5c97e",
    features: ["Everything +", "Cinematic Film", "Custom Domain Microsite", "Twilight Photos"],
    desc: "The full cinematic experience.",
  },
];

// ============================================================
// PRICING DATA — pulled from Rela HQ
// ============================================================
export const SQFT_TIERS = [
  { label: "Under 1,500 sf", value: "under_1500" },
  { label: "1,501 – 2,500 sf", value: "1501_2500" },
  { label: "2,501 – 3,500 sf", value: "2501_3500" },
  { label: "3,501 – 4,500 sf", value: "3501_4500" },
  { label: "Over 4,501 sf", value: "over_4501" },
];

export const ESSENTIAL_PRICING = {
  under_1500: 185, "1501_2500": 205, "2501_3500": 225, "3501_4500": 250, over_4501: 275,
};

export const INDIVIDUAL_SERVICES = {
  photography: {
    name: "Still Photography",
    desc: "Premium HDR Listing Photos (Interior & Exterior): 30+ professionally edited images.",
    icon: "📷",
    priceByTier: { under_1500: 110, "1501_2500": 130, "2501_3500": 150, "3501_4500": 175, over_4501: 200 },
  },
  matterport: {
    name: "Matterport 3D Tour",
    desc: "Immersive, self-guided 3D walkthrough. Dollhouse view, floor plans & room navigation included.",
    icon: "🔮",
    priceByTier: { under_1500: 200, "1501_2500": 250, "2501_3500": 300, "3501_4500": 350, over_4501: 400 },
  },
  zillow3d: {
    name: "Zillow 3D Walkthrough & Floor Plan",
    desc: "Panoramic 3D tour integrated with high-resolution downloadable floor plans.",
    icon: "📐",
    fixedPrice: 100,
  },
  aerialVideo: {
    name: "Aerial Video",
    desc: "Captivating aerial video (up to 2 min) of the home's exterior and surrounding area.",
    icon: "🚁",
    fixedPrice: 200,
  },
  aerialPhotos: {
    name: "Aerial Photos",
    desc: "5-10 aerial photos showcasing the home's exterior, yard, and neighborhood.",
    icon: "🛩️",
    fixedPrice: 125,
  },
  socialVideo: {
    name: "Social Media Listing Video",
    desc: "Dynamic 30-second mobile-friendly reel optimized for social media.",
    icon: "🎬",
    fixedPrice: 125,
  },
  cinematicFilm: {
    name: "Cinematic Film",
    desc: "Full cinematic property film with professional editing and music.",
    icon: "🎥",
    fixedPrice: 400,
  },
};

export const ADDONS = [
  { id: "microsite", name: "Custom Property Microsite", price: 150, icon: "🌐", desc: "Custom-designed property website showcasing your listing." },
  { id: "amenities", name: "Amenities Photography", price: 20, unit: "/location", icon: "🏊", desc: "Professional photos of on-site amenities (pools, clubhouses, etc.).", hasQty: true, maxQty: 5 },
  { id: "staging1", name: "Virtual Staging — 1 Room", price: 25, icon: "🛋️", desc: "Lifelike virtual furniture for 1 room." },
  { id: "staging2", name: "Virtual Staging — 2 Rooms", price: 50, icon: "🛋️", desc: "Lifelike virtual furniture for 2 rooms." },
  { id: "staging3", name: "Virtual Staging — 3 Rooms", price: 75, icon: "🛋️", desc: "Lifelike virtual furniture for 3 rooms." },
];

export const MEDIA_ICONS = {
  Photos: "📷", Drone: "🚁", "3D Tour": "🔮", Film: "🎬",
  "Floor Plan": "📐", Microsite: "🌐", Twilight: "🌅",
};

// ============================================================
// AUTH CONTEXT
// ============================================================
const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

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

export function StatusBadge({ status }) {
  const colors = {
    Live: { bg: "rgba(74,222,128,0.15)", color: "#4ade80", dot: "#4ade80" },
    "In Production": { bg: "rgba(201,168,76,0.15)", color: "#c9a84c", dot: "#c9a84c" },
  };
  const s = colors[status] || colors.Live;
  return (
    <span style={{
      background: s.bg, color: s.color, padding: "3px 10px",
      borderRadius: 20, fontSize: 11, fontFamily: "'Jost', sans-serif",
      letterSpacing: "0.08em", fontWeight: 500, display: "inline-flex",
      alignItems: "center", gap: 5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {status}
    </span>
  );
}

export function PackageBadge({ pkg }) {
  return (
    <span style={{
      border: "1px solid rgba(201,168,76,0.4)", color: "#c9a84c",
      padding: "2px 8px", borderRadius: 4, fontSize: 10,
      fontFamily: "'Jost', sans-serif", letterSpacing: "0.12em",
      fontWeight: 600, textTransform: "uppercase",
    }}>{pkg}</span>
  );
}

export const THEMES = [
  // ── Luxury ──
  { name: "Prestige",  label: "Milestone Signature", slug: "prestige",  bg: "#0f0f1a", accent: "#C9A84C", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#0f0f1a","#C9A84C","#F5ECD7"] },
  { name: "Dusk",      label: "Dramatic & Rich",     slug: "dusk",      bg: "#1A1525", accent: "#9B8EC4", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#1A1525","#9B8EC4","#E8C97A","#F0E6D3"] },
  { name: "Noir",      label: "Bold Contrast",       slug: "noir",      bg: "#0A0A0A", accent: "#C41E3A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#0A0A0A","#fff","#C41E3A","#888"] },
  { name: "Obsidian",  label: "Deep & Minimal",      slug: "obsidian",  bg: "#050508", accent: "#6EC6C6", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#050508","#6EC6C6","#3A3A5C","#E8E8E8"] },
  // ── Modern ──
  { name: "Slate",     label: "Modern Professional", slug: "slate",     bg: "#2C3E50", accent: "#5D8AA8", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F2F4F6","#2C3E50","#5D8AA8","#95A5A6"] },
  { name: "Loft",      label: "Urban Edge",          slug: "loft",      bg: "#1A1A1A", accent: "#C8B400", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F0EFED","#1A1A1A","#C8B400","#8C8C8C"] },
  { name: "Ember",     label: "Warm & Bold",         slug: "ember",     bg: "#3D2B1F", accent: "#D4956A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#FAF7F2","#3D2B1F","#8B3A2A","#D4956A"] },
  { name: "Maison",    label: "French Modern",       slug: "maison",    bg: "#2C2416", accent: "#D4A853", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#FAF7F4","#2C2416","#D4A853"] },
  // ── Classic ──
  { name: "Classic",   label: "Timeless Elegance",   slug: "classic",   bg: "#1B2A4A", accent: "#C9A84C", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#fff","#1B2A4A","#C9A84C","#F5F5F0"] },
  { name: "Ivory",     label: "Soft Luxury",         slug: "ivory",     bg: "#FAF8F5", accent: "#C9A84C", text: "#1A1A1A", sub: "rgba(0,0,0,0.5)",        card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#FAF8F5","#1A1A1A","#C9A84C","#E8E0D0"] },
  { name: "Blanc",     label: "Clean & Minimal",     slug: "blanc",     bg: "#fff",    accent: "#D4AF37", text: "#111",    sub: "rgba(0,0,0,0.5)",        card: "rgba(0,0,0,0.03)",       border: "rgba(0,0,0,0.1)",        swatches: ["#fff","#111","#D4AF37"] },
  // ── Natural ──
  { name: "Coastal",   label: "Light & Airy",        slug: "coastal",   bg: "#F8F5F0", accent: "#2A4A5E", text: "#2A4A5E", sub: "rgba(0,0,0,0.45)",       card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#F8F5F0","#2A4A5E","#B5C4C1","#8B6F47"] },
  { name: "Grove",     label: "Natural Warmth",      slug: "grove",     bg: "#F5F0E8", accent: "#2D4A2D", text: "#2D4A2D", sub: "rgba(0,0,0,0.45)",       card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#F5F0E8","#2D4A2D","#8B7355","#C8B89A"] },
  { name: "Sage",      label: "Organic & Fresh",     slug: "sage",      bg: "#2D3D30", accent: "#5B7B6A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F4F6F4","#2D3D30","#5B7B6A","#A8B8A8"] },
];

function AnalyticsView() {
  const [analyticsListings, setAnalyticsListings] = useState([]);
  useEffect(() => {
    const fetchListings = async () => {
      const { data: rows } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
      if (rows) setAnalyticsListings(rows);
    };
    fetchListings();
  }, []);
  const total = { views: 5164, leads: 40, shares: 210 };
  const bars = [
    { label: "Mon", v: 320 }, { label: "Tue", v: 540 }, { label: "Wed", v: 410 },
    { label: "Thu", v: 780 }, { label: "Fri", v: 920 }, { label: "Sat", v: 680 }, { label: "Sun", v: 514 },
  ];
  const max = Math.max(...bars.map(b => b.v));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>Analytics</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>All listings · Last 30 days</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          { label: "Total Views", value: total.views.toLocaleString(), change: "+18%" },
          { label: "Leads", value: total.leads, change: "+32%" },
          { label: "Shares", value: total.shares, change: "+9%" },
        ].map(k => (
          <div key={k.label} style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 18,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", fontWeight: 700, marginBottom: 4 }}>{k.value}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#4ade80" }}>{k.change} this month</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.7)", marginBottom: 20 }}>Views This Week</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}>
          {bars.map(b => (
            <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: "100%", height: `${(b.v / max) * 100}px`,
                background: b.v === max
                  ? "linear-gradient(to top, #c9a84c, #e5c97e)"
                  : "rgba(201,168,76,0.25)",
                borderRadius: "4px 4px 0 0", transition: "height 0.5s ease",
              }} />
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per listing */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.7)" }}>By Listing</div>
        {analyticsListings.map((l, i) => (
          <div key={l.id} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
            borderBottom: i < analyticsListings.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
          }}>
            <img src={l.hero_img || ""} alt="" style={{ width: 44, height: 36, borderRadius: 6, objectFit: "cover" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff" }}>{l.address}</div>
              <StatusBadge status={l.status || "In Production"} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c" }}>{(l.views || 0).toLocaleString()}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>views</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Layout variant assigned to each theme
const THEME_LAYOUT = {
  Prestige: "cinematic", Dusk: "cinematic", Obsidian: "cinematic", Ember: "cinematic",
  Noir: "split", Loft: "split", Slate: "split",
  Blanc: "minimal", Ivory: "minimal", Classic: "minimal", Maison: "minimal",
  Coastal: "editorial", Grove: "editorial", Sage: "editorial",
};

// ============================================================
// PUBLIC MICROSITE PAGE (no authentication required)
// ============================================================
function PublicMicrosite() {
  const [microsite, setMicrosite] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);
  const [floorplanUrl, setFloorplanUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("photos");
  const [prestigeMediaTab, setPrestigeMediaTab] = useState(null);
  const [agentBranding, setAgentBranding] = useState(null);

  const photoRef = useRef(null);
  const floorplanRef = useRef(null);
  const droneRef = useRef(null);
  const tourRef = useRef(null);
  const detailsRef = useRef(null);
  const contactRef = useRef(null);
  const mediaRef = useRef(null);

  const slug = window.location.pathname.replace("/p/", "").split("/")[0];
  // pubT is resolved below after microsite loads — declare a mutable ref here
  // so navLinkStyle can reference it (will be set in render path below)

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
        const pd = msData.property_data || {};

        // Use gallery photos saved at publish time (storage .list() requires auth)
        if (pd.gallery_photos && pd.gallery_photos.length > 0) {
          setPhotos(pd.gallery_photos);
        }
        if (pd.video_url) setVideoUrl(pd.video_url);
        if (pd.floorplan_url) setFloorplanUrl(pd.floorplan_url);

        // Fetch agent branding (logo, agency name, profile photo)
        if (msData.agent_id) {
          const { data: ab } = await supabase
            .from("agents")
            .select("full_name, agency_name, agency_logo_url, profile_photo_url")
            .eq("id", msData.agent_id)
            .single();
          if (ab) setAgentBranding(ab);
        }

        setLoading(false);
      } catch (err) {
        setError("Error loading microsite");
        setLoading(false);
      }
    };

    fetchMicrosite();
  }, [slug]);

  // Build sections list for nav
  const data = microsite?.property_data || {};
  const hasFloorplan = !!(floorplanUrl || data.floorplan_url);
  const hasVideo = !!(videoUrl || data.video_url);
  const hasTour = !!data.matterport_url;
  // ── Agent branding helper ───────────────────────────────────────────────
  // Returns the correct brand mark for nav/footer based on agent's profile:
  //   logo image → agency name text → Milestone Media fallback
  const brandMark = (accentColor = "#C9A84C", subColor = "rgba(255,255,255,0.35)") => {
    if (agentBranding?.agency_logo_url) {
      return (
        <img
          src={agentBranding.agency_logo_url}
          alt="Agency Logo"
          style={{ height: 34, maxWidth: 160, objectFit: "contain" }}
        />
      );
    }
    if (agentBranding?.agency_name) {
      return (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, fontWeight: 700, color: accentColor, letterSpacing: "0.08em" }}>
          {agentBranding.agency_name}
        </div>
      );
    }
    return (
      <>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, fontWeight: 700, color: accentColor, letterSpacing: "0.08em" }}>MILESTONE MEDIA</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: subColor, letterSpacing: "0.06em" }}>& Photography</div>
      </>
    );
  };

  // ── Agent avatar helper ─────────────────────────────────────────────────
  // Returns a profile photo <img> or initial-based fallback circle
  const agentAvatar = (size, accentColor, textColor) => {
    const name = agentBranding?.full_name || "Agent";
    const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    if (agentBranding?.profile_photo_url) {
      return (
        <img
          src={agentBranding.profile_photo_url}
          alt={name}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      );
    }
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: textColor,
      }}>
        {initials}
      </div>
    );
  };

  const isPrestige = microsite?.theme === "Prestige";

  const sections = isPrestige ? [
    { id: "photos",  label: "Gallery", ref: photoRef,   show: true },
    { id: "media",   label: "Media",   ref: mediaRef,   show: hasVideo || hasTour || hasFloorplan },
    { id: "details", label: "Details", ref: detailsRef, show: true },
    { id: "contact", label: "Contact", ref: contactRef, show: true },
  ].filter(s => s.show) : [
    { id: "photos",   label: "Photos",   ref: photoRef,    show: true },
    { id: "floorplan",label: "Floorplan",ref: floorplanRef, show: hasFloorplan },
    { id: "drone",    label: "Drone",    ref: droneRef,    show: hasVideo },
    { id: "tour",     label: "3D Tour",  ref: tourRef,     show: hasTour },
    { id: "details",  label: "Details",  ref: detailsRef,  show: true },
    { id: "contact",  label: "Contact",  ref: contactRef,  show: true },
  ].filter(s => s.show);

  useEffect(() => {
    const handleScroll = () => {
      for (let section of sections) {
        if (section.ref.current) {
          const rect = section.ref.current.getBoundingClientRect();
          if (rect.top < 300) setActiveSection(section.id);
        }
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections]);

  const scrollToSection = (sectionId) => {
    const section = sections.find(s => s.id === sectionId);
    if (section && section.ref.current) {
      section.ref.current.scrollIntoView({ behavior: "smooth" });
      setMobileNavOpen(false);
    }
  };

  // pubT is resolved after microsite loads in the render path below
  const resolvedTheme = THEMES.find(th => th.name === microsite?.theme) || THEMES[0];
  const navLinkStyle = (sectionId) => ({
    fontFamily: "'Jost', sans-serif",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: activeSection === sectionId ? resolvedTheme.accent : "#888",
    cursor: "pointer",
    transition: "color 0.3s",
    paddingBottom: 6,
    borderBottom: activeSection === sectionId ? `2px solid ${resolvedTheme.accent}` : "2px solid transparent",
  });

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
        minHeight: "100vh", background: "#0f0f1a", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 20,
      }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 80, color: "#C9A84C", fontWeight: 700 }}>404</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff", textAlign: "center" }}>
          Microsite not found
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
          This property microsite is no longer available.
        </div>
      </div>
    );
  }

  const agentName = data.agent_name || "";
  const agentPhone = data.agent_phone || "";
  const finalVideo = videoUrl || data.video_url;
  const finalFloorplan = floorplanUrl || data.floorplan_url;
  const galleryPhotos = photos.length > 0 ? photos : (data.hero_img ? [data.hero_img] : []);

  // Resolve theme colors based on the saved theme name
  const pubT = THEMES.find(th => th.name === microsite?.theme) || THEMES[0];
  const isDarkTheme = pubT.text === "#fff";
  const navBg = isDarkTheme
    ? `rgba(${parseInt(pubT.bg.slice(1,3),16)},${parseInt(pubT.bg.slice(3,5),16)},${parseInt(pubT.bg.slice(5,7),16)},0.96)`
    : "rgba(255,255,255,0.97)";
  const navText = isDarkTheme ? "#fff" : pubT.text;
  const photoSecBg = isDarkTheme ? "#0f0f1a" : "#fafafa";
  const photoSecText = isDarkTheme ? "#fff" : "#0f0f1a";
  const darkSecBg = isDarkTheme ? pubT.bg : "#f0ede6";
  const stickyNavBg = isDarkTheme ? (pubT.bg === "#0f0f1a" ? "#181826" : pubT.bg) : "#f5f2ed";
  const layout = THEME_LAYOUT[microsite?.theme] || "cinematic";
  const footerBg = isDarkTheme ? pubT.bg : "#0f0f1a";

  // ─────────────────────────────────────────────────────────────────
  // PRESTIGE LAYOUT — fixed hero background, prosperity-style design
  // ─────────────────────────────────────────────────────────────────
  if (isPrestige) {
    const mediaTabs = [
      ...(hasVideo     ? [{ id: "film",      label: "Cinematic Film" }] : []),
      ...(hasTour      ? [{ id: "tour",      label: "Virtual Tour"   }] : []),
      ...(hasFloorplan ? [{ id: "floorplan", label: "Floor Plan"     }] : []),
    ];
    const activeTab = prestigeMediaTab || (mediaTabs[0]?.id ?? null);
    const finalVideo   = videoUrl || data.video_url;
    const finalFloor   = floorplanUrl || data.floorplan_url;
    const presGallery  = photos.length > 0 ? photos : (data.hero_img ? [data.hero_img] : []);
    const pNavStyle = (id) => ({
      fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.08em",
      textTransform: "uppercase", whiteSpace: "nowrap", cursor: "pointer",
      paddingBottom: 10, paddingTop: 10, transition: "color 0.2s",
      color: activeSection === id ? "#C9A84C" : "rgba(255,255,255,0.5)",
      borderBottom: activeSection === id ? "2px solid #C9A84C" : "2px solid transparent",
    });

    return (
      <div style={{ fontFamily: "'Cormorant Garamond', serif", minHeight: "100vh" }}>
        {/* Fixed hero background — agent's selected hero image */}
        <div style={{
          position: "fixed", inset: 0, zIndex: -1,
          backgroundImage: `url(${data.hero_img || presGallery[0] || ""})`,
          backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat",
        }} />

        {/* Animation CSS — Prestige only. Duration scales with photo count for consistent px/sec speed */}
        <style>{`
          @keyframes msGalleryLeft  { from { transform: translateX(0);    } to { transform: translateX(-50%); } }
          @keyframes msGalleryRight { from { transform: translateX(-50%); } to { transform: translateX(0);    } }
          .ms-gallery-track-fwd { animation: msGalleryLeft  ${Math.max(presGallery.length * 22, 120)}s linear infinite; }
          .ms-gallery-track-rev { animation: msGalleryRight ${Math.max(presGallery.length * 18, 100)}s linear infinite; }
          .ms-gallery-outer:hover .ms-gallery-track-fwd,
          .ms-gallery-outer:hover .ms-gallery-track-rev { animation-play-state: paused; }
        `}</style>

        {/* Top nav */}
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
          background: "rgba(15,15,26,0.92)", backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(201,168,76,0.2)",
          padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {brandMark("#C9A84C", "rgba(255,255,255,0.35)")}
          </div>
          <div style={{ display: "flex", gap: 32 }}>
            {sections.map(s => (
              <div key={s.id} onClick={() => { s.ref?.current?.scrollIntoView({ behavior: "smooth" }); setActiveSection(s.id); }} style={pNavStyle(s.id)}>
                {s.label}
              </div>
            ))}
          </div>
        </div>

        {/* Hero — address left, stats right, over semi-transparent gradient */}
        <div style={{ position: "relative", height: "90vh", marginTop: 60 }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(15,15,26,0.95) 0%, rgba(15,15,26,0.75) 28%, rgba(15,15,26,0.0) 52%)",
          }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", padding: "0 48px 52px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#C9A84C", marginBottom: 12 }}>
                {data.city || "Dallas, TX"}
              </div>
              <div style={{ fontSize: 60, fontWeight: 700, color: "#fff", lineHeight: 1.05, marginBottom: 14, maxWidth: 680 }}>
                {data.address || "Luxury Property"}
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 42, fontWeight: 400, color: "#C9A84C" }}>
                {data.price || ""}
              </div>
            </div>
            {(data.beds || data.baths || data.sqft) && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 20, paddingBottom: 4 }}>
                {[["Beds", data.beds], ["Baths", data.baths], ["Sq Ft", data.sqft]].filter(([, v]) => v).map(([label, val]) => (
                  <div key={label} style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 34, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{val}</div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky section nav */}
        <div style={{
          position: "sticky", top: 60, zIndex: 100,
          background: "rgba(15,15,26,0.88)", backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(201,168,76,0.15)",
          padding: "0 48px", display: "flex", gap: 40, overflowX: "auto",
        }}>
          {sections.map(s => (
            <div key={s.id} onClick={() => { s.ref?.current?.scrollIntoView({ behavior: "smooth" }); setActiveSection(s.id); }} style={pNavStyle(s.id)}>
              {s.label}
            </div>
          ))}
        </div>

        {/* Media Showcase — tabbed (Cinematic Film / Virtual Tour / Floor Plan) */}
        {mediaTabs.length > 0 && (
          <div ref={mediaRef} style={{ background: "rgba(15,15,26,0.72)", backdropFilter: "blur(4px)", padding: "72px 48px 80px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C9A84C", marginBottom: 8 }}>Media Showcase</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
                <h2 style={{ fontSize: 40, margin: 0, color: "#fff", fontWeight: 600 }}>Property Media</h2>
                <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
              </div>
              {mediaTabs.length > 1 && (
                <div style={{ display: "flex", marginBottom: 32, border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
                  {mediaTabs.map((tab, i) => (
                    <div key={tab.id} onClick={() => setPrestigeMediaTab(tab.id)} style={{
                      padding: "10px 28px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                      background: activeTab === tab.id ? "#C9A84C" : "transparent",
                      color: activeTab === tab.id ? "#0f0f1a" : "rgba(255,255,255,0.55)",
                      fontWeight: activeTab === tab.id ? 700 : 400,
                      borderRight: i < mediaTabs.length - 1 ? "1px solid rgba(201,168,76,0.25)" : "none",
                      transition: "all 0.2s",
                    }}>{tab.label}</div>
                  ))}
                </div>
              )}
              {activeTab === "film" && finalVideo && (
                /youtube\.com|youtu\.be|vimeo\.com/.test(finalVideo) ? (
                  <iframe src={finalVideo.replace("watch?v=","embed/").replace("youtu.be/","youtube.com/embed/").replace("vimeo.com/","player.vimeo.com/video/")}
                    title="Cinematic Film" style={{ width: "100%", height: 560, borderRadius: 8, border: "none" }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                ) : (
                  <video controls poster={data.hero_img} style={{ width: "100%", borderRadius: 8, maxHeight: 560, display: "block" }}>
                    <source src={finalVideo} type="video/mp4" />
                  </video>
                )
              )}
              {activeTab === "tour" && data.matterport_url && (
                <iframe src={data.matterport_url} title="3D Tour" style={{ width: "100%", height: 560, borderRadius: 8, border: "none" }} />
              )}
              {activeTab === "floorplan" && finalFloor && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <img src={finalFloor} alt="Floorplan" style={{ maxWidth: 900, width: "100%", borderRadius: 8 }} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Photo Gallery — solid dark background, dual-row auto-scroll */}
        <div ref={photoRef} style={{ background: "#0f0f1a", padding: "80px 0", borderTop: "1px solid rgba(201,168,76,0.12)" }}>
          <div style={{ padding: "0 48px 40px", maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C9A84C", marginBottom: 8 }}>Photography</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#fff", fontWeight: 600 }}>Photo Gallery</h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
          </div>
          <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none", marginBottom: 4 }}>
            <div className="ms-gallery-track-fwd" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
              {[...presGallery, ...presGallery].map((photo, idx) => (
                <div key={idx} onClick={() => { setLightboxIndex(idx % presGallery.length); setLightboxOpen(true); }}
                  style={{ height: 380, flexShrink: 0, overflow: "hidden" }}>
                  <img src={photo} alt="" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
                </div>
              ))}
            </div>
          </div>
          <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none" }}>
            <div className="ms-gallery-track-rev" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
              {[...presGallery, ...presGallery].map((photo, idx) => (
                <div key={idx} onClick={() => { setLightboxIndex(idx % presGallery.length); setLightboxOpen(true); }}
                  style={{ height: 280, flexShrink: 0, overflow: "hidden" }}>
                  <img src={photo} alt="" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: "20px 48px 0", display: "flex", justifyContent: "flex-end", maxWidth: 1200, margin: "0 auto" }}>
            <button onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }} style={{
              background: "transparent", border: "1px solid rgba(201,168,76,0.4)", color: "#C9A84C",
              padding: "8px 20px", borderRadius: 6, fontFamily: "'Jost', sans-serif",
              fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
            }}>View All {presGallery.length} Photos ↗</button>
          </div>
        </div>

        {/* Property Details — semi-transparent */}
        <div ref={detailsRef} style={{ background: "rgba(15,15,26,0.88)", backdropFilter: "blur(4px)", padding: "80px 40px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C9A84C", marginBottom: 8 }}>Property Info</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#fff", fontWeight: 600 }}>Property Details</h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginBottom: 60 }}>
              {[{ val: data.beds, label: "Bedrooms" }, { val: data.baths, label: "Bathrooms" }, { val: data.sqft, label: "Sq. Ft." }, { val: data.price, label: "Price" }].map(s => (
                <div key={s.label} style={{ background: "rgba(255,255,255,0.06)", padding: 32, borderRadius: 8, textAlign: "center", border: "1px solid rgba(201,168,76,0.15)" }}>
                  <div style={{ fontSize: s.label === "Price" ? 34 : 48, fontWeight: 700, color: "#C9A84C", marginBottom: 8 }}>{s.val || "—"}</div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em" }}>{s.label}</div>
                </div>
              ))}
            </div>
            {data.description && (
              <div style={{ background: "rgba(255,255,255,0.04)", padding: 32, borderRadius: 8, marginBottom: 40, borderLeft: "4px solid #C9A84C" }}>
                <p style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, lineHeight: 1.8, color: "rgba(255,255,255,0.75)", margin: 0 }}>{data.description}</p>
              </div>
            )}
            {data.features && data.features.filter(f => f).length > 0 && (
              <div>
                <h3 style={{ fontSize: 24, color: "#fff", marginBottom: 24, fontWeight: 600 }}>Key Features</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
                  {data.features.filter(f => f).map((feature, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ color: "#C9A84C", fontSize: 18, flexShrink: 0 }}>•</div>
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{feature}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contact — semi-transparent */}
        <div ref={contactRef} style={{ background: "rgba(15,15,26,0.88)", backdropFilter: "blur(4px)", padding: "80px 40px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C9A84C", marginBottom: 8 }}>Schedule a Visit</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#fff", fontWeight: 600 }}>Request a Showing</h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
            {agentName && (
              <div style={{ background: "rgba(255,255,255,0.05)", padding: 32, borderRadius: 8, border: "1px solid rgba(201,168,76,0.15)", display: "flex", alignItems: "center", gap: 20, marginBottom: 40 }}>
                {agentAvatar(80, "#C9A84C", "#0f0f1a")}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 24, color: "#fff", marginBottom: 4, fontWeight: 600 }}>{agentName}</div>
                  {agentPhone && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.5)" }}>{agentPhone}</div>}
                </div>
                {agentPhone && (
                  <a href={`tel:${agentPhone}`} style={{ background: "#C9A84C", color: "#0f0f1a", border: "none", padding: "12px 28px", borderRadius: 6, fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", textDecoration: "none" }}>Call</a>
                )}
              </div>
            )}
            <PublicLeadCaptureForm
              theme={{ bg: "rgba(255,255,255,0.04)", text: "#fff", sub: "rgba(255,255,255,0.5)", accent: "#C9A84C", border: "rgba(255,255,255,0.12)", card: "rgba(255,255,255,0.05)" }}
              micrositeId={microsite.id}
              listingId={microsite.property_data?.listing_id || microsite.listing_id}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: "#0f0f1a", borderTop: "1px solid #C9A84C", padding: "40px 48px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {brandMark("#C9A84C", "rgba(255,255,255,0.35)")}
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
            © {new Date().getFullYear()} {agentBranding?.agency_name || "Milestone Media"}. All rights reserved.
          </div>
        </div>

        {/* Lightbox */}
        {lightboxOpen && (
          <div onClick={() => setLightboxOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={() => setLightboxOpen(false)} style={{ position: "absolute", top: 20, right: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer" }}>✕</button>
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => (p - 1 + presGallery.length) % presGallery.length); }} style={{ position: "absolute", left: 30, background: "none", border: "none", color: "#fff", fontSize: 48, cursor: "pointer" }}>‹</button>
            <img src={presGallery[lightboxIndex]} alt="" style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => (p + 1) % presGallery.length); }} style={{ position: "absolute", right: 30, background: "none", border: "none", color: "#fff", fontSize: 48, cursor: "pointer" }}>›</button>
            <div style={{ position: "absolute", bottom: 30, color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14 }}>{lightboxIndex + 1} / {presGallery.length}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Cormorant Garamond', serif", overflow: "hidden" }}>
      {/* Fixed Top Nav Bar */}
      <div style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        zIndex: 1000,
        background: navBg,
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${pubT.accent}33`,
        padding: "16px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {brandMark(pubT.accent, isDarkTheme ? "#888" : "#666")}
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {sections.map(section => (
            <div key={section.id} onClick={() => scrollToSection(section.id)} style={navLinkStyle(section.id)}>
              {section.label}
            </div>
          ))}
        </div>
      </div>

      {/* Hero Section */}
      {layout === "split" ? (
        /* SPLIT: image left 55%, text panel right 45% */
        <div style={{ display: "grid", gridTemplateColumns: "55fr 45fr", minHeight: "85vh", marginTop: 60 }}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <img src={data.hero_img || galleryPhotos[0] || ""} alt="Property"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{
            background: pubT.bg, display: "flex", flexDirection: "column",
            justifyContent: "center", padding: "60px 48px", gap: 24,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: pubT.accent }}>
              Property Listing
            </div>
            <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: pubT.text }}>
              {data.address || "Luxury Property"}
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, color: pubT.sub }}>
              {data.city || ""}
            </div>
            <div style={{ fontSize: 38, fontWeight: 700, color: pubT.accent }}>
              {data.price || ""}
            </div>
            <div style={{ display: "flex", gap: 24, borderTop: `1px solid ${pubT.border}`, paddingTop: 24 }}>
              {[["Beds", data.beds], ["Baths", data.baths], ["Sq Ft", data.sqft]].filter(([,v]) => v).map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: pubT.text }}>{val}</div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: pubT.sub, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
                </div>
              ))}
            </div>
            <button onClick={() => scrollToSection("contact")} style={{
              alignSelf: "flex-start", background: pubT.accent, border: "none", padding: "14px 32px",
              fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#0a1628", cursor: "pointer", borderRadius: 4,
            }}>Schedule Showing</button>
          </div>
        </div>
      ) : layout === "minimal" ? (
        /* MINIMAL: full-bleed with centered text overlay, light feel */
        <div style={{ position: "relative", height: "80vh", marginTop: 60, overflow: "hidden" }}>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt="Property"
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: isDarkTheme ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.35)" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, padding: "0 40px" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: pubT.accent }}>
              {data.city || ""}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 64, fontWeight: 400, lineHeight: 1.05, color: "#fff", textShadow: "0 2px 20px rgba(0,0,0,0.5)", maxWidth: 800 }}>
              {data.address || "Luxury Property"}
            </div>
            <div style={{ width: 60, height: 1, background: pubT.accent }} />
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: pubT.accent, fontWeight: 400 }}>
              {data.price || ""}
            </div>
            <button onClick={() => scrollToSection("photos")} style={{
              marginTop: 8, background: "transparent", border: `1px solid rgba(255,255,255,0.6)`,
              color: "#fff", padding: "12px 32px", fontFamily: "'Jost', sans-serif", fontSize: 11,
              letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer", backdropFilter: "blur(4px)",
            }}>View Gallery ↓</button>
          </div>
        </div>
      ) : layout === "editorial" ? (
        /* EDITORIAL: full-bleed with bottom-split text, zoom animation, nature tones */
        <div style={{ position: "relative", height: "90vh", marginTop: 60, overflow: "hidden" }}>
          <style>{`@keyframes heroZoom { from { transform: scale(1); } to { transform: scale(1.06); } }`}</style>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt="Property"
            style={{ width: "100%", height: "100%", objectFit: "cover", animation: "heroZoom 12s ease-out forwards" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "40px 48px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: pubT.accent, marginBottom: 10 }}>
                Featured Property
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 52, fontWeight: 700, color: "#fff", lineHeight: 1.1, marginBottom: 8 }}>
                {data.address || "Luxury Property"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                {data.city || ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 44, fontWeight: 700, color: pubT.accent }}>
                {data.price || ""}
              </div>
              <div style={{ display: "flex", gap: 20, marginTop: 8, justifyContent: "flex-end" }}>
                {[["Beds", data.beds], ["Baths", data.baths], ["Sq Ft", data.sqft]].filter(([,v]) => v).map(([label, val]) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 700 }}>{val}</div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CINEMATIC (default): full-bleed 90vh, bottom-left, large serif */
        <div style={{ position: "relative", height: "90vh", marginTop: 60, background: "#000", overflow: "hidden" }}>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt="Property"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 55%)" }} />
          <div style={{ position: "absolute", bottom: 48, left: 48 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: pubT.accent, marginBottom: 12 }}>
              {data.city || ""}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 64, fontWeight: 700, color: "#fff", lineHeight: 1.05, marginBottom: 12, maxWidth: 700 }}>
              {data.address || "Luxury Property"}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 44, fontWeight: 400, color: pubT.accent }}>
              {data.price || ""}
            </div>
          </div>
        </div>
      )}

      {/* Sticky Section Nav */}
      <div style={{
        position: "sticky",
        top: 60,
        zIndex: 100,
        background: stickyNavBg,
        borderBottom: `1px solid ${pubT.accent}33`,
        padding: "0 40px",
        display: "flex",
        gap: 40,
        overflowX: "auto",
      }}>
        {sections.map(section => (
          <div key={section.id} onClick={() => scrollToSection(section.id)} style={navLinkStyle(section.id)}>
            {section.label}
          </div>
        ))}
      </div>

      {/* Stats Bar */}
      {(data.beds || data.baths || data.sqft) && layout !== "split" && layout !== "editorial" && (
        <div style={{
          background: layout === "minimal" ? (isDarkTheme ? pubT.bg : "#fff") : pubT.bg,
          borderBottom: `1px solid ${pubT.border}`,
          padding: layout === "minimal" ? "28px 40px" : "24px 48px",
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: layout === "minimal" ? 48 : 40, justifyContent: layout === "minimal" ? "center" : "flex-start" }}>
            {[["Bedrooms", data.beds], ["Bathrooms", data.baths], ["Square Feet", data.sqft], ["Price", data.price]].filter(([,v]) => v).map(([label, val]) => (
              <div key={label} style={{ textAlign: layout === "minimal" ? "center" : "left" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: layout === "minimal" ? 32 : 28, fontWeight: 700, color: pubT.accent }}>{val}</div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: pubT.sub, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo Gallery Section */}
      <div ref={photoRef} style={{ background: photoSecBg, padding: "80px 0" }}>
        <div style={{ padding: "0 40px 40px", maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
            Photography
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: photoSecText, fontWeight: 600 }}>Photo Gallery</h2>
            <div style={{ width: 60, height: 1, background: pubT.accent }} />
          </div>
        </div>
        <div style={{ overflowX: "auto", display: "flex", gap: 4, padding: "0 40px" }}>
          {galleryPhotos.map((photo, idx) => (
            <div key={idx} onClick={() => { setLightboxIndex(idx); setLightboxOpen(true); }}
              style={{ height: 360, flexShrink: 0, overflow: "hidden", borderRadius: 4, cursor: "pointer" }}>
              <img src={photo} alt="" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block" }} />
            </div>
          ))}
        </div>
        <div style={{ padding: "20px 40px 0", display: "flex", justifyContent: "flex-end", maxWidth: 1200, margin: "0 auto" }}>
          <button onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }} style={{
            background: "transparent", border: `1px solid ${pubT.accent}60`,
            color: pubT.accent, padding: "8px 20px", borderRadius: 6,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.1em",
            textTransform: "uppercase", cursor: "pointer",
          }}>View All {galleryPhotos.length} Photos ↗</button>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)",
            zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <button onClick={() => setLightboxOpen(false)} style={{
            position: "absolute", top: 20, right: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer",
          }}>✕</button>
          <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => (prev - 1 + galleryPhotos.length) % galleryPhotos.length); }} style={{
            position: "absolute", left: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer",
          }}>‹</button>
          <img
            src={galleryPhotos[lightboxIndex]}
            alt="Lightbox"
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }}
            onClick={(e) => e.stopPropagation()}
          />
          <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => (prev + 1) % galleryPhotos.length); }} style={{
            position: "absolute", right: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer",
          }}>›</button>
          <div style={{ position: "absolute", bottom: 30, color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14 }}>
            {lightboxIndex + 1} / {galleryPhotos.length}
          </div>
        </div>
      )}

      {/* Floorplan Section */}
      {finalFloorplan && (
        <div ref={floorplanRef} style={{ background: isDarkTheme ? "#181826" : "#f5f2ed", padding: "80px 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
              Floorplan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: isDarkTheme ? "#fff" : pubT.text, fontWeight: 600 }}>Interactive Floorplan</h2>
              <div style={{ width: 60, height: 1, background: pubT.accent }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <img
                src={finalFloorplan}
                alt="Floorplan"
                style={{ maxWidth: 900, width: "100%", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Drone Video Section */}
      {finalVideo && (
        <div ref={droneRef} style={{ background: darkSecBg, padding: "80px 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
              Aerial
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: isDarkTheme ? "#fff" : pubT.text, fontWeight: 600 }}>Drone Video</h2>
              <div style={{ width: 60, height: 1, background: pubT.accent }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              {/youtube\.com|youtu\.be|vimeo\.com/.test(finalVideo) ? (
                <iframe
                  src={finalVideo.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/").replace("vimeo.com/", "player.vimeo.com/video/")}
                  title="Drone Video"
                  style={{ width: "100%", maxWidth: 960, height: 540, borderRadius: 8, border: "none" }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video controls poster={data.hero_img} style={{ maxWidth: 960, width: "100%", borderRadius: 8 }}>
                  <source src={finalVideo} type="video/mp4" />
                </video>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3D Tour Section */}
      {data.matterport_url && (
        <div ref={tourRef} style={{ background: photoSecBg, padding: "80px 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
              Virtual Tour
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: photoSecText, fontWeight: 600 }}>3D Walkthrough</h2>
              <div style={{ width: 60, height: 1, background: pubT.accent }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <iframe
                src={data.matterport_url}
                title="3D Tour"
                style={{ width: "100%", maxWidth: 960, height: 600, borderRadius: 8, border: "none" }}
              />
            </div>
            <p style={{ textAlign: "center", fontFamily: "'Jost', sans-serif", fontSize: 14, color: pubT.sub, marginTop: 20 }}>
              Use your mouse or touch to walk through the home in full 3D
            </p>
          </div>
        </div>
      )}

      {/* Property Details Section */}
      <div ref={detailsRef} style={{ background: darkSecBg, padding: "80px 40px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontFamily: layout === "editorial" ? "'Cormorant Garamond', serif" : "'Jost', sans-serif", fontSize: layout === "editorial" ? 14 : 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8, fontStyle: layout === "editorial" ? "italic" : "normal" }}>
            {layout === "split" ? "— Property Info" : "Property Info"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: isDarkTheme ? "#fff" : pubT.text, fontWeight: 600 }}>Property Details</h2>
            <div style={{ width: 60, height: 1, background: pubT.accent }} />
          </div>

          {/* Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginBottom: 60 }}>
            {[{ val: data.beds, label: "Bedrooms" }, { val: data.baths, label: "Bathrooms" }, { val: data.sqft, label: "Sq. Ft." }, { val: data.price, label: "Price" }].map(s => (
              <div key={s.label} style={{ background: isDarkTheme ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${pubT.accent}22` }}>
                <div style={{ fontSize: s.label === "Price" ? 36 : 48, fontWeight: 700, color: pubT.accent, marginBottom: 8 }}>{s.val || "—"}</div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: isDarkTheme ? "#888" : "#666", letterSpacing: "0.08em" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {data.description && (
            <div style={{ background: isDarkTheme ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", padding: 32, borderRadius: 8, marginBottom: 40, borderLeft: `4px solid ${pubT.accent}` }}>
              <p style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, lineHeight: 1.8, color: isDarkTheme ? "#ddd" : pubT.text, margin: 0 }}>
                {data.description}
              </p>
            </div>
          )}

          {/* Features */}
          {data.features && data.features.filter(f => f).length > 0 && (
            <div>
              <h3 style={{ fontSize: 24, color: isDarkTheme ? "#fff" : pubT.text, marginBottom: 24, fontWeight: 600 }}>Key Features</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
                {data.features.filter(f => f).map((feature, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ color: pubT.accent, fontSize: 18, flexShrink: 0 }}>•</div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: isDarkTheme ? "#ccc" : pubT.text }}>{feature}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Request a Showing Section */}
      <div ref={contactRef} style={{ background: isDarkTheme ? "#181826" : "#faf6ee", padding: "80px 40px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
            Schedule a Visit
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: isDarkTheme ? "#fff" : pubT.text, fontWeight: 600 }}>Request a Showing</h2>
            <div style={{ width: 60, height: 1, background: pubT.accent }} />
          </div>

          {/* Agent Card */}
          {agentName && (
            <div style={{
              background: isDarkTheme ? "rgba(255,255,255,0.05)" : "#fff", padding: 32, borderRadius: 8,
              display: "flex", alignItems: "center", gap: 20, marginBottom: 40,
              boxShadow: isDarkTheme ? "none" : "0 4px 15px rgba(0,0,0,0.08)",
              border: isDarkTheme ? `1px solid ${pubT.accent}22` : "none",
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: "50%",
                background: `linear-gradient(135deg, ${pubT.accent}, ${pubT.accent}bb)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 32, fontWeight: 700, color: "#fff", flexShrink: 0,
              }}>
                {agentName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 24, color: isDarkTheme ? "#fff" : pubT.text, marginBottom: 4, fontWeight: 600 }}>{agentName}</div>
                {agentPhone && (
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: isDarkTheme ? "#aaa" : "#666" }}>{agentPhone}</div>
                )}
              </div>
              {agentPhone && (
                <a href={`tel:${agentPhone}`} style={{
                  background: pubT.accent, color: isDarkTheme ? "#0a1628" : "#fff", border: "none",
                  padding: "12px 28px", borderRadius: 6, fontFamily: "'Jost', sans-serif",
                  fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  cursor: "pointer", textDecoration: "none",
                }}>Call</a>
              )}
            </div>
          )}

          {/* Lead Capture Form */}
          <PublicLeadCaptureForm
            theme={{
              bg: isDarkTheme ? "#0f0f1a" : "#fff",
              text: isDarkTheme ? "#fff" : pubT.text,
              sub: isDarkTheme ? "#aaa" : "#666",
              accent: pubT.accent,
              border: isDarkTheme ? "rgba(255,255,255,0.12)" : "#e0e0e0",
              card: isDarkTheme ? "rgba(255,255,255,0.05)" : "#f5f5f5",
            }}
            micrositeId={microsite.id}
            listingId={microsite.property_data?.listing_id || microsite.listing_id}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: footerBg,
        borderTop: `1px solid ${pubT.accent}`,
        padding: 40,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {brandMark(pubT.accent, isDarkTheme ? "#888" : "#666")}
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#666" }}>
          © {new Date().getFullYear()} {agentBranding?.agency_name || "Milestone Media"}. All rights reserved.
        </div>
      </div>
    </div>
  );
}

function PublicLeadCaptureForm({ theme: t, micrositeId, listingId }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", tourType: "in-person" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: "" })); };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = "Valid email required";
    if (!form.phone.trim()) e.phone = "Required";
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitting(true);

    try {
      const { error } = await supabase
        .from("leads")
        .insert({
          listing_id: listingId,
          microsite_id: micrositeId,
          name: form.name,
          email: form.email,
          phone: form.phone,
          message: form.message,
          tour_type: form.tourType,
        });

      if (!error) {
        setSubmitting(false);
        setSubmitted(true);
      } else {
        setSubmitting(false);
        setErrors({ submit: "Failed to submit. Please try again." });
      }
    } catch (err) {
      setSubmitting(false);
      setErrors({ submit: "An error occurred. Please try again." });
    }
  };

  const fi = (key, placeholder, type = "text") => ({
    value: form[key],
    onChange: e => setField(key, e.target.value),
    placeholder,
    type,
    style: {
      width: "100%", background: `${t.card}`, border: `1px solid ${errors[key] ? "#f87171" : t.border}`,
      borderRadius: 7, padding: "10px 12px", color: t.text,
      fontFamily: "'Jost', sans-serif", fontSize: 12, outline: "none",
      boxSizing: "border-box", colorScheme: t.bg === "#f7f4ef" ? "light" : "dark",
    },
  });

  if (submitted) return (
    <div style={{ padding: "40px 16px", borderTop: `1px solid ${t.border}`, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: t.accent, marginBottom: 8 }}>Thank You!</div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: t.sub, lineHeight: 1.6 }}>
        Your inquiry has been received. The agent will be in touch shortly.
      </div>
    </div>
  );

  return (
    <div style={{ padding: "30px 16px", borderTop: `1px solid ${t.border}` }} data-lead-form-section>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: t.text, marginBottom: 8 }}>
          Request Information
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: t.sub, marginBottom: 20 }}>
          Get in touch with the listing agent today
        </div>

        {/* Tour type toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 18, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
          {[{ val: "in-person", label: "🏠 In-Person" }, { val: "virtual", label: "🎥 Virtual" }, { val: "offer", label: "✍️ Offer" }].map(opt => (
            <div
              key={opt.val}
              onClick={() => setField("tourType", opt.val)}
              style={{
                flex: 1, padding: "10px 8px", textAlign: "center", cursor: "pointer",
                background: form.tourType === opt.val ? `${t.accent}22` : "transparent",
                borderRight: opt === [{ val: "in-person", label: "🏠 In-Person" }, { val: "virtual", label: "🎥 Virtual" }, { val: "offer", label: "✍️ Offer" }][2] ? "none" : `1px solid ${t.border}`,
                fontFamily: "'Jost', sans-serif", fontSize: 11,
                color: form.tourType === opt.val ? t.accent : t.sub,
                fontWeight: form.tourType === opt.val ? 600 : 400,
                transition: "all 0.15s",
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>

        {/* Form fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
          <input {...fi("name", "Your Full Name")} />
          <input {...fi("email", "Your Email", "email")} />
          <input {...fi("phone", "Your Phone Number", "tel")} />
          <textarea
            value={form.message}
            onChange={e => setField("message", e.target.value)}
            placeholder="Message (optional)"
            style={{
              width: "100%", background: `${t.card}`, border: `1px solid ${t.border}`,
              borderRadius: 7, padding: "10px 12px", color: t.text,
              fontFamily: "'Jost', sans-serif", fontSize: 12, outline: "none",
              boxSizing: "border-box", colorScheme: t.bg === "#f7f4ef" ? "light" : "dark",
              minHeight: "100px", resize: "vertical",
            }}
          />
        </div>

        {errors.submit && (
          <div style={{ color: "#f87171", fontFamily: "'Jost', sans-serif", fontSize: 11, marginBottom: 12 }}>
            {errors.submit}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: "100%", background: submitting ? `${t.accent}66` : t.accent, color: t.bg,
            border: "none", padding: "14px", borderRadius: 8,
            fontFamily: "'Jost', sans-serif", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.08em", textTransform: "uppercase", cursor: submitting ? "not-allowed" : "pointer",
            transition: "background 0.3s",
          }}
        >
          {submitting ? "Sending..." : "Send Inquiry"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// EDIT PROFILE & BRANDING MODAL
// ============================================================
function EditProfileModal({ onClose }) {
  const { user, profile, fetchProfile } = useAuth();

  // ── Personal info
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [businessAddress, setBusinessAddress] = useState(profile?.business_address || "");

  // ── Agency branding
  const [agencyName, setAgencyName] = useState(profile?.agency_name || "");
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
          <div style={{ marginBottom: 0 }}>
            <label style={labelSt}>Agency Name <span style={{ color: "rgba(255,255,255,0.2)" }}>— text fallback if no logo</span></label>
            <input
              style={inputSt}
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              placeholder="e.g. Compass Real Estate · Keller Williams DFW"
            />
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
  const [tab, setTab] = useState(0);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleBook = () => setTab(1);
  const isAdmin = profile?.role === "admin";

  const baseNavItems = [
    { label: "Showcase", icon: "✦" },
    { label: "Book", icon: "+" },
    { label: "Media", icon: "⊞" },
    { label: "Analytics", icon: "↗" },
    { label: "Microsite", icon: "🌐" },
  ];
  const navItems = isAdmin
    ? [...baseNavItems, { label: "Bookings", icon: "📋" }, { label: "Admin", icon: "⚙" }]
    : [...baseNavItems, { label: "Bookings", icon: "📋" }];

  const viewMap = {
    Showcase: <ShowcaseView onBook={handleBook} />,
    Book: <BookView />,
    Media: <MediaView />,
    Analytics: <AnalyticsView />,
    Microsite: <MicrositeView />,
    Bookings: <BookingsManagerView />,
    ...(isAdmin && { Admin: <AdminView /> }),
  };
  const activeView = viewMap[navItems[tab]?.label] ?? null;

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
