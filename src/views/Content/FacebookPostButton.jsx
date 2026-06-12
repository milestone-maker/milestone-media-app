// Facebook post/schedule control for the Content tab (Stage 3 Part B).
//
// FB generated content has no slides, so CarouselView never renders for it.
// This is the FB equivalent — a Post / Schedule control shown in the FB result
// panel AND FB History rows. Unlike Instagram, the client composites + uploads
// NOTHING: it just POSTs { contentId, platform:'facebook', postDate? } and the
// SERVER builds the photo album from the listing's classified photos and
// re-resolves the microsite link. Mode picker mirrors CarouselView:
//   • Post Now      → immediate
//   • Schedule      → manual datetime (Central wall-clock)
//   • Smart         → nextRecommendedSlot(now, 'facebook')
//
// Reuses the shared schedule helpers + the platform-general /api/social-posts
// reconciliation (already-scheduled indicator) and Upcoming Posts list.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import {
  nextRecommendedSlot,
  centralWallClockToUtcIso,
  formatCentral,
  SCHEDULE_BUFFER_MS,
} from "../../lib/postScheduling";
import { scheduleState } from "../../lib/scheduledPosts";
import { buildFacebookPostRequest, interpretFacebookPostResponse } from "../../lib/facebookPosting";
import { facebookAlbumUrls } from "../../../api/_content/selectCarouselPhotos.js";
import { LabeledThumb, PhotoLightbox } from "./photoAlbum";

const GOLD = "#c9a84c";
const FB_BLUE = "#3b82f6";

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return { token: data?.session?.access_token || null };
}

