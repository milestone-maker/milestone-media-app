// LinkedInGalleryEditor — inline per-tile editor for the LinkedIn multi-photo
// gallery post. Mirrors the FacebookAlbumEditor's inline pattern (rendered
// above PostToLinkedInButton in the Result + History panels), but the tiles
// themselves are the SAME combined photo+caption images the Instagram
// Walkthrough Carousel uses — caption baked onto each photo by the canvas
// compositor in carouselCompose.js.
//
// MAXIMUM REUSE — this file is small on purpose:
//   • buildSlideSequenceCombined + renderCombinedSlide + CombinedTile +
//     SlidePreviewModal are imported from carouselCompose.js / CarouselView.jsx.
//     The lightbox (Edit text + Swap photo + Delete) is the same component
//     the IG carousel uses; it's platform-agnostic and only renders the
//     combined slide on canvas, so reusing it is risk-free.
//   • The per-slide handlers (onUpdateStatement, onSwapPhoto,
//     onRetryStatement, onDeleteSlide, onAddSlide) are the SAME callbacks
//     ContentView wires for Instagram. They operate on (rowId, sourceIndex)
//     and persist to generated_content.slides regardless of platform.
//   • The photo-picker UX (used both inline by the lightbox swap and by the
//     "Add photo" modal here) reuses the Replace-photo candidate logic:
//     photoPool filtered to exclude photos already used by other slides.
//
// LinkedIn-specific bits:
//   • Cap is 9 (LINKEDIN_MAX_GALLERY_IMAGES) — the Add-photo button disables
//     at cap; an over-cap warning banner appears if the count exceeds it
//     (e.g. an old draft).
//   • No "Download all slides" or PostToInstagramButton — the post button
//     for LinkedIn is PostToLinkedInButton, rendered separately by the
//     parent right below this editor.
//   • No Facebook album editor / no IG carousel preview chrome.

import { useState } from "react";
import { buildSlideSequenceCombined, DEFAULT_BRAND_TOKENS, HUMAN_SUBJECT } from "./carouselCompose";
import { CombinedTile, SlidePreviewModal } from "./CarouselView";
import { LINKEDIN_MAX_GALLERY_IMAGES } from "../../../shared/carouselPosting.js";

const LI_BLUE = "#0a66c2"; // matches PostToLinkedInButton

