// Shared microsite renderer used by both the public /p/:slug page and
// the in-app preview. Lifted from App.jsx's PublicMicrosite (which is
// now a thin fetch-wrapper) so the agent's editor preview shows the
// exact layout, theme, and structure that will be published — including
// Prestige's dedicated cinematic render path that the previous
// MicrositePreview (in src/views/Microsite/index.jsx) didn't have.
//
// Contract:
//   <MicrositeRenderer
//     microsite      canonical property_data shape (snake_case)
//     theme          theme NAME string from THEMES catalog (e.g. "Prestige")
//     agentBranding  agents-table row (full_name, agency_name, agency_logo_url,
//                    profile_photo_url) — may be null; renders graceful fallbacks
//     mode           "live" | "preview" — only branches the lead form
//     micrositeId    required when mode === "live" (lead form needs it)
//     listingId      required when mode === "live"
//   />
//
// No fetches, no slug parsing, no analytics. Pure render. Caller owns
// loading/error states. PublicMicrosite wraps with the fetch effect;
// MicrositeView passes form state through a transform function.

import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { THEMES, THEME_LAYOUT } from "../lib/ui";
import MicrositeChat from "./MicrositeChat";

// ============================================================
// LEAD CAPTURE — live vs preview variants
// ============================================================

/**
 * Live lead capture form. Inserts a row into public.leads on submit.
 * Lifted verbatim from App.jsx so MicrositeRenderer is self-contained
 * (avoids a circular import).
 */
export function PublicLeadCaptureForm({ theme: t, micrositeId, listingId }) {
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
          source: "contact_form",
          name: form.name,
          email: form.email,
          phone: form.phone,
          message: form.message,
          tour_type: form.tourType,
        });

      if (!error) { setSubmitting(false); setSubmitted(true); }
      else { setSubmitting(false); setErrors({ submit: "Failed to submit. Please try again." }); }
    } catch (err) {
      setSubmitting(false);
      setErrors({ submit: "An error occurred. Please try again." });
    }
  };

  return <LeadFormBody t={t} form={form} setField={setField} errors={errors} submitted={submitted} submitting={submitting} onSubmit={handleSubmit} />;
}

/**
 * Preview lead capture form. Identical UI to the public form, but
 * onSubmit only flashes a transient "(preview — no lead created)"
 * confirmation. Never touches the leads table. Prevents agents from
 * creating fake leads against their own preview.
 */
