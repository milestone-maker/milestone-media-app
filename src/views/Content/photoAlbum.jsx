// Shared FB album preview pieces:
//   • LabeledThumb  — a category-labeled, clickable thumbnail (optional badge +
//                     selection ring).
//   • PhotoLightbox — the shared larger-preview overlay that NAVIGATES a set
//                     (prev/next arrows + keyboard ←/→ with wrap), shows the
//                     category label + close, and an optional per-photo action
//                     (e.g. Add/Remove).
// The editable album strip + controls live in FacebookAlbumEditor; both it and
// the Post modal use these pieces, so the preview/lightbox is one component.

import { useEffect } from "react";
import { categoryLabel } from "../../lib/photoCategories";
import { stepIndex } from "../../lib/facebookAlbumEdit";

const FB_BLUE = "#3b82f6";

// Navigable larger-preview overlay over `items` (rows with {photo_url, category}).
// `index` is the current item; `onIndex(next)` moves; arrows + ←/→ wrap; Esc
// closes. `renderAction(photo)` may return { label, onClick } for a contextual
// action (Add to / Remove from album).
export function PhotoLightbox({ items = [], index = 0, onIndex, onClose, renderAction }) {
  const list = Array.isArray(items) ? items : [];
  const photo = list[index];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onClose?.(); return; }
      if (!list.length || !onIndex) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onIndex(stepIndex(index, list.length, +1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onIndex(stepIndex(index, list.length, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, list.length, onIndex, onClose]);

  if (!photo?.photo_url) return null;
  const multi = list.length > 1;
  const action = renderAction ? renderAction(photo) : null;

  const arrowBtn = (dir, glyph) => (
    <button
      onClick={(e) => { e.stopPropagation(); onIndex?.(stepIndex(index, list.length, dir)); }}
      aria-label={dir < 0 ? "Previous photo" : "Next photo"}
      style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)", [dir < 0 ? "left" : "right"]: -6,
        width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer", fontSize: 20, lineHeight: "40px",
      }}
    >{glyph}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <img src={photo.photo_url} alt={categoryLabel(photo.category)} style={{ maxWidth: "92vw", maxHeight: "76vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.6)" }} />
          {multi && arrowBtn(-1, "‹")}
          {multi && arrowBtn(+1, "›")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F5ECD7", letterSpacing: "0.04em" }}>
            {categoryLabel(photo.category)}{multi ? ` · ${index + 1}/${list.length}` : ""}
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

// One labeled, clickable thumbnail. `badge` = optional small corner tag;
// `selected` draws a green ring; `corner` = optional extra top-left control
// (e.g. a remove ×). Always shows the category label.
export function LabeledThumb({ photo, size = 60, badge, badgeColor = FB_BLUE, selected = false, onClick, corner }) {
  const label = categoryLabel(photo?.category);
  return (
    <div style={{ position: "relative", width: size, display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          position: "relative", width: size, height: size, padding: 0, cursor: "pointer", borderRadius: 7, overflow: "hidden",
          border: selected ? "2px solid #4ade80" : "1px solid rgba(255,255,255,0.18)", background: "transparent",
        }}
      >
        <img src={photo?.photo_url} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {badge && (
          <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, fontSize: 7.5, lineHeight: 1.6, textAlign: "center", background: badgeColor, color: "#fff", fontFamily: "'Jost', sans-serif" }}>{badge}</span>
        )}
        {selected && <span style={{ position: "absolute", top: 2, left: 3, fontSize: 12, color: "#4ade80" }}>✓</span>}
      </button>
      {corner}
      <span style={{ width: size, fontSize: 8.5, lineHeight: 1.2, textAlign: "center", color: "rgba(255,255,255,0.6)", fontFamily: "'Jost', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </div>
  );
}