function LinkedInGalleryEditor({
  slides,
  rowId,
  stats,
  footer,
  brandTokens,
  photoPool,
  onUpdateStatement,
  onSwapPhoto,
  onRetryStatement,
  onDeleteSlide,
  onAddSlide,
}) {
  // Merge brand tokens over defaults (skip nullish — matches CarouselView).
  const bt = { ...DEFAULT_BRAND_TOKENS };
  for (const [k, v] of Object.entries(brandTokens || {})) {
    if (v != null) bt[k] = v;
  }

  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");

  if (!Array.isArray(slides) || slides.length === 0) return null;

  const seq = buildSlideSequenceCombined(slides, { stats, footer });
  const slidesArr = Array.isArray(slides) ? slides : [];
  const liveCount = slidesArr.length;
  const cap = LINKEDIN_MAX_GALLERY_IMAGES;
  const atCap   = liveCount >= cap;
  const overCap = liveCount > cap;

  // Source slides marked stale (photo swapped, caption not yet regenerated).
  const staleCount = slidesArr.filter((s) => s && s._needsCaption === true).length;

  // Add-photo candidates: same filter as Replace-photo — every analyzed
  // photo NOT already on a source slide.
  const used = new Set(slidesArr.map((s) => s && s.photo_url).filter(Boolean));
  const addCandidates = (Array.isArray(photoPool) ? photoPool : [])
    .filter((c) => c.photo_url && !used.has(c.photo_url));

  const onPickAdd = async (candidate) => {
    if (typeof onAddSlide !== "function") return;
    setAddErr(""); setAddBusy(true);
    const res = (await onAddSlide(rowId, candidate)) || {};
    setAddBusy(false);
    if (res.ok) { setAddOpen(false); return; }
    if (res.reason === "atCap") {
      setAddErr(`LinkedIn allows up to ${res.cap} images; this gallery already has ${res.count}. Delete a tile first.`);
      return;
    }
    setAddErr("Couldn't add that slide. Please try again.");
  };

  const labelSt = {
    fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.12em", textTransform: "uppercase", display: "block",
  };

  return (
    <div style={{ marginTop: 6 }}>
      {/* Header row: live count + Add photo */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <label style={{ ...labelSt, marginBottom: 0 }}>
          LinkedIn gallery · {seq.length} slides{" "}
          {/* Count badge — neutral under the cap, emphasized (gold) only at
              or above the cap. The over-cap banner below stays red because
              that's an actionable warning, but the inline count shouldn't
              look like an error while there's still headroom (8/9, 7/9, …). */}
          <span style={{
            color: atCap ? "#e8c97a" : "rgba(255,255,255,0.45)",
            fontWeight: atCap ? 600 : 400,
          }}>
            ({liveCount} / {cap} images)
          </span>
        </label>
        {typeof onAddSlide === "function" && (
          <button
            onClick={() => { setAddErr(""); setAddOpen(true); }}
            disabled={atCap || addCandidates.length === 0}
            title={atCap
              ? `At the ${cap}-image LinkedIn cap — delete a tile first`
              : addCandidates.length === 0
                ? "No other usable photos for this listing — every analyzed photo is already in the gallery."
                : "Add a new interior tile"}
            style={{
              padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${LI_BLUE}`,
              background: "rgba(10,102,194,0.10)", color: "#cfe1f4",
              cursor: (atCap || addCandidates.length === 0) ? "not-allowed" : "pointer",
              opacity: (atCap || addCandidates.length === 0) ? 0.55 : 1,
              fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
            }}
          >＋ Add photo</button>
        )}
      </div>

      {staleCount > 0 && (
        <div style={{
          marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fbbf24",
          background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.35)", borderRadius: 8, padding: "10px 12px",
        }}>
          ⚠ {staleCount} {staleCount === 1 ? "tile has" : "tiles have"} a swapped photo whose caption hasn't been regenerated. Open the tile to retry or edit the text before posting.
        </div>
      )}

      {overCap && (
        <div style={{
          marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px",
        }}>
          ⚠ This gallery has {liveCount} images — LinkedIn allows up to {cap}. Delete tiles to bring it under the cap before posting.
        </div>
      )}

      {/* Numbered tile strip. Each tile is a combined photo+caption preview;
          clicking opens the lightbox (same one IG uses). Interior tiles get
          a small × delete affordance bottom-right. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {seq.map((item, i) => (
          <div key={i} style={{ width: 120 }}>
            <div
              onClick={() => setLightboxIndex(i)}
              title="Click to preview full size"
              style={{ position: "relative", cursor: "pointer" }}
            >
              <CombinedTile item={item} bt={bt} />
              <span style={{
                position: "absolute", top: 5, left: 5, background: "rgba(8,18,40,0.78)", color: "#fff",
                borderRadius: 4, padding: "1px 6px", fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
              }}>{String(i + 1).padStart(2, "0")}</span>
              {item.needsCaption && (
                <span title="Caption needs updating — photo swapped, statement not regenerated" style={{
                  position: "absolute", top: 5, right: 5, background: "rgba(234,179,8,0.92)", color: "#1a1505",
                  borderRadius: 4, padding: "1px 5px", fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                }}>⚠ caption</span>
              )}
              {item.type === "combined" && item.kind === "room" && typeof onDeleteSlide === "function" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSlide(rowId, item.sourceIndex);
                  }}
                  title="Delete this tile"
                  style={{
                    position: "absolute", bottom: 6, right: 6,
                    width: 22, height: 22, borderRadius: 11,
                    background: "rgba(8,12,20,0.85)", border: "1px solid rgba(255,255,255,0.25)",
                    color: "#f87171", cursor: "pointer", lineHeight: "20px", padding: 0,
                    fontFamily: "'Jost', sans-serif", fontSize: 14, fontWeight: 700,
                  }}
                >×</button>
              )}
            </div>
            <div style={{
              marginTop: 4, textAlign: "center", fontFamily: "'Jost', sans-serif", fontSize: 8.5,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: "#cfe1f4",
            }}>
              {item.kind === "hook" ? "Hook" : item.kind === "cta" ? "CTA" : (item.kicker || "Slide")}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox — same component IG uses. Closes on successful delete via
          the wrapper we hand to onDeleteSlide. */}
      {lightboxIndex !== null && (
        <SlidePreviewModal
          seq={seq}
          index={lightboxIndex}
          bt={bt}
          slides={slides}
          photoPool={photoPool}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex((i) => Math.min(seq.length - 1, i + 1))}
          canPersist={!!rowId}
          onUpdateStatement={
            typeof onUpdateStatement === "function"
              ? (sourceIndex, text) => onUpdateStatement(rowId, sourceIndex, text)
              : undefined
          }
          onSwapPhoto={
            typeof onSwapPhoto === "function"
              ? (sourceIndex, candidate) => onSwapPhoto(rowId, sourceIndex, candidate)
              : undefined
          }
          onRetryStatement={
            typeof onRetryStatement === "function"
              ? (sourceIndex) => onRetryStatement(rowId, sourceIndex)
              : undefined
          }
          onDeleteSlide={
            typeof onDeleteSlide === "function"
              ? async (sourceIndex) => {
                  const res = (await onDeleteSlide(rowId, sourceIndex)) || {};
                  if (res.ok) setLightboxIndex(null);
                  return res;
                }
              : undefined
          }
        />
      )}

      {/* Add-photo modal — same picker UX as Replace photo in the lightbox. */}
      {addOpen && (
        <div onClick={() => !addBusy && setAddOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(4,8,16,0.78)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(95vw, 560px)", background: "#0e1220", border: `1px solid ${LI_BLUE}44`,
            borderRadius: 14, padding: 18, fontFamily: "'Jost', sans-serif", color: "#F0EDE8",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 600, color: "#F5ECD7" }}>
                Add a tile
              </div>
              <button onClick={() => !addBusy && setAddOpen(false)} style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 0,
              }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginBottom: 12 }}>
              Picking a photo inserts a new interior tile and writes its caption — written for that room in isolation, so it won't reference the rest of the gallery's narrative arc. The tile lands between the existing rooms and the closing tile.
            </div>
            {addErr && (
              <div style={{
                marginBottom: 10, fontSize: 12, color: "#f87171",
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 10px",
              }}>{addErr}</div>
            )}
            {addBusy ? (
              <div style={{
                fontSize: 12, color: "#cfe1f4",
                background: "rgba(10,102,194,0.10)", border: `1px solid ${LI_BLUE}55`,
                borderRadius: 8, padding: "10px 14px",
              }}>⟳ Adding tile and generating its caption…</div>
            ) : addCandidates.length === 0 ? (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", padding: "8px 2px" }}>
                No other usable photos for this listing — every analyzed photo is already in the gallery.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: "55vh", overflowY: "auto" }}>
                {addCandidates.map((c) => (
                  <button key={c.id || c.photo_url} onClick={() => onPickAdd(c)} title="Add this photo" style={{
                    width: 100, padding: 0, border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 8, background: "rgba(255,255,255,0.04)", cursor: "pointer", overflow: "hidden", textAlign: "left",
                  }}>
                    <img src={c.photo_url} alt="" loading="lazy" crossOrigin="anonymous" style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }} />
                    <div style={{ padding: "4px 5px 5px" }}>
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 8.5, color: "#cfe1f4", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {HUMAN_SUBJECT[c.category] || c.category}
                      </div>
                      {Array.isArray(c.features) && c.features.length > 0 && (
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.45)", lineHeight: 1.3, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {c.features.slice(0, 3).join(", ")}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LinkedInGalleryEditor;
