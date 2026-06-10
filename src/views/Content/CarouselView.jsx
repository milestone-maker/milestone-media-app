// CarouselView — shared, social-ready renderer for a walkthrough_carousel.
//
// Used by BOTH the Content tab Result panel and each expanded History row, so a
// saved carousel renders identically to a fresh one (the persistence fix). Shows
// the Style B "statement-then-reveal" sequence in order (numbered: card → photo),
// with "Download all slides" (client-composed ZIP) and one-click copy of the
// caption + hashtags. Composition is on-demand at download — nothing is stored.

import { useState, useEffect, useRef } from "react";
import {
  buildSlideSequence,
  downloadCarouselZip,
  DEFAULT_BRAND_TOKENS,
  renderCardSlide,
  renderPhotoSlide,
  ensureFonts,
  loadImage,
  HUMAN_SUBJECT,
} from "./carouselCompose";
import { composeAndUploadCarousel } from "./carouselUpload";
import { checkCarouselImageCap } from "../../../shared/carouselPosting.js";
import { supabase } from "../../supabaseClient";

function MiniCopy({ text, label }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };
  return (
    <button onClick={onCopy} style={{
      padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "'Jost', sans-serif",
      fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
      background: copied ? "rgba(74,222,128,0.12)" : "rgba(201,168,76,0.08)",
      border: `1px solid ${copied ? "rgba(74,222,128,0.35)" : "rgba(201,168,76,0.25)"}`,
      color: copied ? "#4ade80" : "#c9a84c",
    }}>{copied ? "✓ Copied" : label}</button>
  );
}

