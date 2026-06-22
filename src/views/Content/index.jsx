// ContentView — the Content tab (formerly "Media" in the nav).
//
// Lets an agent generate on-brand Instagram content for one of their
// listings using their saved voice profile, via POST /api/content-generate
// (the engine + persistence shipped in 2a). Shows the generated result and
// a per-listing history of past generations (read from generated_content,
// which RLS already scopes to the agent's own rows).
//
// Front-end only — no schema/endpoint changes. Auth follows the established
// Bearer-token pattern (supabase.auth.getSession() → access_token), the same
// one used by the parse-comps call in Microsite/ComparableSalesSection.jsx.
//
// Layout is deliberately split into independent panels (setup → result →
// history) so a future "photo intelligence" panel can be slotted in without
// restructuring this screen.

import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { hasFeatureAccess } from "../../lib/subscription";
import { PUBLIC_APP_BASE as MICROSITE_PUBLIC_BASE } from "../../lib/siteConfig";
import VoiceProfileModal from "../../components/VoiceProfileModal";
import PhotosPanel from "./PhotosPanel";
import CarouselView from "./CarouselView";
import FacebookAlbumEditor from "./FacebookAlbumEditor";
import PostToLinkedInButton from "./PostToLinkedInButton";
import LinkedInGalleryEditor from "./LinkedInGalleryEditor";
import UpcomingPosts from "./UpcomingPosts";
import { includable } from "../../../api/_content/selectCarouselPhotos.js";
import { INSTAGRAM_MAX_CAROUSEL_IMAGES, LINKEDIN_MAX_GALLERY_IMAGES } from "../../../shared/carouselPosting.js";

// Friendly label → exact framework_name slug the endpoint expects, keyed by
// platform. Instagram keeps its 7 listing frameworks; Facebook (Stage 2) adds
// 5 FB-native long-form frameworks. The style picker swaps lists when the
// platform toggle changes.
//
// `comingSoon: true` marks frameworks that are visible-but-disabled on the
// platform until they're brought up to parity. Walkthrough Carousel is the
// only Instagram framework currently shipping the combined photo+caption
// slide format — the other six render visible with a "Coming soon" tag.
// Facebook is unaffected.
const FRAMEWORKS_BY_PLATFORM = {
  instagram: [
    { label: "Walkthrough Carousel",         slug: "walkthrough_carousel" },
    { label: "Story-Driven",                 slug: "story_driven_listing",       comingSoon: true },
    { label: '"You" Hook',                   slug: "you_hook_listing",           comingSoon: true },
    { label: "Behind-the-Scenes / Pre-List", slug: "behind_the_scenes_prelist",  comingSoon: true },
    { label: "Neighborhood-First",           slug: "neighborhood_first",         comingSoon: true },
    { label: "Problem → Solution",           slug: "problem_solution",           comingSoon: true },
    { label: "POV: Day in the Life",         slug: "pov_day_in_life",            comingSoon: true },
  ],
  facebook: [
    // Listing-focused first, then community/market frameworks.
    { label: "Property Showcase",   slug: "property_showcase" },
    { label: "Investment Angle",    slug: "investment_angle" },
    { label: "Neighbor Story",      slug: "neighbor_story" },
    { label: "Community Question",  slug: "community_question" },
    { label: "Market Plain-Talk",   slug: "market_plain_talk" },
    { label: "Win Share",           slug: "win_share" },
    { label: "Resource Drop",       slug: "resource_drop" },
  ],
  // LinkedIn stopgaps until LinkedIn-native prompts ship at
  // api/_content/prompts/linkedin/:
  //   • "Standard post" → FB-aliased single-caption prompt (text + optional
  //     single image). The original LinkedIn flow, proven live on prod.
  //   • "Multi-photo gallery" → IG-walkthrough-aliased prompt that emits a
  //     per-photo slides[] array. Drives the LinkedIn gallery editor
  //     (combined photo+caption tiles, capped at 9 per LinkedIn's limit).
  linkedin: [
    { label: "Standard post (stopgap)",       slug: "property_showcase" },
    { label: "Multi-photo gallery (stopgap)", slug: "walkthrough_carousel" },
  ],
};

// First selectable (non-comingSoon) framework for a platform — the safe
// default when the user lands on the platform or switches to it.
function firstEnabledFramework(platform) {
  const list = FRAMEWORKS_BY_PLATFORM[platform] || [];
  const enabled = list.find((f) => !f.comingSoon);
  return (enabled || list[0])?.slug;
}
// Whether a framework is currently selectable for a platform.
function isFrameworkEnabled(platform, slug) {
  const list = FRAMEWORKS_BY_PLATFORM[platform] || [];
  const entry = list.find((f) => f.slug === slug);
  return !!entry && !entry.comingSoon;
}
const PLATFORMS = [
  { key: "instagram", label: "Instagram", emoji: "📷" },
  { key: "facebook",  label: "Facebook",  emoji: "📘" },
  { key: "linkedin",  label: "LinkedIn",  emoji: "💼" },
];
const ALL_FRAMEWORKS = [...FRAMEWORKS_BY_PLATFORM.instagram, ...FRAMEWORKS_BY_PLATFORM.facebook];
const labelForSlug = (slug) => ALL_FRAMEWORKS.find((f) => f.slug === slug)?.label || slug;
const platformLabel = (key) => PLATFORMS.find((p) => p.key === key)?.label || key;

// Facebook captions carry a microsite-link PLACEHOLDER TOKEN (api/_lib/microsite.js)
// instead of a baked URL. Resolve it for DISPLAY + COPY: substitute the live
// microsite URL, or drop the token's line when the listing has no published
// microsite. NEVER show the raw token. Mirrors the server's substituteMicrositeToken.
const MICROSITE_TOKEN = "[[MILESTONE_MICROSITE_URL]]";
function resolveCaptionForDisplay(caption, micrositeUrl) {
  if (typeof caption !== "string" || !caption.includes(MICROSITE_TOKEN)) return caption;
  if (micrositeUrl) return caption.split(MICROSITE_TOKEN).join(micrositeUrl);
  return caption.includes("\n" + MICROSITE_TOKEN)
    ? caption.split("\n" + MICROSITE_TOKEN).join("")
    : caption.split(MICROSITE_TOKEN).join("");
}

// Map an HTTP status (and the server's bodyJson.error) to a friendly,
// non-crashing message for the agent.
function friendlyError(status, serverMsg) {
  switch (status) {
    case 401: return "Your session expired. Please sign in again.";
    case 402: return "An active subscription is required to generate content. Open Subscriptions from your profile menu to get started.";
    case 422: return "Your voice profile needs a license number before you can generate. Open your Voice Profile to add it.";
    case 403: return "This listing or voice profile isn't available to your account. Pick one of your own listings and try again.";
    case 404: return "That listing or voice profile couldn't be found. Refresh and try again.";
    case 400: return serverMsg || "Something about that request wasn't right. Adjust your selection and try again.";
    case 500:
    case 502: return "The generator hit a snag. Please try again in a moment.";
    default:  return serverMsg || "Couldn't generate content. Please try again.";
  }
}

