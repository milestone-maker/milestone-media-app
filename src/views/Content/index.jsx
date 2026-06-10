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

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { isSubscribed } from "../../lib/subscription";
import VoiceProfileModal from "../../components/VoiceProfileModal";
import SubscriptionsView from "../Subscriptions";
import PhotosPanel from "./PhotosPanel";
import CarouselView from "./CarouselView";
import { includable } from "../../../api/_content/selectCarouselPhotos.js";

// Friendly label → exact framework_name slug the endpoint expects.
const FRAMEWORKS = [
  { label: "Story-Driven",                slug: "story_driven_listing" },
  { label: '"You" Hook',                  slug: "you_hook_listing" },
  { label: "Walkthrough Carousel",        slug: "walkthrough_carousel" },
  { label: "Behind-the-Scenes / Pre-List", slug: "behind_the_scenes_prelist" },
  { label: "Neighborhood-First",          slug: "neighborhood_first" },
  { label: "Problem → Solution",          slug: "problem_solution" },
  { label: "POV: Day in the Life",        slug: "pov_day_in_life" },
];
const labelForSlug = (slug) => FRAMEWORKS.find((f) => f.slug === slug)?.label || slug;

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

function ContentView() {
  const { user, profile } = useAuth();
  // Admins always pass; otherwise an active subscription is required.
  const isAdmin = profile?.role === "admin";
  const canGenerate = isAdmin || isSubscribed(profile);

  // Data
  const [listings, setListings] = useState([]);
  const [listingsLoaded, setListingsLoaded] = useState(false);
  const [selectedListingId, setSelectedListingId] = useState(null);

  const [voiceProfile, setVoiceProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  // Generator inputs
  const [framework, setFramework] = useState(FRAMEWORKS[0].slug);
  const [storyAngle, setStoryAngle] = useState("");

  // Photo-label count for the selected listing — drives the carousel nudge.
  // null = unknown / not applicable; a number once checked.
  const [photoLabelCount, setPhotoLabelCount] = useState(null);

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
      return { target: "result", baseSlides: Array.isArray(result.slides) ? result.slides : [] };
    }
    const h = history.find((x) => x.id === rowId);
    if (h) return { target: "history", baseSlides: Array.isArray(h.slides) ? h.slides : [] };
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
        platform: "instagram",
        content_type: "listing",
      };
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
    </div>
  );

  // ── Render: loading ──
  if (!listingsLoaded || !profileLoaded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {Header}
        <div style={{ ...panelSt, textAlign: "center", color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", fontSize: 13, padding: 40 }}>
          Loading…
        </div>
      </div>
    );
  }

  // ── Render: subscription gate (FIRST gate; admins exempt) ──
  // Unsubscribed non-admins see the existing subscription page in place —
  // tier picker + Stripe checkout, self-contained. Subscribed agents and
  // admins fall through to the voice-profile gate below.
  if (!canGenerate) {
    return <SubscriptionsView />;
  }

  // ── Render: voice-profile gate ──
  if (!hasUsableProfile) {
    return (
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
    );
  }

  // ── Render: no listings ──
  if (listings.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {Header}
        <div style={{ ...panelSt, textAlign: "center", color: "rgba(255,255,255,0.45)", fontFamily: "'Jost', sans-serif", fontSize: 13, padding: 40 }}>
          You don't have any listings yet. Once a listing is added to your account, you can generate content for it here.
        </div>
      </div>
    );
  }

  // ── Render: full generator ──
  return (
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

        {/* Style picker */}
        <label style={labelSt}>Content Style</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {FRAMEWORKS.map((f) => {
            const selected = f.slug === framework;
            return (
              <button key={f.slug} onClick={() => setFramework(f.slug)} style={{
                padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: "0.03em",
                border: selected ? "1px solid #c9a84c" : "1px solid rgba(255,255,255,0.12)",
                background: selected ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
                color: selected ? "#c9a84c" : "rgba(255,255,255,0.55)",
              }}>{f.label}</button>
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

          {/* Caption */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ ...labelSt, marginBottom: 0 }}>Caption</label>
              <CopyButton text={result.caption} label="Copy caption" />
            </div>
            <div style={{
              whiteSpace: "pre-wrap", fontFamily: "'Jost', sans-serif", fontSize: 13.5, color: "#ECE7DC",
              lineHeight: 1.7, background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "16px 18px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>{result.caption}</div>
          </div>

          {/* Carousel — Style B sequence + download (walkthrough_carousel only) */}
          {Array.isArray(result.slides) && result.slides.length > 0 && (
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
                    <span style={{
                      background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", color: "#e8c97a",
                      borderRadius: 6, padding: "3px 8px", fontFamily: "'Jost', sans-serif", fontSize: 10, flexShrink: 0,
                    }}>{labelForSlug(h.framework_name)}</span>
                    <span style={{ flex: 1, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(h.caption || "").replace(/\s+/g, " ").slice(0, 80)}
                    </span>
                    <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{fmtDate(h.created_at)}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
                  </div>
                  {open && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <CopyButton text={h.caption} label="Copy caption" />
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", fontFamily: "'Jost', sans-serif", fontSize: 12.5, color: "#ECE7DC", lineHeight: 1.7 }}>
                        {h.caption}
                      </div>
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
                      {/* Saved carousel — same renderer as the Result panel (persistence fix) */}
                      {Array.isArray(h.slides) && h.slides.length > 0 && (
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

      {/* ── PHOTO INTELLIGENCE PANEL ── */}
      {selectedListingId && (
        <PhotosPanel listingId={selectedListingId} listingAddress={selectedListing?.address} />
      )}

      {/* Voice profile editor (reused) — reachable from the 422 error path */}
      {showVoiceModal && (
        <VoiceProfileModal onClose={() => { setShowVoiceModal(false); loadVoiceProfile(); }} />
      )}
    </div>
  );
}

export default ContentView;
