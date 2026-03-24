import { useState, useEffect } from "react";

const NAV = ["Showcase", "Book", "My Media", "Analytics"];

const RELA_PHOTOS = {
  "2410prosperitydr": [
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-001_248.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-002_276.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-003_221.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-004_311.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-005_249.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-006_822.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-007_231.jpg",
    "https://media.relahq.com/public/styles/kb_full/s3/property-images/prop-nid-165942746/s_surrey_dr-008_237.jpg",
  ],
};

const LISTINGS = [
  {
    id: 1,
    address: "2410 Prosperity Dr",
    city: "Dallas, TX",
    price: "$1,250,000",
    beds: 4, baths: 3.5, sqft: "3,840",
    package: "Luxury",
    status: "Live",
    img: RELA_PHOTOS["2410prosperitydr"][0],
    gallery: RELA_PHOTOS["2410prosperitydr"],
    views: 1482, shares: 64, leads: 12,
    media: ["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Microsite"],
    relaSite: "https://sites.listvt.com/2410prosperitydr",
  },
  {
    id: 2,
    address: "2103 Preston Hollow Rd",
    city: "Dallas, TX 75225",
    price: "$895,000",
    beds: 3, baths: 2, sqft: "2,610",
    package: "Signature",
    status: "In Production",
    img: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
    gallery: null,
    views: 741, shares: 28, leads: 5,
    media: ["Photos", "Drone", "3D Tour", "Floor Plan"],
    relaSite: null,
  },
  {
    id: 3,
    address: "918 Kessler Pkwy",
    city: "Dallas, TX 75208",
    price: "$2,100,000",
    beds: 5, baths: 5, sqft: "5,200",
    package: "Luxury",
    status: "Live",
    img: "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800&q=80",
    gallery: null,
    views: 2941, shares: 118, leads: 23,
    media: ["Photos", "Drone", "3D Tour", "Film", "Floor Plan", "Microsite", "Twilight"],
    relaSite: null,
  },
];

const PACKAGES = [
  {
    name: "Essential",
    price: "$249",
    color: "#8fa3b1",
    features: ["Professional Photography"],
    desc: "Crystal-clear stills that stop the scroll.",
  },
  {
    name: "Signature",
    price: "$549",
    color: "#c9a84c",
    features: ["Photography", "Drone", "Matterport 3D", "Floor Plan"],
    desc: "The complete digital listing presence.",
    popular: true,
  },
  {
    name: "Zillow Ready",
    price: "$649",
    color: "#b08d57",
    features: ["Everything in Signature", "Zillow Showcase Optimized"],
    desc: "Engineered to dominate Zillow search.",
  },
  {
    name: "Luxury",
    price: "$1,095",
    color: "#e5c97e",
    features: ["Everything +", "Cinematic Film", "Custom Microsite", "Twilight Photos"],
    desc: "The full cinematic experience.",
  },
];

