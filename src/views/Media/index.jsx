import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { StatusBadge, PackageBadge, MEDIA_ICONS } from "../../lib/ui";

// Maps the user-facing media-type label to its storage folder name.
// Folder names match AdminView's upload paths so all admin uploads
// (from either AdminView or MediaView's own upload modal) and reads
// reference the same storage layout.
const FOLDER_FOR_LABEL = {
  "Photos": "photos",
  "Drone": "drone",
  "3D Tour": "3d-tour",
  "Film": "video",
  "Floor Plan": "floorplan",
  "Twilight": "twilight",
};

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
      const folder = `${listing.id}/${FOLDER_FOR_LABEL[type]}`;
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
    const folder = `${listing.id}/${FOLDER_FOR_LABEL[uploadType]}`;
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
    const folder = `${listing.id}/${FOLDER_FOR_LABEL[type]}`;
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

export default MediaView;
