import { useState, useEffect, useRef, createContext, useContext } from "react";
import { supabase } from "./supabaseClient";

const NAV = ["Showcase", "Book", "My Media", "Analytics"];

// LISTINGS and RELA_PHOTOS removed — all listing data now fetched from Supabase

const PACKAGES = [
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
const SQFT_TIERS = [
  { label: "Under 1,500 sf", value: "under_1500" },
  { label: "1,501 – 2,500 sf", value: "1501_2500" },
  { label: "2,501 – 3,500 sf", value: "2501_3500" },
  { label: "3,501 – 4,500 sf", value: "3501_4500" },
  { label: "Over 4,501 sf", value: "over_4501" },
];

const ESSENTIAL_PRICING = {
  under_1500: 185, "1501_2500": 205, "2501_3500": 225, "3501_4500": 250, over_4501: 275,
};

const INDIVIDUAL_SERVICES = {
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

const ADDONS = [
  { id: "microsite", name: "Custom Property Microsite", price: 150, icon: "🌐", desc: "Custom-designed property website showcasing your listing." },
  { id: "amenities", name: "Amenities Photography", price: 20, unit: "/location", icon: "🏊", desc: "Professional photos of on-site amenities (pools, clubhouses, etc.).", hasQty: true, maxQty: 5 },
  { id: "staging1", name: "Virtual Staging — 1 Room", price: 25, icon: "🛋️", desc: "Lifelike virtual furniture for 1 room." },
  { id: "staging2", name: "Virtual Staging — 2 Rooms", price: 50, icon: "🛋️", desc: "Lifelike virtual furniture for 2 rooms." },
  { id: "staging3", name: "Virtual Staging — 3 Rooms", price: 75, icon: "🛋️", desc: "Lifelike virtual furniture for 3 rooms." },
];

const MEDIA_ICONS = {
  Photos: "📷", Drone: "🚁", "3D Tour": "🔮", Film: "🎬",
  "Floor Plan": "📐", Microsite: "🌐", Twilight: "🌅",
};

// ============================================================
// AUTH CONTEXT
// ============================================================
const AuthContext = createContext(null);

function useAuth() {
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

function StatusBadge({ status }) {
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

function PackageBadge({ pkg }) {
  return (
    <span style={{
      border: "1px solid rgba(201,168,76,0.4)", color: "#c9a84c",
      padding: "2px 8px", borderRadius: 4, fontSize: 10,
      fontFamily: "'Jost', sans-serif", letterSpacing: "0.12em",
      fontWeight: 600, textTransform: "uppercase",
    }}>{pkg}</span>
  );
}

function ShowcaseView({ onBook }) {
  const [active, setActive] = useState(0);
  const [heroPhoto, setHeroPhoto] = useState(0);
  const [listings, setListings] = useState([]);
  const [listingPhotos, setListingPhotos] = useState({});
  const [mediaHover, setMediaHover] = useState(null);
  const [loadingListings, setLoadingListings] = useState(true);

  useEffect(() => {
    const fetchListings = async () => {
      const { data: rows, error } = await supabase
        .from("listings")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && rows && rows.length > 0) {
        setListings(rows);
        // Fetch photos for each listing from listing-media bucket
        const photoMap = {};
        for (const row of rows) {
          const { data: photoFiles } = await supabase.storage
            .from("listing-media")
            .list(`${row.id}/photos`, { sortBy: { column: "name", order: "asc" } });
          if (photoFiles && photoFiles.length > 0) {
            photoMap[row.id] = photoFiles
              .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name))
              .map(f => supabase.storage.from("listing-media").getPublicUrl(`${row.id}/photos/${f.name}`).data.publicUrl);
          }
        }
        setListingPhotos(photoMap);
      }
      setLoadingListings(false);
    };
    fetchListings();
  }, []);

  const listing = listings[active] || {};
  const photos = listingPhotos[listing.id] || (listing.hero_img ? [listing.hero_img] : []);
  const displayMedia = listing.media_types || (listing.package === "Luxury"
    ? ["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Microsite", "Twilight"]
    : listing.package === "Signature"
    ? ["Photos", "Drone", "Reels"]
    : ["Photos"]);

  if (loadingListings) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c" }}>Loading listings...</div>
    </div>
  );

  if (listings.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff" }}>No Listings Yet</div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Create your first listing in the Admin panel.</div>
      <button onClick={onBook} style={{
        background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "14px 28px",
        fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 13,
        letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
      }}>Book Your First Listing →</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Hero Listing */}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", height: 420 }}>
        <img src={photos[heroPhoto] || listing.hero_img || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "opacity 0.3s" }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(8,18,40,0.95) 0%, rgba(8,18,40,0.4) 60%, transparent 100%)",
        }} />
        {/* Top bar */}
        <div style={{ position: "absolute", top: 20, left: 20, right: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <PackageBadge pkg={listing.package} />
          <StatusBadge status={listing.status} />
        </div>
        {/* Photo nav arrows */}
        {photos.length > 1 && (
          <>
            <div onClick={() => setHeroPhoto(p => p > 0 ? p - 1 : photos.length - 1)} style={{
              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
              width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, cursor: "pointer", backdropFilter: "blur(4px)",
            }}>‹</div>
            <div onClick={() => setHeroPhoto(p => p < photos.length - 1 ? p + 1 : 0)} style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, cursor: "pointer", backdropFilter: "blur(4px)",
            }}>›</div>
            {/* Photo counter */}
            <div style={{
              position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.5)", borderRadius: 20, padding: "4px 12px",
              fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.7)",
              backdropFilter: "blur(4px)", letterSpacing: "0.05em",
            }}>{heroPhoto + 1} / {photos.length}</div>
          </>
        )}
        {/* Thumbnail strip — inside hero, above the gradient */}
        {photos.length > 1 && (
          <div style={{
            position: "absolute", bottom: 16, left: 20, right: 20,
            display: "flex", gap: 6, justifyContent: "center",
          }}>
            {photos.slice(0, 6).map((p, i) => (
              <div key={i} onClick={() => setHeroPhoto(i)} style={{
                width: 44, height: 32, borderRadius: 4, overflow: "hidden", cursor: "pointer",
                border: i === heroPhoto ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.25)",
                opacity: i === heroPhoto ? 1 : 0.7, transition: "all 0.2s",
              }}>
                <img src={p} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ))}
            {photos.length > 6 && (
              <div style={{
                width: 44, height: 32, borderRadius: 4, background: "rgba(0,0,0,0.6)",
                border: "2px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.6)",
              }}>+{photos.length - 6}</div>
            )}
          </div>
        )}
      </div>

      {/* Address & details — moved below the hero image */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: "#fff", fontWeight: 600, lineHeight: 1.1, marginBottom: 6 }}>
          {listing.address}
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 16 }}>
          {listing.city}
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", fontWeight: 700 }}>{typeof listing.price === "number" ? `$${listing.price.toLocaleString()}` : listing.price}</span>
          <span style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
            {listing.beds} bd · {listing.baths} ba · {Number(listing.sqft || 0).toLocaleString()} sqft
          </span>
        </div>
      </div>

      {/* Media types */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.5)", marginBottom: 14, letterSpacing: "0.05em" }}>
          Delivered Media
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {displayMedia.map((m) => (
            <div key={m} onMouseEnter={() => setMediaHover(m)} onMouseLeave={() => setMediaHover(null)}
              style={{
                background: mediaHover === m ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${mediaHover === m ? "rgba(201,168,76,0.6)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 10, padding: "10px 16px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
              }}>
              <span style={{ fontSize: 16 }}>{MEDIA_ICONS[m]}</span>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: mediaHover === m ? "#c9a84c" : "rgba(255,255,255,0.7)", letterSpacing: "0.05em" }}>{m}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "Total Views", value: (listing.views || 0).toLocaleString(), icon: "👁" },
          { label: "Shares", value: listing.shares || 0, icon: "↗" },
          { label: "Leads", value: listing.leads || 0, icon: "✉" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "20px 24px",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
              {s.icon} {s.label}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, color: "#c9a84c", fontWeight: 700 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button onClick={onBook} style={{
        background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "16px 32px",
        fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 14,
        letterSpacing: "0.12em", textTransform: "uppercase", color: "#0a1628",
        cursor: "pointer", width: "100%",
      }}>
        Book Your Next Listing →
      </button>
    </div>
  );
}