function PostToFacebookButton({ contentId, photos = [] }) {
  const [connection, setConnection] = useState("checking"); // checking|connected|none|error
  const [phase, setPhase] = useState("idle");               // idle|confirm|working|done|error
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState("now");                  // now|smart|schedule
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [smartSlot, setSmartSlot] = useState(null);
  const [scheduledLabel, setScheduledLabel] = useState("");
  const [existing, setExisting] = useState({ kind: "none", record: null });
  // Agent-added album photos (URLs), in selection order.
  const [extras, setExtras] = useState([]);
  // Larger-preview lightbox: { photo, addable } | null.
  const [preview, setPreview] = useState(null);

  // The curated default album (mirrors the server) + the listing's OTHER
  // classified photos the agent can add. Computed from the listing's photo_labels.
  const { curated, others, byUrl } = useMemo(() => {
    const curatedUrls = facebookAlbumUrls(photos);
    const inDefault = new Set(curatedUrls);
    const map = new Map();
    for (const p of (Array.isArray(photos) ? photos : [])) {
      if (p?.photo_url && !map.has(p.photo_url)) map.set(p.photo_url, p);
    }
    const curatedRows = curatedUrls.map((u) => map.get(u) || { photo_url: u, category: "" });
    const otherRows = [];
    for (const p of map.values()) if (!inDefault.has(p.photo_url)) otherRows.push(p);
    return { curated: curatedRows, others: otherRows, byUrl: map };
  }, [photos]);

  const rowFor = (url) => byUrl.get(url) || { photo_url: url, category: "" };

  const toggleExtra = (url) =>
    setExtras((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));

  // FB connection status (Stage 1 status endpoint is platform-aware).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { token } = await getSession();
        if (!token) { if (alive) setConnection("error"); return; }
        const res = await fetch("/api/social-status?platform=facebook", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (alive) setConnection(body?.status === "connected" ? "connected" : "none");
      } catch { if (alive) setConnection("error"); }
    })();
    return () => { alive = false; };
  }, []);

  const refreshExisting = async () => {
    if (!contentId) { setExisting({ kind: "none", record: null }); return; }
    try {
      const { token } = await getSession();
      if (!token) return;
      const res = await fetch(`/api/social-posts?contentId=${encodeURIComponent(contentId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setExisting(scheduleState(body.posts || [], new Date()));
    } catch { /* best-effort indicator */ }
  };
  useEffect(() => { refreshExisting(); /* eslint-disable-next-line */ }, [contentId]);

  const goConnect = () => { window.location.assign("/?social=connected&platform=facebook"); };

  const open = () => {
    setMsg("");
    if (connection !== "connected") { goConnect(); return; }
    if (!contentId) { setPhase("error"); setMsg("This post is still saving — try again in a moment."); return; }
    setMode("now"); setScheduleLocal(""); setSmartSlot(null); setExtras([]); setPreview(null);
    setPhase("confirm");
  };

  const selectMode = (m) => {
    setMsg("");
    if (m === "smart") setSmartSlot(nextRecommendedSlot(new Date(), "facebook"));
    setMode(m);
  };

  const doPost = async () => {
    const built = buildFacebookPostRequest({ contentId, mode, scheduleLocal, smartSlot, extraPhotoUrls: extras, now: new Date() });
    if (built.error) { setMsg(built.error); return; }
    const isScheduled = mode === "schedule" || mode === "smart";

    setPhase("working"); setMsg("");
    try {
      const { token } = await getSession();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const res = await fetch("/api/social-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(built.body),
      });
      const body = await res.json().catch(() => ({}));
      const outcome = interpretFacebookPostResponse(res.status, body);

      if (outcome.kind === "success") {
        setScheduledLabel(isScheduled ? formatCentral(outcome.scheduledFor || built.body.postDate) : "");
        setPhase("done");
        refreshExisting();
        return;
      }
      // blocked (no photos) / conflict (not connected) / error → keep the modal open.
      setPhase("confirm");
      setMsg(outcome.message);
    } catch (e) {
      setPhase("error");
      setMsg(typeof e?.message === "string" ? e.message : "Couldn't reach the poster. Please try again.");
    }
  };

  // ── Render ──
  const btn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled} style={{
      padding: "9px 16px", borderRadius: 8, border: "none",
      background: opts.disabled ? "rgba(59,130,246,0.25)" : (opts.ghost ? "transparent" : FB_BLUE),
      color: opts.ghost ? "rgba(255,255,255,0.7)" : "#fff",
      ...(opts.ghost ? { border: "1px solid rgba(255,255,255,0.15)" } : {}),
      fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
      cursor: opts.disabled ? "default" : "pointer",
    }}>{label}</button>
  );

  if (connection === "checking") {
    return <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Checking Facebook connection…</div>;
  }

  if (phase === "done") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#4ade80" }}>
        <span>✓</span>
        <span>{scheduledLabel ? `Scheduled for ${scheduledLabel}` : "Posted to Facebook"}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {connection === "connected"
          ? btn("📘 Post to Facebook", open)
          : btn("📘 Connect Facebook to post", goConnect, { ghost: true })}
        {existing.kind === "scheduled" && existing.record?.scheduled_for && (
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#e8c97a" }}>
            Already scheduled · {formatCentral(existing.record.scheduled_for)}
          </span>
        )}
      </div>

      {phase === "error" && msg && (
        <div style={{ marginTop: 8, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#f87171" }}>{msg}</div>
      )}

      {/* Confirm / mode modal */}
      {phase === "confirm" && (
        <div style={{
          marginTop: 12, padding: 16, borderRadius: 12,
          background: "rgba(8,12,24,0.85)", border: "1px solid rgba(59,130,246,0.3)",
        }}>
          {existing.kind === "scheduled" && (
            <div style={{
              marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#e8c97a",
              background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, padding: "8px 10px",
            }}>
              This post is already scheduled for {formatCentral(existing.record?.scheduled_for)}. Posting again will create a second post.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[["now", "Post now"], ["smart", "Smart time"], ["schedule", "Pick a time"]].map(([m, label]) => (
              <button key={m} onClick={() => selectMode(m)} style={{
                padding: "7px 13px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                border: mode === m ? `1px solid ${FB_BLUE}` : "1px solid rgba(255,255,255,0.12)",
                background: mode === m ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.04)",
                color: mode === m ? "#93c5fd" : "rgba(255,255,255,0.6)",
              }}>{label}</button>
            ))}
          </div>

          {mode === "smart" && (
            <div style={{ marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
              {smartSlot?.label ? `Next recommended Facebook time: ${smartSlot.label}` : "No recommended time available — pick one manually."}
            </div>
          )}

          {mode === "schedule" && (
            <input
              type="datetime-local"
              value={scheduleLocal}
              onChange={(e) => setScheduleLocal(e.target.value)}
              style={{
                marginBottom: 12, width: "100%", padding: "9px 11px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#ECE7DC",
                fontFamily: "'Jost', sans-serif", fontSize: 12,
              }}
            />
          )}

          {/* Album preview: curated defaults + the agent's added photos, each
              labeled by category. Tap any to preview large. */}
          {(curated.length > 0 || extras.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 7 }}>
                In the album · {curated.length + extras.length} photo{curated.length + extras.length === 1 ? "" : "s"} <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.3)" }}>— tap to preview</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {curated.map((p) => (
                  <LabeledThumb key={p.photo_url} photo={p} badge="default" badgeColor={FB_BLUE} onClick={() => setPreview({ photo: p, addable: false })} />
                ))}
                {extras.map((url) => {
                  const p = rowFor(url);
                  return <LabeledThumb key={url} photo={p} badge="added" badgeColor="#16a34a" onClick={() => setPreview({ photo: p, addable: true })} />;
                })}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 7 }}>
                Add more photos <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.3)" }}>— tap to preview &amp; add</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {others.map((p) => (
                  <LabeledThumb
                    key={p.photo_url}
                    photo={p}
                    selected={extras.includes(p.photo_url)}
                    onClick={() => setPreview({ photo: p, addable: true })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Shared larger-preview lightbox. Addable photos get an Add/Remove action. */}
          {preview && (
            <PhotoLightbox
              photo={preview.photo}
              onClose={() => setPreview(null)}
              action={preview.addable ? {
                label: extras.includes(preview.photo.photo_url) ? "Remove from album" : "Add to album",
                onClick: () => toggleExtra(preview.photo.photo_url),
              } : null}
            />
          )}

          {msg && <div style={{ marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#f87171", lineHeight: 1.5 }}>{msg}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            {btn(mode === "now" ? "Post now" : "Schedule", doPost)}
            {btn("Cancel", () => { setPhase("idle"); setMsg(""); }, { ghost: true })}
          </div>
          <div style={{ marginTop: 10, fontFamily: "'Jost', sans-serif", fontSize: 10.5, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            We'll build the photo album from this listing's analyzed photos and add the live microsite link automatically.
          </div>
        </div>
      )}

      {phase === "working" && (
        <div style={{ marginTop: 10, fontFamily: "'Jost', sans-serif", fontSize: 12, color: GOLD }}>Posting to Facebook…</div>
      )}
    </div>
  );
}

export default PostToFacebookButton;
