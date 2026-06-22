// LinkedIn post/schedule control for the Content tab.
//
// Mirrors PostToFacebookButton's shape — LinkedIn content has no slides and no
// album, so this is a single text post (MVP: caption + microsite link, no
// images yet). The agent picks a TARGET CHANNEL ("Post as: My profile" /
// "Acme Pages" / …) on every post; the choice is sticky as a default but
// always overridable.
//
// Endpoints touched:
//   GET  /api/social-status?platform=linkedin
//        → { status, username, channels:[{id,name,username,...}], channelId }
//   POST /api/social-post
//        → body { contentId, platform:"linkedin", channelId, postDate? }
//
// "Smart time" mode is hidden because RECOMMENDED_SLOTS.linkedin isn't
// defined yet — Post now + Pick a time are the two options.

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { centralWallClockToUtcIso, formatCentral, SCHEDULE_BUFFER_MS } from "../../lib/postScheduling";
import { scheduleState } from "../../lib/scheduledPosts";
import { composeAndUploadCarousel } from "./carouselUpload";

const GOLD = "#c9a84c";
const LI_BLUE = "#0a66c2"; // LinkedIn brand blue

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return { token: data?.session?.access_token || null };
}

// Channel label fallback chain: name (humans) → username (org slug / profile
// handle) → id (last resort). Different channel records carry different
// fields — bundle's spec doesn't promise any single one is populated.
function channelLabel(c) {
  if (!c) return "(no name)";
  return c.name || c.username || c.id || "(no name)";
}

/**
 * PostToLinkedInButton supports two modes:
 *   • Single-image / text-only (default): the agent picks 0 or 1 photo from
 *     the listing's analyzed pool inside the confirm modal, and the POST
 *     sends imageUrls=[url] or omits it.
 *   • Multi-photo gallery: when a non-empty `slides` prop is passed, the
 *     button composes the slides through the SAME carousel compositor
 *     Instagram uses (combined photo+caption tiles), uploads them all,
 *     and sends the N image URLs as imageUrls. The in-modal single-image
 *     picker is hidden in this mode because the photos are owned by the
 *     LinkedInGalleryEditor above. `stats`, `footer`, `brandTokens`,
 *     `address` are forwarded to composeCarousel; same shape the
 *     IG flow uses, so callers can pass exactly what they already have.
 */