function BookView() {
  // ── State ──
  const [step, setStep] = useState(1);
  const [bookingMode, setBookingMode] = useState(null); // "package" | "individual"
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Texas");
  const [zip, setZip] = useState("");
  const [sqftTier, setSqftTier] = useState("");
  const [accessMethod, setAccessMethod] = useState("");
  // Package mode
  const [selectedPackage, setSelectedPackage] = useState(null); // 0,1,2
  // Individual service mode
  const [selectedServices, setSelectedServices] = useState({}); // { photography: true, matterport: true, ... }
  // Add-ons
  const [selectedAddons, setSelectedAddons] = useState({}); // { microsite: true, amenities: 2, ... }
  // Scheduling
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [busySlots, setBusySlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Contact info
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // Booking complete
  const [booked, setBooked] = useState(false);
  const [processing, setProcessing] = useState(false);

  const STEPS = ["Address", "Services", "Add-ons", "Schedule", "Review & Pay"];

  // Fetch Google Calendar busy slots when date changes
  useEffect(() => {
    if (!selectedDate) { setBusySlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    fetch(`/api/calendar?date=${selectedDate}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setBusySlots(data.busySlots || []);
      })
      .catch(() => { if (!cancelled) setBusySlots([]); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Check if a time slot overlaps with any busy period
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

  // ── Total calc ──
  const calcTotal = () => {
    let total = 0;
    if (bookingMode === "package") {
      if (selectedPackage === 0 && sqftTier) total += ESSENTIAL_PRICING[sqftTier] || 0;
      else if (selectedPackage === 1) total += 549;
      else if (selectedPackage === 2) total += 1095;
    } else if (bookingMode === "individual") {
      Object.keys(selectedServices).forEach(key => {
        if (selectedServices[key]) {
          const svc = INDIVIDUAL_SERVICES[key];
          const p = getServicePrice(svc);
          if (p) total += p;
        }
      });
    }
    // Add-ons
    ADDONS.forEach(a => {
      const val = selectedAddons[a.id];
      if (val) {
        if (a.hasQty) total += a.price * (typeof val === "number" ? val : 1);
        else if (val === true) total += a.price;
      }
    });
    return total;
  };

  const canProceed = () => {
    if (step === 1) return address.trim() && city.trim() && zip.trim() && sqftTier;
    if (step === 2) {
      if (bookingMode === "package") return selectedPackage !== null;
      if (bookingMode === "individual") return Object.values(selectedServices).some(v => v);
      return false;
    }
    if (step === 3) return true; // add-ons optional
    if (step === 4) return selectedDate && selectedTime;
    if (step === 5) return clientName.trim() && clientEmail.trim() && clientEmail.includes("@");
    return true;
  };

  const handleBook = async () => {
    setProcessing(true);
    try {
      const selSvcs = bookingMode === "individual"
        ? Object.keys(selectedServices).filter(k => selectedServices[k])
        : [];
      const selAddons = [];
      ADDONS.forEach(a => {
        if (selectedAddons[a.id]) selAddons.push({ id: a.id, qty: typeof selectedAddons[a.id] === "number" ? selectedAddons[a.id] : 1 });
      });
      const bookingData = {
        source: "app",
        agent_id: user?.id,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone || null,
        address, city, state: st, zip,
        sqft_tier: sqftTier,
        access_method: accessMethod || "lockbox",
        booking_mode: bookingMode,
        selected_package: bookingMode === "package" ? ["essential","signature","luxury"][selectedPackage] : null,
        selected_services: selSvcs,
        selected_addons: selAddons,
        booking_date: selectedDate,
        booking_time: selectedTime,
        subtotal: calcTotal(),
      };
      const { data: inserted, error } = await supabase.from("bookings").insert(bookingData).select("id").single();
      if (error) { console.error("Booking insert error:", error); throw new Error("Booking insert failed: " + error.message); }

      // Create Google Calendar event
      try {
        const calBody = { ...bookingData, booking_id: inserted?.id };
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(calBody),
        });
      } catch (calErr) {
        console.error("Calendar sync error (non-blocking):", calErr);
      }

      // Send booking confirmation emails (owner + client)
      try {
        const pkgName = bookingMode === "package" ? PACKAGES[selectedPackage]?.name : null;
        const svcList = bookingMode === "individual"
          ? Object.keys(selectedServices).filter(k => selectedServices[k]).map(k => {
              const svc = SERVICES.find(s => s.id === k);
              return svc ? { name: svc.name, price: svc.tiers?.[sqftTier] || svc.price || 0 } : null;
            }).filter(Boolean)
          : (bookingMode === "package" && PACKAGES[selectedPackage]
              ? PACKAGES[selectedPackage].features.map(f => ({ name: f, price: 0 }))
              : []);
        const addonList = [];
        ADDONS.forEach(a => {
          if (selectedAddons[a.id]) addonList.push({ name: a.name, price: a.price * (typeof selectedAddons[a.id] === "number" ? selectedAddons[a.id] : 1) });
        });
        const emailPayload = {
          booking: {
            clientName, clientEmail, clientPhone,
            agentEmail: user?.email,
            agentName: user?.user_metadata?.name || user?.email,
            address: `${address}, ${city}, ${st} ${zip}`,
            sqftTier, accessMethod,
            date: selectedDate, time: selectedTime,
            packageName: pkgName,
            services: svcList, addons: addonList,
            total: calcTotal(),
          },
        };
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailPayload),
        });
      } catch (emailErr) {
        console.error("Email send error (non-blocking):", emailErr);
      }

      // Create & send Stripe invoice (non-blocking)
      try {
        const pkgName2 = bookingMode === "package" ? PACKAGES[selectedPackage]?.name : null;
        const svcList2 = bookingMode === "individual"
          ? Object.keys(selectedServices).filter(k => selectedServices[k]).map(k => {
              const svc = Object.values(INDIVIDUAL_SERVICES).find(s => s.name && Object.keys(INDIVIDUAL_SERVICES).find(key => key === k));
              const svcData = INDIVIDUAL_SERVICES[k];
              return svcData ? { name: svcData.name, price: svcData.priceByTier?.[sqftTier] || svcData.fixedPrice || 0 } : null;
            }).filter(Boolean)
          : [];
        const addonList2 = [];
        ADDONS.forEach(a => {
          if (selectedAddons[a.id]) addonList2.push({ name: a.name, price: a.price * (typeof selectedAddons[a.id] === "number" ? selectedAddons[a.id] : 1) });
        });
        await fetch("/api/create-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking: {
              clientName, clientEmail, clientPhone,
              address: `${address}, ${city}, ${st} ${zip}`,
              sqftTier, accessMethod,
              date: selectedDate, time: selectedTime,
              packageName: pkgName2,
              services: svcList2, addons: addonList2,
              total: calcTotal(),
            },
          }),
        });
      } catch (invoiceErr) {
        console.error("Stripe invoice error (non-blocking):", invoiceErr);
      }
    } catch (err) {
      console.error("Booking error:", err);
    }
    setProcessing(false);
    setBooked(true);
  };

  const resetBooking = () => {
    setStep(1); setBookingMode(null); setAddress(""); setCity(""); setState("Texas");
    setZip(""); setSqftTier(""); setAccessMethod(""); setSelectedPackage(null);
    setSelectedServices({}); setSelectedAddons({}); setSelectedDate(""); setSelectedTime("");
    setClientName(""); setClientEmail(""); setClientPhone("");
    setBooked(false); setProcessing(false);
  };

  // ── Time slots (placeholder until Google Calendar integration) ──
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
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", marginBottom: 32 }}>
          Total: ${calcTotal().toLocaleString()}
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 32 }}>
          We'll reach out within 24 hours to finalize details.
        </div>
        <button onClick={resetBooking} style={{
          background: "transparent", border: "1px solid rgba(201,168,76,0.5)",
          color: "#c9a84c", padding: "12px 28px", borderRadius: 8,
          fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.1em",
          textTransform: "uppercase", cursor: "pointer",
        }}>Book Another Listing</button>
      </div>
    );
  }

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
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", fontWeight: 700 }}>
            ${calcTotal().toLocaleString()}
          </div>
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
                const priceDisplay = isEssential
                  ? (sqftTier ? `$${ESSENTIAL_PRICING[sqftTier]}` : "Select sqft")
                  : p.price;
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
                      </div>
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>{p.desc}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {p.features.map(f => (
                          <span key={f} style={{
                            fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.6)",
                            background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: 4,
                          }}>✓ {f}</span>
                        ))}
                      </div>
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
                  </span>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", fontWeight: 600 }}>
                    ${selectedPackage === 0 ? (ESSENTIAL_PRICING[sqftTier] || 0) : selectedPackage === 1 ? 549 : 1095}
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
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", fontWeight: 700 }}>${calcTotal().toLocaleString()}</span>
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
          {/* Payment stub */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: 16,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Payment</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              Payment processing will be available soon. Your booking will be confirmed and invoiced separately.
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ NAV BUTTONS ═══════════ */}
      <div style={{ display: "flex", gap: 12 }}>
        {step > 1 && (
          <button onClick={() => setStep(s => s - 1)} style={{
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

function MediaView() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [active, setActive] = useState(0);
  const [listings, setListings] = useState([]);
  const [showRelaSite, setShowRelaSite] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadType, setUploadType] = useState("Photos");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [mediaFiles, setMediaFiles] = useState({});
  const [viewingType, setViewingType] = useState(null);
  const [toast, setToast] = useState(null);

  // Fetch listings from Supabase
  useEffect(() => {
    const fetchListings = async () => {
      const { data: rows, error } = await supabase
        .from("listings")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && rows) setListings(rows);
    };
    fetchListings();
  }, []);

  const listing = listings[active] || {};

  // Fetch uploaded media for current listing
  useEffect(() => {
    if (listing.id) fetchMedia();
  }, [active, listing.id]);

  const fetchMedia = async () => {
    if (!listing.id) return;
    const types = ["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Twilight"];
    const result = {};
    for (const type of types) {
      const folder = `${listing.id}/${type.toLowerCase().replace(/\s+/g, "-")}`;
      const { data } = await supabase.storage.from("listing-media").list(folder, { limit: 100 });
      if (data && data.length > 0) {
        result[type] = data.filter(f => f.name !== ".emptyFolderPlaceholder").map(f => ({
          name: f.name,
          url: supabase.storage.from("listing-media").getPublicUrl(`${folder}/${f.name}`).data.publicUrl,
          size: f.metadata?.size || 0,
          created: f.created_at,
        }));
      }
    }
    setMediaFiles(result);
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !listing.id) return;
    setUploading(true);
    const folder = `${listing.id}/${uploadType.toLowerCase().replace(/\s+/g, "-")}`;
    let uploaded = 0;
    for (const file of files) {
      setUploadProgress(`Uploading ${uploaded + 1} of ${files.length}...`);
      const filePath = `${folder}/${file.name}`;
      const { error } = await supabase.storage.from("listing-media").upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) {
        showToast(`Failed: ${file.name} - ${error.message}`, "error");
      }
      uploaded++;
    }
    setUploading(false);
    setUploadProgress("");
    setShowUpload(false);
    showToast(`${uploaded} file(s) uploaded successfully!`);
    fetchMedia();
  };

  const handleDelete = async (type, fileName) => {
    if (!listing.id) return;
    const folder = `${listing.id}/${type.toLowerCase().replace(/\s+/g, "-")}`;
    const { error } = await supabase.storage.from("listing-media").remove([`${folder}/${fileName}`]);
    if (error) showToast(`Delete failed: ${error.message}`, "error");
    else {
      showToast("File deleted");
      fetchMedia();
    }
  };

  const totalFiles = Object.values(mediaFiles).reduce((sum, arr) => sum + arr.length, 0);

  // Toast notification
  const ToastEl = toast && (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 999,
      background: toast.type === "error" ? "rgba(239,68,68,0.95)" : "rgba(74,222,128,0.95)",
      color: "#fff", padding: "10px 20px", borderRadius: 10, fontSize: 13,
      fontFamily: "'Jost', sans-serif", fontWeight: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    }}>{toast.msg}</div>
  );

  // Viewing files of a specific type (gallery view)
  if (viewingType && mediaFiles[viewingType]) {
    const files = mediaFiles[viewingType];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {ToastEl}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setViewingType(null)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0,
          }}>← Back</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", flex: 1 }}>
            {viewingType} — {listing.address}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif" }}>
          {files.length} file{files.length !== 1 ? "s" : ""}
        </div>

        {/* Photo grid */}
        {(viewingType === "Photos" || viewingType === "Drone" || viewingType === "Twilight") ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {files.map((f, i) => (
              <div key={f.name} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "4/3" }}>
                <img src={f.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)", opacity: 0, transition: "opacity 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = 1}
                  onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                  <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex", gap: 6 }}>
                    <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{
                      flex: 1, textAlign: "center", background: "rgba(201,168,76,0.9)", color: "#080c16",
                      borderRadius: 6, padding: "6px 0", fontSize: 10, fontWeight: 600, textDecoration: "none",
                      fontFamily: "'Jost', sans-serif", letterSpacing: "0.06em",
                    }}>Download</a>
                    {isAdmin && (
                      <button onClick={() => handleDelete(viewingType, f.name)} style={{
                        background: "rgba(239,68,68,0.8)", color: "#fff", border: "none",
                        borderRadius: 6, padding: "6px 10px", fontSize: 10, cursor: "pointer",
                      }}>✕</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* File list for non-image types */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {files.map(f => (
              <div key={f.name} style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 24 }}>{MEDIA_ICONS[viewingType] || "📁"}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{f.size ? (f.size / 1024 / 1024).toFixed(1) + " MB" : ""}</div>
                </div>
                <a href={f.url} download={f.name} target="_blank" rel="noreferrer" style={{
                  background: "rgba(201,168,76,0.15)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.3)",
                  borderRadius: 6, padding: "6px 14px", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  fontFamily: "'Jost', sans-serif", letterSpacing: "0.06em",
                }}>Download</a>
                {isAdmin && (
                  <button onClick={() => handleDelete(viewingType, f.name)} style={{
                    background: "none", border: "none", color: "rgba(239,68,68,0.6)", cursor: "pointer", fontSize: 16,
                  }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Download all button */}
        <button onClick={() => {
          files.forEach(f => { const a = document.createElement("a"); a.href = f.url; a.download = f.name; a.target = "_blank"; document.body.appendChild(a); a.click(); document.body.removeChild(a); });
        }} style={{
          width: "100%", padding: "14px", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg, #c9a84c, #e5c97e)", color: "#080c16",
          fontFamily: "'Jost', sans-serif", fontSize: 13, fontWeight: 600,
          letterSpacing: "0.06em", cursor: "pointer",
        }}>Download All {viewingType}</button>
      </div>
    );
  }

  // Rela site embed view
  if (showRelaSite && listing.relaSite) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {ToastEl}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowRelaSite(false)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0,
          }}>← Back to Media</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", flex: 1 }}>{listing.address}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={listing.status} />
          <PackageBadge pkg={listing.package} />
        </div>
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.25)", background: "#000" }}>
          <iframe src={listing.relaSite} title={`${listing.address}`} style={{ width: "100%", height: 600, border: "none", borderRadius: 14 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" allowFullScreen />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => window.open(listing.relaSite, "_blank")} style={{
            flex: 1, background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)", border: "none", borderRadius: 8, padding: "14px",
            fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
          }}>Open Full Site ↗</button>
          <button onClick={() => { navigator.clipboard.writeText(listing.relaSite); showToast("Link copied!"); }} style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "14px",
            fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
          }}>Copy Link</button>
        </div>
      </div>
    );
  }

  // Upload modal
  const UploadModal = showUpload && (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.8)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={() => !uploading && setShowUpload(false)}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#0f1320", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16,
        padding: 28, width: "100%", maxWidth: 400,
      }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 20 }}>
          Upload Media
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          Listing: {listing.address}
        </div>

        {/* Media type selector */}
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'Jost', sans-serif" }}>Media Type</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
          {["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Twilight"].map(t => (
            <button key={t} onClick={() => setUploadType(t)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer",
              fontFamily: "'Jost', sans-serif", fontWeight: 500, letterSpacing: "0.04em",
              border: uploadType === t ? "1px solid #c9a84c" : "1px solid rgba(255,255,255,0.12)",
              background: uploadType === t ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
              color: uploadType === t ? "#c9a84c" : "rgba(255,255,255,0.5)",
            }}>{MEDIA_ICONS[t]} {t}</button>
          ))}
        </div>

        {/* Upload area */}
        {uploading ? (
          <div style={{
            border: "2px dashed rgba(201,168,76,0.3)", borderRadius: 12, padding: 40,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
            <div style={{ color: "#c9a84c", fontSize: 13, fontFamily: "'Jost', sans-serif" }}>{uploadProgress}</div>
          </div>
        ) : (
          <label style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 12, padding: 40,
            cursor: "pointer", transition: "all 0.2s",
          }}>
            <div style={{ fontSize: 36 }}>📁</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "'Jost', sans-serif" }}>
              Tap to select files
            </div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
              JPG, PNG, WebP, MP4, PDF — up to 50MB each
            </div>
            <input type="file" multiple accept="image/*,video/*,.pdf" onChange={handleUpload} style={{ display: "none" }} />
          </label>
        )}

        <button onClick={() => setShowUpload(false)} disabled={uploading} style={{
          width: "100%", marginTop: 16, padding: "12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
          background: "none", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", fontFamily: "'Jost', sans-serif",
        }}>Cancel</button>
      </div>
    </div>
  );

  // Main media view
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {ToastEl}
      {UploadModal}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff" }}>My Media</div>
        {isAdmin && (
          <button onClick={() => setShowUpload(true)} style={{
            background: "linear-gradient(135deg, #c9a84c, #e5c97e)", color: "#080c16", border: "none",
            borderRadius: 8, padding: "8px 16px", fontSize: 11, fontWeight: 700, cursor: "pointer",
            fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>+ Upload</button>
        )}
      </div>

      {/* Listing selector */}
      <div style={{ display: "flex", gap: 10 }}>
        {listings.map((l, i) => (
          <div key={l.id} onClick={() => { setActive(i); setShowRelaSite(false); setViewingType(null); }} style={{
            flex: 1, borderRadius: 10, overflow: "hidden", cursor: "pointer", position: "relative", height: 80,
            border: active === i ? "2px solid #c9a84c" : "2px solid transparent", transition: "all 0.2s",
          }}>
            <img src={l.hero_img || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: active === i ? "rgba(201,168,76,0.15)" : "rgba(8,18,40,0.5)" }} />
            <div style={{ position: "absolute", bottom: 6, left: 8, fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#fff", letterSpacing: "0.06em" }}>
              {(l.address || "").split(" ").slice(0, 2).join(" ")}
            </div>
          </div>
        ))}
      </div>

      {/* Stats bar */}
      {totalFiles > 0 && (
        <div style={{
          background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
          borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            {totalFiles} file{totalFiles !== 1 ? "s" : ""} across {Object.keys(mediaFiles).length} categor{Object.keys(mediaFiles).length !== 1 ? "ies" : "y"}
          </span>
        </div>
      )}

      {/* View Property Site CTA */}
      {listing.relaSite && (
        <div onClick={() => setShowRelaSite(true)} style={{
          background: "linear-gradient(135deg, rgba(201,168,76,0.12) 0%, rgba(201,168,76,0.04) 100%)",
          border: "1px solid rgba(201,168,76,0.3)", borderRadius: 14, padding: "18px 20px",
          display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"}>
          <div style={{ width: 48, height: 48, borderRadius: 10, background: "rgba(201,168,76,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>🏠</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c", marginBottom: 2 }}>View Property Website</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Photos, drone, 3D tour & more — all in one place</div>
          </div>
          <span style={{ color: "#c9a84c", fontSize: 18 }}>→</span>
        </div>
      )}

      {/* Media grid — shows real uploaded files with counts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Twilight"].map((m) => {
          const count = mediaFiles[m]?.length || 0;
          const hasFiles = count > 0;
          const thumb = hasFiles && (m === "Photos" || m === "Drone" || m === "Twilight") ? mediaFiles[m][0].url : null;
          return (
            <div key={m} onClick={() => hasFiles ? setViewingType(m) : isAdmin ? setShowUpload(true) || setUploadType(m) : null} style={{
              background: thumb ? "none" : "rgba(255,255,255,0.03)",
              border: hasFiles ? "1px solid rgba(201,168,76,0.25)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, overflow: "hidden", cursor: hasFiles || isAdmin ? "pointer" : "default",
              position: "relative", minHeight: 120, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s",
            }}
              onMouseEnter={e => { if (hasFiles || isAdmin) e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = hasFiles ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.08)"; }}>
              {thumb && (
                <>
                  <img src={thumb} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(8,12,22,0.9) 0%, rgba(8,12,22,0.3) 100%)" }} />
                </>
              )}
              <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "16px 12px" }}>
                <span style={{ fontSize: 28 }}>{MEDIA_ICONS[m]}</span>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: hasFiles ? "#fff" : "rgba(255,255,255,0.7)", letterSpacing: "0.06em", marginTop: 4 }}>{m}</div>
                {hasFiles ? (
                  <div style={{
                    background: "rgba(201,168,76,0.2)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)",
                    borderRadius: 6, padding: "4px 12px", fontSize: 10, fontFamily: "'Jost', sans-serif",
                    letterSpacing: "0.08em", fontWeight: 600, marginTop: 6,
                  }}>{count} file{count !== 1 ? "s" : ""} — View</div>
                ) : (
                  <div style={{
                    color: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "'Jost', sans-serif", marginTop: 6,
                  }}>{isAdmin ? "Tap to upload" : "No files yet"}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Share microsite */}
      {(listing.package === "Luxury") && (
        <div style={{
          background: "linear-gradient(135deg, rgba(201,168,76,0.1) 0%, rgba(201,168,76,0.03) 100%)",
          border: "1px solid rgba(201,168,76,0.25)", borderRadius: 12, padding: 20,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 4 }}>Property Microsite</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              milestone.media/{listing.address.split(" ")[0].toLowerCase()}
            </div>
          </div>
          <button style={{
            background: "#c9a84c", color: "#0a1628", border: "none", borderRadius: 8,
            padding: "10px 20px", fontFamily: "'Jost', sans-serif", fontSize: 12,
            fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
          }}>Share ↗</button>
        </div>
      )}
    </div>
  );
}

const THEMES = [
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

function MicrositePreview({ data, theme }) {
  const t = theme;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("photos");

  const photos = data.galleryPhotos || (data.heroImg ? [data.heroImg] : []);

  const photoRef = useRef(null);
  const floorplanRef = useRef(null);
  const droneRef = useRef(null);
  const tourRef = useRef(null);
  const detailsRef = useRef(null);
  const contactRef = useRef(null);

  const sections = [
    { id: "photos", label: "Photos", ref: photoRef, show: true },
    { id: "floorplan", label: "Floorplan", ref: floorplanRef, show: !!data.floorplanUrl },
    { id: "drone", label: "Drone", ref: droneRef, show: !!data.videoUrl },
    { id: "tour", label: "3D Tour", ref: tourRef, show: !!data.matterportUrl },
    { id: "details", label: "Details", ref: detailsRef, show: true },
    { id: "contact", label: "Contact", ref: contactRef, show: true },
  ].filter(s => s.show);

  useEffect(() => {
    const handleScroll = () => {
      for (let section of sections) {
        if (section.ref.current) {
          const rect = section.ref.current.getBoundingClientRect();
          if (rect.top < 300) {
            setActiveSection(section.id);
          }
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

  const handleLightboxNext = () => {
    setLightboxIndex((prev) => (prev + 1) % photos.length);
  };

  const handleLightboxPrev = () => {
    setLightboxIndex((prev) => (prev - 1 + photos.length) % photos.length);
  };

  const navLinkStyle = (sectionId) => ({
    fontFamily: "'Jost', sans-serif",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: activeSection === sectionId ? "#C9A84C" : "#888",
    cursor: "pointer",
    transition: "color 0.3s",
    paddingBottom: 6,
    borderBottom: activeSection === sectionId ? "2px solid #C9A84C" : "2px solid transparent",
  });

  return (
    <div style={{ fontFamily: "'Cormorant Garamond', serif", overflow: "hidden" }}>
      {/* Fixed Top Nav Bar */}
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: "rgba(15,15,26,0.95)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(201,168,76,0.2)",
        padding: "16px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#C9A84C", letterSpacing: "0.06em" }}>
            MILESTONE MEDIA
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "#888", letterSpacing: "0.08em" }}>
            Photography & Media
          </div>
        </div>
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          style={{
            display: "none",
            background: "none",
            border: "none",
            color: "#C9A84C",
            fontSize: 24,
            cursor: "pointer",
            "@media (maxWidth: 768px)": { display: "block" },
          }}
        >
          ☰
        </button>
        <div style={{
          display: "flex",
          gap: 28,
          "@media (maxWidth: 768px)": { display: mobileNavOpen ? "flex" : "none", position: "absolute", top: "100%", left: 0, right: 0, flexDirection: "column", background: "rgba(15,15,26,0.98)", padding: "16px 24px", borderBottom: "1px solid rgba(201,168,76,0.2)" },
        }}>
          {sections.map(section => (
            <div
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              style={navLinkStyle(section.id)}
            >
              {section.label}
            </div>
          ))}
        </div>
      </div>

      {/* Hero Section */}
      <div style={{
        position: "relative",
        height: "75vh",
        marginTop: 60,
        background: "#000",
        overflow: "hidden",
      }}>
        <img
          src={data.heroImg || ""}
          alt="Property"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, rgba(15,15,26,0.7) 0%, transparent 60%)",
        }} />
        <div style={{
          position: "absolute",
          bottom: 40,
          left: 40,
          color: "#fff",
        }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, marginBottom: 8 }}>
            {data.address || "Luxury Property"}
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 18, letterSpacing: "0.08em", marginBottom: 16 }}>
            {data.city || "Dallas, TX"}
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#C9A84C" }}>
            {data.price || "$1,250,000"}
          </div>
        </div>
      </div>

      {/* Sticky Section Nav */}
      <div style={{
        position: "sticky",
        top: 60,
        zIndex: 100,
        background: "#181826",
        borderBottom: "1px solid rgba(201,168,76,0.2)",
        padding: "0 40px",
        display: "flex",
        gap: 40,
        overflowX: "auto",
      }}>
        {sections.map(section => (
          <div
            key={section.id}
            onClick={() => scrollToSection(section.id)}
            style={navLinkStyle(section.id)}
          >
            {section.label}
          </div>
        ))}
      </div>

      {/* Photo Gallery Section */}
      <div ref={photoRef} style={{ background: "#fafafa", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 40, padding: "0 40px 40px" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
            Photography
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: "#0f0f1a", fontWeight: 600 }}>Photo Gallery</h2>
            <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
          </div>
        </div>
        <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none" }}>
          <div className="ms-gallery-track" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
            {[...photos, ...photos].map((photo, idx) => (
              <div
                key={idx}
                onClick={() => { setLightboxIndex(idx % photos.length); setLightboxOpen(true); }}
                style={{ height: 420, flexShrink: 0, overflow: "hidden" }}
              >
                <img src={photo} alt={`Gallery ${idx}`} style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "20px 40px 0", display: "flex", justifyContent: "flex-end", maxWidth: 1200, margin: "0 auto" }}>
          <button onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }} style={{
            background: "transparent", border: "1px solid rgba(201,168,76,0.4)",
            color: "#C9A84C", padding: "8px 20px", borderRadius: 6,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.1em",
            textTransform: "uppercase", cursor: "pointer",
          }}>View All {photos.length} Photos ↗</button>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            style={{
              position: "absolute",
              top: 20,
              right: 30,
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 36,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleLightboxPrev();
            }}
            style={{
              position: "absolute",
              left: 30,
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 36,
              cursor: "pointer",
            }}
          >
            ‹
          </button>
          <img
            src={photos[lightboxIndex]}
            alt="Lightbox"
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              objectFit: "contain",
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleLightboxNext();
            }}
            style={{
              position: "absolute",
              right: 30,
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 36,
              cursor: "pointer",
            }}
          >
            ›
          </button>
          <div style={{
            position: "absolute",
            bottom: 30,
            color: "#fff",
            fontFamily: "'Jost', sans-serif",
            fontSize: 14,
          }}>
            {lightboxIndex + 1} / {photos.length}
          </div>
        </div>
      )}

      {/* Floorplan Section */}
      {data.floorplanUrl && (
        <div
          ref={floorplanRef}
          style={{
            background: "#faf6ee",
            padding: "80px 40px",
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
              Floorplan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#0f0f1a", fontWeight: 600 }}>
                Interactive Floorplan
              </h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <img
                src={data.floorplanUrl}
                alt="Floorplan"
                style={{
                  maxWidth: 900,
                  width: "100%",
                  borderRadius: 8,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Drone Video Section */}
      {data.videoUrl && (
        <div
          ref={droneRef}
          style={{
            background: "#0f0f1a",
            padding: "80px 40px",
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
              Aerial
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#fff", fontWeight: 600 }}>
                Drone Video
              </h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <video
                controls
                poster={data.heroImg}
                style={{
                  maxWidth: 960,
                  width: "100%",
                  borderRadius: 8,
                }}
              >
                <source src={data.videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* 3D Tour Section */}
      {data.matterportUrl && (
        <div
          ref={tourRef}
          style={{
            background: "#fafafa",
            padding: "80px 40px",
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
              Virtual Tour
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: "#0f0f1a", fontWeight: 600 }}>
                3D Walkthrough
              </h2>
              <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <iframe
                src={data.matterportUrl}
                title="3D Tour"
                style={{
                  width: "100%",
                  maxWidth: 960,
                  height: 600,
                  borderRadius: 8,
                  border: "none",
                }}
              />
            </div>
            <p style={{
              textAlign: "center",
              fontFamily: "'Jost', sans-serif",
              fontSize: 14,
              color: "#666",
              marginTop: 20,
            }}>
              Use your mouse or touch to walk through the home in full 3D
            </p>
          </div>
        </div>
      )}

      {/* Property Details Section */}
      <div
        ref={detailsRef}
        style={{
          background: "#0f0f1a",
          padding: "80px 40px",
          "@media (maxWidth: 768px)": { padding: "40px 20px" },
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
            Property Info
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: "#fff", fontWeight: 600 }}>
              Property Details
            </h2>
            <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
          </div>

          {/* Stats Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 24,
            marginBottom: 60,
            "@media (maxWidth: 768px)": { gridTemplateColumns: "repeat(2, 1fr)" },
          }}>
            <div style={{ background: "#181826", padding: 32, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: "#C9A84C", marginBottom: 8 }}>
                {data.beds || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" }}>
                Bedrooms
              </div>
            </div>
            <div style={{ background: "#181826", padding: 32, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: "#C9A84C", marginBottom: 8 }}>
                {data.baths || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" }}>
                Bathrooms
              </div>
            </div>
            <div style={{ background: "#181826", padding: 32, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: "#C9A84C", marginBottom: 8 }}>
                {data.sqft || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" }}>
                Sq. Ft.
              </div>
            </div>
            <div style={{ background: "#181826", padding: 32, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: "#C9A84C", marginBottom: 8 }}>
                {data.price || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" }}>
                Price
              </div>
            </div>
          </div>

          {/* Description */}
          {data.description && (
            <div style={{
              background: "#181826",
              padding: 32,
              borderRadius: 8,
              marginBottom: 40,
              borderLeft: "4px solid #C9A84C",
            }}>
              <p style={{
                fontFamily: "'Jost', sans-serif",
                fontSize: 15,
                lineHeight: 1.8,
                color: "#ddd",
                margin: 0,
              }}>
                {data.description}
              </p>
            </div>
          )}

          {/* Features */}
          {data.features && data.features.filter(f => f).length > 0 && (
            <div>
              <h3 style={{ fontSize: 24, color: "#fff", marginBottom: 24, fontWeight: 600 }}>
                Key Features
              </h3>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 16,
                "@media (maxWidth: 768px)": { gridTemplateColumns: "1fr" },
              }}>
                {data.features.filter(f => f).map((feature, idx) => (
                  <div key={idx} style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}>
                    <div style={{ color: "#C9A84C", fontSize: 18, flexShrink: 0 }}>•</div>
                    <div style={{
                      fontFamily: "'Jost', sans-serif",
                      fontSize: 14,
                      color: "#ccc",
                    }}>
                      {feature}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Request a Showing Section */}
      <div
        ref={contactRef}
        style={{
          background: "#faf6ee",
          padding: "80px 40px",
          "@media (maxWidth: 768px)": { padding: "40px 20px" },
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
            Schedule a Visit
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: "#0f0f1a", fontWeight: 600 }}>
              Request a Showing
            </h2>
            <div style={{ width: 60, height: 1, background: "#C9A84C" }} />
          </div>

          {/* Agent Card */}
          <div style={{
            background: "#fff",
            padding: 32,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 40,
            boxShadow: "0 4px 15px rgba(0,0,0,0.08)",
            "@media (maxWidth: 768px)": { flexDirection: "column", textAlign: "center" },
          }}>
            <div style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #C9A84C, #e8c97a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}>
              {(data.agentName || "JD").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, color: "#0f0f1a", marginBottom: 4, fontWeight: 600 }}>
                {data.agentName || "Jane Doe"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#666" }}>
                {data.agentPhone || "(214) 000-0000"}
              </div>
            </div>
            <button style={{
              background: "#C9A84C",
              color: "#0f0f1a",
              border: "none",
              padding: "12px 28px",
              borderRadius: 6,
              fontFamily: "'Jost', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "background 0.3s",
            }}
            onMouseEnter={(e) => (e.target.style.background = "#e8c97a")}
            onMouseLeave={(e) => (e.target.style.background = "#C9A84C")}
            >
              Call
            </button>
          </div>

          {/* Lead Capture Form */}
          <LeadCaptureForm theme={{ bg: "#fff", text: "#0f0f1a", sub: "#666", accent: "#C9A84C", border: "#e0e0e0", card: "#f5f5f5" }} onSubmit={data.onLeadSubmit} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: "#0f0f1a",
        borderTop: "1px solid #C9A84C",
        padding: "40px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        "@media (maxWidth: 768px)": { flexDirection: "column", textAlign: "center", gap: 20 },
      }}>
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 14,
          color: "#C9A84C",
          fontWeight: 700,
          letterSpacing: "0.08em",
        }}>
          MILESTONE MEDIA
        </div>
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 12,
          color: "#666",
        }}>
          © 2026 Milestone Media. All rights reserved.
        </div>
      </div>
    </div>
  );
}

function LeadCaptureForm({ theme: t, onSubmit }) {
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

  const handleSubmit = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
      if (onSubmit) onSubmit({ ...form, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), date: new Date().toLocaleDateString() });
    }, 1200);
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
    <div style={{ padding: "28px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: t.accent, marginBottom: 6 }}>Request Received!</div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: t.sub, lineHeight: 1.6 }}>
        {form.name.split(" ")[0]}, the listing agent will be in touch shortly.
      </div>
    </div>
  );

  return (
    <div style={{ padding: "18px 16px", borderTop: `1px solid ${t.border}` }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: t.text, marginBottom: 3 }}>
          Request a Showing
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: t.sub, letterSpacing: "0.06em" }}>
          We'll get back to you within 2 hours.
        </div>
      </div>

      {/* Tour type toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
        {[{ val: "in-person", label: "🏠 In-Person" }, { val: "virtual", label: "🎥 Virtual" }, { val: "offer", label: "✍️ Make Offer" }].map(opt => (
          <div key={opt.val} onClick={() => setField("tourType", opt.val)} style={{
            flex: 1, padding: "8px 4px", textAlign: "center", cursor: "pointer",
            background: form.tourType === opt.val ? `${t.accent}22` : "transparent",
            borderRight: `1px solid ${t.border}`,
            fontFamily: "'Jost', sans-serif", fontSize: 10,
            color: form.tourType === opt.val ? t.accent : t.sub,
            fontWeight: form.tourType === opt.val ? 600 : 400,
            transition: "all 0.15s",
          }}>{opt.label}</div>
        ))}
      </div>

      {/* Fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <input {...fi("name", "Full Name")} />
            {errors.name && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#f87171", marginTop: 3 }}>{errors.name}</div>}
          </div>
          <div>
            <input {...fi("phone", "Phone", "tel")} />
            {errors.phone && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#f87171", marginTop: 3 }}>{errors.phone}</div>}
          </div>
        </div>
        <div>
          <input {...fi("email", "Email Address", "email")} />
          {errors.email && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#f87171", marginTop: 3 }}>{errors.email}</div>}
        </div>
        <textarea
          value={form.message}
          onChange={e => setField("message", e.target.value)}
          placeholder="Any questions or preferred showing times?"
          style={{ ...fi("message", "").style, height: 70, resize: "none", lineHeight: 1.5 }}
        />
      </div>

      {/* Submit */}
      <button onClick={handleSubmit} disabled={submitting} style={{
        width: "100%", marginTop: 12,
        background: submitting ? `${t.accent}66` : t.accent,
        border: "none", borderRadius: 8, padding: "12px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12,
        letterSpacing: "0.1em", textTransform: "uppercase",
        color: t.bg, cursor: submitting ? "default" : "pointer",
        transition: "all 0.2s",
      }}>
        {submitting ? "Sending..." : form.tourType === "offer" ? "Submit Offer Interest →" : "Request Showing →"}
      </button>

      <div style={{ textAlign: "center", marginTop: 8, fontFamily: "'Jost', sans-serif", fontSize: 9, color: t.sub, letterSpacing: "0.06em" }}>
        🔒 Your info is never shared or sold
      </div>
    </div>
  );
}

function MicrositeView() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const editLoadRef = useRef(false); // skip sourceType reset when loading for edit
  const [step, setStep] = useState("build");
  const [themeIdx, setThemeIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [published, setPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState(null);
  const [myMicrosites, setMyMicrosites] = useState([]);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [toast, setToast] = useState(null);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [notifSettings, setNotifSettings] = useState({
    emailEnabled: true, emailAddr: "info@milestonemediaphoto.com",
    smsEnabled: true, smsPhone: "(214) 744-3801",
    notifyOnNew: true, notifyOnOffer: true, notifyOnVirtual: false,
  });
  const [leads, setLeads] = useState([
    { name: "Marcus Johnson", email: "marcus@email.com", phone: "(214) 555-0182", message: "Interested in viewing this weekend.", tourType: "in-person", time: "9:14 AM", date: "3/21/2026", read: true, status: "scheduled" },
    { name: "Priya Sharma", email: "priya.sharma@gmail.com", phone: "(469) 555-0347", message: "Can we schedule a virtual tour?", tourType: "virtual", time: "2:31 PM", date: "3/22/2026", read: false, status: "contacted" },
    { name: "Derek & Alicia Tran", email: "dtran@outlook.com", phone: "(972) 555-0094", message: "Ready to make an offer. Please contact ASAP.", tourType: "offer", time: "8:03 AM", date: "3/23/2026", read: false, status: "new" },
  ]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [listings, setListings] = useState([]);
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [listingPhotos, setListingPhotos] = useState([]);
  const [listingVideo, setListingVideo] = useState(null);
  const [listingFloorplan, setListingFloorplan] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [addonRequested, setAddonRequested] = useState(false);
  const [addonStatus, setAddonStatus] = useState(null); // null | 'pending' | 'approved' | 'denied'
  // Source toggle: "listing" or "booking" — agents always use bookings
  const [sourceType, setSourceType] = useState(isAdmin ? "listing" : "booking");
  const [bookings, setBookings] = useState([]);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [data, setData] = useState({
    address: "", city: "", price: "",
    beds: "", baths: "", sqft: "",
    description: "", agentName: "", agentPhone: "",
    heroImg: "",
    features: ["", "", "", ""],
    mediaTypes: ["Photos", "Drone", "3D Tour"],
    matterportUrl: "",
    videoUrl: "",
  });

  // Fetch listings from Supabase
  useEffect(() => {
    const fetchListings = async () => {
      const { data: rows, error } = await supabase
        .from("listings")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && rows) setListings(rows);
    };
    fetchListings();
  }, []);

  // Fetch bookings from Supabase (admin sees all, agents see their own)
  useEffect(() => {
    const fetchBookings = async () => {
      let query = supabase.from("bookings").select("*").order("created_at", { ascending: false });
      if (!isAdmin && user?.id) {
        query = query.eq("agent_id", user.id);
      }
      const { data: rows, error } = await query;
      if (!error && rows) setBookings(rows);
    };
    fetchBookings();
  }, [isAdmin, user?.id]);

  // Fetch this user's published microsites
  useEffect(() => {
    if (!user?.id) return;
    const fetchMyMicrosites = async () => {
      setLoadingMicrosites(true);
      const { data: rows } = await supabase
        .from("microsites")
        .select("id, slug, theme, published, property_data, agent_name, agent_phone, created_at")
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false });
      if (rows) setMyMicrosites(rows);
      setLoadingMicrosites(false);
    };
    fetchMyMicrosites();
  }, [user?.id]);

  // Check microsite addon request status when listing changes
  useEffect(() => {
    if (!selectedListingId || !user?.id) { setAddonStatus(null); setAddonRequested(false); return; }
    const checkAddon = async () => {
      const { data: reqs } = await supabase
        .from("microsite_requests")
        .select("status")
        .eq("listing_id", selectedListingId)
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (reqs && reqs.length > 0) {
        setAddonStatus(reqs[0].status);
        setAddonRequested(true);
      } else {
        setAddonStatus(null);
        setAddonRequested(false);
      }
    };
    checkAddon();
  }, [selectedListingId, user?.id]);

  // When a listing is selected, populate form and fetch media
  useEffect(() => {
    if (!selectedListingId) return;
    const listing = listings.find(l => l.id === selectedListingId);
    if (!listing) return;

    // Auto-populate form fields
    setData(d => ({
      ...d,
      address: listing.address || "",
      city: listing.city || "",
      price: listing.price || "",
      beds: listing.beds ? String(listing.beds) : "",
      baths: listing.baths ? String(listing.baths) : "",
      sqft: listing.sqft ? String(listing.sqft) : "",
      matterportUrl: listing.matterport_url || "",
      videoUrl: listing.youtube_url || "",
    }));

    // Fetch media files from storage
    const fetchMedia = async () => {
      setMediaLoading(true);
      try {
        // Fetch photos
        const { data: photoFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/photos`, { limit: 50 });

        const photos = (photoFiles || [])
          .filter(f => f.name !== ".emptyFolderPlaceholder")
          .map(f => {
            const { data: urlData } = supabase.storage
              .from("listing-media")
              .getPublicUrl(`${selectedListingId}/photos/${f.name}`);
            return urlData.publicUrl;
          });
        setListingPhotos(photos);
        if (photos.length > 0) {
          setData(d => ({ ...d, heroImg: photos[0] }));
        }

        // Fetch video
        const { data: videoFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/video`, { limit: 5 });

        const vids = (videoFiles || []).filter(f => f.name !== ".emptyFolderPlaceholder");
        if (vids.length > 0) {
          const { data: vidUrl } = supabase.storage
            .from("listing-media")
            .getPublicUrl(`${selectedListingId}/video/${vids[0].name}`);
          setListingVideo(vidUrl.publicUrl);
        } else {
          setListingVideo(null);
        }

        // Fetch floorplan
        const { data: fpFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/floorplan`, { limit: 5 });

        const fps = (fpFiles || []).filter(f => f.name !== ".emptyFolderPlaceholder");
        if (fps.length > 0) {
          const { data: fpUrl } = supabase.storage
            .from("listing-media")
            .getPublicUrl(`${selectedListingId}/floorplan/${fps[0].name}`);
          setListingFloorplan(fpUrl.publicUrl);
        } else {
          setListingFloorplan(null);
        }
      } catch (err) {
        console.error("Error fetching media:", err);
      }
      setMediaLoading(false);
    };
    fetchMedia();
  }, [selectedListingId, listings]);

  // When a booking is selected, populate form and fetch media from booking-media bucket
  useEffect(() => {
    if (!selectedBookingId) return;
    const booking = bookings.find(b => b.id === selectedBookingId);
    if (!booking) return;

    // Auto-populate form fields from booking data
    setData(d => ({
      ...d,
      address: booking.address || "",
      city: [booking.city, booking.state, booking.zip].filter(Boolean).join(", ") || "",
      agentName: booking.client_name || "",
      matterportUrl: "",
      videoUrl: "",
    }));

    // Fetch media from booking_media table (private bucket, needs signed URLs)
    const fetchBookingMedia = async () => {
      setMediaLoading(true);
      try {
        const { data: mediaRows, error } = await supabase
          .from("booking_media")
          .select("*")
          .eq("booking_id", selectedBookingId)
          .order("created_at", { ascending: false });

        if (error) { console.error("Error fetching booking media:", error); setMediaLoading(false); return; }

        const photos = [];
        let video = null;
        let tourUrl = null;

        if (mediaRows && mediaRows.length > 0) {
          // Generate signed URLs for all files
          for (const item of mediaRows) {
            if (item.file_type === "3d_tour") {
              tourUrl = item.url || item.file_path;
              continue;
            }
            if (!item.file_path) continue;

            const { data: signedData } = await supabase.storage
              .from("booking-media")
              .createSignedUrl(item.file_path, 3600);
            const signedUrl = signedData?.signedUrl;
            if (!signedUrl) continue;

            if (item.file_type === "video") {
              video = signedUrl;
            } else {
              photos.push(signedUrl);
            }
          }
        }

        setListingPhotos(photos);
        setListingVideo(video);
        setListingFloorplan(null); // bookings don't have separate floorplan category
        if (photos.length > 0) {
          setData(d => ({ ...d, heroImg: photos[0] }));
        }
        if (tourUrl) {
          setData(d => ({ ...d, matterportUrl: tourUrl }));
        }
      } catch (err) {
        console.error("Error fetching booking media:", err);
      }
      setMediaLoading(false);
    };
    fetchBookingMedia();
  }, [selectedBookingId, bookings]);

  // Reset state when switching source type
  useEffect(() => {
    setSelectedListingId(null);
    if (editLoadRef.current) { editLoadRef.current = false; return; }
    setSelectedBookingId(null);
    setListingPhotos([]);
    setListingVideo(null);
    setListingFloorplan(null);
    setStep("build");
    setPublished(false);
    setData(d => ({
      ...d,
      address: "", city: "", price: "",
      beds: "", baths: "", sqft: "",
      description: "", agentName: "", agentPhone: "",
      heroImg: "",
      features: ["", "", "", ""],
      matterportUrl: "", videoUrl: "",
    }));
  }, [sourceType]);

  const theme = THEMES[themeIdx];
  const slug = (data.address || "your-listing").split(" ").slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const liveUrl = `https://app.milestonemediaphotography.com/p/${slug}`;

  const setField = (key, val) => setData(d => ({ ...d, [key]: val }));
  const setFeature = (i, val) => setData(d => { const f = [...d.features]; f[i] = val; return { ...d, features: f }; });
  const toggleMedia = (m) => setData(d => ({
    ...d, mediaTypes: d.mediaTypes.includes(m) ? d.mediaTypes.filter(x => x !== m) : [...d.mediaTypes, m],
  }));

  const showToast = (lead) => {
    setToast(lead);
    setTimeout(() => setToast(null), 4500);
  };

  const handleNewLead = (lead) => {
    const newLead = { ...lead, read: false, status: "new" };
    setLeads(l => [newLead, ...l]);
    showToast(newLead);
  };

  const updateLeadStatus = (idx, status) => setLeads(l => l.map((x, i) => i === idx ? { ...x, status } : x));

  // Package tier gating helper — works for both listings and bookings
  const selectedListing = listings.find(l => l.id === selectedListingId);
  const selectedBooking = bookings.find(b => b.id === selectedBookingId);

  // Determine package based on source
  let activePackage = "";
  let micrositeIncluded = false;
  let micrositeAddonApproved = false;
  let micrositeAccessible = false;

  if (sourceType === "listing") {
    activePackage = selectedListing?.package || "";
    micrositeIncluded = activePackage === "Luxury";
    micrositeAddonApproved = selectedListing?.microsite_addon === true;
  } else {
    // Booking source
    const bookingPkg = selectedBooking?.selected_package || "";
    activePackage = bookingPkg.charAt(0).toUpperCase() + bookingPkg.slice(1); // Capitalize for display
    micrositeIncluded = bookingPkg.toLowerCase() === "luxury";
    // Check if microsite addon was purchased with this booking
    const addons = selectedBooking?.selected_addons || [];
    micrositeAddonApproved = Array.isArray(addons) && addons.some(a => a.id === "microsite" || a === "microsite");
  }
  // Invoice paid check — agents must pay before creating a microsite
  const invoicePaid = sourceType === "booking" ? !!selectedBooking?.invoice_paid : true;
  // Admin always has access; agents need package/addon AND paid invoice
  micrositeAccessible = isAdmin || ((micrositeIncluded || micrositeAddonApproved) && invoicePaid);
  const hasSourceSelection = sourceType === "listing" ? !!selectedListingId : !!selectedBookingId;

  const handleRequestAddon = async () => {
    if (!selectedListingId || !user?.id) return;
    const { error } = await supabase.from("microsite_requests").insert({
      listing_id: selectedListingId,
      agent_id: user.id,
      status: "pending",
    });
    if (!error) {
      setAddonRequested(true);
      setAddonStatus("pending");
    }
  };

  const loadMicrositeForEdit = (ms) => {
    const pd = ms.property_data || {};

    // Populate all form fields from saved property_data
    setData({
      address: pd.address || "",
      city: pd.city || "",
      price: pd.price || "",
      beds: pd.beds || "",
      baths: pd.baths || "",
      sqft: pd.sqft || "",
      description: pd.description || "",
      agentName: pd.agent_name || ms.agent_name || "",
      agentPhone: pd.agent_phone || ms.agent_phone || "",
      agentEmail: pd.agent_email || "",
      heroImg: pd.hero_img || "",
      features: pd.features?.length
        ? [...pd.features, ...Array(Math.max(0, 4 - pd.features.length)).fill("")]
        : ["", "", "", ""],
      mediaTypes: pd.media_types || ["Photos"],
      matterportUrl: pd.matterport_url || "",
      videoUrl: pd.video_url || "",
    });

    // Load gallery photos directly from published URLs — avoids re-fetching from
    // the booking media bucket (which would overwrite the saved hero selection)
    if (pd.gallery_photos?.length) {
      setListingPhotos(pd.gallery_photos);
    }
    if (pd.video_url) setListingVideo(pd.video_url);
    if (pd.floorplan_url) setListingFloorplan(pd.floorplan_url);

    // Restore source context — set the ref first so the sourceType reset effect skips
    if (pd.source_type && pd.source_type !== sourceType) {
      editLoadRef.current = true;
      setSourceType(pd.source_type);
    }

    // Restore theme
    const themeIndex = THEMES.findIndex(t => t.name === ms.theme);
    if (themeIndex >= 0) setThemeIdx(themeIndex);

    setPublishedSlug(ms.slug);
    setPublished(true);
    setStep("build");
  };

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setStep("preview"); }, 1800);
  };

  const handlePublish = async () => {
    try {
      let galleryPhotos = listingPhotos;
      let heroImg = data.heroImg;
      let publishVideoUrl = data.videoUrl || listingVideo;
      let publishFloorplanUrl = listingFloorplan;

      // For booking source, copy media from private bucket to public bucket
      // so published microsite URLs never expire
      if (sourceType === "booking" && selectedBookingId) {
        const { data: mediaRows } = await supabase
          .from("booking_media")
          .select("*")
          .eq("booking_id", selectedBookingId)
          .order("created_at", { ascending: false });

        if (mediaRows && mediaRows.length > 0) {
          const publishedPhotos = [];
          let publishedVideo = null;

          for (const item of mediaRows) {
            if (item.file_type === "3d_tour" || !item.file_path) continue;

            // Download from private bucket
            const { data: fileBlob, error: dlError } = await supabase.storage
              .from("booking-media")
              .download(item.file_path);

            if (dlError || !fileBlob) {
              console.error("Download error for", item.file_path, dlError);
              continue;
            }

            // Upload to public bucket under slug folder
            const fileName = item.file_path.split("/").pop();
            const destPath = `${slug}/${fileName}`;
            const { error: upError } = await supabase.storage
              .from("published-media")
              .upload(destPath, fileBlob, { upsert: true, contentType: fileBlob.type });

            if (upError) {
              console.error("Upload to published-media error:", upError);
              continue;
            }

            // Get permanent public URL
            const { data: pubUrlData } = supabase.storage
              .from("published-media")
              .getPublicUrl(destPath);

            const publicUrl = pubUrlData?.publicUrl;
            if (!publicUrl) continue;

            if (item.file_type === "video") {
              publishedVideo = publicUrl;
            } else {
              publishedPhotos.push(publicUrl);
            }
          }

          if (publishedPhotos.length > 0) {
            galleryPhotos = publishedPhotos;
            heroImg = publishedPhotos[0];
          }
          if (publishedVideo) publishVideoUrl = publishedVideo;
        }
      }

      const property_data = {
        address: data.address,
        city: data.city,
        price: data.price,
        beds: data.beds,
        baths: data.baths,
        sqft: data.sqft,
        description: data.description,
        features: data.features.filter(f => f),
        media_types: data.mediaTypes,
        agent_name: data.agentName,
        agent_phone: data.agentPhone,
        agent_email: data.agentEmail,
        hero_img: heroImg,
        listing_id: selectedListingId || null,
        booking_id: selectedBookingId || null,
        source_type: sourceType,
        matterport_url: data.matterportUrl,
        video_url: publishVideoUrl,
        floorplan_url: publishFloorplanUrl,
        gallery_photos: galleryPhotos,
      };

      // Build the record to insert
      const micrositeData = {
        agent_id: user?.id,
        slug,
        theme: THEMES[themeIdx].name,
        published: true,
        property_data,
        agent_name: data.agentName,
        agent_phone: data.agentPhone,
      };

      console.log("Publishing microsite:", JSON.stringify(micrositeData, null, 2));
      console.log("User ID:", user?.id);

      const { data: result, error } = await supabase
        .from("microsites")
        .upsert(micrositeData, { onConflict: "slug" })
        .select();

      console.log("Upsert result:", JSON.stringify({ data: result, error }));

      if (error) {
        console.error("Publish error:", error);
        alert("Failed to publish: " + error.message);
      } else if (!result || result.length === 0) {
        console.error("Publish failed: no row returned (RLS blocked the insert)");
        alert("Publish failed — your account may not have permission. Check the browser console for details.");
      } else {
        console.log("Microsite published successfully:", result[0]);
        setPublished(true);
        setPublishedSlug(slug);
        setStep("published");
        // Refresh the microsites list so it's up to date
        const { data: refreshed } = await supabase
          .from("microsites")
          .select("id, slug, theme, published, property_data, agent_name, agent_phone, created_at")
          .eq("agent_id", user?.id)
          .order("created_at", { ascending: false });
        if (refreshed) setMyMicrosites(refreshed);
      }
    } catch (err) {
      console.error("Publish error:", err);
      alert("Failed to publish. Please try again.");
    }
  };

  const handleCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const unread = leads.filter(l => !l.read).length;

  const STATUSES = [
    { key: "new", label: "New", color: "#c9a84c", bg: "rgba(201,168,76,0.15)" },
    { key: "contacted", label: "Contacted", color: "#5fb0d8", bg: "rgba(95,176,216,0.15)" },
    { key: "scheduled", label: "Scheduled", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
    { key: "closed", label: "Closed 🎉", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
    { key: "lost", label: "Lost", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.06)" },
  ];

  const tourColors = { "in-person": "#4ade80", virtual: "#5fb0d8", offer: "#c9a84c" };
  const tourLabels = { "in-person": "🏠 Showing", virtual: "🎥 Virtual", offer: "✍️ Offer" };

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8, padding: "11px 14px", color: "#fff",
    fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none",
    boxSizing: "border-box", colorScheme: "dark",
  };
  const labelStyle = {
    fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, display: "block",
  };

  // ── NOTIFICATION SETTINGS PANEL ──
  if (showNotifSettings) {
    const Toggle = ({ on, onToggle }) => (
      <div onClick={onToggle} style={{
        width: 42, height: 24, borderRadius: 12, cursor: "pointer",
        background: on ? "linear-gradient(135deg,#c9a84c,#e5c97e)" : "rgba(255,255,255,0.12)",
        position: "relative", transition: "background 0.25s", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 3, left: on ? 21 : 3,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          transition: "left 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }} />
      </div>
    );
    const ns = notifSettings;
    const setNS = (k, v) => setNotifSettings(s => ({ ...s, [k]: v }));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowNotifSettings(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em" }}>← Back</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: "#fff", flex: 1 }}>Notifications</div>
        </div>

        {/* Email */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff" }}>📧 Email Alerts</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Instant email when a lead submits</div>
            </div>
            <Toggle on={ns.emailEnabled} onToggle={() => setNS("emailEnabled", !ns.emailEnabled)} />
          </div>
          {ns.emailEnabled && (
            <div style={{ padding: "14px 18px" }}>
              <label style={labelStyle}>Notify email address</label>
              <input style={inputStyle} value={ns.emailAddr} onChange={e => setNS("emailAddr", e.target.value)} placeholder="you@email.com" />
            </div>
          )}
        </div>

        {/* SMS */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff" }}>📱 SMS Alerts</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Text message to your phone</div>
            </div>
            <Toggle on={ns.smsEnabled} onToggle={() => setNS("smsEnabled", !ns.smsEnabled)} />
          </div>
          {ns.smsEnabled && (
            <div style={{ padding: "14px 18px" }}>
              <label style={labelStyle}>Notify phone number</label>
              <input style={inputStyle} value={ns.smsPhone} onChange={e => setNS("smsPhone", e.target.value)} placeholder="(214) 000-0000" type="tel" />
            </div>
          )}
        </div>

        {/* Triggers */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff", marginBottom: 14 }}>Alert Triggers</div>
          {[
            { key: "notifyOnNew", label: "🏠 In-Person Showing Requests", sub: "Notify when someone requests an in-person tour" },
            { key: "notifyOnVirtual", label: "🎥 Virtual Tour Requests", sub: "Notify when someone requests a virtual showing" },
            { key: "notifyOnOffer", label: "✍️ Offer Inquiries", sub: "Always recommended — high intent leads" },
          ].map(t => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ flex: 1, paddingRight: 12 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff", marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{t.sub}</div>
              </div>
              <Toggle on={ns[t.key]} onToggle={() => setNS(t.key, !ns[t.key])} />
            </div>
          ))}
        </div>

        <button onClick={() => setShowNotifSettings(false)} style={{
          background: "linear-gradient(135deg,#c9a84c,#e5c97e)", border: "none", borderRadius: 10, padding: "14px",
          fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
          letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
        }}>Save Settings ✓</button>
      </div>
    );
  }

  // ── LEAD DETAIL ──
  if (step === "published" && selectedLead !== null) {
    const lead = leads[selectedLead];
    const currentStatus = STATUSES.find(s => s.key === lead.status) || STATUSES[0];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => { setSelectedLead(null); setLeads(l => l.map((x, i) => i === selectedLead ? { ...x, read: true } : x)); }} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em",
          }}>← Inbox</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff", flex: 1 }}>Lead Detail</div>
          <span style={{ background: currentStatus.bg, color: currentStatus.color, padding: "4px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.07em", fontWeight: 600 }}>
            {currentStatus.label}
          </span>
        </div>

        {/* Lead card */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "20px", background: "rgba(201,168,76,0.05)", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
              background: `linear-gradient(135deg, ${tourColors[lead.tourType]}, ${tourColors[lead.tourType]}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#0a1628", fontWeight: 700,
            }}>{lead.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>{lead.name}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                <span style={{ background: `${tourColors[lead.tourType]}20`, color: tourColors[lead.tourType], border: `1px solid ${tourColors[lead.tourType]}40`, padding: "2px 8px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10 }}>
                  {tourLabels[lead.tourType]}
                </span>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{lead.date} · {lead.time}</span>
              </div>
            </div>
          </div>

          {/* Contact rows */}
          {[{ icon: "📧", label: "Email", val: lead.email }, { icon: "📱", label: "Phone", val: lead.phone }].map(row => (
            <div key={row.label} style={{ padding: "13px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>{row.icon} {row.label}</span>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff" }}>{row.val}</span>
            </div>
          ))}

          {/* Message */}
          {lead.message && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Message</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, fontStyle: "italic" }}>"{lead.message}"</div>
            </div>
          )}

          {/* Call / Email actions */}
          <div style={{ padding: "16px 20px", display: "flex", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button style={{
              flex: 1, background: "linear-gradient(135deg,#c9a84c,#e5c97e)", border: "none", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
            }}>📞 Call</button>
            <button style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}>✉️ Email</button>
            <button style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}>💬 Text</button>
          </div>
        </div>

        {/* Status Tracker */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "18px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff", marginBottom: 14 }}>Update Status</div>

          {/* Pipeline bar */}
          <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden", height: 6 }}>
            {["new","contacted","scheduled","closed"].map((s, i) => {
              const idx = ["new","contacted","scheduled","closed"].indexOf(lead.status);
              return <div key={s} style={{ flex: 1, background: i <= idx ? "#c9a84c" : "rgba(255,255,255,0.1)", transition: "background 0.3s" }} />;
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STATUSES.map(s => (
              <div key={s.key} onClick={() => updateLeadStatus(selectedLead, s.key)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                borderRadius: 10, cursor: "pointer",
                background: lead.status === s.key ? s.bg : "rgba(255,255,255,0.02)",
                border: `1px solid ${lead.status === s.key ? s.color + "50" : "rgba(255,255,255,0.06)"}`,
                transition: "all 0.2s",
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  border: `2px solid ${lead.status === s.key ? s.color : "rgba(255,255,255,0.2)"}`,
                  background: lead.status === s.key ? s.color : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}>
                  {lead.status === s.key && <span style={{ color: "#0a1628", fontSize: 10, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: lead.status === s.key ? s.color : "rgba(255,255,255,0.5)", fontWeight: lead.status === s.key ? 600 : 400, letterSpacing: "0.04em" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (step === "published") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 100, minWidth: 300, maxWidth: 400,
          background: "rgba(10,22,40,0.97)", border: "1px solid rgba(201,168,76,0.5)",
          borderRadius: 12, padding: "14px 16px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 12,
          animation: "slideDown 0.3s ease",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg,#c9a84c,#e5c97e)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#0a1628", fontWeight: 700,
          }}>{toast.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#c9a84c", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>🔔 New Lead!</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", fontWeight: 600 }}>{toast.name}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{tourLabels[toast.tourType]} · Just now</div>
          </div>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff" }}>Your Microsite</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#4ade80", letterSpacing: "0.06em" }}>Live</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowNotifSettings(true)} style={{
            background: notifSettings.emailEnabled || notifSettings.smsEnabled ? "rgba(201,168,76,0.12)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${notifSettings.emailEnabled || notifSettings.smsEnabled ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.1)"}`,
            color: notifSettings.emailEnabled || notifSettings.smsEnabled ? "#c9a84c" : "rgba(255,255,255,0.35)",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", cursor: "pointer",
          }}>🔔 Alerts</button>
          <button onClick={() => setStep("build")} style={{
            background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
          }}>✏️ Edit</button>
          <button onClick={() => { setStep("build"); setPublished(false); setPublishedSlug(null); setLeads([]); setData({ address: "", city: "", price: "", beds: "", baths: "", sqft: "", description: "", agentName: "", agentPhone: "", heroImg: "", features: ["","","",""], mediaTypes: ["Photos","Drone","3D Tour"] }); }} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
          }}>+ New</button>
        </div>
      </div>

      {/* URL card */}
      <div style={{ background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 12, padding: "15px 18px" }}>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Live URL</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", marginBottom: 12, wordBreak: "break-all" }}>{liveUrl}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCopy} style={{
            flex: 1, background: copied ? "rgba(74,222,128,0.12)" : "rgba(201,168,76,0.1)",
            border: `1px solid ${copied ? "rgba(74,222,128,0.3)" : "rgba(201,168,76,0.25)"}`,
            color: copied ? "#4ade80" : "#c9a84c", padding: "9px", borderRadius: 7,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
          }}>{copied ? "✓ Copied!" : "Copy Link"}</button>
          <button style={{
            flex: 1, background: "#c9a84c", border: "none", color: "#0a1628", padding: "9px", borderRadius: 7,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer", fontWeight: 700,
          }}>Share ↗</button>
        </div>
      </div>

      {/* Pipeline summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {STATUSES.slice(0, 4).map(s => {
          const count = leads.filter(l => l.status === s.key).length;
          return (
            <div key={s.key} style={{ background: count > 0 ? s.bg : "rgba(255,255,255,0.02)", border: `1px solid ${count > 0 ? s.color + "30" : "rgba(255,255,255,0.06)"}`, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: count > 0 ? s.color : "rgba(255,255,255,0.2)", fontWeight: 700 }}>{count}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: count > 0 ? s.color : "rgba(255,255,255,0.2)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{s.label.replace(" 🎉","")}</div>
            </div>
          );
        })}
      </div>

      {/* Leads inbox */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>Leads Inbox</div>
            {unread > 0 && (
              <span style={{ background: "#c9a84c", color: "#0a1628", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Jost', sans-serif", fontSize: 10, fontWeight: 700 }}>{unread}</span>
            )}
          </div>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{leads.length} total</span>
        </div>

        {leads.length === 0 ? (
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12, padding: "32px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.4)" }}>No leads yet</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>Share your microsite to start collecting leads.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {leads.map((lead, i) => {
              const st = STATUSES.find(s => s.key === lead.status) || STATUSES[0];
              return (
                <div key={i} onClick={() => setSelectedLead(i)} style={{
                  background: lead.read ? "rgba(255,255,255,0.02)" : "rgba(201,168,76,0.05)",
                  border: `1px solid ${lead.read ? "rgba(255,255,255,0.07)" : "rgba(201,168,76,0.2)"}`,
                  borderRadius: 12, padding: "13px 15px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = lead.read ? "rgba(255,255,255,0.07)" : "rgba(201,168,76,0.2)"}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${tourColors[lead.tourType]}88, ${tourColors[lead.tourType]}44)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: "#fff", fontWeight: 700,
                  }}>{lead.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", fontWeight: lead.read ? 400 : 600 }}>{lead.name}</span>
                      {!lead.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c9a84c", flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {lead.message || "No message"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <span style={{ background: st.bg, color: st.color, padding: "2px 7px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 9, letterSpacing: "0.07em", fontWeight: 600 }}>
                      {st.label.replace(" 🎉","")}
                    </span>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{lead.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share channels */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>Share Via</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {[{ icon: "📱", label: "Text" }, { icon: "📧", label: "Email" }, { icon: "💼", label: "LinkedIn" }, { icon: "📘", label: "Facebook" }, { icon: "🐦", label: "X" }, { icon: "📸", label: "Instagram" }].map(c => (
            <div key={c.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 6px", textAlign: "center", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.background = "rgba(201,168,76,0.05)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}>
              <div style={{ fontSize: 18, marginBottom: 3 }}>{c.icon}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (step === "preview") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setStep("build")} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
          fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em",
        }}>← Edit</button>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff", flex: 1 }}>Preview</div>
      </div>

      {/* Theme picker */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={labelStyle}>Choose Theme</span>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "#c9a84c", letterSpacing: "0.06em" }}>
            {THEMES[themeIdx].name} — {THEMES[themeIdx].label}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {THEMES.map((t, i) => (
            <div key={t.name} onClick={() => setThemeIdx(i)} style={{
              borderRadius: 10, cursor: "pointer", overflow: "hidden",
              border: themeIdx === i ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
              transition: "border-color 0.2s", background: t.bg,
            }}>
              {/* Color swatch bar */}
              <div style={{ display: "flex", height: 28 }}>
                {t.swatches.map((s, si) => (
                  <div key={si} style={{ flex: 1, background: s, borderRight: si < t.swatches.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }} />
                ))}
              </div>
              {/* Name row */}
              <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: t.text, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: t.sub, letterSpacing: "0.06em" }}>{t.label}</div>
                </div>
                {themeIdx === i && (
                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#c9a84c", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 8, color: "#0a1628", fontWeight: 900 }}>✓</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <MicrositePreview data={{ ...data, galleryPhotos: listingPhotos, videoUrl: data.videoUrl || listingVideo, floorplanUrl: listingFloorplan, onLeadSubmit: handleNewLead }} theme={theme} />

      <button onClick={handlePublish} style={{
        background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "15px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
      }}>{publishedSlug ? "✅ Save & Republish" : "🚀 Publish Microsite"}</button>
    </div>
  );

  // Build step
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>Microsite Generator</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Build a branded property page in 60 seconds.</div>
      </div>

      {/* My Published Microsites */}
      {myMicrosites.length > 0 && (
        <div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
            My Published Microsites
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myMicrosites.map(ms => {
              const pd = ms.property_data || {};
              const th = THEMES.find(t => t.name === ms.theme) || THEMES[0];
              const isEditing = publishedSlug === ms.slug;
              return (
                <div key={ms.id} style={{
                  background: isEditing ? "rgba(201,168,76,0.07)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isEditing ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 12, padding: "13px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* Theme color dot */}
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    {(th.swatches || [th.bg, th.accent]).slice(0, 3).map((s, i) => (
                      <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: s, border: "1px solid rgba(255,255,255,0.15)" }} />
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {pd.address || ms.slug}
                    </div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                      {ms.theme} · /p/{ms.slug}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => loadMicrositeForEdit(ms)} style={{
                      background: isEditing ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isEditing ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.12)"}`,
                      color: isEditing ? "#c9a84c" : "rgba(255,255,255,0.6)",
                      padding: "6px 12px", borderRadius: 7,
                      fontFamily: "'Jost', sans-serif", fontSize: 10,
                      letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
                    }}>{isEditing ? "Editing" : "✏️ Edit"}</button>
                    <a href={`/p/${ms.slug}`} target="_blank" rel="noreferrer" style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.4)", padding: "6px 10px", borderRadius: 7,
                      fontFamily: "'Jost', sans-serif", fontSize: 10,
                      letterSpacing: "0.06em", textDecoration: "none", display: "flex", alignItems: "center",
                    }}>↗</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Toggle: Admin only — agents always use bookings */}
      {isAdmin && (
        <div>
          <div style={labelStyle}>Source</div>
          <div style={{ display: "flex", gap: 0, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
            {[{ key: "listing", label: "Listings" }, { key: "booking", label: "Bookings" }].map(s => (
              <button key={s.key} onClick={() => setSourceType(s.key)} style={{
                flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
                background: sourceType === s.key ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.03)",
                color: sourceType === s.key ? "#c9a84c" : "rgba(255,255,255,0.4)",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: sourceType === s.key ? 600 : 400,
                letterSpacing: "0.08em", transition: "all 0.2s",
                borderRight: s.key === "listing" ? "1px solid rgba(255,255,255,0.12)" : "none",
              }}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Property Selector */}
      <div>
        <div style={labelStyle}>{sourceType === "listing" && isAdmin ? "Select Listing" : "Select a Listing"}</div>
        {sourceType === "listing" && isAdmin ? (
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={selectedListingId || ""}
            onChange={e => setSelectedListingId(e.target.value || null)}
          >
            <option value="">— Choose a listing —</option>
            {listings.map(l => (
              <option key={l.id} value={l.id}>{l.address} — {l.city}</option>
            ))}
          </select>
        ) : (
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={selectedBookingId || ""}
            onChange={e => setSelectedBookingId(e.target.value || null)}
          >
            <option value="">— Choose a listing —</option>
            {bookings.map(b => (
              <option key={b.id} value={b.id}>
                {b.address || "No address"}{b.city ? ` — ${b.city}` : ""}
              </option>
            ))}
          </select>
        )}
        {/* Package info display */}
        {hasSourceSelection && (
          <div style={{ marginTop: 6, fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            Package: <span style={{ color: activePackage === "Luxury" ? "#e5c97e" : activePackage === "Signature" ? "#c9a84c" : "#8fa3b1", fontWeight: 600 }}>{activePackage || "Unknown"}</span>
            {isAdmin && <span style={{ color: "#4ade80", marginLeft: 8 }}>— Admin access</span>}
            {!isAdmin && micrositeIncluded && <span style={{ color: "rgba(201,168,76,0.7)", marginLeft: 8 }}>— Microsite included</span>}
            {!isAdmin && !micrositeIncluded && micrositeAddonApproved && <span style={{ color: "#4ade80", marginLeft: 8 }}>— Microsite add-on active</span>}
            {!isAdmin && (micrositeIncluded || micrositeAddonApproved) && !invoicePaid && <span style={{ color: "#f59e0b", marginLeft: 8 }}>— Invoice unpaid</span>}
          </div>
        )}
      </div>

      {/* Invoice not paid gate — agent has package but hasn't paid yet */}
      {hasSourceSelection && !isAdmin && (micrositeIncluded || micrositeAddonApproved) && !invoicePaid && (
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(239,168,76,0.25)",
          borderRadius: 14, padding: 28, textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 8 }}>
            Invoice Payment Required
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            Your {activePackage} package includes a microsite, but it will be available once your invoice has been paid. Please complete payment to unlock this feature.
          </div>
        </div>
      )}

      {/* Package tier gate — non-admin without microsite access */}
      {hasSourceSelection && !micrositeAccessible && !(!invoicePaid && (micrositeIncluded || micrositeAddonApproved)) && (
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(201,168,76,0.2)",
          borderRadius: 14, padding: 28, textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🌐</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 8 }}>
            Unlock Your Property Microsite
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 20px" }}>
            Your {activePackage || "current"} package doesn't include a microsite. Add one for just <span style={{ color: "#c9a84c", fontWeight: 600 }}>$150</span> to give your listing a branded, shareable property page with lead capture.
          </div>
          {sourceType === "listing" && (
            <>
              {addonStatus === "pending" ? (
                <div style={{
                  display: "inline-block", padding: "12px 28px", borderRadius: 10,
                  background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                  fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c",
                  letterSpacing: "0.08em", fontWeight: 600,
                }}>
                  Request Pending — Awaiting Admin Approval
                </div>
              ) : addonStatus === "denied" ? (
                <div style={{
                  display: "inline-block", padding: "12px 28px", borderRadius: 10,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
                  letterSpacing: "0.08em", fontWeight: 600,
                }}>
                  Request Denied — Contact admin for details
                </div>
              ) : (
                <button onClick={handleRequestAddon} style={{
                  background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
                  border: "none", borderRadius: 10, padding: "14px 32px",
                  fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12,
                  letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628",
                  cursor: "pointer", transition: "all 0.3s",
                }}>
                  Add Microsite — $150
                </button>
              )}
            </>
          )}
          {sourceType === "booking" && (
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8,
            }}>
              Contact admin to add the Microsite add-on to this booking.
            </div>
          )}
          <div style={{ marginTop: 16, fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            Or upgrade to Luxury for a free microsite with every listing.
          </div>
        </div>
      )}

      {/* Show builder only if microsite is accessible (or no source selected yet) */}
      {(!hasSourceSelection || micrositeAccessible) && <>

      {/* Hero Image from uploaded photos */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={labelStyle}>Hero Photo</span>
          {listingPhotos.length > 0 && (
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              Tap a photo to set as hero
            </span>
          )}
        </div>
        {mediaLoading ? (
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", padding: "20px 0" }}>
            Loading photos...
          </div>
        ) : listingPhotos.length > 0 ? (
          <>
            {/* Selected hero preview */}
            {data.heroImg && (
              <div style={{ position: "relative", width: "100%", height: 180, borderRadius: 10, overflow: "hidden", marginBottom: 10, border: "2px solid #c9a84c" }}>
                <img src={data.heroImg} alt="Hero" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(201,168,76,0.9)", color: "#0a1628", fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 4 }}>
                  Hero Photo
                </div>
              </div>
            )}
            {/* Photo strip picker */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {listingPhotos.map((url, i) => (
                <div key={i} onClick={() => setField("heroImg", url)} style={{
                  position: "relative", height: 72, borderRadius: 7, overflow: "hidden", cursor: "pointer",
                  border: data.heroImg === url ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                  transition: "border-color 0.2s",
                }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {data.heroImg === url && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(201,168,76,0.25)" }} />
                  )}
                  <div style={{ position: "absolute", bottom: 4, right: 5, fontFamily: "'Jost', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>{String(i + 1).padStart(2, "0")}</div>
                </div>
              ))}
            </div>
          </>
        ) : hasSourceSelection ? (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              No photos uploaded yet.<br />Upload photos in the Bookings Manager first.
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)", padding: "12px 0" }}>
            Select a {sourceType} above to see available photos.
          </div>
        )}
      </div>

      {/* Property Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Property Details</div>
        <div>
          <label style={labelStyle}>Street Address</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "123 Main St" : "4821 Lakewood Blvd"} value={data.address} onChange={e => setField("address", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>City, State & ZIP</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "Fort Worth, TX 76109" : "Dallas, TX 75206"} value={data.city} onChange={e => setField("city", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>List Price</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "$750,000" : "$1,250,000"} value={data.price} onChange={e => setField("price", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[{ key: "beds", ph: "4" }, { key: "baths", ph: "3.5" }, { key: "sqft", ph: "3,840" }].map(f => (
            <div key={f.key}>
              <label style={labelStyle}>{f.key}</label>
              <input style={inputStyle} placeholder={f.ph} value={data[f.key]} onChange={e => setField(f.key, e.target.value)} />
            </div>
          ))}
        </div>
        <div>
          <label style={labelStyle}>Property Description</label>
          <textarea style={{ ...inputStyle, height: 90, resize: "none", lineHeight: 1.5 }}
            placeholder={sourceType === "booking" ? "Describe the property highlights for your microsite..." : "Describe the property's best features..."}
            value={data.description} onChange={e => setField("description", e.target.value)} />
        </div>
      </div>

      {/* Highlights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Highlights</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {data.features.map((f, i) => (
            <input key={i} style={inputStyle} placeholder={sourceType === "booking"
              ? ["Open Floor Plan", "Updated Kitchen", "Large Backyard", "New Roof"][i]
              : ["Chef's Kitchen", "Pool & Spa", "Smart Home", "3-Car Garage"][i]}
              value={f} onChange={e => setFeature(i, e.target.value)} />
          ))}
        </div>
      </div>

      {/* Media included */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>Media Included</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.keys(MEDIA_ICONS).map(m => (
            <div key={m} onClick={() => toggleMedia(m)} style={{
              padding: "7px 14px", borderRadius: 20, cursor: "pointer",
              background: data.mediaTypes.includes(m) ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${data.mediaTypes.includes(m) ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.1)"}`,
              fontFamily: "'Jost', sans-serif", fontSize: 11,
              color: data.mediaTypes.includes(m) ? "#c9a84c" : "rgba(255,255,255,0.4)",
              transition: "all 0.2s",
            }}>
              {MEDIA_ICONS[m]} {m}
            </div>
          ))}
        </div>
      </div>

      {/* Agent Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Agent Info</div>
        <div>
          <label style={labelStyle}>Agent Name</label>
          <input style={inputStyle} placeholder="Jane Doe" value={data.agentName} onChange={e => setField("agentName", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Phone Number</label>
          <input style={inputStyle} placeholder="(214) 555-0000" value={data.agentPhone} onChange={e => setField("agentPhone", e.target.value)} />
        </div>
      </div>

      {/* Media URLs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Media Links</div>
        <div>
          <label style={labelStyle}>Matterport / 3D Tour URL</label>
          <input style={inputStyle} placeholder="https://my.matterport.com/show/?m=..." value={data.matterportUrl || ""} onChange={e => setField("matterportUrl", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Drone / Video URL <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>(YouTube, Vimeo, or direct .mp4)</span></label>
          <input style={inputStyle} placeholder="https://youtube.com/watch?v=..." value={data.videoUrl || ""} onChange={e => setField("videoUrl", e.target.value)} />
        </div>
        {(data.matterportUrl || data.videoUrl || listingVideo || listingFloorplan) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {(data.matterportUrl) && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>🔮 3D Tour</span>}
            {(data.videoUrl || listingVideo) && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>🚁 Drone Video</span>}
            {listingFloorplan && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>📐 Floorplan</span>}
          </div>
        )}
      </div>

      {/* Generate CTA */}
      <button onClick={handleGenerate} disabled={generating} style={{
        background: generating ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "16px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: generating ? "rgba(255,255,255,0.5)" : "#0a1628", cursor: generating ? "default" : "pointer",
        transition: "all 0.3s",
      }}>
        {generating ? "✨ Generating..." : publishedSlug ? "Preview Changes →" : "Preview Microsite →"}
      </button>

      </>}
    </div>
  );
}

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

  const photoRef = useRef(null);
  const floorplanRef = useRef(null);
  const droneRef = useRef(null);
  const tourRef = useRef(null);
  const detailsRef = useRef(null);
  const contactRef = useRef(null);

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

  const sections = [
    { id: "photos", label: "Photos", ref: photoRef, show: true },
    { id: "floorplan", label: "Floorplan", ref: floorplanRef, show: hasFloorplan },
    { id: "drone", label: "Drone", ref: droneRef, show: hasVideo },
    { id: "tour", label: "3D Tour", ref: tourRef, show: hasTour },
    { id: "details", label: "Details", ref: detailsRef, show: true },
    { id: "contact", label: "Contact", ref: contactRef, show: true },
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
  const footerBg = isDarkTheme ? pubT.bg : "#0f0f1a";

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
          <div style={{ fontSize: 16, fontWeight: 700, color: pubT.accent, letterSpacing: "0.06em" }}>
            MILESTONE MEDIA
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: isDarkTheme ? "#888" : "#666", letterSpacing: "0.08em" }}>
            Photography & Media
          </div>
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
      <div style={{
        position: "relative",
        height: "75vh",
        marginTop: 60,
        background: "#000",
        overflow: "hidden",
      }}>
        <img
          src={data.hero_img || (galleryPhotos[0] || "")}
          alt="Property"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)",
        }} />
        <div style={{ position: "absolute", bottom: 40, left: 40, color: "#fff" }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, marginBottom: 8 }}>
            {data.address || "Luxury Property"}
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 18, letterSpacing: "0.08em", marginBottom: 16 }}>
            {data.city || ""}
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: pubT.accent }}>
            {data.price || ""}
          </div>
        </div>
      </div>

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

      {/* Photo Gallery Section */}
      <style>{`
        @keyframes msGalleryLeft {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes msGalleryRight {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
        .ms-gallery-track-fwd { animation: msGalleryLeft 90s linear infinite; }
        .ms-gallery-track-rev { animation: msGalleryRight 75s linear infinite; }
        .ms-gallery-outer:hover .ms-gallery-track-fwd,
        .ms-gallery-outer:hover .ms-gallery-track-rev { animation-play-state: paused; }
      `}</style>
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
        {/* Row 1 — scrolls left */}
        <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none", marginBottom: 4 }}>
          <div className="ms-gallery-track-fwd" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
            {[...galleryPhotos, ...galleryPhotos].map((photo, idx) => (
              <div key={idx} onClick={() => { setLightboxIndex(idx % galleryPhotos.length); setLightboxOpen(true); }}
                style={{ height: 380, flexShrink: 0, overflow: "hidden" }}>
                <img src={photo} alt="" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
              </div>
            ))}
          </div>
        </div>
        {/* Row 2 — scrolls right */}
        <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none" }}>
          <div className="ms-gallery-track-rev" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
            {[...galleryPhotos, ...galleryPhotos].map((photo, idx) => (
              <div key={idx} onClick={() => { setLightboxIndex(idx % galleryPhotos.length); setLightboxOpen(true); }}
                style={{ height: 280, flexShrink: 0, overflow: "hidden" }}>
                <img src={photo} alt="" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
              </div>
            ))}
          </div>
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
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: pubT.accent, marginBottom: 8 }}>
            Property Info
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
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: pubT.accent, fontWeight: 700, letterSpacing: "0.08em" }}>
          MILESTONE MEDIA
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#666" }}>
          © 2026 Milestone Media. All rights reserved.
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
// BOOKINGS MANAGER VIEW — View & manage all bookings
// ============================================================
function BookingsManagerView() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [editingBooking, setEditingBooking] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(null);
  // Media upload/download state
  const [mediaModal, setMediaModal] = useState(null); // booking object when modal is open
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tourUrl, setTourUrl] = useState("");
  const [tourLabel, setTourLabel] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { fetchBookings(); }, []);

  const fetchBookings = async () => {
    setLoading(true);
    let query = supabase.from("bookings").select("*").order("created_at", { ascending: false });
    // Agents only see their own bookings
    if (!isAdmin && user?.id) {
      query = query.eq("agent_id", user.id);
    }
    const { data, error } = await query;
    if (data) setBookings(data);
    if (error) console.error("Error loading bookings:", error);
    setLoading(false);
  };

  const updateStatus = async (id, newStatus) => {
    const { error } = await supabase.from("bookings").update({ status: newStatus }).eq("id", id);
    if (error) { console.error("Status update error:", error); alert("Failed to update status."); }
    else { fetchBookings(); }
    setCancelConfirm(null);
  };

  const saveBooking = async (updated) => {
    setSaving(true);
    const { id, created_at, ...fields } = updated;
    const { error } = await supabase.from("bookings").update(fields).eq("id", id);
    if (error) { console.error("Save error:", error); alert("Failed to save changes."); }
    else { setEditingBooking(null); fetchBookings(); }
    setSaving(false);
  };

  // ——— Media Functions ———
  const openMediaModal = async (booking) => {
    setMediaModal(booking);
    setTourUrl("");
    setTourLabel("");
    await loadMedia(booking.id);
  };

  const loadMedia = async (bookingId) => {
    setMediaLoading(true);
    const { data, error } = await supabase
      .from("booking_media")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false });
    if (error) { console.error("Error loading media:", error); setMediaLoading(false); return; }
    // Generate signed URLs for photos/videos (private bucket)
    if (data && data.length > 0) {
      const withUrls = await Promise.all(data.map(async (item) => {
        if (item.file_path && item.file_type !== "3d_tour") {
          const { data: signedData } = await supabase.storage
            .from("booking-media")
            .createSignedUrl(item.file_path, 3600); // 1 hour
          return { ...item, signed_url: signedData?.signedUrl || null };
        }
        return item;
      }));
      setMediaFiles(withUrls);
    } else {
      setMediaFiles(data || []);
    }
    setMediaLoading(false);
  };

  const handleFileUpload = async (files) => {
    if (!mediaModal || !files.length) return;
    setUploading(true);
    const bookingId = mediaModal.id;

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const fileType = isVideo ? "video" : "photo";
      const filePath = `${bookingId}/${Date.now()}_${file.name}`;

      // Upload to Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from("booking-media")
        .upload(filePath, file, { contentType: file.type });

      if (uploadErr) {
        console.error("Upload error:", uploadErr);
        alert(`Failed to upload ${file.name}`);
        continue;
      }

      // Insert record into booking_media table
      const { error: dbErr } = await supabase.from("booking_media").insert({
        booking_id: bookingId,
        file_name: file.name,
        file_type: fileType,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user?.id,
      });

      if (dbErr) console.error("DB insert error:", dbErr);
    }

    await loadMedia(bookingId);
    setUploading(false);
  };

  const addTourLink = async () => {
    if (!mediaModal || !tourUrl.trim()) return;
    const { error } = await supabase.from("booking_media").insert({
      booking_id: mediaModal.id,
      file_name: tourLabel.trim() || "3D Tour",
      file_type: "3d_tour",
      tour_url: tourUrl.trim(),
      uploaded_by: user?.id,
    });
    if (error) { console.error("Tour link error:", error); alert("Failed to add tour link."); }
    else { setTourUrl(""); setTourLabel(""); await loadMedia(mediaModal.id); }
  };

  const deleteMedia = async (media) => {
    if (!confirm(`Delete "${media.file_name}"?`)) return;
    // Delete from storage if it's a file (not a tour link)
    if (media.file_path) {
      await supabase.storage.from("booking-media").remove([media.file_path]);
    }
    await supabase.from("booking_media").delete().eq("id", media.id);
    await loadMedia(mediaModal.id);
  };

  const getDownloadUrl = async (filePath) => {
    const { data } = await supabase.storage
      .from("booking-media")
      .createSignedUrl(filePath, 3600); // 1 hour expiry
    return data?.signedUrl;
  };

  const downloadSingleFile = async (media) => {
    const url = await getDownloadUrl(media.file_path);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = media.file_name;
      a.click();
    }
  };

  const downloadAllMedia = async () => {
    const downloadable = mediaFiles.filter(m => m.file_path);
    if (!downloadable.length) return alert("No files to download.");
    // Download each file sequentially (browser will handle multiple downloads)
    for (const media of downloadable) {
      await downloadSingleFile(media);
      // Small delay between downloads so browser doesn't block them
      await new Promise(r => setTimeout(r, 500));
    }
  };

  const toggleInvoicePaid = async (bookingId, currentVal) => {
    const { error } = await supabase.from("bookings").update({ invoice_paid: !currentVal }).eq("id", bookingId);
    if (error) alert("Failed to update invoice status.");
    else fetchBookings();
  };

  const filtered = filter === "all" ? bookings : bookings.filter(b => b.status === filter);

  const statusColors = {
    confirmed: "#c9a84c",
    in_progress: "#4ecdc4",
    completed: "#27ae60",
    cancelled: "#e74c3c",
  };

  const cardStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
  };

  const labelSt = {
    fontFamily: "'Jost', sans-serif",
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 4,
  };

  const btnBase = {
    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
    letterSpacing: "0.06em", textTransform: "uppercase", borderRadius: 6, padding: "6px 14px",
  };

  // ——— Media Modal (Admin: upload | Agent: download) ———
  if (mediaModal) {
    const photos = mediaFiles.filter(m => m.file_type === "photo");
    const videos = mediaFiles.filter(m => m.file_type === "video");
    const tours = mediaFiles.filter(m => m.file_type === "3d_tour");
    const mediaCount = mediaFiles.length;
    const canDownload = isAdmin || mediaModal.invoice_paid;

    const sectionHeader = (text) => ({
      fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c",
      letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, marginTop: 20,
    });
    const dropZoneSt = {
      border: dragOver ? "2px dashed #c9a84c" : "2px dashed rgba(255,255,255,0.15)",
      borderRadius: 12, padding: 40, textAlign: "center", cursor: "pointer",
      background: dragOver ? "rgba(201,168,76,0.06)" : "rgba(255,255,255,0.02)",
      transition: "all 0.2s",
    };
    const thumbSt = {
      width: 80, height: 80, objectFit: "cover", borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.1)",
    };
    const inputSt = {
      width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8, padding: "10px 12px", color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 13,
      outline: "none", boxSizing: "border-box",
    };

    return (
      <div style={{ padding: "32px 24px", maxWidth: 750, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c" }}>
            {isAdmin ? "Manage Media" : "Booking Media"}
          </div>
          <button onClick={() => setMediaModal(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "8px 16px", color: "rgba(255,255,255,0.6)", fontFamily: "'Jost', sans-serif",
            fontSize: 12, cursor: "pointer", letterSpacing: "0.06em",
          }}>← Back</button>
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>
          {mediaModal.client_name} — {mediaModal.address}, {mediaModal.city}
          <span style={{ marginLeft: 12, color: "rgba(255,255,255,0.3)" }}>{mediaCount} file{mediaCount !== 1 ? "s" : ""}</span>
        </div>

        {/* Admin: Invoice & Payment Section */}
        {isAdmin && (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 20, marginBottom: 16,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Invoice & Payment</div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Stripe Invoice ID</div>
                <input
                  value={mediaModal.stripe_invoice_id || ""}
                  onChange={e => setMediaModal({ ...mediaModal, stripe_invoice_id: e.target.value })}
                  placeholder="in_1abc123... (paste from Stripe Dashboard)"
                  style={inputSt}
                />
              </div>
              <button onClick={async () => {
                const { error } = await supabase.from("bookings").update({ stripe_invoice_id: mediaModal.stripe_invoice_id }).eq("id", mediaModal.id);
                if (error) alert("Failed to save invoice ID.");
                else { fetchBookings(); alert("Invoice ID saved! Media will auto-unlock when paid."); }
              }} style={{
                ...btnBase, padding: "10px 16px", whiteSpace: "nowrap",
                background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
              }}>Save Invoice ID</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: mediaModal.invoice_paid ? "#27ae60" : "#e74c3c" }}>
                  {mediaModal.invoice_paid ? "Paid — Media unlocked for agent" : "Unpaid — Media locked for agent"}
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                  {mediaModal.stripe_invoice_id
                    ? "Auto-unlocks when agent pays via Stripe"
                    : "Add a Stripe Invoice ID above for auto-unlock, or toggle manually"}
                </div>
              </div>
              <button onClick={() => {
                toggleInvoicePaid(mediaModal.id, mediaModal.invoice_paid);
                setMediaModal({ ...mediaModal, invoice_paid: !mediaModal.invoice_paid });
              }} style={{
                ...btnBase,
                background: mediaModal.invoice_paid ? "rgba(231,76,60,0.12)" : "rgba(39,174,96,0.12)",
                border: `1px solid ${mediaModal.invoice_paid ? "rgba(231,76,60,0.3)" : "rgba(39,174,96,0.3)"}`,
                color: mediaModal.invoice_paid ? "#e74c3c" : "#27ae60",
              }}>{mediaModal.invoice_paid ? "Mark Unpaid" : "Mark Paid"}</button>
            </div>
          </div>
        )}

        {/* Agent: Payment Required Notice */}
        {!isAdmin && !mediaModal.invoice_paid && (
          <div style={{
            background: "rgba(231,76,60,0.06)", border: "1px solid rgba(231,76,60,0.2)",
            borderRadius: 12, padding: 20, marginBottom: 16, textAlign: "center",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#e74c3c", marginBottom: 6 }}>
              Media downloads are locked until your invoice is paid.
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              Please complete payment to access your photos, videos, and tours.
            </div>
          </div>
        )}

        {/* Admin: Upload Zone */}
        {isAdmin && (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 20, marginBottom: 16,
          }}>
            <div style={sectionHeader()}>Upload Photos & Videos</div>
            <div
              style={dropZoneSt}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFileUpload(Array.from(e.dataTransfer.files)); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={e => { handleFileUpload(Array.from(e.target.files)); e.target.value = ""; }}
              />
              {uploading ? (
                <div style={{ fontFamily: "'Jost', sans-serif", color: "#c9a84c", fontSize: 14 }}>
                  Uploading... Please wait
                </div>
              ) : (
                <>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
                    Drag & drop photos or videos here
                  </div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                    or click to browse — JPG, PNG, WebP, MP4, MOV
                  </div>
                </>
              )}
            </div>

            <div style={sectionHeader()}>Add 3D Tour Link</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "end" }}>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Label</div>
                <input
                  value={tourLabel}
                  onChange={e => setTourLabel(e.target.value)}
                  placeholder="e.g. Matterport Tour"
                  style={inputSt}
                />
              </div>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Tour URL</div>
                <input
                  value={tourUrl}
                  onChange={e => setTourUrl(e.target.value)}
                  placeholder="https://my.matterport.com/show/?m=..."
                  style={inputSt}
                />
              </div>
              <button onClick={addTourLink} style={{
                ...btnBase, padding: "10px 18px",
                background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
              }}>Add Tour</button>
            </div>
          </div>
        )}

        {/* Media Gallery */}
        {mediaLoading ? (
          <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", padding: 20, textAlign: "center" }}>Loading media...</div>
        ) : mediaFiles.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 40, textAlign: "center",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
              No media uploaded yet.
            </div>
          </div>
        ) : (
          <>
            {/* Download All button (for agents with paid invoice, or admin) */}
            {canDownload && mediaFiles.some(m => m.file_path) && (
              <button onClick={downloadAllMedia} style={{
                ...btnBase, padding: "10px 20px", marginBottom: 16,
                background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
                border: "none", color: "#0a1628", fontWeight: 600,
              }}>Download All Files</button>
            )}

            {/* Photos Section */}
            {photos.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={sectionHeader()}>Photos ({photos.length})</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {photos.map(p => (
                    <div key={p.id} style={{ position: "relative", display: "inline-block" }}>
                      <img
                        src={p.signed_url || "#"}
                        alt={p.file_name}
                        style={thumbSt}
                      />
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.file_name}
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        {canDownload && (
                          <button onClick={() => downloadSingleFile(p)} style={{
                            ...btnBase, padding: "2px 8px", fontSize: 9,
                            background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.2)", color: "#c9a84c",
                          }}>Download</button>
                        )}
                        {isAdmin && (
                          <button onClick={() => deleteMedia(p)} style={{
                            ...btnBase, padding: "2px 8px", fontSize: 9,
                            background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                          }}>×</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Videos Section */}
            {videos.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={sectionHeader()}>Videos ({videos.length})</div>
                {videos.map(v => (
                  <div key={v.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 8, background: "rgba(78,205,196,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>🎬</div>
                      <div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{v.file_name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                          {v.file_size ? `${(v.file_size / 1048576).toFixed(1)} MB` : "Video"}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {canDownload && (
                        <button onClick={() => downloadSingleFile(v)} style={{
                          ...btnBase,
                          background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.2)", color: "#c9a84c",
                        }}>Download</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => deleteMedia(v)} style={{
                          ...btnBase,
                          background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                        }}>Delete</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3D Tours Section */}
            {tours.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={sectionHeader()}>3D Tours ({tours.length})</div>
                {tours.map(t => (
                  <div key={t.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 8, background: "rgba(201,168,76,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>🏠</div>
                      <div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{t.file_name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.tour_url}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {canDownload && (
                        <button onClick={() => window.open(t.tour_url, "_blank")} style={{
                          ...btnBase,
                          background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
                        }}>Open Tour</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => deleteMedia(t)} style={{
                          ...btnBase,
                          background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                        }}>Delete</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ——— Edit Modal ———
  if (editingBooking) {
    const b = editingBooking;
    const set = (key, val) => setEditingBooking({ ...b, [key]: val });
    const inputSt = {
      width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8, padding: "10px 12px", color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 13,
      outline: "none", boxSizing: "border-box",
    };
    const fieldLabel = { ...labelSt, marginTop: 14 };
    const pkgOpts = ["essential", "signature", "luxury"];
    const tierOpts = [
      { value: "under_1500", label: "Under 1,500 sf" },
      { value: "1501_2500", label: "1,501 – 2,500 sf" },
      { value: "2501_3500", label: "2,501 – 3,500 sf" },
      { value: "3501_4500", label: "3,501 – 4,500 sf" },
      { value: "over_4501", label: "Over 4,501 sf" },
    ];
    const timeSlots = ["9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];

    return (
      <div style={{ padding: "32px 24px", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c" }}>Edit Booking</div>
          <button onClick={() => setEditingBooking(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "8px 16px", color: "rgba(255,255,255,0.6)", fontFamily: "'Jost', sans-serif",
            fontSize: 12, cursor: "pointer", letterSpacing: "0.06em",
          }}>← Back</button>
        </div>

        {/* Contact */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Contact Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Full Name</div>
              <input value={b.client_name || ""} onChange={e => set("client_name", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Phone</div>
              <input value={b.client_phone || ""} onChange={e => set("client_phone", e.target.value)} style={inputSt} />
            </div>
          </div>
          <div style={fieldLabel}>Email</div>
          <input value={b.client_email || ""} onChange={e => set("client_email", e.target.value)} style={inputSt} />
        </div>

        {/* Property */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Property Details</div>
          <div style={fieldLabel}>Street Address</div>
          <input value={b.address || ""} onChange={e => set("address", e.target.value)} style={inputSt} />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>City</div>
              <input value={b.city || ""} onChange={e => set("city", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>State</div>
              <input value={b.state || ""} onChange={e => set("state", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Zip</div>
              <input value={b.zip || ""} onChange={e => set("zip", e.target.value)} style={inputSt} />
            </div>
          </div>
          <div style={fieldLabel}>Property Size</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tierOpts.map(t => (
              <button key={t.value} onClick={() => set("sqft_tier", t.value)} style={{
                background: b.sqft_tier === t.value ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                border: b.sqft_tier === t.value ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6, padding: "6px 12px", color: b.sqft_tier === t.value ? "#c9a84c" : "rgba(255,255,255,0.5)",
                fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
              }}>{t.label}</button>
            ))}
          </div>
          <div style={fieldLabel}>Method of Access</div>
          <input value={b.access_method || ""} onChange={e => set("access_method", e.target.value)} style={inputSt} />
        </div>

        {/* Services */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Services</div>
          <div style={fieldLabel}>Package</div>
          <div style={{ display: "flex", gap: 8 }}>
            {pkgOpts.map(p => (
              <button key={p} onClick={() => set("selected_package", p)} style={{
                background: b.selected_package === p ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                border: b.selected_package === p ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6, padding: "8px 18px", color: b.selected_package === p ? "#c9a84c" : "rgba(255,255,255,0.5)",
                fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer", textTransform: "capitalize",
              }}>{p}</button>
            ))}
            <button onClick={() => set("selected_package", null)} style={{
              background: !b.selected_package ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
              border: !b.selected_package ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, padding: "8px 18px", color: !b.selected_package ? "#c9a84c" : "rgba(255,255,255,0.5)",
              fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer",
            }}>Individual</button>
          </div>
          <div style={fieldLabel}>Subtotal ($)</div>
          <input type="number" value={b.subtotal || 0} onChange={e => set("subtotal", Number(e.target.value))} style={{ ...inputSt, width: 160 }} />
        </div>

        {/* Schedule */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Schedule</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Date</div>
              <input type="date" value={b.booking_date || ""} onChange={e => set("booking_date", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Time</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {timeSlots.map(t => (
                  <button key={t} onClick={() => set("booking_time", t)} style={{
                    background: b.booking_time === t ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                    border: b.booking_time === t ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6, padding: "4px 10px", color: b.booking_time === t ? "#c9a84c" : "rgba(255,255,255,0.5)",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
                  }}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          {isAdmin && (
            <>
              <div style={fieldLabel}>Status</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["confirmed", "in_progress", "completed", "cancelled"].map(s => (
                  <button key={s} onClick={() => set("status", s)} style={{
                    background: b.status === s ? `${statusColors[s]}22` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${b.status === s ? statusColors[s] : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6, padding: "6px 14px", color: b.status === s ? statusColors[s] : "rgba(255,255,255,0.5)",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>{s.replace("_", " ")}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Save / Cancel buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => saveBooking(b)} disabled={saving} style={{
            flex: 1, background: saving ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
            border: "none", borderRadius: 8, padding: "14px 24px", color: "#0a1628",
            fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 13, cursor: saving ? "wait" : "pointer",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}>{saving ? "Saving..." : "Save Changes"}</button>
          <button onClick={() => setEditingBooking(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8, padding: "14px 24px", color: "rgba(255,255,255,0.6)",
            fontFamily: "'Jost', sans-serif", fontSize: 13, cursor: "pointer", letterSpacing: "0.06em",
          }}>Discard</button>
        </div>
      </div>
    );
  }

  // ——— Bookings List ———
  return (
    <div style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#c9a84c", marginBottom: 8 }}>
        {isAdmin ? "All Bookings" : "My Bookings"}
      </div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>
        {bookings.length} booking{bookings.length !== 1 ? "s" : ""}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {["all", "confirmed", "in_progress", "completed", "cancelled"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
            border: filter === f ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20, padding: "6px 16px", color: filter === f ? "#c9a84c" : "rgba(255,255,255,0.5)",
            fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase",
            cursor: "pointer",
          }}>{f.replace("_", " ")}</button>
        ))}
      </div>

      {loading && <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif" }}>Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", textAlign: "center", padding: 40 }}>
          No bookings found.
        </div>
      )}

      {filtered.map(b => (
        <div key={b.id} style={{
          ...cardStyle,
          borderLeft: b.status === "cancelled" ? "3px solid #e74c3c" : cardStyle.border,
          opacity: b.status === "cancelled" ? 0.65 : 1,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff" }}>{b.client_name}</div>
                {b.source === "website" && (
                  <span style={{ background: "rgba(90,160,255,0.12)", color: "#5aa0ff", padding: "2px 8px", borderRadius: 8, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>website</span>
                )}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{b.client_email} {b.client_phone ? `· ${b.client_phone}` : ""}</div>
            </div>
            <span style={{
              background: `${statusColors[b.status] || "#888"}22`,
              color: statusColors[b.status] || "#888",
              padding: "4px 12px", borderRadius: 12,
              fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
              textDecoration: b.status === "cancelled" ? "line-through" : "none",
            }}>{b.status?.replace("_", " ") || "pending"}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={labelSt}>Property</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{b.address}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{b.city}, {b.state} {b.zip}</div>
            </div>
            <div>
              <div style={labelSt}>Schedule</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{b.booking_date}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{b.booking_time}</div>
            </div>
            <div>
              <div style={labelSt}>Total</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", fontWeight: 700 }}>${Number(b.subtotal || 0).toLocaleString()}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={labelSt}>
              {b.booking_mode === "package" ? `${b.selected_package} package` : `${(b.selected_services || []).length} services`}
              {" · "}{b.sqft_tier?.replace("_", "-").replace("under", "<").replace("over", ">")} sf
            </div>
          </div>

          {/* Action buttons */}
          {b.status !== "cancelled" && b.status !== "completed" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => setEditingBooking({ ...b })} style={{
                ...btnBase,
                background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c",
              }}>Edit</button>
              {isAdmin && b.status === "confirmed" && (
                <button onClick={() => updateStatus(b.id, "in_progress")} style={{
                  ...btnBase,
                  background: "rgba(78,205,196,0.15)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
                }}>Start</button>
              )}
              {isAdmin && b.status === "in_progress" && (
                <button onClick={() => updateStatus(b.id, "completed")} style={{
                  ...btnBase,
                  background: "rgba(39,174,96,0.15)", border: "1px solid rgba(39,174,96,0.3)", color: "#27ae60",
                }}>Mark Complete</button>
              )}
              {cancelConfirm === b.id ? (
                <>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e74c3c", padding: "6px 0", alignSelf: "center" }}>Are you sure?</span>
                  <button onClick={() => updateStatus(b.id, "cancelled")} style={{
                    ...btnBase,
                    background: "rgba(231,76,60,0.2)", border: "1px solid rgba(231,76,60,0.4)", color: "#e74c3c",
                  }}>Yes, Cancel</button>
                  <button onClick={() => setCancelConfirm(null)} style={{
                    ...btnBase,
                    background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)",
                  }}>No</button>
                </>
              ) : (
                <button onClick={() => setCancelConfirm(b.id)} style={{
                  ...btnBase,
                  background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.2)", color: "#e74c3c",
                }}>Cancel Booking</button>
              )}
              {/* Admin: Upload Media button */}
              {isAdmin && (
                <button onClick={() => openMediaModal(b)} style={{
                  ...btnBase,
                  background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.3)", color: "#9b59b6",
                }}>Upload Media</button>
              )}
            </div>
          )}

          {/* Media button row — always visible (even for completed/cancelled bookings) */}
          {b.status === "completed" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {isAdmin && (
                <button onClick={() => openMediaModal(b)} style={{
                  ...btnBase,
                  background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.3)", color: "#9b59b6",
                }}>Upload Media</button>
              )}
            </div>
          )}

          {/* Agent: Download Media button */}
          {!isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              {b.invoice_paid ? (
                <button onClick={() => openMediaModal(b)} style={{
                  ...btnBase,
                  background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
                  border: "none", color: "#0a1628", fontWeight: 600,
                }}>Download Media</button>
              ) : (
                <>
                  <button onClick={() => openMediaModal(b)} style={{
                    ...btnBase,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)",
                  }}>View Media</button>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(231,76,60,0.7)" }}>
                    🔒 Invoice payment required
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ADMIN VIEW — Property Creation & Management
// ============================================================
function AdminView() {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  const [formData, setFormData] = useState({
    address: "",
    city: "Dallas, TX",
    price: "",
    beds: "",
    baths: "",
    sqft: "",
    package: "Signature",
    status: "In Production",
    agent_id: "",
    description: "",
    hero_img: "",
    matterport_url: "",
    youtube_url: "",
  });

  const [selectedListing, setSelectedListing] = useState(null);
  const [mediaFiles, setMediaFiles] = useState({});
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [micrositeRequests, setMicrositeRequests] = useState([]);

  const fetchMicrositeRequests = async () => {
    const { data: reqs } = await supabase
      .from("microsite_requests")
      .select("*, listings(address, city, package), agents:agent_id(full_name)")
      .order("created_at", { ascending: false });
    if (reqs) setMicrositeRequests(reqs);
  };

  const handleApproveAddon = async (requestId, listingId) => {
    // Approve the request
    await supabase.from("microsite_requests").update({
      status: "approved", resolved_at: new Date().toISOString(), resolved_by: user?.id,
    }).eq("id", requestId);
    // Enable microsite_addon on the listing
    await supabase.from("listings").update({ microsite_addon: true }).eq("id", listingId);
    fetchMicrositeRequests();
    fetchListingsAndAgents();
  };

  const handleDenyAddon = async (requestId) => {
    await supabase.from("microsite_requests").update({
      status: "denied", resolved_at: new Date().toISOString(), resolved_by: user?.id,
    }).eq("id", requestId);
    fetchMicrositeRequests();
  };

  // Fetch listings and agents on mount
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    fetchListingsAndAgents();
    fetchMicrositeRequests();
  }, []);

  const fetchListingsAndAgents = async () => {
    setLoading(true);
    try {
      // Fetch agents
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, full_name")
        .order("full_name");
      if (agentsError) throw agentsError;
      setAgents(agentsData || []);

      // Fetch listings with agent info
      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*, agents(full_name)")
        .order("created_at", { ascending: false });
      if (listingsError) throw listingsError;
      setListings(listingsData || []);
    } catch (err) {
      setErrorMessage(`Error loading data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const uploadFile = async (listingId, category, file) => {
    const filePath = `${listingId}/${category}/${file.name}`;
    try {
      const { data, error } = await supabase.storage
        .from('listing-media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('listing-media')
        .getPublicUrl(filePath);
      return publicUrl;
    } catch (err) {
      throw new Error(`Upload failed: ${err.message}`);
    }
  };

  const listFiles = async (listingId, category) => {
    try {
      const { data, error } = await supabase.storage
        .from('listing-media')
        .list(`${listingId}/${category}/`, {
          limit: 100,
          sortBy: { column: 'name', order: 'asc' },
        });
      if (error) throw error;
      return data || [];
    } catch (err) {
      throw new Error(`List files failed: ${err.message}`);
    }
  };

  const deleteFile = async (listingId, category, fileName) => {
    try {
      const { error } = await supabase.storage
        .from('listing-media')
        .remove([`${listingId}/${category}/${fileName}`]);
      if (error) throw error;
    } catch (err) {
      throw new Error(`Delete failed: ${err.message}`);
    }
  };

  const loadMediaFiles = async (listingId) => {
    setMediaLoading(true);
    try {
      const photos = await listFiles(listingId, 'photos');
      const video = await listFiles(listingId, 'video');
      const floorplan = await listFiles(listingId, 'floorplan');
      setMediaFiles(prev => ({
        ...prev,
        [listingId]: { photos, video, floorplan },
      }));
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setMediaLoading(false);
    }
  };

  const handleMediaUpload = async (listingId, category, files) => {
    setUploadProgress(prev => ({ ...prev, [listingId]: 'uploading' }));
    try {
      for (const file of files) {
        await uploadFile(listingId, category, file);
      }
      await loadMediaFiles(listingId);
      setUploadProgress(prev => ({ ...prev, [listingId]: 'done' }));
      setTimeout(() => setUploadProgress(prev => ({ ...prev, [listingId]: null })), 2000);
    } catch (err) {
      setErrorMessage(err.message);
      setUploadProgress(prev => ({ ...prev, [listingId]: null }));
    }
  };

  const handleMediaDelete = async (listingId, category, fileName) => {
    try {
      await deleteFile(listingId, category, fileName);
      await loadMediaFiles(listingId);
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // Validate required fields
      if (!formData.address || !formData.price || !formData.beds || !formData.baths || !formData.sqft || !formData.agent_id) {
        throw new Error("Please fill in all required fields");
      }

      const { data, error } = await supabase
        .from("listings")
        .insert([
          {
            address: formData.address,
            city: formData.city,
            price: formData.price,
            beds: parseInt(formData.beds),
            baths: parseFloat(formData.baths),
            sqft: formData.sqft,
            package: formData.package,
            status: formData.status,
            agent_id: formData.agent_id,
            description: formData.description || null,
            hero_img: formData.hero_img || null,
            matterport_url: formData.matterport_url || null,
            youtube_url: formData.youtube_url || null,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (error) throw error;

      setSuccessMessage("Listing created successfully!");
      setFormData({
        address: "",
        city: "Dallas, TX",
        price: "",
        beds: "",
        baths: "",
        sqft: "",
        package: "Signature",
        status: "In Production",
        agent_id: "",
        description: "",
        hero_img: "",
        matterport_url: "",
        youtube_url: "",
      });

      // Refresh listings
      await fetchListingsAndAgents();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setErrorMessage(err.message || "Error creating listing");
    } finally {
      setSubmitting(false);
    }
  };

  const formInputStyle = {
    width: "100%",
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "12px 16px",
    color: "#F0EDE8",
    fontFamily: "'Jost', sans-serif",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  const formFieldContainer = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const labelStyle = {
    fontFamily: "'Jost', sans-serif",
    fontSize: 12,
    color: "#F0EDE8",
    fontWeight: 500,
  };

  const cardStyle = {
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 24,
    marginBottom: 16,
  };

  const pendingRequests = micrositeRequests.filter(r => r.status === "pending");

  const MicrositeRequestsSection = () => (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#c9a84c", marginBottom: 16 }}>
        Microsite Add-on Requests
        {pendingRequests.length > 0 && (
          <span style={{
            display: "inline-block", marginLeft: 10, padding: "2px 10px",
            borderRadius: 12, fontSize: 11, fontFamily: "'Jost', sans-serif",
            fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171",
            verticalAlign: "middle",
          }}>{pendingRequests.length} pending</span>
        )}
      </div>
      {micrositeRequests.length === 0 ? (
        <div style={{ color: "#8A8680", fontSize: 13, fontFamily: "'Jost', sans-serif", padding: "16px 0" }}>
          No microsite add-on requests yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {micrositeRequests.map(req => (
            <div key={req.id} style={{
              background: "#111827", border: `1px solid ${req.status === "pending" ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 12, padding: "14px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F0EDE8", fontWeight: 500 }}>
                  {req.listings?.address || "Unknown"} — {req.listings?.city || ""}
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#8A8680", marginTop: 2 }}>
                  Agent: {req.agents?.full_name || "Unknown"} · Package: {req.listings?.package || "—"} · {new Date(req.created_at).toLocaleDateString()}
                </div>
              </div>
              {req.status === "pending" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleApproveAddon(req.id, req.listing_id)} style={{
                    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: "rgba(74,222,128,0.15)", color: "#4ade80",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                  }}>Approve</button>
                  <button onClick={() => handleDenyAddon(req.id)} style={{
                    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: "rgba(239,68,68,0.1)", color: "#f87171",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                  }}>Deny</button>
                </div>
              ) : (
                <span style={{
                  padding: "4px 12px", borderRadius: 8, fontSize: 10, fontWeight: 600,
                  fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em", textTransform: "uppercase",
                  background: req.status === "approved" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)",
                  color: req.status === "approved" ? "#4ade80" : "#f87171",
                }}>{req.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Desktop layout: two columns
  if (isDesktop) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40 }}>
        {/* LEFT: Requests + Listings */}
        <div>
          <MicrositeRequestsSection />

          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#c9a84c", marginBottom: 24 }}>
            Existing Listings
          </div>

          {loading ? (
            <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
              Loading listings...
            </div>
          ) : listings.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
              No listings yet. Create one using the form on the right.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {listings.map((listing) => (
                <div
                  key={listing.id}
                  style={{
                    ...cardStyle,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Address</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#F0EDE8", fontWeight: 600 }}>
                      {listing.address}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8680", marginTop: 2 }}>{listing.city}</div>
                  </div>

                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Package</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: "rgba(201,168,76,0.1)",
                        color: "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                      }}
                    >
                      {listing.package}
                    </div>
                  </div>

                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Status</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: listing.status === "Live" ? "rgba(34,197,94,0.1)" : listing.status === "Archived" ? "rgba(107,114,128,0.1)" : "rgba(59,130,246,0.1)",
                        color: listing.status === "Live" ? "#22c55e" : listing.status === "Archived" ? "#6b7280" : "#3b82f6",
                        border: listing.status === "Live" ? "1px solid rgba(34,197,94,0.3)" : listing.status === "Archived" ? "1px solid rgba(107,114,128,0.3)" : "1px solid rgba(59,130,246,0.3)",
                      }}
                    >
                      {listing.status}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Agent</div>
                      <div style={{ fontSize: 12, color: "#F0EDE8" }}>
                        {listing.agents?.full_name || "Unassigned"}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedListing(selectedListing === listing.id ? null : listing.id);
                        if (selectedListing !== listing.id) {
                          loadMediaFiles(listing.id);
                        }
                      }}
                      style={{
                        background: selectedListing === listing.id ? "#c9a84c" : "rgba(201,168,76,0.1)",
                        color: selectedListing === listing.id ? "#0a0a0a" : "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "'Jost', sans-serif",
                        transition: "all 0.2s",
                      }}
                    >
                      {selectedListing === listing.id ? "Hide Media" : "Manage Media"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Media Management Panel */}
          {selectedListing && (
            <div style={{
              ...cardStyle,
              marginTop: 24,
              background: "rgba(201,168,76,0.05)",
              border: "2px solid rgba(201,168,76,0.2)",
            }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c", marginBottom: 20 }}>
                Media Management
              </div>

              {mediaLoading ? (
                <div style={{ color: "#8A8680", textAlign: "center", padding: "20px" }}>
                  Loading media files...
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* Photos Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      📷 Photos
                    </label>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                        if (files.length > 0) handleMediaUpload(selectedListing, 'photos', files);
                      }}
                      style={{
                        border: "2px dashed rgba(201,168,76,0.3)",
                        borderRadius: 8,
                        padding: 20,
                        textAlign: "center",
                        cursor: "pointer",
                        marginBottom: 12,
                        transition: "border-color 0.2s",
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={(e) => handleMediaUpload(selectedListing, 'photos', Array.from(e.target.files))}
                        style={{ display: "none" }}
                        id={`photos-input-${selectedListing}`}
                      />
                      <label
                        htmlFor={`photos-input-${selectedListing}`}
                        style={{ cursor: "pointer", color: "#F0EDE8", fontSize: 12 }}
                      >
                        Click to upload photos or drag and drop
                      </label>
                    </div>
                    {mediaFiles[selectedListing]?.photos?.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 8 }}>
                        {mediaFiles[selectedListing].photos.map((file) => (
                          <div key={file.name} style={{ position: "relative", aspectRatio: "1" }}>
                            <img
                              src={supabase.storage.from('listing-media').getPublicUrl(`${selectedListing}/photos/${file.name}`).data.publicUrl}
                              alt={file.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }}
                            />
                            <button
                              onClick={() => handleMediaDelete(selectedListing, 'photos', file.name)}
                              style={{
                                position: "absolute",
                                top: -8,
                                right: -8,
                                width: 24,
                                height: 24,
                                background: "#f87171",
                                color: "#fff",
                                border: "none",
                                borderRadius: "50%",
                                cursor: "pointer",
                                fontSize: 14,
                                fontWeight: "bold",
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Video Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      🎬 Video File
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        if (e.target.files.length > 0) {
                          handleMediaUpload(selectedListing, 'video', Array.from(e.target.files));
                        }
                      }}
                      style={formInputStyle}
                    />
                    {mediaFiles[selectedListing]?.video?.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: "#F0EDE8" }}>
                        <div>Uploaded: {mediaFiles[selectedListing].video[0].name}</div>
                        <button
                          onClick={() => handleMediaDelete(selectedListing, 'video', mediaFiles[selectedListing].video[0].name)}
                          style={{
                            marginTop: 8,
                            background: "#f87171",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Floorplan Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      📐 Floorplan
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files.length > 0) {
                          handleMediaUpload(selectedListing, 'floorplan', Array.from(e.target.files));
                        }
                      }}
                      style={formInputStyle}
                    />
                    {mediaFiles[selectedListing]?.floorplan?.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: "#F0EDE8" }}>
                        <div>Uploaded: {mediaFiles[selectedListing].floorplan[0].name}</div>
                        <button
                          onClick={() => handleMediaDelete(selectedListing, 'floorplan', mediaFiles[selectedListing].floorplan[0].name)}
                          style={{
                            marginTop: 8,
                            background: "#f87171",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {uploadProgress[selectedListing] === 'uploading' && (
                <div style={{ marginTop: 12, color: "#c9a84c", fontSize: 12 }}>
                  Uploading...
                </div>
              )}
              {uploadProgress[selectedListing] === 'done' && (
                <div style={{ marginTop: 12, color: "#22c55e", fontSize: 12 }}>
                  Upload complete!
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Create Form (sticky) */}
        <div style={{ position: "sticky", top: 100, height: "fit-content" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
            Create New Listing
          </div>

          {successMessage && (
            <div style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: "#22c55e",
              fontFamily: "'Jost', sans-serif",
            }}>
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div style={{
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: "#f87171",
              fontFamily: "'Jost', sans-serif",
            }}>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Address */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Address *</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange("address", e.target.value)}
                placeholder="e.g., 2410 Prosperity Dr"
                style={formInputStyle}
              />
            </div>

            {/* City */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>City *</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleInputChange("city", e.target.value)}
                placeholder="Dallas, TX"
                style={formInputStyle}
              />
            </div>

            {/* Price */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Price *</label>
              <input
                type="text"
                value={formData.price}
                onChange={(e) => handleInputChange("price", e.target.value)}
                placeholder="$725,000"
                style={formInputStyle}
              />
            </div>

            {/* Beds & Baths */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={formFieldContainer}>
                <label style={labelStyle}>Beds *</label>
                <input
                  type="number"
                  value={formData.beds}
                  onChange={(e) => handleInputChange("beds", e.target.value)}
                  placeholder="4"
                  style={formInputStyle}
                />
              </div>
              <div style={formFieldContainer}>
                <label style={labelStyle}>Baths *</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.baths}
                  onChange={(e) => handleInputChange("baths", e.target.value)}
                  placeholder="3.5"
                  style={formInputStyle}
                />
              </div>
            </div>

            {/* Sqft */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Sqft *</label>
              <input
                type="text"
                value={formData.sqft}
                onChange={(e) => handleInputChange("sqft", e.target.value)}
                placeholder="3,840"
                style={formInputStyle}
              />
            </div>

            {/* Package */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Package *</label>
              <select
                value={formData.package}
                onChange={(e) => handleInputChange("package", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="Essential">Essential</option>
                <option value="Signature">Signature</option>
                <option value="Luxury">Luxury</option>
              </select>
            </div>

            {/* Status */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Status *</label>
              <select
                value={formData.status}
                onChange={(e) => handleInputChange("status", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="In Production">In Production</option>
                <option value="Delivered">Delivered</option>
                <option value="Live">Live</option>
                <option value="Archived">Archived</option>
              </select>
            </div>

            {/* Agent */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Agent *</label>
              <select
                value={formData.agent_id}
                onChange={(e) => handleInputChange("agent_id", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="">Select an agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                placeholder="Optional description..."
                style={{
                  ...formInputStyle,
                  minHeight: 80,
                  resize: "vertical",
                  fontFamily: "'Jost', sans-serif",
                }}
              />
            </div>

            {/* Hero Image URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Hero Image URL</label>
              <input
                type="text"
                value={formData.hero_img}
                onChange={(e) => handleInputChange("hero_img", e.target.value)}
                placeholder="https://..."
                style={formInputStyle}
              />
            </div>

            {/* Matterport URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Matterport URL</label>
              <input
                type="text"
                value={formData.matterport_url}
                onChange={(e) => handleInputChange("matterport_url", e.target.value)}
                placeholder="https://my.matterport.com/..."
                style={formInputStyle}
              />
            </div>

            {/* YouTube URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>YouTube URL</label>
              <input
                type="text"
                value={formData.youtube_url}
                onChange={(e) => handleInputChange("youtube_url", e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                style={formInputStyle}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                background: submitting ? "rgba(201,168,76,0.5)" : "#c9a84c",
                color: "#0a0a0a",
                border: "none",
                padding: 14,
                borderRadius: 8,
                fontFamily: "'Jost', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: submitting ? "not-allowed" : "pointer",
                transition: "background 0.3s",
                marginTop: 8,
              }}
            >
              {submitting ? "Creating..." : "Create Listing"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mobile layout: stacked
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <MicrositeRequestsSection />

      {/* Form */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
          Create New Listing
        </div>

        {successMessage && (
          <div style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: "#22c55e",
            fontFamily: "'Jost', sans-serif",
          }}>
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div style={{
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: "#f87171",
            fontFamily: "'Jost', sans-serif",
          }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Address */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Address *</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleInputChange("address", e.target.value)}
              placeholder="e.g., 2410 Prosperity Dr"
              style={formInputStyle}
            />
          </div>

          {/* City */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>City *</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => handleInputChange("city", e.target.value)}
              placeholder="Dallas, TX"
              style={formInputStyle}
            />
          </div>

          {/* Price */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Price *</label>
            <input
              type="text"
              value={formData.price}
              onChange={(e) => handleInputChange("price", e.target.value)}
              placeholder="$725,000"
              style={formInputStyle}
            />
          </div>

          {/* Beds & Baths */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={formFieldContainer}>
              <label style={labelStyle}>Beds *</label>
              <input
                type="number"
                value={formData.beds}
                onChange={(e) => handleInputChange("beds", e.target.value)}
                placeholder="4"
                style={formInputStyle}
              />
            </div>
            <div style={formFieldContainer}>
              <label style={labelStyle}>Baths *</label>
              <input
                type="number"
                step="0.5"
                value={formData.baths}
                onChange={(e) => handleInputChange("baths", e.target.value)}
                placeholder="3.5"
                style={formInputStyle}
              />
            </div>
          </div>

          {/* Sqft */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Sqft *</label>
            <input
              type="text"
              value={formData.sqft}
              onChange={(e) => handleInputChange("sqft", e.target.value)}
              placeholder="3,840"
              style={formInputStyle}
            />
          </div>

          {/* Package */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Package *</label>
            <select
              value={formData.package}
              onChange={(e) => handleInputChange("package", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="Essential">Essential</option>
              <option value="Signature">Signature</option>
              <option value="Luxury">Luxury</option>
            </select>
          </div>

          {/* Status */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Status *</label>
            <select
              value={formData.status}
              onChange={(e) => handleInputChange("status", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="In Production">In Production</option>
              <option value="Delivered">Delivered</option>
              <option value="Live">Live</option>
              <option value="Archived">Archived</option>
            </select>
          </div>

          {/* Agent */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Agent *</label>
            <select
              value={formData.agent_id}
              onChange={(e) => handleInputChange("agent_id", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="">Select an agent...</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange("description", e.target.value)}
              placeholder="Optional description..."
              style={{
                ...formInputStyle,
                minHeight: 80,
                resize: "vertical",
                fontFamily: "'Jost', sans-serif",
              }}
            />
          </div>

          {/* Hero Image URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Hero Image URL</label>
            <input
              type="text"
              value={formData.hero_img}
              onChange={(e) => handleInputChange("hero_img", e.target.value)}
              placeholder="https://..."
              style={formInputStyle}
            />
          </div>

          {/* Matterport URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Matterport URL</label>
            <input
              type="text"
              value={formData.matterport_url}
              onChange={(e) => handleInputChange("matterport_url", e.target.value)}
              placeholder="https://my.matterport.com/..."
              style={formInputStyle}
            />
          </div>

          {/* YouTube URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>YouTube URL</label>
            <input
              type="text"
              value={formData.youtube_url}
              onChange={(e) => handleInputChange("youtube_url", e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              style={formInputStyle}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              background: submitting ? "rgba(201,168,76,0.5)" : "#c9a84c",
              color: "#0a0a0a",
              border: "none",
              padding: 14,
              borderRadius: 8,
              fontFamily: "'Jost', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: submitting ? "not-allowed" : "pointer",
              transition: "background 0.3s",
              marginTop: 8,
            }}
          >
            {submitting ? "Creating..." : "Create Listing"}
          </button>
        </form>
      </div>

      {/* Listings */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
          Existing Listings
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
            Loading listings...
          </div>
        ) : listings.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
            No listings yet. Create one using the form above.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {listings.map((listing) => (
              <div key={listing.id} style={cardStyle}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, color: "#F0EDE8", fontWeight: 600, marginBottom: 12 }}>
                  {listing.address}
                </div>
                <div style={{ fontSize: 12, color: "#8A8680", marginBottom: 12 }}>
                  {listing.city}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Package</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "rgba(201,168,76,0.1)",
                        color: "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                      }}
                    >
                      {listing.package}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Status</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: listing.status === "Live" ? "rgba(34,197,94,0.1)" : listing.status === "Archived" ? "rgba(107,114,128,0.1)" : "rgba(59,130,246,0.1)",
                        color: listing.status === "Live" ? "#22c55e" : listing.status === "Archived" ? "#6b7280" : "#3b82f6",
                        border: listing.status === "Live" ? "1px solid rgba(34,197,94,0.3)" : listing.status === "Archived" ? "1px solid rgba(107,114,128,0.3)" : "1px solid rgba(59,130,246,0.3)",
                      }}
                    >
                      {listing.status}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Agent</div>
                  <div style={{ fontSize: 12, color: "#F0EDE8" }}>
                    {listing.agents?.full_name || "Unassigned"}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedListing(selectedListing === listing.id ? null : listing.id);
                    if (selectedListing !== listing.id) {
                      loadMediaFiles(listing.id);
                    }
                  }}
                  style={{
                    width: "100%",
                    background: selectedListing === listing.id ? "#c9a84c" : "rgba(201,168,76,0.1)",
                    color: selectedListing === listing.id ? "#0a0a0a" : "#c9a84c",
                    border: "1px solid rgba(201,168,76,0.3)",
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "'Jost', sans-serif",
                    transition: "all 0.2s",
                    marginTop: 8,
                  }}
                >
                  {selectedListing === listing.id ? "Hide Media" : "Manage Media"}
                </button>

                {/* Mobile Media Management Panel */}
                {selectedListing === listing.id && (
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(201,168,76,0.2)",
                  }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#c9a84c", marginBottom: 12 }}>
                      Media Management
                    </div>

                    {mediaLoading ? (
                      <div style={{ color: "#8A8680", textAlign: "center", padding: "20px 0" }}>
                        Loading media files...
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {/* Photos */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            📷 Photos
                          </label>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(e) => handleMediaUpload(selectedListing, 'photos', Array.from(e.target.files))}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.photos?.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(50px, 1fr))", gap: 6, marginTop: 8 }}>
                              {mediaFiles[selectedListing].photos.map((file) => (
                                <div key={file.name} style={{ position: "relative", aspectRatio: "1" }}>
                                  <img
                                    src={supabase.storage.from('listing-media').getPublicUrl(`${selectedListing}/photos/${file.name}`).data.publicUrl}
                                    alt={file.name}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }}
                                  />
                                  <button
                                    onClick={() => handleMediaDelete(selectedListing, 'photos', file.name)}
                                    style={{
                                      position: "absolute",
                                      top: -6,
                                      right: -6,
                                      width: 20,
                                      height: 20,
                                      background: "#f87171",
                                      color: "#fff",
                                      border: "none",
                                      borderRadius: "50%",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: "bold",
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Video */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            🎬 Video
                          </label>
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => {
                              if (e.target.files.length > 0) {
                                handleMediaUpload(selectedListing, 'video', Array.from(e.target.files));
                              }
                            }}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.video?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#F0EDE8" }}>
                              <div>{mediaFiles[selectedListing].video[0].name}</div>
                              <button
                                onClick={() => handleMediaDelete(selectedListing, 'video', mediaFiles[selectedListing].video[0].name)}
                                style={{
                                  marginTop: 6,
                                  background: "#f87171",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontSize: 10,
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Floorplan */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            📐 Floorplan
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              if (e.target.files.length > 0) {
                                handleMediaUpload(selectedListing, 'floorplan', Array.from(e.target.files));
                              }
                            }}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.floorplan?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#F0EDE8" }}>
                              <div>{mediaFiles[selectedListing].floorplan[0].name}</div>
                              <button
                                onClick={() => handleMediaDelete(selectedListing, 'floorplan', mediaFiles[selectedListing].floorplan[0].name)}
                                style={{
                                  marginTop: 6,
                                  background: "#f87171",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontSize: 10,
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {uploadProgress[selectedListing] === 'uploading' && (
                      <div style={{ marginTop: 8, color: "#c9a84c", fontSize: 11 }}>
                        Uploading...
                      </div>
                    )}
                    {uploadProgress[selectedListing] === 'done' && (
                      <div style={{ marginTop: 8, color: "#22c55e", fontSize: 11 }}>
                        Upload complete!
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP SHELL (responsive: desktop sidebar + mobile bottom nav)
// ============================================================
function AppShell() {
  const { user, profile, signOut } = useAuth();
  const [tab, setTab] = useState(0);
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

  const baseViews = [
    <ShowcaseView onBook={handleBook} />,
    <BookView />,
    <MediaView />,
    <AnalyticsView />,
    <MicrositeView />,
  ];
  const views = isAdmin
    ? [...baseViews, <BookingsManagerView />, <AdminView />]
    : [...baseViews, <BookingsManagerView />];

  const ProfileDropdown = showProfile && (
    <div style={{
      position: "absolute", top: 44, right: 0, width: 220,
      background: "#161616", border: "1px solid #2A2A2A",
      borderRadius: 12, padding: 16, zIndex: 50,
      boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,168,76,0.08)",
    }}>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F0EDE8", fontWeight: 500 }}>
        {profile?.full_name || "Agent"}
      </div>
      <div style={{ fontSize: 11, color: "#8A8680", marginTop: 2, wordBreak: "break-all" }}>
        {user?.email}
      </div>
      {profile?.role === "admin" && (
        <span style={{
          display: "inline-block", marginTop: 6, padding: "2px 8px",
          borderRadius: 4, fontSize: 9, letterSpacing: "0.1em",
          textTransform: "uppercase", fontWeight: 600,
          background: "rgba(201,168,76,0.15)", color: "#c9a84c",
          border: "1px solid rgba(201,168,76,0.3)",
        }}>Admin</span>
      )}
      <div style={{ height: 1, background: "#2A2A2A", margin: "12px 0" }} />
      <button onClick={signOut} style={{
        width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
        background: "rgba(239,68,68,0.1)", color: "#f87171",
        fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer",
        fontWeight: 500, letterSpacing: "0.04em",
      }}>Sign Out</button>
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
            {views[tab]}
          </div>
        </div>
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
          {views[tab]}
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
