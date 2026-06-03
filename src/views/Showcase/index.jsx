import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";

function ShowcaseView({ onBook }) {
  const { user } = useAuth();
  const [active, setActive] = useState(0);      // index into `microsites`
  const [heroPhoto, setHeroPhoto] = useState(0); // index into the featured photo array
  const [microsites, setMicrosites] = useState([]);
  const [loadingMicrosites, setLoadingMicrosites] = useState(true);
  const [msHover, setMsHover] = useState(null);

  // Fetch this agent's published microsites — these drive both the
  // featured preview (above) and the card grid (below).
  useEffect(() => {
    if (!user?.id) return;
    setLoadingMicrosites(true);
    supabase
      .from("microsites")
      .select("id, slug, theme, property_data, created_at")
      .eq("agent_id", user.id)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMicrosites(data || []);
        setLoadingMicrosites(false);
      });
  }, [user?.id]);

  // When the featured microsite changes, reset the gallery to its first
  // photo so heroPhoto never points past the new array's length.
  useEffect(() => { setHeroPhoto(0); }, [active]);

  const featured = microsites[active] || {};
  const pd = featured.property_data || {};
  const propertyName = pd.address || "Property";

  // Build the featured photo array straight from the microsite's
  // property_data: hero_img first, then gallery_photos, deduped and with
  // blanks dropped. Falls back to just the hero (gallery stays hidden).
  const galleryPhotos = Array.isArray(pd.gallery_photos) ? pd.gallery_photos : [];
  const photos = [...new Set([pd.hero_img, ...galleryPhotos].filter(Boolean))];

  if (loadingMicrosites) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c" }}>Loading microsites...</div>
    </div>
  );

  if (microsites.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff" }}>No Microsites Yet</div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Publish your first property microsite to feature it here.</div>
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
      {/* ── Featured preview: hero + scrollable gallery ── */}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", height: 420 }}>
        <img src={photos[heroPhoto] || pd.hero_img || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "opacity 0.3s" }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(8,18,40,0.95) 0%, rgba(8,18,40,0.4) 60%, transparent 100%)",
        }} />
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
        {/* Property-name label — bottom left, above the gradient */}
        <div style={{
          position: "absolute", bottom: photos.length > 1 ? 58 : 20, left: 20, right: 20,
          fontFamily: "'Cormorant Garamond', serif", fontSize: 30, color: "#fff", fontWeight: 600,
          lineHeight: 1.1, textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{propertyName}</div>
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

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "Total Views", value: (featured.views || 0).toLocaleString(), icon: "👁" },
          { label: "Shares", value: featured.shares || 0, icon: "↗" },
          { label: "Leads", value: featured.leads || 0, icon: "✉" },
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

      {/* ── My Microsites ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: "#fff", fontWeight: 600 }}>
            My Property Microsites
          </div>
          <div style={{ flex: 1, height: 1, background: "rgba(201,168,76,0.25)" }} />
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
            {microsites.length} Published
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {microsites.map((ms, idx) => {
            const msData = ms.property_data || {};
            const heroImg = msData.hero_img || "";
            const address = msData.address || "Property";
            const city    = msData.city || "";
            const price   = msData.price || "";
            const liveUrl = `https://app.milestonemediaphotography.com/p/${ms.slug}`;
            const isHovered = msHover === ms.id;
            const isActive  = idx === active;
            return (
              <div
                key={ms.id}
                onMouseEnter={() => setMsHover(ms.id)}
                onMouseLeave={() => setMsHover(null)}
                onClick={() => setActive(idx)}
                style={{
                  position: "relative", borderRadius: 14, overflow: "hidden",
                  cursor: "pointer", height: 220,
                  border: isActive
                    ? "2px solid #c9a84c"
                    : isHovered ? "1px solid rgba(201,168,76,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  transform: isHovered && !isActive ? "translateY(-3px)" : "translateY(0)",
                  transition: "all 0.22s ease",
                  boxShadow: isActive
                    ? "0 0 0 3px rgba(201,168,76,0.18), 0 12px 40px rgba(0,0,0,0.5)"
                    : isHovered ? "0 12px 40px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.3)",
                }}
              >
                {/* Hero image */}
                {heroImg ? (
                  <img src={heroImg} alt={address} style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%",
                    objectFit: "cover", transition: "transform 0.4s ease",
                    transform: isHovered ? "scale(1.04)" : "scale(1)",
                  }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)" }} />
                )}
                {/* Dark gradient overlay */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: "linear-gradient(to top, rgba(8,12,24,0.95) 0%, rgba(8,12,24,0.5) 55%, rgba(8,12,24,0.15) 100%)",
                }} />
                {/* Featured badge — top left (only on the active card) */}
                {isActive && (
                  <div style={{
                    position: "absolute", top: 12, left: 12,
                    background: "rgba(201,168,76,0.92)", borderRadius: 20, padding: "3px 10px",
                    fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#0a1628",
                    letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
                  }}>★ Featured</div>
                )}
                {/* Theme badge — top right */}
                <div style={{
                  position: "absolute", top: 12, right: 12,
                  background: "rgba(201,168,76,0.18)", border: "1px solid rgba(201,168,76,0.4)",
                  borderRadius: 20, padding: "3px 10px",
                  fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#C9A84C",
                  letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600,
                }}>{ms.theme}</div>
                {/* Content — bottom */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 18px" }}>
                  <div style={{
                    fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff",
                    fontWeight: 600, lineHeight: 1.2, marginBottom: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{address}</div>
                  {(city || price) && (
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 12 }}>
                      {[city, price].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {/* View Live — its own button; opens the live site without changing the featured card */}
                  <button
                    onClick={(e) => { e.stopPropagation(); window.open(liveUrl, "_blank", "noopener,noreferrer"); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: isHovered ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.08)",
                      border: `1px solid ${isHovered ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.15)"}`,
                      borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 10, color: isHovered ? "#C9A84C" : "rgba(255,255,255,0.7)",
                      letterSpacing: "0.08em", textTransform: "uppercase", transition: "all 0.2s",
                    }}
                  >
                    View Live ↗
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ShowcaseView;