function PostToLinkedInButton({ contentId, photos = [], slides = null, stats, footer, brandTokens, address }) {
  const galleryMode = Array.isArray(slides) && slides.length > 0;
  const [connection, setConnection] = useState("checking"); // checking|connected|none|error
  const [channels, setChannels] = useState([]);             // bundle channels[]
  const [channelId, setChannelId] = useState("");           // user's selected target
  const [activeChannelId, setActiveChannelId] = useState(null); // channel bundle will actually post to
  const [phase, setPhase] = useState("idle");               // idle|confirm|working|done|error
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState("now");                  // now|schedule
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [scheduledLabel, setScheduledLabel] = useState("");
  const [existing, setExisting] = useState({ kind: "none", record: null });
  // Optional single image (LinkedIn MVP: text-only OR one image; never an
  // album). null = text-only post. Reset whenever the post modal opens.
  const [photoUrl, setPhotoUrl] = useState(null);

  // Initial connection + channels load. The status endpoint returns channels[]
  // and the agent's sticky channelId default for platform=linkedin in one call.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { token } = await getSession();
        if (!token) { if (alive) setConnection("error"); return; }
        const res = await fetch("/api/social-status?platform=linkedin", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (body?.status === "connected") {
          setConnection("connected");
          const list = Array.isArray(body.channels) ? body.channels : [];
          setChannels(list);
          const active = body.activeChannelId || null;
          setActiveChannelId(active);
          // Preselect the ACTIVE channel — that's the only one bundle will
          // actually post to right now (set-channel is a one-shot bind we
          // can't safely re-run). Fall back to sticky preference if for
          // some reason the active is missing, then first, then empty.
          const activeMatch = active && list.find((c) => c.id === active);
          const sticky     = body.channelId && list.find((c) => c.id === body.channelId);
          setChannelId(activeMatch ? activeMatch.id : (sticky ? sticky.id : (list[0]?.id || "")));
        } else {
          setConnection("none");
        }
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
    } catch { /* best-effort */ }
  };
  useEffect(() => { refreshExisting(); /* eslint-disable-next-line */ }, [contentId]);

  const goConnect = () => { window.location.assign("/?social=connected&platform=linkedin"); };

  const open = () => {
    setMsg("");
    if (connection !== "connected") { goConnect(); return; }
    if (!contentId) { setPhase("error"); setMsg("This post is still saving — try again in a moment."); return; }
    setMode("now"); setScheduleLocal(""); setPhotoUrl(null);
    setPhase("confirm");
  };

  const doPost = async () => {
    if (!channelId) { setMsg("Pick a target — your profile or a Page."); return; }
    let postDate = null;
    if (mode === "schedule") {
      const iso = centralWallClockToUtcIso(scheduleLocal);
      if (!iso) { setMsg("Pick a date and time to schedule."); return; }
      if (new Date(iso).getTime() < Date.now() + SCHEDULE_BUFFER_MS) {
        setMsg("Pick a time a few minutes from now or later.");
        return;
      }
      postDate = iso;
    }

    setPhase("working"); setMsg("");
    try {
      const { token } = await getSession();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const { data: sess } = await supabase.auth.getSession();
      const agentId = sess?.session?.user?.id || null;

      // Multi-photo gallery mode: compose the slides into combined
      // photo+caption tiles using the SAME compositor IG uses, upload them
      // to public Storage, and send N image URLs. Server validates ≤ 9.
      // Single-image / text-only mode: send 0 or 1 imageUrls from the
      // in-modal picker.
      let imageUrls = null;
      if (galleryMode) {
        if (!agentId) throw new Error("Your session expired. Please sign in again.");
        if (!contentId) throw new Error("This post is still saving — try again in a moment.");
        imageUrls = await composeAndUploadCarousel({
          slides, stats, footer, brandTokens, agentId, contentId,
          platform: "linkedin",
        });
      } else if (photoUrl) {
        imageUrls = [photoUrl];
      }

      const body = { contentId, platform: "linkedin", channelId };
      if (postDate) body.postDate = postDate;
      if (Array.isArray(imageUrls) && imageUrls.length > 0) body.imageUrls = imageUrls;

      const res = await fetch("/api/social-post", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const respBody = await res.json().catch(() => ({}));
      if (res.ok) {
        setScheduledLabel(mode === "schedule" ? formatCentral(respBody?.scheduledFor || postDate) : "");
        setPhase("done");
        refreshExisting();
        return;
      }
      // Server returned an error — surface it. 409 = not connected etc.
      setPhase("confirm");
      setMsg(typeof respBody?.error === "string" ? respBody.error : `Couldn't post (${res.status}).`);
    } catch (e) {
      setPhase("error");
      setMsg(typeof e?.message === "string" ? e.message : "Couldn't reach the poster. Please try again.");
    }
  };

  // ── Render ──
  const btn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled} style={{
      padding: "9px 16px", borderRadius: 8, border: "none",
      background: opts.disabled ? "rgba(10,102,194,0.25)" : (opts.ghost ? "transparent" : LI_BLUE),
      color: opts.ghost ? "rgba(255,255,255,0.7)" : "#fff",
      ...(opts.ghost ? { border: "1px solid rgba(255,255,255,0.15)" } : {}),
      fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
      cursor: opts.disabled ? "default" : "pointer",
    }}>{label}</button>
  );

  if (connection === "checking") {
    return <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Checking LinkedIn connection…</div>;
  }

  if (phase === "done") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#4ade80" }}>
        <span>✓</span>
        <span>{scheduledLabel ? `Scheduled for ${scheduledLabel}` : "Posted to LinkedIn"}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {connection === "connected"
          ? btn("💼 Post to LinkedIn", open)
          : btn("💼 Connect LinkedIn to post", goConnect, { ghost: true })}
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
          background: "rgba(8,12,24,0.85)", border: "1px solid rgba(10,102,194,0.3)",
        }}>
          {existing.kind === "scheduled" && (
            <div style={{
              marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#e8c97a",
              background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, padding: "8px 10px",
            }}>
              This post is already scheduled for {formatCentral(existing.record?.scheduled_for)}. Posting again will create a second post.
            </div>
          )}

          {/* Post-as target picker — always visible, sticky default preselected. */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 7,
            }}>
              Post as
            </div>
            {channels.length === 0 ? (
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                No LinkedIn targets returned by your connection. Reconnect LinkedIn from Connected Accounts and try again.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {channels.map((c) => {
                  const isActive   = activeChannelId ? c.id === activeChannelId : false;
                  const isSelected = c.id === channelId;
                  // ANY channel is selectable for ergonomics — but only the
                  // ACTIVE one will actually post. Non-active picks trigger
                  // the reconnect-to-switch hint below the picker and disable
                  // the Post button. activeChannelId === null (couldn't be
                  // detected) falls through to the legacy behaviour: every
                  // channel selectable, post goes to whatever bundle thinks
                  // is bound.
                  const disabled = !!(activeChannelId && !isActive);
                  return (
                    <label key={c.id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      cursor: disabled ? "not-allowed" : "pointer",
                      padding: "7px 10px", borderRadius: 8,
                      border: isSelected ? `1px solid ${LI_BLUE}` : "1px solid rgba(255,255,255,0.12)",
                      background: isSelected ? "rgba(10,102,194,0.15)" : "rgba(255,255,255,0.03)",
                      opacity: disabled ? 0.55 : 1,
                    }}>
                      <input
                        type="radio"
                        name="li-channel"
                        value={c.id}
                        checked={isSelected}
                        onChange={() => setChannelId(c.id)}
                        style={{ accentColor: LI_BLUE, cursor: disabled ? "not-allowed" : "pointer" }}
                      />
                      <span style={{
                        fontFamily: "'Jost', sans-serif", fontSize: 12.5,
                        color: isSelected ? "#cfe1f4" : "rgba(255,255,255,0.75)",
                        flex: 1,
                      }}>{channelLabel(c)}</span>
                      {isActive && (
                        <span style={{
                          fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                          letterSpacing: "0.06em", textTransform: "uppercase",
                          padding: "1px 6px", borderRadius: 4,
                          background: "rgba(74,222,128,0.16)", color: "#86efac",
                        }}>Active</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {/* Switching active LinkedIn target requires a reconnect — bundle's
                runtime set-channel rejects re-binds. Surface the hint only
                when (a) we know the active channel and (b) the user has
                picked a non-active one. */}
            {activeChannelId && channelId && channelId !== activeChannelId ? (
              <div style={{
                marginTop: 8, fontFamily: "'Jost', sans-serif", fontSize: 11, lineHeight: 1.5,
                color: "#e8c97a", background: "rgba(201,168,76,0.07)",
                border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, padding: "8px 10px",
              }}>
                LinkedIn posting goes to your currently-active target only. To post as this one instead,{" "}
                <button
                  onClick={goConnect}
                  style={{ background: "none", border: "none", color: "#e8c97a", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 11 }}
                >reconnect LinkedIn</button>
                {" "}and pick it during the OAuth flow.
              </div>
            ) : (
              <div style={{
                marginTop: 6, fontFamily: "'Jost', sans-serif", fontSize: 10.5,
                color: "rgba(255,255,255,0.35)", lineHeight: 1.5,
              }}>
                The post goes to the channel marked Active. To switch the active target you'll need to{" "}
                <button
                  onClick={goConnect}
                  style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 10.5 }}
                >reconnect LinkedIn</button>
                {" "}and pick the new one in the bundle.social portal.
              </div>
            )}
          </div>

          {/* Optional single image — single-image / text-only mode ONLY.
              In gallery mode the photos are owned by LinkedInGalleryEditor
              above this button; the post sends those composed tile URLs
              directly, so this in-modal picker is hidden. */}
          {!galleryMode && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 10.5, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 7,
            }}>
              Image <span style={{ textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.3)" }}>· optional, one photo</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* "No image" tile — text-only post. */}
              <button
                onClick={() => setPhotoUrl(null)}
                title="Post text only"
                style={{
                  width: 76, height: 76, borderRadius: 8,
                  border: photoUrl === null ? `2px solid ${LI_BLUE}` : "1px solid rgba(255,255,255,0.14)",
                  background: photoUrl === null ? "rgba(10,102,194,0.16)" : "rgba(255,255,255,0.03)",
                  color: photoUrl === null ? "#cfe1f4" : "rgba(255,255,255,0.55)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Jost', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em",
                  textAlign: "center", padding: 4,
                }}
              >Text only</button>
              {(Array.isArray(photos) ? photos : []).filter((p) => p && p.photo_url).map((p) => {
                const selected = photoUrl === p.photo_url;
                return (
                  <button
                    key={p.photo_url}
                    onClick={() => setPhotoUrl(p.photo_url)}
                    title={p.category || "photo"}
                    style={{
                      width: 76, height: 76, padding: 0, overflow: "hidden", borderRadius: 8,
                      border: selected ? `2px solid ${LI_BLUE}` : "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.04)", cursor: "pointer", position: "relative",
                    }}
                  >
                    <img src={p.photo_url} alt="" loading="lazy" crossOrigin="anonymous" style={{
                      width: "100%", height: "100%", objectFit: "cover", display: "block",
                    }} />
                    {selected && (
                      <span style={{
                        position: "absolute", top: 4, right: 4, background: LI_BLUE, color: "#fff",
                        borderRadius: 4, padding: "1px 5px", fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                      }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            {(!Array.isArray(photos) || photos.length === 0) && (
              <div style={{ marginTop: 6, fontFamily: "'Jost', sans-serif", fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>
                No analyzed photos for this listing — posting as text only. Run photo analysis on the listing to add an image.
              </div>
            )}
          </div>
          )}

          {galleryMode && (
            <div style={{
              marginBottom: 14, fontFamily: "'Jost', sans-serif", fontSize: 11,
              color: "#cfe1f4",
              background: "rgba(10,102,194,0.08)", border: `1px solid ${LI_BLUE}55`,
              borderRadius: 8, padding: "8px 12px", lineHeight: 1.5,
            }}>
              Posting {slides.length} composed tile{slides.length === 1 ? "" : "s"} from the gallery above — edit tiles there before posting. The post body is your full caption with the live microsite link substituted in, plus hashtags.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[["now", "Post now"], ["schedule", "Pick a time"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setMsg(""); }} style={{
                padding: "7px 13px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                border: mode === m ? `1px solid ${LI_BLUE}` : "1px solid rgba(255,255,255,0.12)",
                background: mode === m ? "rgba(10,102,194,0.16)" : "rgba(255,255,255,0.04)",
                color: mode === m ? "#cfe1f4" : "rgba(255,255,255,0.6)",
              }}>{label}</button>
            ))}
          </div>

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

          {msg && <div style={{ marginBottom: 12, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#f87171", lineHeight: 1.5 }}>{msg}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            {btn(mode === "now" ? "Post now" : "Schedule", doPost, {
              // Block posting on a non-active target — bundle would silently
              // route to the active channel anyway, which would be a
              // confusing UX. When activeChannelId is unknown (legacy/no
              // detection), keep the old behaviour: any non-empty pick
              // posts.
              disabled: !channelId || (!!activeChannelId && channelId !== activeChannelId),
            })}
            {btn("Cancel", () => { setPhase("idle"); setMsg(""); }, { ghost: true })}
          </div>
          <div style={{ marginTop: 10, fontFamily: "'Jost', sans-serif", fontSize: 10.5, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            {galleryMode
              ? `We'll compose and post all ${slides.length} gallery tile${slides.length === 1 ? "" : "s"}; the post body is your full caption with the live microsite link substituted in, plus hashtags.`
              : photoUrl
                ? "We'll post this image with the caption and insert the live microsite link automatically."
                : "We'll post the caption as a text-only update and insert the live microsite link automatically."}
          </div>
        </div>
      )}

      {phase === "working" && (
        <div style={{ marginTop: 10, fontFamily: "'Jost', sans-serif", fontSize: 12, color: GOLD }}>Posting to LinkedIn…</div>
      )}
    </div>
  );
}

export default PostToLinkedInButton;
