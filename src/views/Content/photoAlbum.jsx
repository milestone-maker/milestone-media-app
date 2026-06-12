// Shared FB album preview pieces — used by BOTH the Content result panel
// (display-only strip) and the Post-to-Facebook modal (selectable grid):
//   • LabeledThumb   — a thumbnail labeled by its photo category, clickable to
//                      open the lightbox; optional selection ring + small badge.
//   • PhotoLightbox  — the shared larger-preview overlay (full image + category
//                      label + close).
//   • FacebookAlbumStrip — the display-only curated-album strip for the result
//                      panel (computes the curated set from photo_labels and
//                      owns its own lightbox state).

import { useState, useMemo } from "react";
import { categoryLabel } from "../../lib/photoCategories";
import { facebookAlbumUrls } from "../../../api/_content/selectCarouselPhotos.js";

const FB_BLUE = "#3b82f6";

// Shared larger-preview overlay. `photo` = { photo_url, category }. Optional
// `action` = { label, onClick } renders a button next to Close (the modal uses
// it to add/remove the previewed photo from the album).
export function PhotoLightbox({ photo, onClose, action }) {
  if (!photo?.photo_url) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.82)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <img src={photo.photo_url} alt={categoryLabel(photo.category)} style={{ maxWidth: "92vw", maxHeight: "78vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.6)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F5ECD7", letterSpacing: "0.04em" }}>
            {categoryLabel(photo.category)}
          </span>
          {action && (
            <button onClick={action.onClick} style={{
              padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.5)",
              background: "rgba(74,222,128,0.14)", color: "#9fe3b0", cursor: "pointer",
              fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600,
            }}>{action.label}</button>
          )}
          <button onClick={onClose} style={{
            padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600,
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// One labeled, clickable thumbnail. `badge` = optional small corner tag
// ("default" / "added"); `selected` draws a green ring; `onClick` opens preview
// or toggles selection (caller decides). Always shows the category label.
export function LabeledThumb({ photo, size = 60, badge, badgeColor = FB_BLUE, selected = false, onClick }) {
  const label = categoryLabel(photo?.category);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        position: "relative", width: size, height: size + 16, padding: 0, cursor: "pointer",
        background: "transparent", border: "none", display: "flex", flexDirection: "column", gap: 2,
      }}
    >
      <div style={{
        position: "relative", width: size, height: size, borderRadius: 7, overflow: "hidden",
        border: selected ? "2px solid #4ade80" : "1px solid rgba(255,255,255,0.18)",
      }}>
        <img src={photo?.photo_url} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {badge && (
          <span style={{
            position: "absolute", top: 2, right: 2, fontSize: 7.5, lineHeight: 1.4, padding: "0 4px",
            borderRadius: 4, background: badgeColor, color: "#fff", fontFamily: "'Jost', sans-serif",
          }}>{badge}</span>
        )}
        {selected && <span style={{ position: "absolute", top: 2, left: 3, fontSize: 12, color: "#4ade80" }}>✓</span>}
      </div>
      <span style={{
        width: size, fontSize: 8.5, lineHeight: 1.2, textAlign: "center", color: "rgba(255,255,255,0.6)",
        fontFamily: "'Jost', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{label}</span>
    </button>
  );
}

// Display-only curated-album strip for the FB result panel. `photos` is the
// listing's classified photo_labels (the photoPool); the curated set is derived
// here (same facebookAlbumUrls the server + modal use). Owns its lightbox state.
export function FacebookAlbumStrip({ photos = [], emptyNote }) {
  const [preview, setPreview] = useState(null);

  const curated = useMemo(() => {
    const urls = facebookAlbumUrls(photos);
    const byUrl = new Map();
    for (const p of (Array.isArray(photos) ? photos : [])) {
      if (p?.photo_url && !byUrl.has(p.photo_url)) byUrl.set(p.photo_url, p);
    }
    return urls.map((u) => byUrl.get(u) || { photo_url: u, category: "" });
  }, [photos]);

  if (curated.length === 0) {
    return emptyNote ? (
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>{emptyNote}</div>
    ) : null;
  }

  return (
    <div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>
        Album · {curated.length} photo{curated.length === 1 ? "" : "s"} <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.3)" }}>— tap to preview</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {curated.map((p) => (
          <LabeledThumb key={p.photo_url} photo={p} onClick={() => setPreview(p)} />
        ))}
      </div>
      {preview && <PhotoLightbox photo={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