const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

// ── Shared inline styles (match the app's dark/gold theme) ──
const panelSt = {
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14, padding: 20,
};
const labelSt = {
  fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
  letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10, display: "block",
};
const inputSt = {
  width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "11px 14px", color: "#fff",
  fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none", boxSizing: "border-box",
};
const goldBtn = (disabled) => ({
  width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
  background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)", color: "#0a1628",
  fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase",
});
const ghostBtn = {
  padding: "11px 16px", borderRadius: 8, cursor: "pointer",
  background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c",
  fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
};

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable — no-op, never crash */ }
  };
  return (
    <button onClick={onCopy} style={{
      ...ghostBtn, padding: "6px 12px", fontSize: 10,
      background: copied ? "rgba(74,222,128,0.12)" : "rgba(201,168,76,0.08)",
      borderColor: copied ? "rgba(74,222,128,0.35)" : "rgba(201,168,76,0.25)",
      color: copied ? "#4ade80" : "#c9a84c",
    }}>{copied ? "✓ Copied" : label}</button>
  );
}

// Editable caption block. Display mode shows the resolved caption (microsite
// token substituted to the live URL) with Copy + Edit affordances. Edit mode
// opens a textarea pre-filled with the RAW stored caption (token visible) so
// the agent can keep/replace/remove the token, with Save/Cancel. Save calls
// onSave(rawText) which the parent persists to generated_content.caption.
// canPersist=false (an unsaved fresh generation with no saved_id) keeps the
// textarea functional locally but disables the Save button — same shape as
// the per-slide editor's behavior.
function EditableCaption({
  caption,
  micrositeUrl,
  onSave,
  canPersist,
  size = "result", // "result" | "history"
}) {
  const raw = typeof caption === "string" ? caption : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const [saving, setSaving] = useState(false);

  // Re-seed the draft when the upstream caption changes (e.g. a fresh
  // generation lands while not in edit mode).
  useEffect(() => { if (!editing) setDraft(raw); }, [raw, editing]);

  const displayText = resolveCaptionForDisplay(raw, micrositeUrl);
  const ghostBtnSm = {
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 10,
    fontFamily: "'Jost', sans-serif", fontWeight: 600, letterSpacing: "0.06em",
    background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c",
  };
  const headerWrap = size === "result"
    ? { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }
    : { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8 };
  const bodyStyle = size === "result"
    ? {
        whiteSpace: "pre-wrap", fontFamily: "'Jost', sans-serif", fontSize: 13.5, color: "#ECE7DC",
        lineHeight: 1.7, background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "16px 18px",
        border: "1px solid rgba(255,255,255,0.06)",
      }
    : { whiteSpace: "pre-wrap", fontFamily: "'Jost', sans-serif", fontSize: 12.5, color: "#ECE7DC", lineHeight: 1.7 };
  const taStyle = {
    width: "100%", boxSizing: "border-box",
    fontFamily: "'Jost', sans-serif", fontSize: size === "result" ? 13.5 : 12.5, color: "#ECE7DC",
    lineHeight: 1.7, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "14px 16px",
    border: "1px solid rgba(201,168,76,0.4)", outline: "none", resize: "vertical",
    minHeight: size === "result" ? 240 : 180,
  };

  const onClickSave = async () => {
    if (typeof onSave !== "function") { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); }
    finally { setSaving(false); setEditing(false); }
  };

  return (
    <>
      <div style={headerWrap}>
        {size === "result" && <label style={{ ...labelSt, marginBottom: 0 }}>Caption</label>}
        {/* Copy still works regardless of edit mode; reflects the resolved-display text. */}
        <div style={{ display: "flex", gap: 8 }}>
          <CopyButton text={displayText} label="Copy caption" />
          {!editing && typeof onSave === "function" && (
            <button
              onClick={() => { setDraft(raw); setEditing(true); }}
              style={ghostBtnSm}
              title="Edit the post caption"
            >✎ Edit</button>
          )}
        </div>
      </div>
      {!editing ? (
        <div style={bodyStyle}>{displayText}</div>
      ) : (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={taStyle}
            autoFocus
          />
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10, marginTop: 8, flexWrap: "wrap",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
              {draft.length} chars
              {!canPersist && " · edit not saved (no saved row yet)"}
              {draft.includes(MICROSITE_TOKEN) && (
                <> · contains microsite link token (live URL substitutes at post time)</>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setDraft(raw); setEditing(false); }}
                style={{
                  padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                  background: "transparent", border: "1px solid rgba(255,255,255,0.18)",
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                }}
              >Cancel</button>
              <button
                onClick={onClickSave}
                disabled={saving || !canPersist}
                style={{
                  padding: "7px 16px", borderRadius: 8,
                  cursor: (saving || !canPersist) ? "default" : "pointer",
                  background: (saving || !canPersist)
                    ? "rgba(201,168,76,0.25)"
                    : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
                  color: (saving || !canPersist) ? "rgba(26,18,6,0.55)" : "#0a1628",
                  border: "none", fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ContentView({ onOpenSubscriptions } = {}) {
  const { user, profile } = useAuth();
  // Admins always pass; otherwise an active subscription is required.
  const isAdmin = profile?.role === "admin";
  const canGenerate = isAdmin || hasFeatureAccess(profile);

  // ── Onboarding overlay state ──
  // overlay: null | "tour" | "landing"
  // overlayMode: "initial" (first-time tour — flips seen flag on exit) or "replay" (no DB write)
  const [overlay, setOverlay] = useState(null);
  const [overlayMode, setOverlayMode] = useState("initial");
  const [overlayDecided, setOverlayDecided] = useState(false);

  // Decide initial overlay once profile is loaded.
  useEffect(() => {
    if (overlayDecided) return;
    if (!profile) return;
    setOverlayDecided(true);
    const seen = profile?.seen_content_onboarding === true;
    if (!canGenerate) {
      setOverlayMode("initial");
      setOverlay("landing");
    } else if (!seen) {
      setOverlayMode("initial");
      setOverlay("tour");
    }
  }, [profile, canGenerate, overlayDecided]);

  // Latest-value refs for the postMessage handler so the listener can be
  // registered ONCE (empty deps) without going stale on state changes or
  // capturing a new onOpenSubscriptions arrow on every App render.
  const overlayRef = useRef(overlay);
  const overlayModeRef = useRef(overlayMode);
  const profileRef = useRef(profile);
  const onOpenSubscriptionsRef = useRef(onOpenSubscriptions);
  useEffect(() => { overlayRef.current = overlay; }, [overlay]);
  useEffect(() => { overlayModeRef.current = overlayMode; }, [overlayMode]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { onOpenSubscriptionsRef.current = onOpenSubscriptions; }, [onOpenSubscriptions]);

  // Listen for the tour's exit postMessage. Registered once; reads current
  // state through the refs above so it never operates on stale values.
  useEffect(() => {
    function onMsg(e) {
      if (!e || !e.data || e.data.type !== "milestone-tour-exit") return;
      const cur = overlayRef.current;
      const mode = overlayModeRef.current;
      const prof = profileRef.current;
      const openSubs = onOpenSubscriptionsRef.current;
      // Landing flow → close overlay and hand off to Subscriptions.
      if (cur === "landing") {
        setOverlay(null);
        if (typeof openSubs === "function") openSubs();
        return;
      }
      // Tour flow.
      if (cur === "tour") {
        if (
          mode === "initial" &&
          prof?.id &&
          prof?.seen_content_onboarding !== true
        ) {
          supabase
            .from("agents")
            .update({ seen_content_onboarding: true })
            .eq("id", prof.id)
            .then(({ error }) => {
              if (error) console.error("[content] mark onboarding seen failed:", error);
            });
        }
        setOverlay(null);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const openReplay = () => {
    setOverlayMode("replay");
    setOverlay("tour");
  };
  const closeLandingToPlans = () => {
    setOverlay(null);
    if (typeof onOpenSubscriptions === "function") onOpenSubscriptions();
  };

  // Data
  const [listings, setListings] = useState([]);
  const [listingsLoaded, setListingsLoaded] = useState(false);
  const [selectedListingId, setSelectedListingId] = useState(null);

  const [voiceProfile, setVoiceProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  // Generator inputs
  const [platform, setPlatform] = useState("instagram");
  const [framework, setFramework] = useState(firstEnabledFramework("instagram"));
  const [storyAngle, setStoryAngle] = useState("");

  // Switch platform: swap the style list and reset the framework selection to
  // that platform's first ENABLED framework. Prevents a previously-selected
  // framework from getting stuck "selected" on a platform that doesn't allow
  // it any more (e.g. Story-Driven selected on Facebook then user flips to
  // Instagram, which currently restricts to Walkthrough only). Clears any
  // showing result so the panels stay coherent.
  const switchPlatform = (next) => {
    if (next === platform) return;
    setPlatform(next);
    setFramework(firstEnabledFramework(next));
    setResult(null);
    setErrorMsg("");
  };

  // Safety: if the active framework is ever disabled on the current platform
  // (e.g. a future flag flip while the picker is mounted), snap to the first
  // enabled one. Skip if no framework set yet.
  useEffect(() => {
    if (framework && !isFrameworkEnabled(platform, framework)) {
      setFramework(firstEnabledFramework(platform));
    }
  }, [platform, framework]);

  // Photo-label count for the selected listing — drives the carousel nudge.
  // null = unknown / not applicable; a number once checked.
  const [photoLabelCount, setPhotoLabelCount] = useState(null);

  // Live published-microsite URL for the selected listing — used to resolve the
  // Facebook caption's microsite token for display + copy. null = none published.
  const [micrositeUrlForListing, setMicrositeUrlForListing] = useState(null);

  // Includable photo pool for the selected listing — candidates for the
  // lightbox "Replace photo" picker. Filtered by the same includable() rule
  // the server selection uses. Fetched once per listing (RLS-scoped read).
  const [photoPool, setPhotoPool] = useState([]);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [saveError, setSaveError] = useState(""); // transient "couldn't save edit" note

  // History (for the selected listing)
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // ── Load voice profile ──
  const loadVoiceProfile = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("agent_voice_profiles")
      .select("*")
      .eq("agent_id", user.id)
      .limit(1)
      .maybeSingle();
    setVoiceProfile(data || null);
    setProfileLoaded(true);
  };

  // ── Load the agent's own listings (scoped — content-generate 403s on
  //    listings the caller doesn't own) ──
  const loadListings = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("agent_id", user.id)
      .order("created_at", { ascending: false });
    const rows = data || [];
    setListings(rows);
    setSelectedListingId((prev) => prev || (rows[0]?.id ?? null));
    setListingsLoaded(true);
  };

  useEffect(() => {
    if (!user?.id) return;
    loadListings();
    loadVoiceProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Load history for the selected listing ──
  const loadHistory = async (listingId) => {
    if (!listingId) { setHistory([]); return; }
    setHistoryLoading(true);
    const { data } = await supabase
      .from("generated_content")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });
    setHistory(data || []);
    setHistoryLoading(false);
  };

  // ── Edit a card statement (Stage 3a). Updates the source slide immutably so
  //    both the thumbnail and the lightbox re-render, then persists only the
  //    slides column. RLS (agent_id = auth.uid()) scopes ownership. rowId is the
  //    generated_content id: result.saved_id for a fresh generation, or h.id for
  //    a History row. If rowId is missing (the best-effort insert failed at
  //    generation), the edit re-renders locally but cannot be persisted. ──
  // Strip the transient stale-caption flag (_needsCaption) from a slide. The
  // marker means "photo swapped but statement not yet regenerated"; any fresh
  // statement (regenerated OR hand-edited) clears it. JSON.stringify drops the
  // dropped key on persist, so the DB row also loses the flag.
  const clearStale = (s) => { const { _needsCaption, ...rest } = s; return rest; };

  // ── Edit the post caption (the post body the agent ships) ──
  // Persists generated_content.caption for an owned row (RLS scopes by
  // agent_id = auth.uid()). Mirrors updateSlideStatement's optimistic-
  // update-then-persist-then-revert-on-error shape, but operates on the
  // top-level caption field, not slides[]. The microsite token, if the
  // agent leaves it in, still gets substituted to the live URL at post
  // time by api/social-post.js. If they remove it, the post goes
  // without a link.
  const updateCaption = async (rowId, nextCaption) => {
    setSaveError("");
    const safe = typeof nextCaption === "string" ? nextCaption : "";

    // Fresh result (matched by saved_id, or rowId absent → the result is
    // the only candidate since every History row has an id).
    if ((rowId && result?.saved_id === rowId) || (!rowId && result)) {
      const prev = result;
      setResult({ ...result, caption: safe });
      if (!rowId) return; // local-only — nothing to persist
      const { error } = await supabase
        .from("generated_content")
        .update({ caption: safe })
        .eq("id", rowId);
      if (error) {
        console.error("[Content] caption edit save failed:", error);
        setResult(prev); // revert
        setSaveError("Couldn't save that edit. Please try again.");
      }
      return;
    }

    // History entry.
    if (rowId) {
      const prev = history;
      let touched = false;
      const nextHistory = history.map((h) => {
        if (h.id !== rowId) return h;
        touched = true;
        return { ...h, caption: safe };
      });
      if (!touched) return;
      setHistory(nextHistory);
      const { error } = await supabase
        .from("generated_content")
        .update({ caption: safe })
        .eq("id", rowId);
      if (error) {
        console.error("[Content] caption edit save failed:", error);
        setHistory(prev); // revert
        setSaveError("Couldn't save that edit. Please try again.");
      }
    }
  };

  const updateSlideStatement = async (rowId, sourceIndex, text) => {
    setSaveError("");
    const applyEdit = (slides) =>
      (Array.isArray(slides) ? slides : []).map((s, i) =>
        i === sourceIndex ? clearStale({ ...s, statement: text, text }) : s);

    // Fresh result (matched by saved_id, or rowId absent → the result is the only
    // candidate since every History row has an id).
    if ((rowId && result?.saved_id === rowId) || (!rowId && result)) {
      const prev = result;
      const nextSlides = applyEdit(result.slides);
      setResult({ ...result, slides: nextSlides });
      if (!rowId) return; // nothing to persist — no saved row
      const { error } = await supabase
        .from("generated_content")
        .update({ slides: nextSlides })
        .eq("id", rowId);
      if (error) {
        console.error("[Content] slide edit save failed:", error);
        setResult(prev); // revert
        setSaveError("Couldn't save that edit. Please try again.");
      }
      return;
    }

    // Otherwise it's a History entry, matched by id.
    if (rowId) {
      const prev = history;
      let nextSlides = null;
      const nextHistory = history.map((h) => {
        if (h.id !== rowId) return h;
        nextSlides = applyEdit(h.slides);
        return { ...h, slides: nextSlides };
      });
      if (!nextSlides) return; // row not found
      setHistory(nextHistory);
      const { error } = await supabase
        .from("generated_content")
        .update({ slides: nextSlides })
        .eq("id", rowId);
      if (error) {
        console.error("[Content] slide edit save failed:", error);
        setHistory(prev); // revert
        setSaveError("Couldn't save that edit. Please try again.");
      }
    }
  };

  // ── Photo swap + single-card regeneration (Stage 3b) ──
  // Locate which store (the fresh result vs a specific history row) holds rowId
  // and its current slides. Mirrors updateSlideStatement's matching: result by
  // saved_id (or the only candidate when rowId is absent), else a history row
  // by id. Returns null when no store matches.
  const locateSlides = (rowId) => {
    if ((rowId && result?.saved_id === rowId) || (!rowId && result)) {
      return {
        target: "result",
        baseSlides: Array.isArray(result.slides) ? result.slides : [],
        platform:   result.platform || "instagram",
      };
    }
    const h = history.find((x) => x.id === rowId);
    if (h) return {
      target: "history",
      baseSlides: Array.isArray(h.slides) ? h.slides : [],
      platform:   h.platform || "instagram",
    };
    return null;
  };
  const writeSlides = (target, rowId, nextSlides) => {
    if (target === "result") setResult((p) => (p ? { ...p, slides: nextSlides } : p));
    else setHistory((p) => p.map((h) => (h.id === rowId ? { ...h, slides: nextSlides } : h)));
  };
  const persistSlides = (rowId, nextSlides) =>
    supabase.from("generated_content").update({ slides: nextSlides }).eq("id", rowId);

  // Call the single-statement endpoint for one room. Throws on any failure so
  // callers keep the swapped photo and surface a retry.
  const regenerateStatement = async ({ category, features }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("session expired");
    const res = await fetch("/api/content-regenerate-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        voice_profile_id: voiceProfile?.id,
        listing_id: selectedListingId,
        category,
        features: Array.isArray(features) ? features : [],
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `regenerate failed (${res.status})`);
    }
    const j = await res.json();
    if (!j || typeof j.statement !== "string" || !j.statement.trim()) throw new Error("empty statement");
    return j.statement.trim();
  };

  // Regenerate the statement for an already-swapped slide. baseSlides is the
  // array WITH the new photo. Success: write statement (+mirror text), clear
  // the stale flag, persist once. Failure: keep the photo, mark the slide stale,
  // best-effort persist so a reload still shows new photo + the marker. Photo
  // and statement are decoupled — a regen failure never reverts the photo.
  const runRegen = async (rowId, sourceIndex, { category, features }, target, baseSlides) => {
    setSaveError("");
    const markStale = (slides) =>
      slides.map((s, i) => (i === sourceIndex ? { ...s, _needsCaption: true } : s));

    let statement;
    try {
      statement = await regenerateStatement({ category, features });
    } catch (e) {
      console.error("[content] statement regenerate failed:", e);
      const stale = markStale(baseSlides);
      writeSlides(target, rowId, stale);
      if (rowId) {
        const { error } = await persistSlides(rowId, stale);
        if (error) { console.error("[content] stale persist failed:", error); setSaveError("Couldn't save the photo swap. Please try again."); }
      }
      return { ok: false };
    }

    const updated = baseSlides.map((s, i) =>
      i === sourceIndex ? clearStale({ ...s, statement, text: statement }) : s);
    writeSlides(target, rowId, updated);
    if (!rowId) return { ok: true }; // local-only (no saved row) — cannot persist
    const { error } = await persistSlides(rowId, updated);
    if (error) {
      console.error("[content] swap+statement persist failed:", error);
      // Keep the swapped photo; drop the unsaved new statement (revert to the
      // prior caption) and mark stale so DB + UI agree.
      const stale = markStale(baseSlides);
      writeSlides(target, rowId, stale);
      await persistSlides(rowId, stale).catch(() => {});
      setSaveError("Couldn't save that edit. Please try again.");
      return { ok: false };
    }
    return { ok: true };
  };

  // Swap a slide's photo to `candidate`, then regenerate its statement. Photo
  // repaints immediately (optimistic); statement follows. `_features` is stashed
  // on the slide so a later Retry can re-run regeneration with the right inputs.
  const swapSlidePhoto = async (rowId, sourceIndex, candidate) => {
    const loc = locateSlides(rowId);
    if (!loc) return { ok: false };
    const swapped = loc.baseSlides.map((s, i) =>
      i === sourceIndex
        ? clearStale({
            ...s,
            photo_url: candidate.photo_url,
            category: candidate.category,
            _features: Array.isArray(candidate.features) ? candidate.features : [],
          })
        : s);
    writeSlides(loc.target, rowId, swapped); // immediate repaint
    return runRegen(rowId, sourceIndex, { category: candidate.category, features: candidate.features }, loc.target, swapped);
  };

  // Retry regeneration for a slide whose photo is already swapped (reads the
  // swapped photo's category + remembered features off the slide).
  const retrySlideStatement = async (rowId, sourceIndex) => {
    const loc = locateSlides(rowId);
    if (!loc) return { ok: false };
    const s = loc.baseSlides[sourceIndex];
    if (!s) return { ok: false };
    return runRegen(rowId, sourceIndex, { category: s.category, features: Array.isArray(s._features) ? s._features : [] }, loc.target, loc.baseSlides);
  };

  // Delete an INTERIOR source slide (never the hook/cover or the final/CTA).
  // Removes the slide from the array, persists, and the renderer + post path
  // pick up the change automatically (they read straight from slides[]). No
  // Storage orphans: uploads happen at post time from the current slides[],
  // so a deleted slide simply never gets uploaded.
  const deleteSlide = async (rowId, sourceIndex) => {
    setSaveError("");
    const loc = locateSlides(rowId);
    if (!loc) return { ok: false };
    const target = loc.baseSlides[sourceIndex];
    if (!target) return { ok: false };
    const isHook  = target.is_cover || target.subject === "cover";
    const isFinal = target.subject === "final";
    if (isHook || isFinal) return { ok: false, reason: "protected" };

    const next = loc.baseSlides.filter((_, i) => i !== sourceIndex);
    writeSlides(loc.target, rowId, next); // optimistic
    if (!rowId) return { ok: true };      // local-only — nothing to persist
    const { error } = await persistSlides(rowId, next);
    if (error) {
      console.error("[content] delete persist failed:", error);
      writeSlides(loc.target, rowId, loc.baseSlides); // revert
      setSaveError("Couldn't delete that slide. Please try again.");
      return { ok: false };
    }
    return { ok: true };
  };

  // Add a NEW interior slide using the picked photo, then regenerate its
  // caption via the same path swap uses. Insertion point = right before the
  // final/CTA slide (so the new slide is always interior). Per-platform cap
  // enforced defensively (the picker UI also gates this): Instagram = 10,
  // LinkedIn = 9, anything else (incl. future platforms with slides) defaults
  // to the IG cap.
  const addSlide = async (rowId, candidate) => {
    setSaveError("");
    const loc = locateSlides(rowId);
    if (!loc) return { ok: false };
    const cap = loc.platform === "linkedin" ? LINKEDIN_MAX_GALLERY_IMAGES : INSTAGRAM_MAX_CAROUSEL_IMAGES;
    if (loc.baseSlides.length >= cap) {
      return { ok: false, reason: "atCap", count: loc.baseSlides.length, cap };
    }
    if (!candidate || !candidate.photo_url) return { ok: false };

    const finalIdx = loc.baseSlides.findIndex((s) => s && s.subject === "final");
    const insertAt = finalIdx === -1 ? loc.baseSlides.length : finalIdx;
    const newSlide = {
      subject:    candidate.category || "added",
      statement:  "",
      text:       "",
      photo_url:  candidate.photo_url,
      category:   candidate.category,
      _features:  Array.isArray(candidate.features) ? candidate.features : [],
      _needsCaption: true, // surfaces the "caption needs updating" marker until regen lands
    };
    const next = [
      ...loc.baseSlides.slice(0, insertAt),
      newSlide,
      ...loc.baseSlides.slice(insertAt),
    ];
    writeSlides(loc.target, rowId, next); // optimistic insert
    if (rowId) {
      const { error } = await persistSlides(rowId, next);
      if (error) {
        console.error("[content] add persist failed:", error);
        writeSlides(loc.target, rowId, loc.baseSlides); // revert
        setSaveError("Couldn't add that slide. Please try again.");
        return { ok: false };
      }
    }
    // Same regen path swap uses — fills in the caption and clears the stale flag.
    return runRegen(rowId, insertAt, { category: candidate.category, features: candidate.features }, loc.target, next);
  };

  useEffect(() => {
    loadHistory(selectedListingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedListingId]);

  // ── Carousel nudge: does the selected listing have any photo labels? ──
  // Only checked for the walkthrough_carousel framework (cheap head count).
  useEffect(() => {
    let cancelled = false;
    if (framework !== "walkthrough_carousel" || !selectedListingId) {
      setPhotoLabelCount(null);
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("photo_labels")
        .select("id", { count: "exact", head: true })
        .eq("listing_id", selectedListingId);
      if (!cancelled) setPhotoLabelCount(typeof count === "number" ? count : null);
    })();
    return () => { cancelled = true; };
  }, [framework, selectedListingId]);

  // ── Load the includable photo pool for the selected listing (once) ──
  // Candidates for the lightbox "Replace photo" picker. RLS already scopes the
  // read to the agent's own listings (photo_labels has no agent_id column).
  useEffect(() => {
    let cancelled = false;
    if (!selectedListingId) { setPhotoPool([]); return; }
    (async () => {
      const { data, error } = await supabase
        .from("photo_labels")
        .select("*")
        .eq("listing_id", selectedListingId)
        .order("sort_order", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[content] photo pool read error:", error);
        setPhotoPool([]);
        return;
      }
      setPhotoPool((data || []).filter(includable));
    })();
    return () => { cancelled = true; };
  }, [selectedListingId]);

  // ── Resolve the listing's live published-microsite URL (for FB caption token) ──
  useEffect(() => {
    let cancelled = false;
    if (!selectedListingId) { setMicrositeUrlForListing(null); return; }
    (async () => {
      const { data } = await supabase
        .from("microsites")
        .select("slug")
        .eq("listing_id", selectedListingId)
        .eq("published", true)
        .is("retired_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setMicrositeUrlForListing(data?.slug ? `${MICROSITE_PUBLIC_BASE}/p/${data.slug}` : null);
    })();
    return () => { cancelled = true; };
  }, [selectedListingId]);

  const selectedListing = listings.find((l) => l.id === selectedListingId) || null;
  const hasUsableProfile = !!voiceProfile && !!String(voiceProfile.license_number || "").trim();

  // Stats + brand footer for carousel cards (shared by Result + History).
  const carouselStats = selectedListing ? {
    beds: selectedListing.beds, baths: selectedListing.baths,
    sqft: selectedListing.sqft, city: selectedListing.city,
  } : null;
  const carouselFooter = (licenseOverride) => (voiceProfile ? {
    agentName: voiceProfile.display_name || voiceProfile.full_name || "",
    brokerage: voiceProfile.brokerage_name || "",
    license: licenseOverride || voiceProfile.license_number || "",
    contact: voiceProfile.social_instagram || "",
  } : null);

  // ── Generate ──
  const handleGenerate = async () => {
    setErrorMsg("");
    if (!hasUsableProfile) { setErrorMsg("Set up your voice profile first."); return; }
    if (!selectedListingId) { setErrorMsg("Pick a listing to generate for."); return; }
    if (!framework) { setErrorMsg("Pick a content style."); return; }
    // Defense in depth: never submit a framework that's disabled on this
    // platform (the picker already prevents this, but a stale state could
    // theoretically slip through). Snap to the default and bail.
    if (!isFrameworkEnabled(platform, framework)) {
      setFramework(firstEnabledFramework(platform));
      setErrorMsg("That content style isn't available on this platform yet. Try again.");
      return;
    }

    setGenerating(true);
    setResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { setErrorMsg("Your session expired. Please sign in again."); setGenerating(false); return; }

      const body = {
        voice_profile_id: voiceProfile.id,
        listing_id: selectedListingId,
        framework_name: framework,
        platform,
        content_type: "listing",
      };
      // The single "Angle / Focus" input maps to the generic story_angle override
      // (consumed by IG story-driven + FB neighbor_story; other FB frameworks fall
      // back to their own per-framework defaults).
      if (storyAngle.trim()) body.story_angle = storyAngle.trim();

      const res = await fetch("/api/content-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const bodyJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(friendlyError(res.status, bodyJson.error));
        setGenerating(false);
        return;
      }
      setResult(bodyJson);
      // Server already persisted the row in 2a — refresh the history list.
      loadHistory(selectedListingId);
    } catch (e) {
      console.error("[content] generate error:", e);
      setErrorMsg("Couldn't reach the generator. Please try again.");
    }
    setGenerating(false);
  };

  // ── Render: header ──
  const Header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff" }}>Content</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
          Generate on-brand social content for your listings
        </div>
      </div>
      {canGenerate && (
        <button
          onClick={openReplay}
          aria-label="Replay onboarding tour"
          style={{
            background: "transparent",
            border: "1px solid rgba(201,168,76,0.35)",
            color: "#C9A84C",
            fontFamily: "'Jost', sans-serif",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "8px 14px",
            borderRadius: 20,
            cursor: "pointer",
            transition: "background 0.2s, border-color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(201,168,76,0.08)";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.7)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)";
          }}
        >
          ↺ Replay tour
        </button>
      )}
    </div>
  );

  // ── Onboarding overlay layer (rendered above all return branches) ──
  const OverlayLayer = overlay ? (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#0e1220",
      }}
    >
      <iframe
        title={overlay === "tour" ? "Milestone tour" : "Milestone landing"}
        src={overlay === "tour" ? "/tours/milestone-tour.html" : "/tours/milestone-landing.html"}
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
      {overlay === "landing" && (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 16,
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={closeLandingToPlans}
            style={{
              background: "rgba(14,18,32,0.92)",
              border: "1px solid rgba(201,168,76,0.4)",
              color: "#C9A84C",
              fontFamily: "'Jost', sans-serif",
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "9px 16px",
              borderRadius: 20,
              cursor: "pointer",
            }}
          >
            View plans →
          </button>
        </div>
      )}
    </div>
  ) : null;

  // ── Render: loading ──
  if (!listingsLoaded || !profileLoaded) {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {Header}
          <div style={{ ...panelSt, textAlign: "center", color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", fontSize: 13, padding: 40 }}>
            Loading…
          </div>
        </div>
        {OverlayLayer}
      </>
    );
  }

  // ── Render: subscription gate (FIRST gate; admins exempt) ──
  // Unsubscribed non-admins see the landing overlay; closing/finishing it
  // routes them to the Subscriptions view via onOpenSubscriptions. The page
  // body underneath stays minimal because the overlay covers it.
  if (!canGenerate) {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {Header}
        </div>
        {OverlayLayer}
      </>
    );
  }

  // ── Render: voice-profile gate ──
  if (!hasUsableProfile) {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {Header}
          <div style={{ ...panelSt, textAlign: "center", padding: "44px 28px", border: "1px solid rgba(201,168,76,0.25)" }}>
            <div style={{ fontSize: 34, marginBottom: 12 }}>🗣</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 8 }}>
              Set up your voice profile to start generating content
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.45)", maxWidth: 420, margin: "0 auto 22px", lineHeight: 1.6 }}>
              {voiceProfile
                ? "Your voice profile is missing a license number, which is required on every post for TREC compliance. Add it to unlock content generation."
                : "Your voice profile is what the AI writes in — your tone, your phrases, your hashtags. Create it once and every caption sounds like you."}
            </div>
            <button onClick={() => setShowVoiceModal(true)} style={{ ...goldBtn(false), width: "auto", padding: "13px 28px" }}>
              {voiceProfile ? "Complete Voice Profile" : "Set Up Voice Profile"}
            </button>
          </div>
          {showVoiceModal && (
            <VoiceProfileModal onClose={() => { setShowVoiceModal(false); loadVoiceProfile(); }} />
          )}
        </div>
        {OverlayLayer}
      </>
    );
  }

  // ── Render: no listings ──
  if (listings.length === 0) {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {Header}
          <div style={{ ...panelSt, textAlign: "center", color: "rgba(255,255,255,0.45)", fontFamily: "'Jost', sans-serif", fontSize: 13, padding: 40 }}>
            You don't have any listings yet. Once a listing is added to your account, you can generate content for it here.
          </div>
        </div>
        {OverlayLayer}
      </>
    );
  }

  // ── Render: full generator ──
  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {Header}

      {/* ── SETUP PANEL ── */}
      <div style={panelSt}>
        {/* Listing picker */}
        <label style={labelSt}>Listing</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          {listings.map((l) => {
            const selected = l.id === selectedListingId;
            return (
              <div key={l.id} onClick={() => { setSelectedListingId(l.id); setResult(null); setErrorMsg(""); }} style={{
                width: 130, borderRadius: 10, overflow: "hidden", cursor: "pointer", position: "relative", height: 80,
                border: selected ? "2px solid #c9a84c" : "2px solid transparent", transition: "all 0.2s", flexShrink: 0,
              }}>
                <img src={l.hero_img || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: selected ? "rgba(201,168,76,0.15)" : "rgba(8,18,40,0.55)" }} />
                <div style={{ position: "absolute", bottom: 6, left: 8, right: 8, fontFamily: "'Jost', sans-serif", fontSize: 9, color: "#fff", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {l.address || "Listing"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Platform toggle — swaps the style list below */}
        <label style={labelSt}>Platform</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {PLATFORMS.map((p) => {
            const selected = p.key === platform;
            return (
              <button key={p.key} onClick={() => switchPlatform(p.key)} style={{
                padding: "9px 16px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em",
                display: "flex", alignItems: "center", gap: 7,
                border: selected ? "1px solid #c9a84c" : "1px solid rgba(255,255,255,0.12)",
                background: selected ? "rgba(201,168,76,0.18)" : "rgba(255,255,255,0.04)",
                color: selected ? "#c9a84c" : "rgba(255,255,255,0.55)",
              }}>
                <span style={{ fontSize: 14 }}>{p.emoji}</span>{p.label}
              </button>
            );
          })}
        </div>

        {/* Style picker (platform-scoped) */}
        <label style={labelSt}>Content Style</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {FRAMEWORKS_BY_PLATFORM[platform].map((f) => {
            const selected = f.slug === framework;
            const disabled = !!f.comingSoon;
            return (
              <button
                key={f.slug}
                onClick={() => { if (!disabled) setFramework(f.slug); }}
                disabled={disabled}
                title={disabled ? "Coming soon — currently Instagram supports the Walkthrough Carousel only" : undefined}
                style={{
                  padding: "8px 14px", borderRadius: 8,
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.03em",
                  border: selected
                    ? "1px solid #c9a84c"
                    : disabled
                      ? "1px dashed rgba(255,255,255,0.10)"
                      : "1px solid rgba(255,255,255,0.12)",
                  background: selected
                    ? "rgba(201,168,76,0.15)"
                    : disabled
                      ? "rgba(255,255,255,0.02)"
                      : "rgba(255,255,255,0.04)",
                  color: selected
                    ? "#c9a84c"
                    : disabled
                      ? "rgba(255,255,255,0.28)"
                      : "rgba(255,255,255,0.55)",
                  opacity: disabled ? 0.75 : 1,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <span>{f.label}</span>
                {disabled && (
                  <span style={{
                    fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 600,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    padding: "1px 6px", borderRadius: 4,
                    background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)",
                  }}>Coming soon</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Angle / focus */}
        <label style={labelSt}>Angle / Focus <span style={{ color: "rgba(255,255,255,0.2)" }}>— optional</span></label>
        <input
          style={{ ...inputSt, marginBottom: 20 }}
          value={storyAngle}
          onChange={(e) => setStoryAngle(e.target.value)}
          placeholder="e.g. a porch that catches the late-afternoon light"
        />

        {/* Carousel nudge — photo-matched slides need labels first */}
        {framework === "walkthrough_carousel" && photoLabelCount === 0 && (
          <div style={{
            marginBottom: 16, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e8c97a",
            background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)",
            borderRadius: 8, padding: "10px 12px", lineHeight: 1.5,
          }}>
            Analyze photos first for photo-matched carousels — scroll down to the Listing Photos panel and run analysis.
          </div>
        )}

        {/* Generate */}
        <button onClick={handleGenerate} disabled={generating} style={goldBtn(generating)}>
          {generating ? "Generating…" : "✦ Generate Content"}
        </button>

        {errorMsg && (
          <div style={{
            marginTop: 14, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "10px 12px", lineHeight: 1.5,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <span>{errorMsg}</span>
            {/* 422 → quick path to fix the license number */}
            {/needs a license number/i.test(errorMsg) && (
              <button onClick={() => setShowVoiceModal(true)} style={{ ...ghostBtn, flexShrink: 0 }}>Voice Profile</button>
            )}
          </div>
        )}
      </div>

      {/* ── RESULT PANEL ── */}
      {result && (
        <div style={{ ...panelSt, border: "1px solid rgba(201,168,76,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c" }}>
              {labelForSlug(result.framework_used || framework)}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleGenerate} disabled={generating} style={ghostBtn}>Regenerate</button>
              <button onClick={() => { setResult(null); setErrorMsg(""); }} style={ghostBtn}>Try Another Style</button>
            </div>
          </div>

          {/* Caption (editable). The textarea opens with the RAW stored
              caption (microsite token visible) so the agent can keep,
              replace, or remove the link slot. Display mode shows the
              resolved caption (token → live URL). Save persists to
              generated_content.caption via Supabase RLS. */}
          <div style={{ marginBottom: 18 }}>
            <EditableCaption
              caption={result.caption}
              micrositeUrl={micrositeUrlForListing}
              onSave={(next) => updateCaption(result.saved_id || null, next)}
              canPersist={!!result.saved_id}
              size="result"
            />
          </div>

          {/* Microsite-link status. Only meaningful when the caption actually
              carries the placeholder token. If the agent edited the caption
              and removed the token, hide the banner entirely (their choice
              stands — we never re-inject it). If the token is present and a
              microsite is published, show green with the live URL. If the
              token is present but no microsite is published yet, show
              yellow ("publish to fill the link spot"). */}
          {(result.platform === "facebook" || result.platform === "linkedin") &&
            typeof result.caption === "string" && result.caption.includes(MICROSITE_TOKEN) && (
            micrositeUrlForListing ? (
              <div style={{
                marginBottom: 18, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#9fe3b0",
                background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.22)",
                borderRadius: 8, padding: "9px 12px", lineHeight: 1.5, wordBreak: "break-all",
              }}>
                ✓ Microsite link in the caption: {micrositeUrlForListing}
              </div>
            ) : (
              <div style={{
                marginBottom: 18, fontFamily: "'Jost', sans-serif", fontSize: 11.5, color: "#e8c97a",
                background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.22)",
                borderRadius: 8, padding: "9px 12px", lineHeight: 1.5,
              }}>
                No published microsite for this listing yet — the link spot in the caption stands alone for now. Publish a microsite and the link will be inserted automatically when this posts.
              </div>
            )
          )}

          {/* Carousel — Instagram walkthrough only. LinkedIn slides[] are
              handled by LinkedInGalleryEditor below; never feed them
              through CarouselView (its IG-specific chrome — Post-to-IG
              button, IG cap, download zip — doesn't apply to LinkedIn). */}
          {Array.isArray(result.slides) && result.slides.length > 0 && (result.platform || platform) === "instagram" && (
            <div style={{ marginBottom: 18 }}>
              <CarouselView
                slides={result.slides}
                caption={result.caption}
                hashtags={result.hashtags}
                address={selectedListing?.address}
                stats={carouselStats}
                footer={carouselFooter(result.license_number)}
                rowId={result.saved_id}
                onUpdateStatement={updateSlideStatement}
                photoPool={photoPool}
                onSwapPhoto={swapSlidePhoto}
                onRetryStatement={retrySlideStatement}
                onDeleteSlide={deleteSlide}
                onAddSlide={addSlide}
                platform={result.platform || platform}
                brandTokens={{
                  bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                  mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                  fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                  logoUrl: profile?.agency_logo_url || undefined,
                }}
              />
              {saveError && (
                <div style={{ marginTop: 8, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171" }}>{saveError}</div>
              )}
            </div>
          )}

          {/* Hook + CTA */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
            {result.hook_line && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelSt}>Hook</label>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{result.hook_line}</div>
              </div>
            )}
            {result.cta_line && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={labelSt}>Call to Action</label>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{result.cta_line}</div>
              </div>
            )}
          </div>

          {/* Hashtags */}
          {Array.isArray(result.hashtags) && result.hashtags.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ ...labelSt, marginBottom: 0 }}>Hashtags</label>
                <CopyButton text={result.hashtags.join(" ")} label="Copy hashtags" />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.hashtags.map((h, i) => (
                  <span key={i} style={{
                    background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)",
                    color: "#e8c97a", borderRadius: 6, padding: "3px 8px", fontFamily: "'Jost', sans-serif", fontSize: 11,
                  }}>{h}</span>
                ))}
              </div>
            </div>
          )}

          {/* Facebook editable album + post/schedule (FB has no carousel). The
              agent edits the album here — Add / Swap / Remove, category labels,
              clickable preview — and posts exactly that set. */}
          {result.platform === "facebook" && result.saved_id && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <FacebookAlbumEditor key={result.saved_id} contentId={result.saved_id} photos={photoPool} />
            </div>
          )}

          {/* LinkedIn post button + target picker (no album editor — MVP is
              text post + microsite token). The PostToLinkedInButton fetches
              channels[] from /api/social-status?platform=linkedin so the
              "Post as" picker shows the personal profile + admined pages. */}
          {result.platform === "linkedin" && result.saved_id && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              {Array.isArray(result.slides) && result.slides.length > 0 && (
                <LinkedInGalleryEditor
                  slides={result.slides}
                  rowId={result.saved_id}
                  stats={carouselStats}
                  footer={carouselFooter(result.license_number)}
                  brandTokens={{
                    bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                    mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                    fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                    logoUrl: profile?.agency_logo_url || undefined,
                  }}
                  photoPool={photoPool}
                  onUpdateStatement={updateSlideStatement}
                  onSwapPhoto={swapSlidePhoto}
                  onRetryStatement={retrySlideStatement}
                  onDeleteSlide={deleteSlide}
                  onAddSlide={addSlide}
                />
              )}
              <PostToLinkedInButton
                contentId={result.saved_id}
                photos={photoPool}
                slides={Array.isArray(result.slides) && result.slides.length > 0 ? result.slides : null}
                stats={carouselStats}
                footer={carouselFooter(result.license_number)}
                address={selectedListing?.address}
                brandTokens={{
                  bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                  mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                  fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                  logoUrl: profile?.agency_logo_url || undefined,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY PANEL ── (above the photos; gated on a selected listing) */}
      {selectedListingId && (
      <div style={panelSt}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff", marginBottom: 4 }}>History</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>
          Past generations for {selectedListing?.address || "this listing"}
        </div>

        {historyLoading ? (
          <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 12 }}>Loading history…</div>
        ) : history.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 12 }}>
            No content generated for this listing yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h) => {
              const open = expandedId === h.id;
              return (
                <div key={h.id} style={{ background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
                  <div onClick={() => setExpandedId(open ? null : h.id)} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer",
                  }}>
                    {/* Platform badge — rows now mix Instagram + Facebook + LinkedIn */}
                    {(() => {
                      const p = h.platform || "instagram";
                      const tint = p === "facebook"
                        ? { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.4)",  fg: "#93c5fd", emoji: "📘" }
                        : p === "linkedin"
                          ? { bg: "rgba(10,102,194,0.16)", border: "rgba(10,102,194,0.45)", fg: "#7aa8d8", emoji: "💼" }
                          : { bg: "rgba(225,48,108,0.12)", border: "rgba(225,48,108,0.35)", fg: "#f9a8c4", emoji: "📷" };
                      return (
                        <span style={{
                          background: tint.bg, border: `1px solid ${tint.border}`, color: tint.fg,
                          borderRadius: 6, padding: "3px 7px", fontFamily: "'Jost', sans-serif", fontSize: 10, flexShrink: 0,
                          display: "flex", alignItems: "center", gap: 4,
                        }}>
                          {tint.emoji}{platformLabel(p)}
                        </span>
                      );
                    })()}
                    <span style={{
                      background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", color: "#e8c97a",
                      borderRadius: 6, padding: "3px 8px", fontFamily: "'Jost', sans-serif", fontSize: 10, flexShrink: 0,
                    }}>{labelForSlug(h.framework_name)}</span>
                    <span style={{ flex: 1, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {resolveCaptionForDisplay(h.caption || "", micrositeUrlForListing).replace(/\s+/g, " ").slice(0, 80)}
                    </span>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{fmtDate(h.created_at)}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
                  </div>
                  {open && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <EditableCaption
                        caption={h.caption}
                        micrositeUrl={micrositeUrlForListing}
                        onSave={(next) => updateCaption(h.id, next)}
                        canPersist={!!h.id}
                        size="history"
                      />
                      {Array.isArray(h.hashtags) && h.hashtags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                          {h.hashtags.map((tag, i) => (
                            <span key={i} style={{
                              background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)",
                              color: "#e8c97a", borderRadius: 6, padding: "3px 8px", fontFamily: "'Jost', sans-serif", fontSize: 11,
                            }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      {/* Saved carousel — Instagram only. LinkedIn slides[]
                          are handled by LinkedInGalleryEditor below. */}
                      {Array.isArray(h.slides) && h.slides.length > 0 && (h.platform || "instagram") === "instagram" && (
                        <div style={{ marginTop: 14 }}>
                          <CarouselView
                            slides={h.slides}
                            caption={h.caption}
                            hashtags={h.hashtags}
                            address={selectedListing?.address}
                            stats={carouselStats}
                            footer={carouselFooter(h.license_number)}
                            rowId={h.id}
                            onUpdateStatement={updateSlideStatement}
                            photoPool={photoPool}
                            onSwapPhoto={swapSlidePhoto}
                            onRetryStatement={retrySlideStatement}
                            onDeleteSlide={deleteSlide}
                            onAddSlide={addSlide}
                            platform={h.platform || "instagram"}
                            brandTokens={{
                              bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                              mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                              fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                              logoUrl: profile?.agency_logo_url || undefined,
                            }}
                          />
                        </div>
                      )}

                      {/* Facebook editable album + post/schedule for FB history rows. */}
                      {h.platform === "facebook" && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          <FacebookAlbumEditor key={h.id} contentId={h.id} photos={photoPool} />
                        </div>
                      )}

                      {/* LinkedIn post button + target picker for LinkedIn history rows. */}
                      {h.platform === "linkedin" && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          {Array.isArray(h.slides) && h.slides.length > 0 && (
                            <LinkedInGalleryEditor
                              slides={h.slides}
                              rowId={h.id}
                              stats={carouselStats}
                              footer={carouselFooter(h.license_number)}
                              brandTokens={{
                                bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                                mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                                fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                                logoUrl: profile?.agency_logo_url || undefined,
                              }}
                              photoPool={photoPool}
                              onUpdateStatement={updateSlideStatement}
                              onSwapPhoto={swapSlidePhoto}
                              onRetryStatement={retrySlideStatement}
                              onDeleteSlide={deleteSlide}
                              onAddSlide={addSlide}
                            />
                          )}
                          <PostToLinkedInButton
                            contentId={h.id}
                            photos={photoPool}
                            slides={Array.isArray(h.slides) && h.slides.length > 0 ? h.slides : null}
                            stats={carouselStats}
                            footer={carouselFooter(h.license_number)}
                            address={selectedListing?.address}
                            brandTokens={{
                              bgColor: profile?.brand_bg_color, textColor: profile?.brand_text_color,
                              mutedColor: profile?.brand_muted_color, accentColor: profile?.brand_accent_color,
                              fontHeadline: profile?.brand_font_headline, fontBody: profile?.brand_font_body,
                              logoUrl: profile?.agency_logo_url || undefined,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* ── UPCOMING POSTS ── (below History; all listings, collapsible) */}
      <UpcomingPosts />

      {/* ── PHOTO INTELLIGENCE PANEL ── */}
      {selectedListingId && (
        <PhotosPanel listingId={selectedListingId} listingAddress={selectedListing?.address} />
      )}

      {/* Voice profile editor (reused) — reachable from the 422 error path */}
      {showVoiceModal && (
        <VoiceProfileModal onClose={() => { setShowVoiceModal(false); loadVoiceProfile(); }} />
      )}
    </div>
    {OverlayLayer}
    </>
  );
}

export default ContentView;