const MEDIA_ICONS = {
  Photos: "📷", Drone: "🚁", "3D Tour": "🔮", Film: "🎬",
  "Floor Plan": "📐", Microsite: "🌐", Twilight: "🌅",
};

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
  const listing = LISTINGS[active];
  const [mediaHover, setMediaHover] = useState(null);
  const photos = listing.gallery || [listing.img];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Hero Listing */}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", height: 420 }}>
        <img src={photos[heroPhoto] || listing.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "opacity 0.3s" }} />
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
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c", fontWeight: 700 }}>{listing.price}</span>
          <span style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
            {listing.beds} bd · {listing.baths} ba · {listing.sqft} sqft
          </span>
        </div>
      </div>

      {/* Media types */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "rgba(255,255,255,0.5)", marginBottom: 14, letterSpacing: "0.05em" }}>
          Delivered Media
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {listing.media.map((m) => (
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
          { label: "Total Views", value: listing.views.toLocaleString(), icon: "👁" },
          { label: "Shares", value: listing.shares, icon: "↗" },
          { label: "Leads", value: listing.leads, icon: "✉" },
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
  const [selected, setSelected] = useState(1);
  const [step, setStep] = useState(1);
  const [date, setDate] = useState("");
  const [address, setAddress] = useState("");
  const [booked, setBooked] = useState(false);

  const pkg = PACKAGES[selected];

  if (booked) return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>✨</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 40, color: "#c9a84c", marginBottom: 12 }}>
        You're Booked!
      </div>
      <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.6)", fontSize: 15, marginBottom: 32 }}>
        Your {pkg.name} session for {address} is confirmed.<br />
        We'll reach out within 24 hours to finalize details.
      </div>
      <button onClick={() => { setBooked(false); setStep(1); setAddress(""); setDate(""); }} style={{
        background: "transparent", border: "1px solid rgba(201,168,76,0.5)",
        color: "#c9a84c", padding: "12px 28px", borderRadius: 8,
        fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.1em",
        textTransform: "uppercase", cursor: "pointer",
      }}>
        Book Another Listing
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 6 }}>
          Book a Session
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
          Premium real estate media, delivered in 24–48 hours.
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", gap: 0 }}>
        {["Choose Package", "Property Details", "Confirm"].map((s, i) => (
          <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: step > i + 1 ? "#c9a84c" : step === i + 1 ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.05)",
              border: step >= i + 1 ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Jost', sans-serif", fontSize: 13, fontWeight: 600,
              color: step > i + 1 ? "#0a1628" : step === i + 1 ? "#c9a84c" : "rgba(255,255,255,0.3)",
              transition: "all 0.3s", marginBottom: 6,
            }}>{step > i + 1 ? "✓" : i + 1}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: step === i + 1 ? "#c9a84c" : "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Step 1: packages */}
      {step === 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {PACKAGES.map((p, i) => (
            <div key={p.name} onClick={() => setSelected(i)} style={{
              border: selected === i ? `2px solid ${p.color}` : "2px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: 20, cursor: "pointer",
              background: selected === i ? `rgba(${p.color === "#c9a84c" ? "201,168,76" : "255,255,255"},0.05)` : "rgba(255,255,255,0.02)",
              position: "relative", transition: "all 0.2s",
            }}>
              {p.popular && (
                <div style={{
                  position: "absolute", top: -1, right: 12,
                  background: "#c9a84c", color: "#0a1628",
                  fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: "0 0 6px 6px",
                }}>Most Popular</div>
              )}
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: p.color, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff", fontWeight: 700, marginBottom: 10 }}>{p.price}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>{p.desc}</div>
              {p.features.map(f => (
                <div key={f} style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 3 }}>
                  <span style={{ color: p.color, marginRight: 6 }}>✓</span>{f}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { label: "Property Address", placeholder: "123 Main St, Dallas TX", val: address, set: setAddress },
            { label: "Preferred Shoot Date", placeholder: "Select date", val: date, set: setDate, type: "date" },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{f.label}</div>
              <input type={f.type || "text"} placeholder={f.placeholder} value={f.val} onChange={e => f.set(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8, padding: "13px 16px", color: "#fff",
                  fontFamily: "'Jost', sans-serif", fontSize: 14, outline: "none",
                  boxSizing: "border-box", colorScheme: "dark",
                }} />
            </div>
          ))}
          <div style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Selected Package</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>{pkg.name} — <span style={{ color: "#c9a84c" }}>{pkg.price}</span></div>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: "#fff", marginBottom: 20 }}>Confirm Your Booking</div>
          {[
            { label: "Package", value: `${pkg.name} — ${pkg.price}` },
            { label: "Address", value: address || "Not provided" },
            { label: "Date", value: date || "Flexible" },
            { label: "Turnaround", value: "24–48 hours" },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{r.label}</span>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nav buttons */}
      <div style={{ display: "flex", gap: 12 }}>
        {step > 1 && (
          <button onClick={() => setStep(s => s - 1)} style={{
            flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.6)", padding: "14px", borderRadius: 8,
            fontFamily: "'Jost', sans-serif", fontSize: 13, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer",
          }}>← Back</button>
        )}
        <button onClick={() => step < 3 ? setStep(s => s + 1) : setBooked(true)} style={{
          flex: 2, background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
          border: "none", borderRadius: 8, padding: "14px",
          fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 13,
          letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
        }}>
          {step === 3 ? "Confirm Booking ✓" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

function MediaView() {
  const [active, setActive] = useState(0);
  const [showRelaSite, setShowRelaSite] = useState(false);
  const listing = LISTINGS[active];

  if (showRelaSite && listing.relaSite) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Back button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowRelaSite(false)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em",
          }}>← Back to Media</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", flex: 1 }}>
            {listing.address}
          </div>
        </div>

        {/* Status badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={listing.status} />
          <PackageBadge pkg={listing.package} />
        </div>

        {/* Embedded Rela property website */}
        <div style={{
          borderRadius: 14, overflow: "hidden",
          border: "1px solid rgba(201,168,76,0.25)",
          background: "#000",
        }}>
          <iframe
            src={listing.relaSite}
            title={`${listing.address} - Property Media`}
            style={{
              width: "100%", height: 600, border: "none",
              borderRadius: 14,
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
            allowFullScreen
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => window.open(listing.relaSite, "_blank")} style={{
            flex: 1, background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
            border: "none", borderRadius: 8, padding: "14px",
            fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12,
            letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
          }}>Open Full Site ↗</button>
          <button onClick={() => { navigator.clipboard.writeText(listing.relaSite); }} style={{
            flex: 1, background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "14px",
            fontFamily: "'Jost', sans-serif", fontSize: 12,
            letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
          }}>Copy Link</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff" }}>My Media</div>
      {/* Listing selector */}
      <div style={{ display: "flex", gap: 10 }}>
        {LISTINGS.map((l, i) => (
          <div key={l.id} onClick={() => { setActive(i); setShowRelaSite(false); }} style={{
            flex: 1, borderRadius: 10, overflow: "hidden", cursor: "pointer", position: "relative", height: 80,
            border: active === i ? "2px solid #c9a84c" : "2px solid transparent", transition: "all 0.2s",
          }}>
            <img src={l.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: active === i ? "rgba(201,168,76,0.15)" : "rgba(8,18,40,0.5)" }} />
            <div style={{ position: "absolute", bottom: 6, left: 8, fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#fff", letterSpacing: "0.06em" }}>
              {l.address.split(" ").slice(0, 2).join(" ")}
            </div>
          </div>
        ))}
      </div>

      {/* View Property Site CTA — shown when listing has a Rela site */}
      {listing.relaSite && (
        <div onClick={() => setShowRelaSite(true)} style={{
          background: "linear-gradient(135deg, rgba(201,168,76,0.12) 0%, rgba(201,168,76,0.04) 100%)",
          border: "1px solid rgba(201,168,76,0.3)", borderRadius: 14, padding: "18px 20px",
          display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
          transition: "all 0.2s",
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.6)"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"}>
          <div style={{
            width: 48, height: 48, borderRadius: 10, background: "rgba(201,168,76,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0,
          }}>🏠</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c", marginBottom: 2 }}>
              View Property Website
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Photos, drone, 3D tour & more — all in one place
            </div>
          </div>
          <span style={{ color: "#c9a84c", fontSize: 18 }}>→</span>
        </div>
      )}

      {/* Media grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {listing.media.map((m) => (
          <div key={m} style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "20px 16px", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 10, cursor: "pointer", transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.4)"; e.currentTarget.style.background = "rgba(201,168,76,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}>
            <span style={{ fontSize: 28 }}>{MEDIA_ICONS[m]}</span>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.7)", letterSpacing: "0.06em" }}>{m}</div>
            <div style={{
              background: "rgba(201,168,76,0.15)", color: "#c9a84c",
              border: "1px solid rgba(201,168,76,0.3)", borderRadius: 6,
              padding: "4px 12px", fontSize: 10, fontFamily: "'Jost', sans-serif",
              letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
            }}>Download</div>
          </div>
        ))}
      </div>

      {/* Share microsite */}
      {listing.media.includes("Microsite") && (
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
  { name: "Obsidian", bg: "#0a0a0a", accent: "#c9a84c", text: "#fff", sub: "rgba(255,255,255,0.5)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" },
  { name: "Ivory", bg: "#f7f4ef", accent: "#8b6914", text: "#1a1a1a", sub: "rgba(0,0,0,0.45)", card: "rgba(0,0,0,0.04)", border: "rgba(0,0,0,0.1)" },
  { name: "Slate", bg: "#0d1f2d", accent: "#5fb0d8", text: "#fff", sub: "rgba(255,255,255,0.5)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" },
  { name: "Blush", bg: "#1c1014", accent: "#d4807a", text: "#fff", sub: "rgba(255,255,255,0.5)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" },
];

function MicrositePreview({ data, theme }) {
  const t = theme;
  const slug = (data.address || "your-listing").split(" ").slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");

  return (
    <div style={{
      background: t.bg, borderRadius: 14, overflow: "hidden",
      border: `1px solid ${t.border}`, fontFamily: "'Cormorant Garamond', serif",
    }}>
      {/* Hero */}
      <div style={{ position: "relative", height: 200 }}>
        <img src={data.heroImg || LISTINGS[0].img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to top, ${t.bg} 0%, transparent 60%)` }} />
        {/* Nav bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "rgba(0,0,0,0.3)", backdropFilter: "blur(8px)",
        }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: t.accent, letterSpacing: "0.08em" }}>
            Milestone Media
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.6)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            milestone.media/{slug}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 12, left: 16 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 600, lineHeight: 1.1 }}>
            {data.address || "123 Luxury Lane"}
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
            {data.city || "Dallas, TX"}
          </div>
        </div>
      </div>

      {/* Details strip */}
      <div style={{ padding: "14px 16px", display: "flex", gap: 16, alignItems: "center", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: t.accent, fontWeight: 700 }}>
          {data.price || "$1,250,000"}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { icon: "🛏", val: data.beds || "4", label: "Bed" },
            { icon: "🚿", val: data.baths || "3", label: "Bath" },
            { icon: "📐", val: data.sqft || "3,200", label: "sqft" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: t.text, fontWeight: 600 }}>{s.val}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: t.sub, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Description */}
      {data.description && (
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: t.text, lineHeight: 1.6, fontStyle: "italic" }}>
            {data.description.slice(0, 160)}{data.description.length > 160 ? "..." : ""}
          </div>
        </div>
      )}

      {/* Features */}
      {data.features && data.features.filter(f => f).length > 0 && (
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: t.sub, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Highlights</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.features.filter(f => f).map((f, i) => (
              <span key={i} style={{
                background: `${t.accent}18`, border: `1px solid ${t.accent}40`,
                color: t.accent, padding: "3px 10px", borderRadius: 20,
                fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em",
              }}>{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Media badges */}
      {data.mediaTypes && data.mediaTypes.length > 0 && (
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.mediaTypes.map(m => (
            <span key={m} style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: t.sub, background: t.card, padding: "4px 10px", borderRadius: 6 }}>
              {MEDIA_ICONS[m]} {m}
            </span>
          ))}
        </div>
      )}

      {/* Agent card */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${t.border}` }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: `linear-gradient(135deg, ${t.accent}, ${t.accent}99)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Cormorant Garamond', serif", fontSize: 16, color: "#fff", fontWeight: 700, flexShrink: 0,
        }}>{(data.agentName || "JD").split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: t.text }}>{data.agentName || "Jane Doe"}</div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: t.sub }}>{data.agentPhone || "(214) 000-0000"}</div>
        </div>
        <div style={{
          background: t.accent, color: t.bg, padding: "7px 14px", borderRadius: 6,
          fontFamily: "'Jost', sans-serif", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>Call</div>
      </div>

      {/* Lead Capture Form */}
      <LeadCaptureForm theme={t} onSubmit={data.onLeadSubmit} />
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
  const [step, setStep] = useState("build");
  const [themeIdx, setThemeIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [published, setPublished] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const [data, setData] = useState({
    address: "", city: "", price: "", beds: "", baths: "", sqft: "",
    description: "", agentName: "", agentPhone: "",
    heroImg: LISTINGS[0].img,
    features: ["", "", "", ""],
    mediaTypes: ["Photos", "Drone", "3D Tour"],
  });

  const theme = THEMES[themeIdx];
  const slug = (data.address || "your-listing").split(" ").slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const liveUrl = `https://milestone.media/${slug}`;

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

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setStep("preview"); }, 1800);
  };

  const handlePublish = () => { setPublished(true); setStep("published"); };
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
          <button onClick={() => { setStep("build"); setPublished(false); setLeads([]); setData({ address: "", city: "", price: "", beds: "", baths: "", sqft: "", description: "", agentName: "", agentPhone: "", heroImg: LISTINGS[0].img, features: ["","","",""], mediaTypes: ["Photos","Drone","3D Tour"] }); }} style={{
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

      {/* Theme switcher */}
      <div>
        <div style={labelStyle}>Theme</div>
        <div style={{ display: "flex", gap: 8 }}>
          {THEMES.map((t, i) => (
            <div key={t.name} onClick={() => setThemeIdx(i)} style={{
              flex: 1, height: 32, borderRadius: 8, cursor: "pointer", background: t.bg,
              border: themeIdx === i ? `2px solid #c9a84c` : "2px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
              transition: "border-color 0.2s",
            }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.accent }} />
            </div>
          ))}
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6, letterSpacing: "0.08em" }}>
          {THEMES[themeIdx].name}
        </div>
      </div>

      <MicrositePreview data={{ ...data, onLeadSubmit: handleNewLead }} theme={theme} />

      <button onClick={handlePublish} style={{
        background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "15px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
      }}>🚀 Publish Microsite</button>
    </div>
  );

  // Build step
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>Microsite Generator</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Build a branded property page in 60 seconds.</div>
      </div>

      {/* Hero image selector */}
      <div>
        <div style={labelStyle}>Hero Image</div>
        <div style={{ display: "flex", gap: 8 }}>
          {LISTINGS.map((l) => (
            <div key={l.id} onClick={() => setField("heroImg", l.img)} style={{
              flex: 1, height: 60, borderRadius: 8, overflow: "hidden", cursor: "pointer",
              border: data.heroImg === l.img ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.1)",
              transition: "border-color 0.2s",
            }}>
              <img src={l.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      </div>

      {/* Property Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Property Details</div>
        <div>
          <label style={labelStyle}>Street Address</label>
          <input style={inputStyle} placeholder="4821 Lakewood Blvd" value={data.address} onChange={e => setField("address", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>City & ZIP</label>
          <input style={inputStyle} placeholder="Dallas, TX 75206" value={data.city} onChange={e => setField("city", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>List Price</label>
          <input style={inputStyle} placeholder="$1,250,000" value={data.price} onChange={e => setField("price", e.target.value)} />
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
            placeholder="Describe the property's best features..."
            value={data.description} onChange={e => setField("description", e.target.value)} />
        </div>
      </div>

      {/* Highlights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Highlights</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {data.features.map((f, i) => (
            <input key={i} style={inputStyle} placeholder={["Chef's Kitchen", "Pool & Spa", "Smart Home", "3-Car Garage"][i]}
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

      {/* Generate CTA */}
      <button onClick={handleGenerate} disabled={generating} style={{
        background: generating ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "16px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: generating ? "rgba(255,255,255,0.5)" : "#0a1628", cursor: generating ? "default" : "pointer",
        transition: "all 0.3s",
      }}>
        {generating ? "✨ Generating your microsite..." : "Preview Microsite →"}
      </button>
    </div>
  );
}

function AnalyticsView() {
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
        {LISTINGS.map((l, i) => (
          <div key={l.id} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
            borderBottom: i < LISTINGS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
          }}>
            <img src={l.img} alt="" style={{ width: 44, height: 36, borderRadius: 6, objectFit: "cover" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff" }}>{l.address}</div>
              <StatusBadge status={l.status} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c" }}>{l.views.toLocaleString()}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>views</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Jost:wght@300;400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    setTimeout(() => setMounted(true), 100);
  }, []);

  const handleBook = () => setTab(1);

  const views = [
    <ShowcaseView onBook={handleBook} />,
    <BookView />,
    <MediaView />,
    <AnalyticsView />,
    <MicrositeView />,
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#080c16",
      fontFamily: "'Jost', sans-serif",
      opacity: mounted ? 1 : 0, transition: "opacity 0.4s ease",
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
          <img src="/icons/icon-192.png" alt="Milestone Media" style={{
            width: 36, height: 36, borderRadius: "50%", objectFit: "cover",
            border: "1px solid rgba(201,168,76,0.3)",
          }} />
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
        {[
          { label: "Showcase", icon: "✦" },
          { label: "Book", icon: "+" },
          { label: "Media", icon: "⊞" },
          { label: "Analytics", icon: "↗" },
          { label: "Microsite", icon: "🌐" },
        ].map((n, i) => (
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