// CSS preview of a Style B text card (mirrors the canvas brand tokens).
function CardTile({ item, bt }) {
  return (
    <div style={{
      width: 120, height: 150, background: bt.bgColor, borderRadius: 6,
      border: `1px solid ${bt.accentColor}55`, padding: "10px 8px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", overflow: "hidden",
    }}>
      {item.kicker && (
        <div style={{
          fontFamily: `'${bt.fontBody}', sans-serif`, fontSize: 7, letterSpacing: "0.14em",
          color: bt.accentColor, textTransform: "uppercase", marginBottom: 6,
        }}>{item.kicker}</div>
      )}
      <div style={{
        fontFamily: `'${bt.fontHeadline}', serif`, color: bt.textColor,
        fontSize: item.kind === "hook" ? 14 : 12, fontWeight: item.kind === "hook" ? 700 : 600,
        lineHeight: 1.22, display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>{item.statement}</div>
      {item.kind === "hook" && item.stats && (
        <div style={{ fontFamily: `'${bt.fontBody}', sans-serif`, fontSize: 7, color: "#6B6256", marginTop: 6 }}>
          {[item.stats.beds != null && item.stats.beds !== "" ? `${item.stats.beds} BD` : null,
            item.stats.baths != null && item.stats.baths !== "" ? `${item.stats.baths} BA` : null,
            item.stats.sqft ? `${item.stats.sqft} SF` : null].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

// ── Full-size slide preview (lightbox) ──────────────────────────────────────
// Renders the ACTUAL carousel canvas (the same renderCardSlide/renderPhotoSlide
// used at download) for the open slide and appends the <canvas> element to the
// modal. Display-only: we never call toBlob/toDataURL here, so there is no taint
// concern at all. Lazy — only the open slide composes; prev/next re-render.
const STATEMENT_MAX = 200;   // hard cap to prevent pathological overflow
const STATEMENT_WARN = 140;  // soft warning — past this, lines may shrink/overflow

function SlidePreviewModal({ seq, index, bt, slides, photoPool, onClose, onPrev, onNext, onUpdateStatement, onSwapPhoto, onRetryStatement, canPersist }) {
  const containerRef = useRef(null);
  const logoRef  = useRef({ loaded: false, img: null }); // logo loaded once, cached
  const fontsRef = useRef(false);                         // ensureFonts run once
  const [status, setStatus] = useState("rendering");      // "rendering" | "ready" | "error"

  const item = seq[index];
  const count = seq.length;
  const atFirst = index <= 0;
  const atLast  = index >= count - 1;
  const isCard  = item.type === "card";
  const isPhoto = item.type === "photo";
  const canEdit = isCard && typeof onUpdateStatement === "function";
  const canSwap = isPhoto && typeof onSwapPhoto === "function" && Array.isArray(photoPool) && photoPool.length > 0;

  // Inline edit state. Re-seeded whenever the open slide changes.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(isCard ? (item.statement || "") : "");

  // Photo-swap state, scoped to the open slide. "regenerating" while the new
  // card statement is being generated; "error" if it failed (the swapped photo
  // stays — only the caption is pending). The durable stale signal across
  // navigation/reload is item.needsCaption.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [regenState, setRegenState] = useState("idle"); // "idle" | "regenerating" | "error"
  useEffect(() => {
    setEditing(false);
    setDraft(item.type === "card" ? (item.statement || "") : "");
    setPickerOpen(false);
    setRegenState("idle");
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Candidate pool for this photo slide: includable photos (already filtered by
  // the parent) MINUS any photo_url used by ANOTHER source slide. The slide
  // being replaced stays selectable (only OTHER slides' photos are excluded).
  const usedByOthers = new Set(
    (Array.isArray(slides) ? slides : [])
      .filter((_, i) => i !== item.sourceIndex)
      .map((s) => s.photo_url)
      .filter(Boolean)
  );
  const candidates = (Array.isArray(photoPool) ? photoPool : [])
    .filter((c) => c.photo_url && !usedByOthers.has(c.photo_url));

  const onPick = async (candidate) => {
    setPickerOpen(false);
    setRegenState("regenerating");
    const { ok } = (await onSwapPhoto(item.sourceIndex, candidate)) || {};
    setRegenState(ok ? "idle" : "error");
  };
  const onRetry = async () => {
    if (typeof onRetryStatement !== "function") return;
    setRegenState("regenerating");
    const { ok } = (await onRetryStatement(item.sourceIndex)) || {};
    setRegenState(ok ? "idle" : "error");
  };

  // Stale = photo swapped but statement not yet regenerated (persisted flag) OR
  // the most recent regen attempt for this open slide failed.
  const isStale = item.needsCaption === true || regenState === "error";

  // Re-fire the canvas render when the statement changes (an edit), not just on
  // index/bt. statementKey is "" for photo slides (no editable text).
  const statementKey = isCard ? (item.statement || "") : "";
  // Photo slides must also repaint when their photo/category changes (a swap on
  // the CURRENTLY-OPEN slide), so include those in the render key below.
  const photoKey = isPhoto ? `${item.photo_url || ""}|${item.category || ""}` : "";

  // Render the current slide on demand. Keyed on index + bt-by-value (bt is
  // rebuilt each parent render, so stringify it to avoid spurious re-renders).
  const btKey = JSON.stringify(bt);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("rendering");
      try {
        if (!fontsRef.current) { await ensureFonts(bt); fontsRef.current = true; }
        if (!logoRef.current.loaded) {
          logoRef.current.loaded = true;
          if (bt.logoUrl) {
            try { logoRef.current.img = await loadImage(bt.logoUrl, "anonymous"); }
            catch { logoRef.current.img = null; }
          }
        }
        const canvas = item.type === "card"
          ? await renderCardSlide(item, bt, logoRef.current.img)
          : await renderPhotoSlide(item.photo_url, { category: item.category, brandTokens: bt });
        if (cancelled) return; // a newer slide was opened — drop this stale canvas
        const host = containerRef.current;
        if (!host) return;
        host.innerHTML = "";
        canvas.style.display = "block";
        canvas.style.maxHeight = "85vh";
        canvas.style.maxWidth = "95vw";
        canvas.style.width = "auto";
        canvas.style.height = "auto";
        canvas.style.borderRadius = "8px";
        canvas.style.boxShadow = "0 20px 60px rgba(0,0,0,0.6)";
        host.appendChild(canvas);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, btKey, statementKey, photoKey]);

  // Keyboard: ←/→ step, Esc closes. While editing, don't navigate/close — Esc
  // cancels the edit and arrows move the cursor inside the textarea.
  useEffect(() => {
    const onKey = (e) => {
      if (editing) {
        if (e.key === "Escape") { setEditing(false); setDraft(item.statement || ""); }
        return; // swallow arrows/Esc so they don't step/close while editing
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && !atFirst) onPrev();
      else if (e.key === "ArrowRight" && !atLast) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, atFirst, atLast, editing, item]);

  const navBtn = (disabled) => ({
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff", borderRadius: 999, width: 44, height: 44, fontSize: 22, lineHeight: 1,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1, flexShrink: 0,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,8,16,0.88)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "16px", gap: 14,
      }}
    >
      {/* Top bar: counter + close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "min(95vw, 520px)" }}
      >
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>
          {index + 1} / {count}
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 0 }}
        >×</button>
      </div>

      {/* Slide + nav arrows */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: "100%" }}>
        <button onClick={onPrev} disabled={atFirst} title="Previous (←)" style={navBtn(atFirst)}>‹</button>

        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
          <div ref={containerRef} style={{ display: status === "ready" ? "block" : "none" }} />
          {status === "rendering" && (
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.6)", padding: "60px 40px" }}>
              Rendering…
            </div>
          )}
          {status === "error" && (
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#f87171", padding: "60px 40px", textAlign: "center" }}>
              Couldn't render this slide.
            </div>
          )}
        </div>

        <button onClick={onNext} disabled={atLast} title="Next (→)" style={navBtn(atLast)}>›</button>
      </div>

      {/* Card text editor (card slides only) */}
      {canEdit && (
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(95vw, 520px)" }}>
          {!editing ? (
            <button
              onClick={() => { setDraft(item.statement || ""); setEditing(true); }}
              style={{
                background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                color: "#e8c97a", borderRadius: 8, padding: "8px 14px", cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
              }}
            >✎ Edit text</button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                value={draft}
                maxLength={STATEMENT_MAX}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: "10px 12px",
                  color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14, lineHeight: 1.4,
                  outline: "none", resize: "vertical", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: draft.length > STATEMENT_WARN ? "#e8c97a" : "rgba(255,255,255,0.4)" }}>
                  {draft.length}/{STATEMENT_MAX}
                  {draft.length > STATEMENT_WARN && " · Long lines may shrink or overflow the card"}
                  {!canPersist && " · edit not saved (regenerate to enable saving)"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setDraft(item.statement || ""); setEditing(false); }}
                    style={{
                      background: "transparent", border: "1px solid rgba(255,255,255,0.18)",
                      color: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 12,
                    }}
                  >Cancel</button>
                  <button
                    onClick={() => { onUpdateStatement(item.sourceIndex, draft.trim()); setEditing(false); }}
                    style={{
                      background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)", border: "none",
                      color: "#0a1628", borderRadius: 8, padding: "7px 16px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                    }}
                  >Save</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stale-caption marker — photo swapped but statement not yet regenerated.
          Shows on BOTH the card and the photo of a swapped slide. Soft heads-up,
          never blocks download. Clears when regen succeeds or the text is edited. */}
      {isStale && regenState !== "regenerating" && (
        <div onClick={(e) => e.stopPropagation()} style={{
          width: "min(95vw, 520px)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.45)", borderRadius: 8,
          padding: "8px 12px",
        }}>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fbbf24", flex: 1, minWidth: 180 }}>
            ⚠ Caption needs updating — this photo was swapped but its statement hasn’t been regenerated.
          </span>
          {typeof onRetryStatement === "function" && (
            <button onClick={onRetry} style={{
              background: "rgba(234,179,8,0.18)", border: "1px solid rgba(234,179,8,0.5)", color: "#fbbf24",
              borderRadius: 8, padding: "6px 12px", cursor: "pointer",
              fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600,
            }}>↻ Retry</button>
          )}
          {canEdit && (
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              or use “✎ Edit text” above to write it yourself
            </span>
          )}
        </div>
      )}

      {/* Photo-swap controls (photo slides only) */}
      {isPhoto && (
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(95vw, 520px)" }}>
          {regenState === "regenerating" ? (
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e8c97a",
              background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)",
              borderRadius: 8, padding: "8px 14px", display: "inline-block",
            }}>⟳ Regenerating caption…</div>
          ) : !pickerOpen ? (
            canSwap && (
              <button onClick={() => setPickerOpen(true)} style={{
                background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                color: "#e8c97a", borderRadius: 8, padding: "8px 14px", cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
              }}>⇄ Replace photo</button>
            )
          ) : (
            <div style={{
              background: "rgba(8,18,40,0.6)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10, padding: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Replace with a photo from this listing
                </span>
                <button onClick={() => setPickerOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginBottom: 10 }}>
                Picking a photo regenerates this card’s caption on its own — written for this room in isolation, so it won’t reference the rest of the carousel’s narrative arc.
              </div>
              {candidates.length === 0 ? (
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", padding: "8px 2px" }}>
                  No other usable photos for this listing — every analyzed photo is already in the carousel.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: "40vh", overflowY: "auto" }}>
                  {candidates.map((c) => {
                    const isCurrent = c.photo_url === item.photo_url;
                    return (
                      <button key={c.id || c.photo_url} onClick={() => onPick(c)} title={isCurrent ? "Current photo" : "Use this photo"} style={{
                        width: 92, padding: 0, border: `1px solid ${isCurrent ? "#C9A84C" : "rgba(255,255,255,0.14)"}`,
                        borderRadius: 8, background: "rgba(255,255,255,0.04)", cursor: "pointer", overflow: "hidden", textAlign: "left",
                      }}>
                        <img src={c.photo_url} alt="" loading="lazy" crossOrigin="anonymous" style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }} />
                        <div style={{ padding: "4px 5px 5px" }}>
                          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 8.5, color: "#c9a84c", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {HUMAN_SUBJECT[c.category] || c.category}{isCurrent ? " · current" : ""}
                          </div>
                          {Array.isArray(c.features) && c.features.length > 0 && (
                            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.45)", lineHeight: 1.3, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {c.features.slice(0, 3).join(", ")}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Get the current session's access token + agent id in one call.
async function getSession() {
  const { data } = await supabase.auth.getSession();
  return { token: data?.session?.access_token || null, agentId: data?.session?.user?.id || null };
}

// ── Scheduling helpers (Stage 3a) ────────────────────────────────────
// The whole app treats wall-clock times as America/Chicago (Central) — see
// api/calendar.js and api/microsite-chat.js — and Stage 3b will assume the
// same. So a scheduled post's picked time is interpreted as Central, NOT the
// browser's local zone, and converted to a UTC ISO before it leaves the page.

const TZ = "America/Chicago";
// Must mirror SCHEDULE_BUFFER_MS in api/social-post.js — the floor a scheduled
// time must clear so the server never rejects a too-soon pick.
const SCHEDULE_BUFFER_MS = 3 * 60 * 1000; // 3 minutes

// Convert a <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm"), read as a
// Central wall-clock time, into the UTC ISO string for that exact instant.
// DST-correct: we derive Central's offset for THAT specific date via
// Intl.DateTimeFormat rather than assuming a fixed -5/-6h or trusting the
// browser's own zone.
function centralWallClockToUtcIso(localValue) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue || "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Instant if the wall clock were UTC.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // What Central wall clock does that instant render as? (numbered in UTC)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(asUtc));
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const centralAsUtc = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second,
  );
  const offset = centralAsUtc - asUtc; // Central's offset from UTC for this date
  return new Date(asUtc - offset).toISOString();
}

// Render a UTC ISO instant as a friendly Central-time label, e.g.
// "Tue, Jun 9, 2026 at 3:30 PM CT".
function formatCentral(iso) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
  return `${label} CT`;
}

// "Post to Instagram" — ties compose→upload→post together with connection
// gating, the shared image-count cap, a caption-preview confirm, and status
// feedback. Self-contained (own hooks/modal) so CarouselView stays simple.
//   • not connected → routes the agent to the Stage 1 Instagram connect view
//   • over the cap  → blocks with a "trim to post" message
//   • confirm       → shows the caption (already includes hashtags) + count
function PostToInstagramButton({ slides, caption, stats, footer, brandTokens, contentId }) {
  const [connection, setConnection] = useState("checking"); // checking|connected|none|error
  const [phase, setPhase] = useState("idle");               // idle|confirm|working|done|error
  const [step, setStep] = useState("");                     // progress label while working
  const [msg, setMsg] = useState("");                       // error / blocked message
  const [posted, setPosted] = useState(null);               // returned status string
  const [mode, setMode] = useState("now");                  // "now" | "schedule"
  const [scheduleLocal, setScheduleLocal] = useState("");   // datetime-local value (Central wall-clock)
  const [scheduledLabel, setScheduledLabel] = useState(""); // Central label shown on the scheduled success state

  const cap = checkCarouselImageCap(slides);

  // Check connection once on mount (reuses GET /api/social-status from Stage 1).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { token } = await getSession();
        if (!token) { if (alive) setConnection("error"); return; }
        const res = await fetch("/api/social-status", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (alive) setConnection(body?.status === "connected" ? "connected" : "none");
      } catch { if (alive) setConnection("error"); }
    })();
    return () => { alive = false; };
  }, []);

  const goConnect = () => { window.location.assign("/?social=connect"); };

  const onClick = () => {
    setMsg("");
    if (connection !== "connected") { goConnect(); return; }
    if (!contentId) { setPhase("error"); setMsg("This carousel is still saving — try again in a moment."); return; }
    if (!cap.ok) { setPhase("error"); setMsg(cap.message); return; }
    setMode("now"); setScheduleLocal(""); setMsg("");
    setPhase("confirm");
  };

  const doPost = async () => {
    // Resolve the optional postDate from the chosen mode BEFORE leaving the
    // confirm dialog, so a bad pick keeps the modal open with a message.
    let postDate; // undefined → immediate; ISO string → scheduled
    let chosenIso = null;
    if (mode === "schedule") {
      chosenIso = centralWallClockToUtcIso(scheduleLocal);
      if (!chosenIso) { setMsg("Pick a date and time to schedule."); return; }
      // Client-side guard mirrors the server buffer so the user gets a friendly
      // message instead of a 400.
      if (new Date(chosenIso).getTime() < Date.now() + SCHEDULE_BUFFER_MS) {
        setMsg("Pick a time at least a few minutes from now.");
        return;
      }
      postDate = chosenIso;
    }

    setPhase("working"); setMsg("");
    try {
      const { token, agentId } = await getSession();
      if (!token || !agentId) throw new Error("Your session expired. Please sign in again.");

      setStep("Composing & uploading images…");
      const imageUrls = await composeAndUploadCarousel({ slides, stats, footer, brandTokens, agentId, contentId });

      setStep(mode === "schedule" ? "Scheduling…" : "Posting to Instagram…");
      const res = await fetch("/api/social-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(postDate ? { contentId, imageUrls, postDate } : { contentId, imageUrls }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Posting failed (${res.status})`);

      setPosted(body?.status || "submitted");
      // Prefer the server's authoritative effective time for the scheduled label.
      if (mode === "schedule") setScheduledLabel(formatCentral(body?.scheduledFor || chosenIso));
      else setScheduledLabel("");
      setPhase("done");
    } catch (e) {
      console.error("[PostToInstagram] failed:", e);
      setMsg(e?.message || "Could not post to Instagram. Please try again.");
      setPhase("error");
    }
  };

  // Posted — terminal success pill. Scheduled posts show their Central time.
  if (phase === "done") {
    return (
      <span style={{
        fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
        color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
        borderRadius: 8, padding: "8px 14px",
      }}>
        {scheduledLabel ? `✓ Scheduled for ${scheduledLabel}` : "✓ Posted to Instagram"}
      </span>
    );
  }

  const working = phase === "working";
  const label =
    connection === "checking" ? "Checking…"
    : connection !== "connected" ? "Connect Instagram to post"
    : working ? (step || "Working…")
    : "Post to Instagram";

  return (
    <>
      <button
        onClick={onClick}
        disabled={working || connection === "checking"}
        title={connection !== "connected" && connection !== "checking" ? "Connect your Instagram first" : undefined}
        style={{
          padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.4)",
          cursor: working || connection === "checking" ? "default" : "pointer",
          opacity: working || connection === "checking" ? 0.6 : 1,
          background: "rgba(201,168,76,0.1)", color: "#e8c97a",
          fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 11,
          letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap",
        }}
      >{label}</button>

      {phase === "error" && msg && (
        <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#f87171", maxWidth: 280 }}>
          {msg} <button onClick={() => { setPhase("idle"); setMsg(""); }} style={{ background: "none", border: "none", color: "#e8c97a", cursor: "pointer", textDecoration: "underline", fontSize: 11 }}>dismiss</button>
        </span>
      )}

      {/* Confirm dialog: caption preview (already includes hashtags) + count,
          plus a Post-now / Schedule-for-later choice. */}
      {phase === "confirm" && (
        <div onClick={() => setPhase("idle")} style={{
          position: "fixed", inset: 0, background: "rgba(4,8,16,0.78)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(94vw, 480px)", background: "#0e1220", border: "1px solid rgba(201,168,76,0.2)",
            borderRadius: 14, padding: "24px 24px 20px", fontFamily: "'Jost', sans-serif", color: "#F0EDE8",
          }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 600, color: "#F5ECD7", marginBottom: 4 }}>
              Post to Instagram
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>
              {cap.count} images · {mode === "schedule" ? "schedules to your connected account." : "posts immediately to your connected account."}
            </div>
            <div style={{
              maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5,
              color: "rgba(255,255,255,0.82)", background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px", marginBottom: 16,
            }}>{caption || "(no caption)"}</div>

            {/* When to post: Post now vs Schedule for later */}
            <div style={{ display: "flex", gap: 8, marginBottom: mode === "schedule" ? 12 : 16 }}>
              {[["now", "Post now"], ["schedule", "Schedule for later"]].map(([m, lbl]) => {
                const active = mode === m;
                return (
                  <button key={m} onClick={() => { setMode(m); setMsg(""); }} style={{
                    flex: 1, padding: "9px 12px", borderRadius: 9, cursor: "pointer",
                    border: active ? "1px solid rgba(201,168,76,0.7)" : "1px solid rgba(255,255,255,0.16)",
                    background: active ? "rgba(201,168,76,0.14)" : "transparent",
                    color: active ? "#e8c97a" : "rgba(255,255,255,0.7)",
                    fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: active ? 700 : 500,
                  }}>{lbl}</button>
                );
              })}
            </div>

            {mode === "schedule" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>
                  Date &amp; time (Central / CT)
                </label>
                <input
                  type="datetime-local"
                  value={scheduleLocal}
                  onChange={(e) => { setScheduleLocal(e.target.value); setMsg(""); }}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.04)",
                    color: "#F0EDE8", fontFamily: "'Jost', sans-serif", fontSize: 13,
                    colorScheme: "dark",
                  }}
                />
              </div>
            )}

            {msg && (
              <div style={{ fontSize: 12, color: "#f87171", marginBottom: 14 }}>{msg}</div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPhase("idle")} style={{
                padding: "10px 18px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.18)",
                background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 12,
              }}>Cancel</button>
              <button onClick={doPost} style={{
                padding: "10px 20px", borderRadius: 9, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)", color: "#0a1628",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
              }}>{mode === "schedule" ? "Schedule" : "Post now"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CarouselView({ slides, caption, hashtags, address, stats, footer, brandTokens, rowId, onUpdateStatement, photoPool, onSwapPhoto, onRetryStatement }) {
  // Merge over the Milestone defaults, but IGNORE null/undefined token values so
  // an agent who hasn't set a given color/font falls back to the default rather
  // than overriding it with null (a plain spread copies the nullish value and
  // would break canvas fillStyle / font strings).
  const bt = { ...DEFAULT_BRAND_TOKENS };
  for (const [k, v] of Object.entries(brandTokens || {})) {
    if (v != null) bt[k] = v;
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null); // open slide in the preview modal, or null

  if (!Array.isArray(slides) || slides.length === 0) return null;

  const seq = buildSlideSequence(slides, { stats, footer });
  const cardCount = seq.filter((s) => s.type === "card").length;
  const photoCount = seq.filter((s) => s.type === "photo").length;
  // Source slides flagged stale (photo swapped, statement not regenerated). One
  // count per SOURCE slide (card+photo share needsCaption) — a soft heads-up so
  // a mismatched card isn't downloaded unnoticed. Download is never hard-blocked.
  const staleCount = (Array.isArray(slides) ? slides : []).filter((s) => s._needsCaption === true).length;

  const onDownload = async () => {
    setErr(""); setBusy(true);
    try {
      await downloadCarouselZip({ slides, stats, footer, brandTokens: bt, address });
    } catch (e) {
      console.error("[CarouselView] download failed:", e);
      setErr(e?.message || "Couldn't build the download. Please try again.");
    }
    setBusy(false);
  };

  const labelSt = {
    fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.12em", textTransform: "uppercase", display: "block",
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <label style={{ ...labelSt, marginBottom: 0 }}>
          Carousel · {seq.length} slides <span style={{ color: "rgba(255,255,255,0.25)" }}>({cardCount} cards · {photoCount} photos)</span>
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {caption && <MiniCopy text={caption} label="Copy caption" />}
          {Array.isArray(hashtags) && hashtags.length > 0 && <MiniCopy text={hashtags.join(" ")} label="Copy hashtags" />}
          <button onClick={onDownload} disabled={busy} style={{
            padding: "8px 16px", borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1, background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
            color: "#0a1628", fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 11,
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>{busy ? "Composing…" : "⤓ Download all slides"}</button>
          <PostToInstagramButton slides={slides} caption={caption} stats={stats} footer={footer} brandTokens={bt} contentId={rowId} />
        </div>
      </div>

      {err && (
        <div style={{
          marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 12px",
        }}>{err}</div>
      )}

      {staleCount > 0 && (
        <div style={{
          marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fbbf24",
          background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.35)", borderRadius: 8, padding: "10px 12px",
        }}>
          ⚠ {staleCount} {staleCount === 1 ? "slide has" : "slides have"} a swapped photo whose caption hasn’t been regenerated. Open the slide to retry or edit the text before downloading.
        </div>
      )}

      {/* Numbered sequence: card → photo, in order */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {seq.map((item, i) => (
          <div key={i} style={{ width: 120 }}>
            <div
              onClick={() => setLightboxIndex(i)}
              title="Click to preview full size"
              style={{ position: "relative", cursor: "pointer" }}
            >
              {item.type === "card" ? (
                <CardTile item={item} bt={bt} />
              ) : (
                <img src={item.photo_url} alt="" loading="lazy" crossOrigin="anonymous" style={{
                  width: 120, height: 150, objectFit: "cover", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.1)", display: "block",
                }} />
              )}
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
            </div>
            <div style={{
              marginTop: 4, textAlign: "center", fontFamily: "'Jost', sans-serif", fontSize: 8.5,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: item.type === "card" ? "#c9a84c" : "rgba(255,255,255,0.35)",
            }}>{item.type === "card" ? (item.kind === "hook" ? "Hook card" : item.kind === "cta" ? "CTA card" : "Card") : "Photo"}</div>
          </div>
        ))}
      </div>

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
        />
      )}
    </div>
  );
}

export default CarouselView;
