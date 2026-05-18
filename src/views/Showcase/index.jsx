import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { StatusBadge, PackageBadge, MEDIA_ICONS } from "../../lib/ui";

function ShowcaseView({ onBook }) {
  const { user } = useAuth();
  const [active, setActive] = useState(0);
  const [heroPhoto, setHeroPhoto] = useState(0);
  const [listings, setListings] = useState([]);
  const [listingPhotos, setListingPhotos] = useState({});
  const [mediaHover, setMediaHover] = useState(null);
  const [loadingListings, setLoadingListings] = useState(true);
  const [microsites, setMicrosites] = useState([]);
  const [msHover, setMsHover] = useState(null);

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

  // Fetch this agent's published microsites
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("microsites")
      .select("id, slug, theme, property_data, created_at")
      .eq("agent_id", user.id)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setMicrosites(data); });
  }, [user?.id]);

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

      {/* ── My Microsites ── */}
      {microsites.length > 0 && (
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
            {microsites.map(ms => {
              const msData = ms.property_data || {};
              const heroImg = msData.hero_img || "";
              const address = msData.address || "Property";
              const city    = msData.city || "";
              const price   = msData.price || "";
              const liveUrl = `https://app.milestonemediaphotography.com/p/${ms.slug}`;
              const isHovered = msHover === ms.id;
              return (
                <div
                  key={ms.id}
                  onMouseEnter={() => setMsHover(ms.id)}
                  onMouseLeave={() => setMsHover(null)}
                  onClick={() => window.open(liveUrl, "_blank", "noopener,noreferrer")}
                  style={{
                    position: "relative", borderRadius: 14, overflow: "hidden",
                    cursor: "pointer", height: 220,
                    border: isHovered ? "1px solid rgba(201,168,76,0.5)" : "1px solid rgba(255,255,255,0.08)",
                    transform: isHovered ? "translateY(-3px)" : "translateY(0)",
                    transition: "all 0.22s ease",
                    boxShadow: isHovered ? "0 12px 40px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.3)",
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
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: isHovered ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.08)",
                      border: `1px solid ${isHovered ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.15)"}`,
                      borderRadius: 6, padding: "5px 12px",
                      fontFamily: "'Jost', sans-serif", fontSize: 10, color: isHovered ? "#C9A84C" : "rgba(255,255,255,0.7)",
                      letterSpacing: "0.08em", textTransform: "uppercase", transition: "all 0.2s",
                    }}>
                      View Live ↗
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShowcaseView;
