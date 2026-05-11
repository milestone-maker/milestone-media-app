import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth, MEDIA_ICONS, THEMES } from "../../App";

function MicrositePreview({ data, theme }) {
  const t = theme;
  // Derived theme helpers so every section reacts to the selected theme
  const isLight = t.text !== "#fff";
  const cardBg = isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.07)";
  const agentCardBg = isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.08)";
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
    color: activeSection === sectionId ? t.accent : t.sub,
    cursor: "pointer",
    transition: "color 0.3s",
    paddingBottom: 6,
    borderBottom: activeSection === sectionId ? `2px solid ${t.accent}` : "2px solid transparent",
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
        background: t.bg,
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${t.border}`,
        padding: "16px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.accent, letterSpacing: "0.06em" }}>
            MILESTONE MEDIA
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: t.sub, letterSpacing: "0.08em" }}>
            Photography & Media
          </div>
        </div>
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          style={{
            display: "none",
            background: "none",
            border: "none",
            color: t.accent,
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
          <div style={{ fontSize: 40, fontWeight: 700, color: t.accent }}>
            {data.price || "$1,250,000"}
          </div>
        </div>
      </div>

      {/* Sticky Section Nav */}
      <div style={{
        position: "sticky",
        top: 60,
        zIndex: 100,
        background: t.bg,
        borderBottom: `1px solid ${t.border}`,
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
      <div ref={photoRef} style={{ background: t.bg, padding: "80px 0", borderTop: `1px solid ${t.border}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 40, padding: "0 40px 40px" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
            Photography
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>Photo Gallery</h2>
            <div style={{ width: 60, height: 1, background: t.accent }} />
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
            background: "transparent", border: `1px solid ${t.accent}66`,
            color: t.accent, padding: "8px 20px", borderRadius: 6,
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
            background: cardBg,
            padding: "80px 40px",
            borderTop: `1px solid ${t.border}`,
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
              Floorplan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>
                Interactive Floorplan
              </h2>
              <div style={{ width: 60, height: 1, background: t.accent }} />
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
            background: t.bg,
            padding: "80px 40px",
            borderTop: `1px solid ${t.border}`,
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
              Aerial
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>
                Drone Video
              </h2>
              <div style={{ width: 60, height: 1, background: t.accent }} />
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
            background: cardBg,
            padding: "80px 40px",
            borderTop: `1px solid ${t.border}`,
            "@media (maxWidth: 768px)": { padding: "40px 20px" },
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
              Virtual Tour
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
              <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>
                3D Walkthrough
              </h2>
              <div style={{ width: 60, height: 1, background: t.accent }} />
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
              color: t.sub,
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
          background: t.bg,
          padding: "80px 40px",
          borderTop: `1px solid ${t.border}`,
          "@media (maxWidth: 768px)": { padding: "40px 20px" },
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
            Property Info
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>
              Property Details
            </h2>
            <div style={{ width: 60, height: 1, background: t.accent }} />
          </div>

          {/* Stats Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 24,
            marginBottom: 60,
            "@media (maxWidth: 768px)": { gridTemplateColumns: "repeat(2, 1fr)" },
          }}>
            <div style={{ background: cardBg, padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: t.accent, marginBottom: 8 }}>
                {data.beds || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: t.sub, letterSpacing: "0.08em" }}>
                Bedrooms
              </div>
            </div>
            <div style={{ background: cardBg, padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: t.accent, marginBottom: 8 }}>
                {data.baths || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: t.sub, letterSpacing: "0.08em" }}>
                Bathrooms
              </div>
            </div>
            <div style={{ background: cardBg, padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: t.accent, marginBottom: 8 }}>
                {data.sqft || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: t.sub, letterSpacing: "0.08em" }}>
                Sq. Ft.
              </div>
            </div>
            <div style={{ background: cardBg, padding: 32, borderRadius: 8, textAlign: "center", border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: t.accent, marginBottom: 8 }}>
                {data.price || "—"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, textTransform: "uppercase", color: t.sub, letterSpacing: "0.08em" }}>
                Price
              </div>
            </div>
          </div>

          {/* Description */}
          {data.description && (
            <div style={{
              background: cardBg,
              padding: 32,
              borderRadius: 8,
              marginBottom: 40,
              borderLeft: `4px solid ${t.accent}`,
              border: `1px solid ${t.border}`,
              borderLeft: `4px solid ${t.accent}`,
            }}>
              <p style={{
                fontFamily: "'Jost', sans-serif",
                fontSize: 15,
                lineHeight: 1.8,
                color: t.sub,
                margin: 0,
              }}>
                {data.description}
              </p>
            </div>
          )}

          {/* Features */}
          {data.features && data.features.filter(f => f).length > 0 && (
            <div>
              <h3 style={{ fontSize: 24, color: t.text, marginBottom: 24, fontWeight: 600 }}>
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
                    <div style={{ color: t.accent, fontSize: 18, flexShrink: 0 }}>•</div>
                    <div style={{
                      fontFamily: "'Jost', sans-serif",
                      fontSize: 14,
                      color: t.sub,
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
          background: cardBg,
          padding: "80px 40px",
          borderTop: `1px solid ${t.border}`,
          "@media (maxWidth: 768px)": { padding: "40px 20px" },
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: t.sub, marginBottom: 8 }}>
            Schedule a Visit
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: 42, margin: 0, color: t.text, fontWeight: 600 }}>
              Request a Showing
            </h2>
            <div style={{ width: 60, height: 1, background: t.accent }} />
          </div>

          {/* Agent Card */}
          <div style={{
            background: agentCardBg,
            padding: 32,
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 40,
            "@media (maxWidth: 768px)": { flexDirection: "column", textAlign: "center" },
          }}>
            {agentAvatar(80, t.accent, isLight ? "#fff" : t.bg)}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, color: t.text, marginBottom: 4, fontWeight: 600 }}>
                {data.agentName || "Jane Doe"}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: t.sub }}>
                {data.agentPhone || "(214) 000-0000"}
              </div>
            </div>
            <button style={{
              background: t.accent,
              color: isLight ? "#fff" : t.bg,
              border: "none",
              padding: "12px 28px",
              borderRadius: 6,
              fontFamily: "'Jost', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.target.style.opacity = "1")}
            >
              Call
            </button>
          </div>

          {/* Lead Capture Form */}
          <LeadCaptureForm theme={t} onSubmit={data.onLeadSubmit} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: t.bg,
        borderTop: `1px solid ${t.accent}`,
        padding: "40px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        "@media (maxWidth: 768px)": { flexDirection: "column", textAlign: "center", gap: 20 },
      }}>
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 14,
          color: t.accent,
          fontWeight: 700,
          letterSpacing: "0.08em",
        }}>
          MILESTONE MEDIA
        </div>
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 12,
          color: t.sub,
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
  // Slug: if editing reuse the saved slug; for new microsites append the last 8 chars
  // of the agent's UUID so two agents with the same address never collide globally.
  const baseSlug = (data.address || "your-listing").split(" ").slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const agentSuffix = (user?.id || "").slice(-8);
  const slug = publishedSlug || (agentSuffix ? `${baseSlug}-${agentSuffix}` : baseSlug);
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

      // Use INSERT for new microsites, UPDATE for existing ones.
      // Never use upsert-on-slug — if the slug exists and belongs to a different
      // agent the USING policy on the UPDATE path throws an RLS error.
      let result, error;
      if (publishedSlug) {
        // Agent is re-publishing / editing their own microsite — targeted UPDATE
        ({ data: result, error } = await supabase
          .from("microsites")
          .update(micrositeData)
          .eq("slug", publishedSlug)
          .eq("agent_id", user?.id)
          .select());
      } else {
        // Brand-new microsite — INSERT (slug already includes agent suffix)
        ({ data: result, error } = await supabase
          .from("microsites")
          .insert(micrositeData)
          .select());
      }

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

export default MicrositeView;
