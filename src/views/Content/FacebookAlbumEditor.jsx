// Editable Facebook album for one generated FB content item (Stage: editable
// album). Owns the SINGLE source of truth for the album — an ordered list of
// photo URLs, initialized to the curated default set (facebookAlbumUrls). The
// agent can ADD, SWAP, and REMOVE here in the result panel; the Post-to-Facebook
// modal renders this SAME album and posts exactly it (albumPhotoUrls).
//
// Mount one per content (key={contentId}) so each item edits its own album.

import { useState, useMemo, useEffect, useRef } from "react";
import { facebookAlbumUrls } from "../../../api/_content/selectCarouselPhotos.js";
import { addToAlbum, removeFromAlbum, swapInAlbum } from "../../lib/facebookAlbumEdit";
import { categoryLabel } from "../../lib/photoCategories";
import { LabeledThumb, PhotoLightbox } from "./photoAlbum";
import PostToFacebookButton from "./FacebookPostButton";

const FB_BLUE = "#3b82f6";

function FacebookAlbumEditor({ contentId, photos = [], emptyNote }) {
  // url → photo_labels row (category, etc.), de-duped, preserving pool order.
  const { byUrl, poolUrls } = useMemo(() => {
    const m = new Map();
    for (const p of (Array.isArray(photos) ? photos : [])) {
      if (p?.photo_url && !m.has(p.photo_url)) m.set(p.photo_url, p);
    }
    return { byUrl: m, poolUrls: [...m.keys()] };
  }, [photos]);

  // The album: ordered URLs. Initialized once from the curated default as soon
  // as the listing's photos load; after that the agent's edits own it.
  const [album, setAlbum] = useState([]);
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    const curated = facebookAlbumUrls(photos);
    if (curated.length) { setAlbum(curated); initRef.current = true; }
  }, [photos]);

  // Remaining-photos picker: null | { mode:'add' } | { mode:'swap', target:url }.
  const [picker, setPicker] = useState(null);
  // Lightbox: null | { scope:'album'|'remaining', index }.
  const [preview, setPreview] = useState(null);

  const rowFor = (u) => byUrl.get(u) || { photo_url: u, category: "" };
  const albumRows = album.map(rowFor);
  const remainingRows = poolUrls.filter((u) => !album.includes(u)).map(rowFor);

  const doAdd = (url) => { setAlbum((a) => addToAlbum(a, url)); setPicker(null); setPreview(null); };
  const doRemove = (url) => { setAlbum((a) => removeFromAlbum(a, url)); setPreview(null); };
  const doSwap = (oldUrl, newUrl) => { setAlbum((a) => swapInAlbum(a, oldUrl, newUrl)); setPicker(null); setPreview(null); };

  // Apply a remaining-grid pick per the active picker mode.
  const pickRemaining = (url) => {
    if (picker?.mode === "swap") doSwap(picker.target, url);
    else doAdd(url);
  };

  const noPhotos = poolUrls.length === 0;

  // Lightbox wiring — items + index per scope, contextual action per photo.
  const lightboxItems = preview?.scope === "remaining" ? remainingRows : albumRows;
  const renderAction = (photo) => {
    if (preview?.scope === "remaining") {
      return { label: picker?.mode === "swap" ? "Use this photo" : "Add to album", onClick: () => pickRemaining(photo.photo_url) };
    }
    return { label: "Remove from album", onClick: () => doRemove(photo.photo_url) };
  };

  const linkBtn = (label, onClick, active = false) => (
    <button onClick={onClick} style={{
      padding: "5px 11px", borderRadius: 7, cursor: "pointer",
      border: active ? `1px solid ${FB_BLUE}` : "1px solid rgba(255,255,255,0.15)",
      background: active ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.04)",
      color: active ? "#93c5fd" : "rgba(255,255,255,0.7)",
      fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
    }}>{label}</button>
  );

  return (
    <div>
      {/* Header + count */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
          Album · {album.length} photo{album.length === 1 ? "" : "s"}
        </span>
        {!noPhotos && remainingRows.length > 0 && linkBtn(
          picker?.mode === "add" ? "Done adding" : "+ Add more",
          () => setPicker((p) => (p?.mode === "add" ? null : { mode: "add" })),
          picker?.mode === "add",
        )}
      </div>

      {noPhotos ? (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
          {emptyNote || "No analyzed photos on this listing yet — run photo analysis to build the album."}
        </div>
      ) : (
        <>
          {/* Current album — each photo: preview (click), swap, remove (×). */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {albumRows.map((p, i) => (
              <div key={p.photo_url} style={{ position: "relative" }}>
                <LabeledThumb photo={p} onClick={() => setPreview({ scope: "album", index: i })} />
                <button
                  onClick={() => doRemove(p.photo_url)}
                  title="Remove from album"
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(239,68,68,0.92)", color: "#fff", cursor: "pointer", fontSize: 11, lineHeight: "18px", padding: 0 }}
                >×</button>
                {remainingRows.length > 0 && (
                  <button
                    onClick={() => setPicker({ mode: "swap", target: p.photo_url })}
                    title="Swap this photo"
                    style={{
                      position: "absolute", bottom: 16, right: -6, padding: "1px 6px", borderRadius: 6, cursor: "pointer",
                      border: picker?.mode === "swap" && picker.target === p.photo_url ? `1px solid ${FB_BLUE}` : "1px solid rgba(255,255,255,0.25)",
                      background: picker?.mode === "swap" && picker.target === p.photo_url ? "rgba(59,130,246,0.85)" : "rgba(0,0,0,0.7)",
                      color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 8.5, fontWeight: 600,
                    }}
                  >swap</button>
                )}
              </div>
            ))}
          </div>

          {/* Remaining pool — revealed by Add more or Swap. Tap to add/replace. */}
          {picker && remainingRows.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(8,12,24,0.6)", border: "1px solid rgba(59,130,246,0.25)" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                {picker.mode === "swap"
                  ? <>Replace <strong style={{ color: "#93c5fd" }}>{categoryLabel(rowFor(picker.target).category)}</strong> with… <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.35)" }}>(tap a photo)</span></>
                  : <>Add a photo <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.35)" }}>(tap to add; tap the photo to preview first)</span></>}
                {"  "}
                <button onClick={() => setPicker(null)} style={{ marginLeft: 8, background: "none", border: "none", color: "#e8c97a", cursor: "pointer", fontSize: 11, textDecoration: "underline", fontFamily: "'Jost', sans-serif" }}>cancel</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {remainingRows.map((p, i) => (
                  <div key={p.photo_url} style={{ position: "relative" }}>
                    <LabeledThumb photo={p} onClick={() => pickRemaining(p.photo_url)} />
                    <button
                      onClick={() => setPreview({ scope: "remaining", index: i })}
                      title="Preview"
                      style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.3)", background: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", fontSize: 10, lineHeight: "16px", padding: 0 }}
                    >⛶</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Post / schedule — uses the EXPLICIT album as the final selection. */}
      {contentId && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <PostToFacebookButton contentId={contentId} photos={photos} album={album} />
        </div>
      )}

      {preview && lightboxItems[preview.index] && (
        <PhotoLightbox
          items={lightboxItems}
          index={preview.index}
          onIndex={(next) => setPreview((p) => ({ ...p, index: next }))}
          onClose={() => setPreview(null)}
          renderAction={renderAction}
        />
      )}
    </div>
  );
}

export default FacebookAlbumEditor;