function PreviewLeadCaptureForm({ theme: t }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", tourType: "in-person" });
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: "" })); };

  const handleSubmit = async () => {
    const e = {};
    if (!form.name.trim())  e.name  = "Required";
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = "Valid email required";
    if (!form.phone.trim()) e.phone = "Required";
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={{ padding: "40px 16px", borderTop: `1px solid ${t.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>👀</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: t.accent, marginBottom: 8 }}>
          Preview mode — no lead saved
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: t.sub, lineHeight: 1.6 }}>
          When this microsite is published, real visitor submissions go to your leads inbox.
        </div>
      </div>
    );
  }
  return <LeadFormBody t={t} form={form} setField={setField} errors={errors} submitted={false} submitting={false} onSubmit={handleSubmit} previewBanner />;
}

/** Shared form layout used by both live + preview variants. */
function LeadFormBody({ t, form, setField, errors, submitted, submitting, onSubmit, previewBanner = false }) {
  const fi = (key, placeholder, type = "text") => ({
    value: form[key],
    onChange: e => setField(key, e.target.value),
    placeholder, type,
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
        {previewBanner && (
          <div style={{
            background: `${t.accent}18`, color: t.accent, borderRadius: 6, padding: "8px 12px",
            fontFamily: "'Jost', sans-serif", fontSize: 11, marginBottom: 14, textAlign: "center",
            letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600,
          }}>
            Preview — submissions won't be saved
          </div>
        )}
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: t.text, marginBottom: 8 }}>
          Request Information
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: t.sub, marginBottom: 20 }}>
          Get in touch with the listing agent today
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 18, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
          {[{ val: "in-person", label: "🏠 In-Person" }, { val: "virtual", label: "🎥 Virtual" }, { val: "offer", label: "✍️ Offer" }].map((opt, i, arr) => (
            <div
              key={opt.val}
              onClick={() => setField("tourType", opt.val)}
              style={{
                flex: 1, padding: "10px 8px", textAlign: "center", cursor: "pointer",
                background: form.tourType === opt.val ? `${t.accent}22` : "transparent",
                borderRight: i === arr.length - 1 ? "none" : `1px solid ${t.border}`,
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

        <button onClick={onSubmit} disabled={submitting} style={{
          width: "100%", background: submitting ? `${t.accent}66` : t.accent, color: t.bg,
          border: "none", padding: "14px", borderRadius: 8,
          fontFamily: "'Jost', sans-serif", fontSize: 13, fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase", cursor: submitting ? "not-allowed" : "pointer",
          transition: "background 0.3s",
        }}>
          {submitting ? "Sending..." : "Send Inquiry"}
        </button>
      </div>
    </div>
  );
}

// Pick the right lead form per mode. micrositeId/listingId only used live.
function LeadCapture({ mode, theme, micrositeId, listingId }) {
  return mode === "preview"
    ? <PreviewLeadCaptureForm theme={theme} />
    : <PublicLeadCaptureForm theme={theme} micrositeId={micrositeId} listingId={listingId} />;
}

// ============================================================
// MICROSITE RENDERER
// ============================================================

export default function MicrositeRenderer({ microsite, theme, agentBranding, mode = "live", micrositeId, listingId, micrositeSlug, brokerageName, sold = null }) {
  const data = microsite || {};
  // Visible location line: optional neighborhood before the city, so the
  // React-booted view matches the SSR body. Empty when both are absent.
  const locationLine = [data.neighborhood, data.city]
    .map((v) => (v || "").toString().trim())
    .filter(Boolean)
    .join(", ");
  const themeName = theme || "Obsidian";

  // Local UI state (no fetches — pure render)
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("photos");
  const [prestigeMediaTab, setPrestigeMediaTab] = useState(null);

  const photoRef     = useRef(null);
  const floorplanRef = useRef(null);
  const droneRef     = useRef(null);
  const tourRef      = useRef(null);
  const detailsRef   = useRef(null);
  const contactRef   = useRef(null);
  const mediaRef     = useRef(null);

  // Derived data
  const photos          = Array.isArray(data.gallery_photos) ? data.gallery_photos : [];
  const videoUrl        = data.video_url || "";
  const floorplanUrl    = data.floorplan_url || "";
  const hasFloorplan    = !!floorplanUrl;
  const hasVideo        = !!videoUrl;
  const hasTour         = !!data.matterport_url;
  const isPrestige      = themeName === "Prestige";
  const pubT            = THEMES.find(th => th.name === themeName) || THEMES[0];
  const isDarkTheme     = pubT.text === "#fff";
  const layout          = THEME_LAYOUT[themeName] || "cinematic";
  const galleryPhotos   = photos.length > 0 ? photos : (data.hero_img ? [data.hero_img] : []);
  const agentName       = data.agent_name || "";
  const agentPhone      = data.agent_phone || "";
  const finalVideo      = videoUrl;
  const finalFloorplan  = floorplanUrl;

  // Visitor-facing AI chat. Rendered in BOTH layout paths (Prestige
  // cinematic + shared) — Prestige returns its own JSX so this used
  // to be skipped on Prestige listings. Hoist into a shared element.
  const chatEl = (mode === "live" && micrositeSlug) ? (
    <MicrositeChat
      micrositeSlug={micrositeSlug}
      agentName={data.agent_name || agentBranding?.full_name}
      brokerageName={brokerageName || agentBranding?.agency_name}
      agentPhone={data.agent_phone}
      agentEmail={data.agent_email}
    />
  ) : null;

  // Nav sections — different sets for Prestige vs shared layout
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

  // ── Agent branding helper ───────────────────────────────────────────────
  // Returns the correct brand mark for nav/footer based on agent's profile:
  //   logo image → agency name text → Milestone Media fallback
  const brandMark = (accentColor = "#C9A84C", subColor = "rgba(255,255,255,0.35)") => {
    if (agentBranding?.agency_logo_url) {
      return <img src={agentBranding.agency_logo_url} alt={`${agentBranding.agency_name || "Agency"} logo`} decoding="async" style={{ height: 34, maxWidth: 160, objectFit: "contain" }} />;
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
  // Returns a profile photo <img> or initials-based fallback circle
  const agentAvatar = (size, accentColor, textColor) => {
    const name = agentBranding?.full_name || agentName || "Agent";
    const initials = name.split(" ").map(n => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "A";
    if (agentBranding?.profile_photo_url) {
      return <img src={agentBranding.profile_photo_url} alt={name} loading="lazy" decoding="async" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
    }
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: textColor,
      }}>{initials}</div>
    );
  };

  const navBg = isDarkTheme
    ? `rgba(${parseInt(pubT.bg.slice(1,3),16)},${parseInt(pubT.bg.slice(3,5),16)},${parseInt(pubT.bg.slice(5,7),16)},0.96)`
    : "rgba(255,255,255,0.97)";
  const photoSecBg  = isDarkTheme ? "#0f0f1a" : "#fafafa";
  const photoSecText = isDarkTheme ? "#fff" : "#0f0f1a";
  const darkSecBg   = isDarkTheme ? pubT.bg : "#f0ede6";
  const stickyNavBg = isDarkTheme ? (pubT.bg === "#0f0f1a" ? "#181826" : pubT.bg) : "#f5f2ed";
  const footerBg    = isDarkTheme ? pubT.bg : "#0f0f1a";

  const navLinkStyle = (sectionId) => ({
    fontFamily: "'Jost', sans-serif",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: activeSection === sectionId ? pubT.accent : "#888",
    cursor: "pointer",
    transition: "color 0.3s",
    paddingBottom: 6,
    borderBottom: activeSection === sectionId ? `2px solid ${pubT.accent}` : "2px solid transparent",
  });

  // ─────────────────────────────────────────────────────────────────
  // PRESTIGE LAYOUT — fixed hero background, prosperity-style design
  // ─────────────────────────────────────────────────────────────────
  if (isPrestige) {
    const mediaTabs = [
      ...(hasVideo     ? [{ id: "film",      label: "Cinematic Film" }] : []),
      ...(hasTour      ? [{ id: "tour",      label: "Virtual Tour"   }] : []),
      ...(hasFloorplan ? [{ id: "floorplan", label: "Floor Plan"     }] : []),
    ];
    const activeTab    = prestigeMediaTab || (mediaTabs[0]?.id ?? null);
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
                {locationLine || "Dallas, TX"}
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
              {activeTab === "floorplan" && finalFloorplan && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <img src={finalFloorplan} alt="Floorplan" loading="lazy" decoding="async" style={{ maxWidth: 900, width: "100%", aspectRatio: "3 / 2", objectFit: "contain", borderRadius: 8 }} />
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
          {presGallery.length > 0 && (
            <>
              <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none", marginBottom: 4 }}>
                <div className="ms-gallery-track-fwd" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
                  {[...presGallery, ...presGallery].map((photo, idx) => (
                    <div key={idx} onClick={() => { setLightboxIndex(idx % presGallery.length); setLightboxOpen(true); }}
                      style={{ height: 380, flexShrink: 0, overflow: "hidden" }}>
                      <img src={photo} alt={`${data.address || "Property"} photo`} loading="lazy" decoding="async" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ms-gallery-outer" style={{ overflow: "hidden", cursor: "pointer", userSelect: "none" }}>
                <div className="ms-gallery-track-rev" style={{ display: "flex", gap: 4, width: "max-content", willChange: "transform" }}>
                  {[...presGallery, ...presGallery].map((photo, idx) => (
                    <div key={idx} onClick={() => { setLightboxIndex(idx % presGallery.length); setLightboxOpen(true); }}
                      style={{ height: 280, flexShrink: 0, overflow: "hidden" }}>
                      <img src={photo} alt={`${data.address || "Property"} photo`} loading="lazy" decoding="async" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block", pointerEvents: "none" }} />
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
            </>
          )}
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
            <LeadCapture
              mode={mode}
              theme={{ bg: "rgba(255,255,255,0.04)", text: "#fff", sub: "rgba(255,255,255,0.5)", accent: "#C9A84C", border: "rgba(255,255,255,0.12)", card: "rgba(255,255,255,0.05)" }}
              micrositeId={micrositeId}
              listingId={listingId}
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
        {lightboxOpen && presGallery.length > 0 && (
          <div onClick={() => setLightboxOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={() => setLightboxOpen(false)} style={{ position: "absolute", top: 20, right: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer" }}>✕</button>
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => (p - 1 + presGallery.length) % presGallery.length); }} style={{ position: "absolute", left: 30, background: "none", border: "none", color: "#fff", fontSize: 48, cursor: "pointer" }}>‹</button>
            <img src={presGallery[lightboxIndex]} alt={`${data.address || "Property"} photo`} decoding="async" style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => (p + 1) % presGallery.length); }} style={{ position: "absolute", right: 30, background: "none", border: "none", color: "#fff", fontSize: 48, cursor: "pointer" }}>›</button>
            <div style={{ position: "absolute", bottom: 30, color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14 }}>{lightboxIndex + 1} / {presGallery.length}</div>
          </div>
        )}
        {chatEl}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // SHARED LAYOUT — split / minimal / editorial / cinematic
  // ─────────────────────────────────────────────────────────────────
  // SOLD treatment: when the microsite row carries sold_at, show a clear fixed
  // SOLD banner so the human-facing page matches the server-rendered sold page
  // (api/render-microsite.js) and a sold listing never reads as "live". Sale
  // price shown only when disclosed (sold.soldPrice), never the list price.
  const soldDateDisplay = sold?.soldAt ? String(sold.soldAt).slice(0, 10) : "";
  const soldPriceDisplay = sold?.soldPrice ? String(sold.soldPrice).trim().replace(/^\$/, "") : "";

  return (
    <div style={{ fontFamily: "'Cormorant Garamond', serif", overflow: "hidden" }}>
      {sold && (
        <div style={{
          position: "fixed", top: 60, left: 0, right: 0, zIndex: 999,
          background: "#7a1f1f", color: "#F5ECD7",
          fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.12em",
          textTransform: "uppercase", textAlign: "center", padding: "10px 16px",
          borderBottom: "1px solid #C9A84C",
        }}>
          <strong style={{ letterSpacing: "0.2em" }}>SOLD</strong>
          {soldDateDisplay ? ` · Sold ${soldDateDisplay}` : ""}
          {soldPriceDisplay ? ` · Sold for $${soldPriceDisplay}` : ""}
        </div>
      )}
      {/* Fixed Top Nav Bar */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
        background: navBg, backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${pubT.accent}33`,
        padding: "16px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
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
        <div style={{ display: "grid", gridTemplateColumns: "55fr 45fr", minHeight: "85vh", marginTop: 60 }}>
          <div style={{ position: "relative", overflow: "hidden" }}>
            <img src={data.hero_img || galleryPhotos[0] || ""} alt={`${data.address || "Property"} — exterior`}
              loading="eager" fetchpriority="high" decoding="async"
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
              {locationLine}
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
        <div style={{ position: "relative", height: "80vh", marginTop: 60, overflow: "hidden" }}>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt={`${data.address || "Property"} — exterior`}
            loading="eager" fetchpriority="high" decoding="async"
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: isDarkTheme ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.35)" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, padding: "0 40px" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: pubT.accent }}>
              {locationLine}
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
        <div style={{ position: "relative", height: "90vh", marginTop: 60, overflow: "hidden" }}>
          <style>{`@keyframes heroZoom { from { transform: scale(1); } to { transform: scale(1.06); } }`}</style>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt={`${data.address || "Property"} — exterior`}
            loading="eager" fetchpriority="high" decoding="async"
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
                {locationLine}
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
        <div style={{ position: "relative", height: "90vh", marginTop: 60, background: "#000", overflow: "hidden" }}>
          <img src={data.hero_img || galleryPhotos[0] || ""} alt={`${data.address || "Property"} — exterior`}
            loading="eager" fetchpriority="high" decoding="async"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 55%)" }} />
          <div style={{ position: "absolute", bottom: 48, left: 48 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: pubT.accent, marginBottom: 12 }}>
              {locationLine}
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
        position: "sticky", top: 60, zIndex: 100,
        background: stickyNavBg,
        borderBottom: `1px solid ${pubT.accent}33`,
        padding: "0 40px", display: "flex", gap: 40, overflowX: "auto",
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
              <img src={photo} alt={`${data.address || "Property"} photo`} loading="lazy" decoding="async" style={{ height: "100%", width: "auto", objectFit: "cover", display: "block" }} />
            </div>
          ))}
        </div>
        {galleryPhotos.length > 0 && (
          <div style={{ padding: "20px 40px 0", display: "flex", justifyContent: "flex-end", maxWidth: 1200, margin: "0 auto" }}>
            <button onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }} style={{
              background: "transparent", border: `1px solid ${pubT.accent}60`,
              color: pubT.accent, padding: "8px 20px", borderRadius: 6,
              fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: "pointer",
            }}>View All {galleryPhotos.length} Photos ↗</button>
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && galleryPhotos.length > 0 && (
        <div onClick={() => setLightboxOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)",
          zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <button onClick={() => setLightboxOpen(false)} style={{
            position: "absolute", top: 20, right: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer",
          }}>✕</button>
          <button onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => (prev - 1 + galleryPhotos.length) % galleryPhotos.length); }} style={{
            position: "absolute", left: 30, background: "none", border: "none", color: "#fff", fontSize: 36, cursor: "pointer",
          }}>‹</button>
          <img src={galleryPhotos[lightboxIndex]} alt={`${data.address || "Property"} photo`} decoding="async"
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }}
            onClick={(e) => e.stopPropagation()} />
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
              <img src={finalFloorplan} alt="Floorplan" loading="lazy" decoding="async"
                style={{ maxWidth: 900, width: "100%", aspectRatio: "3 / 2", objectFit: "contain", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }} />
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
              <iframe src={data.matterport_url} title="3D Tour"
                style={{ width: "100%", maxWidth: 960, height: 600, borderRadius: 8, border: "none" }} />
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginBottom: 60 }}>
            {[{ val: data.beds, label: "Bedrooms" }, { val: data.baths, label: "Bathrooms" }, { val: data.sqft, label: "Sq. Ft." }, { val: data.price, label: "Price" }].map(s => (
              <div key={s.label} style={{ background: isDarkTheme ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${pubT.accent}22` }}>
                <div style={{ fontSize: s.label === "Price" ? 36 : 48, fontWeight: 700, color: pubT.accent, marginBottom: 8 }}>{s.val || "—"}</div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: isDarkTheme ? "#888" : "#666", letterSpacing: "0.08em" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {data.description && (
            <div style={{ background: isDarkTheme ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", padding: 32, borderRadius: 8, marginBottom: 40, borderLeft: `4px solid ${pubT.accent}` }}>
              <p style={{ fontFamily: "'Jost', sans-serif", fontSize: 15, lineHeight: 1.8, color: isDarkTheme ? "#ddd" : pubT.text, margin: 0 }}>
                {data.description}
              </p>
            </div>
          )}

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

          {/* Agent Card — preserves original inline-initials behavior for non-Prestige
              themes. (Prestige uses agentAvatar with real profile photo; the public
              non-Prestige render has always used inline initials. Fixing that
              inconsistency is out of scope for this extraction PR.) */}
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
                {agentName.split(" ").map(n => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase()}
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
          <LeadCapture
            mode={mode}
            theme={{
              bg: isDarkTheme ? "#0f0f1a" : "#fff",
              text: isDarkTheme ? "#fff" : pubT.text,
              sub: isDarkTheme ? "#aaa" : "#666",
              accent: pubT.accent,
              border: isDarkTheme ? "rgba(255,255,255,0.12)" : "#e0e0e0",
              card: isDarkTheme ? "rgba(255,255,255,0.05)" : "#f5f5f5",
            }}
            micrositeId={micrositeId}
            listingId={listingId}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: footerBg, borderTop: `1px solid ${pubT.accent}`,
        padding: 40, display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {brandMark(pubT.accent, isDarkTheme ? "#888" : "#666")}
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#666" }}>
          © {new Date().getFullYear()} {agentBranding?.agency_name || "Milestone Media"}. All rights reserved.
        </div>
      </div>

      {chatEl}
    </div>
  );
}
