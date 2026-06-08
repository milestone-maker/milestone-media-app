import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";
import { MEDIA_ICONS, THEMES, THEME_LAYOUT } from "../../lib/ui";
import { ADDONS } from "../../lib/pricing";
import MicrositeRenderer from "../../components/MicrositeRenderer";
import ChatAssistantSection from "./ChatAssistantSection.jsx";
import ComparableSalesSection from "./ComparableSalesSection.jsx";
import Modal from "./Modal.jsx";
import { applyListingAutofill, applyBookingAutofill } from "./autofill.js";
// Canonical microsite write/access rule — the SAME pure module the
// serverless endpoint (api/_lib/entitlement.js) imports, so the UI and API
// can never disagree about who may edit a microsite. See shared/micrositeAccess.js.
import { canWriteMicrosite } from "../../../shared/micrositeAccess.js";

// Microsite add-on price, sourced from the central pricing config
const MICROSITE_ADDON_PRICE = ADDONS.find(a => a.id === "microsite")?.price ?? 0;

// ── Lead helpers ───────────────────────────────────────────────────
// The inbox UI renders pre-formatted `date` (M/D/YYYY) and `time`
// (h:mm AM/PM) strings. Live rows carry a single `created_at`
// timestamptz, so we format it into those two strings at map time
// without changing how the UI renders lead.date / lead.time.
function formatLeadDate(d) {
  if (!d || isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
function formatLeadTime(d) {
  if (!d || isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Map a public.leads row into the shape the existing inbox UI consumes.
// Keeps the real `id` (updates depend on it) and carries source +
// chatConversationId through even though 5a doesn't render them (5b
// needs them to open the transcript). Chat leads have null tour_type /
// possibly null email/phone — preserved as null here and handled
// gracefully at render time.
function mapLeadRow(row) {
  const created = row.created_at ? new Date(row.created_at) : null;
  return {
    id:                 row.id,
    name:               row.name || "",
    email:              row.email || null,
    phone:              row.phone || null,
    message:            row.message || "",
    tourType:           row.tour_type || null,
    status:             row.status || "new",
    read:               !!row.read,
    source:             row.source || "contact_form",
    chatConversationId: row.chat_conversation_id || null,
    created_at:         row.created_at || null,
    date:               formatLeadDate(created),
    time:               formatLeadTime(created),
  };
}

// ============================================================
// CHAT TRANSCRIPT MODAL — read-only view of a chat lead's conversation
// ============================================================
//
// The agent's anon client can SELECT these rows directly — migration
// 018 RLS scopes microsite_chat_messages by microsite ownership — so no
// endpoint is needed. We render EXACTLY the persisted rows: only user +
// final-assistant turns are stored (intermediate tool turns are not),
// and a conversation may legitimately end on a user message with no
// assistant reply. We don't reconstruct anything.
function TranscriptModal({ lead, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      const { data: rows, error: err } = await supabase
        .from("microsite_chat_messages")
        .select("id, role, content, flagged_topic, created_at")
        .eq("conversation_id", lead.chatConversationId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) {
        console.error("transcript fetch error:", err);
        setError(true);
        setMessages([]);
        setLoading(false);
        return;
      }
      // Deterministic order: created_at ascending, then "user" before
      // "assistant" for a turn's two rows — they're batch-inserted with
      // an identical timestamp, so created_at alone can't order them.
      const rolePriority = { user: 0, assistant: 1, system: 2 };
      const sorted = [...(rows || [])].sort((a, b) => {
        const ta = a.created_at || "";
        const tb = b.created_at || "";
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9);
      });
      setMessages(sorted);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [lead.chatConversationId]);

  // Header fields derived from the messages + the lead already in scope
  // (no second query). Started = first message time.
  const firstCreated = messages.length ? new Date(messages[0].created_at) : null;
  const startedStr = firstCreated ? `${formatLeadDate(firstCreated)} · ${formatLeadTime(firstCreated)}` : "—";
  const topics = [...new Set(messages.map(m => m.flagged_topic).filter(Boolean))];

  const labelStyle = { fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" };

  return (
    <Modal title="Conversation" onClose={onClose} maxWidth={560}>
      {/* Header */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff" }}>{lead.name || "Visitor"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6 }}>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>📧 {lead.email || "—"}</span>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>📱 {lead.phone || "—"}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8 }}>
          <span style={labelStyle}>Started <span style={{ color: "rgba(255,255,255,0.7)", textTransform: "none", letterSpacing: 0 }}>{startedStr}</span></span>
          <span style={labelStyle}>Messages <span style={{ color: "rgba(255,255,255,0.7)" }}>{messages.length}</span></span>
        </div>
        {topics.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {topics.map(t => (
              <span key={t} style={{ background: "rgba(201,168,76,0.12)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.3)", padding: "2px 8px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10 }}>{t}</span>
            ))}
          </div>
        )}
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.3)", fontStyle: "italic", marginTop: 10 }}>
          Automated conversation with the microsite AI assistant.
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "24px 0" }}>Loading conversation…</div>
      ) : error ? (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center", padding: "24px 0" }}>Couldn't load this conversation. Please try again.</div>
      ) : messages.length === 0 ? (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "24px 0" }}>No messages in this conversation.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map(m => {
            const isUser = m.role === "user";
            const text = (m.content || "").trim();
            return (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-start" : "flex-end" }}>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                  {isUser ? "Visitor" : "AI Assistant"}
                </span>
                <div style={{
                  maxWidth: "82%",
                  background: isUser ? "rgba(255,255,255,0.05)" : "rgba(201,168,76,0.12)",
                  border: `1px solid ${isUser ? "rgba(255,255,255,0.1)" : "rgba(201,168,76,0.3)"}`,
                  borderRadius: 12, padding: "10px 13px",
                  fontFamily: "'Jost', sans-serif", fontSize: 13, lineHeight: 1.5,
                  color: isUser ? "rgba(255,255,255,0.85)" : "#f5ecd7",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {text || <span style={{ fontStyle: "italic", color: "rgba(255,255,255,0.3)" }}>(no message text)</span>}
                </div>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 3 }}>
                  {formatLeadTime(new Date(m.created_at))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ============================================================
// MICROSITE PREVIEW — thin wrapper around the shared renderer
// ============================================================
//
// Transforms the editor's camelCase form state into the canonical
// snake_case property_data shape that <MicrositeRenderer> expects,
// then renders in mode="preview" so the lead form is a noop variant
// (no real leads created from agent self-preview).
//
// agentBranding is sourced from useAuth().profile (which is a SELECT *
// from agents) — same fields the public render fetches by agent_id.

function MicrositePreview({ data, theme, listingPhotos, listingVideo, listingFloorplan }) {
  const { profile } = useAuth();
  const agentBranding = profile ? {
    full_name:         profile.full_name,
    agency_name:       profile.agency_name,
    agency_logo_url:   profile.agency_logo_url,
    profile_photo_url: profile.profile_photo_url,
  } : null;

  const microsite = {
    hero_img:       data.heroImg || "",
    hero_media_id:  data.heroMediaId || "",
    gallery_photos: (listingPhotos || []).map(p => p.url || p),
    video_url:      data.videoUrl || listingVideo || "",
    floorplan_url:  listingFloorplan || "",
    matterport_url: data.matterportUrl || "",
    address:        data.address || "",
    city:           data.city || "",
    price:          data.price || "",
    beds:           data.beds || "",
    baths:          data.baths || "",
    sqft:           data.sqft || "",
    description:    data.description || "",
    features:       (data.features || []).filter(Boolean),
    agent_name:     data.agentName || "",
    agent_phone:    data.agentPhone || "",
    agent_email:    data.agentEmail || "",
  };

  return (
    <MicrositeRenderer
      microsite={microsite}
      theme={theme.name}
      agentBranding={agentBranding}
      mode="preview"
    />
  );
}



function MicrositeView() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Stage 6 white-label: branding is "complete" when the agent has both an
  // agency name and a logo — the two fields that actually replace "Milestone
  // Media" in the published nav, footer, browser tab, and favicon. Drives the
  // build-step heads-up banner and the soft publish warning.
  const brandingComplete = !!(profile?.agency_name && profile?.agency_logo_url);
  const [brandingNoticeDismissed, setBrandingNoticeDismissed] = useState(false);
  const editLoadRef = useRef(false); // skip sourceType reset when loading for edit
  // When loading a published microsite for edit, the listing/booking source
  // effects must NOT overwrite the form fields we just restored from the
  // saved property_data (Bug A: re-edit was clobbering address/city/agent/
  // tour/video from the raw source row, silently rewriting on republish).
  // Set true by loadMicrositeForEdit; cleared the moment the user manually
  // picks a source from a dropdown, or starts a fresh build.
  const skipAutofillRef = useRef(false);
  const [step, setStep] = useState("build");
  const [themeIdx, setThemeIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [published, setPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState(null);
  const [myMicrosites, setMyMicrosites] = useState([]);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [toast, setToast] = useState(null);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [notifSettings, setNotifSettings] = useState({
    emailEnabled: true, emailAddr: "info@milestonemediaphoto.com",
    smsEnabled: true, smsPhone: "(214) 744-3801",
    notifyOnNew: true, notifyOnOffer: true, notifyOnVirtual: false,
  });
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [listings, setListings] = useState([]);
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [listingPhotos, setListingPhotos] = useState([]);
  const [listingVideo, setListingVideo] = useState(null);
  const [listingFloorplan, setListingFloorplan] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [addonRequested, setAddonRequested] = useState(false);
  const [addonStatus, setAddonStatus] = useState(null); // null | 'pending' | 'approved' | 'denied'
  // Source is always "booking" — Bookings is the sole microsite source.
  // The listing source (admin-only) was retired (Bug C: it had no working
  // publish path). Kept as state so the dead listing-only effects/branches
  // below remain inert without restructuring; nothing can set it to
  // "listing" anymore. Dead-code pruning deferred to post-demo cleanup.
  const [sourceType, setSourceType] = useState("booking");
  const [bookings, setBookings] = useState([]);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [data, setData] = useState({
    address: "", city: "", price: "",
    beds: "", baths: "", sqft: "",
    description: "", agentName: "", agentPhone: "",
    heroImg: "",
    heroMediaId: "",  // booking_media.id for the agent's hero pick — sent to publish endpoint for lookup
    features: ["", "", "", ""],
    mediaTypes: ["Photos", "Drone", "3D Tour"],
    matterportUrl: "",
    videoUrl: "",
  });

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

  // Fetch bookings from Supabase (admin sees all, agents see their own)
  useEffect(() => {
    const fetchBookings = async () => {
      let query = supabase.from("bookings").select("*").order("created_at", { ascending: false });
      if (!isAdmin && user?.id) {
        query = query.eq("agent_id", user.id);
      }
      const { data: rows, error } = await query;
      if (!error && rows) setBookings(rows);
    };
    fetchBookings();
  }, [isAdmin, user?.id]);

  // Fetch this user's published microsites
  useEffect(() => {
    if (!user?.id) return;
    const fetchMyMicrosites = async () => {
      setLoadingMicrosites(true);
      const { data: rows } = await supabase
        .from("microsites")
        .select("id, slug, theme, published, property_data, agent_name, agent_phone, created_at")
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false });
      if (rows) setMyMicrosites(rows);
      setLoadingMicrosites(false);
    };
    fetchMyMicrosites();
  }, [user?.id]);

  // Fetch the current published microsite's leads (live inbox). The
  // published screen is single-microsite scoped: resolve the current
  // microsite id from the slug already in scope, then load only that
  // microsite's leads. RLS scopes further to the agent's own rows.
  useEffect(() => {
    if (step !== "published" || !publishedSlug) { setLeads([]); return; }
    const micrositeId = myMicrosites.find(m => m.slug === publishedSlug)?.id;
    if (!micrositeId) { setLeads([]); return; }
    let cancelled = false;
    const fetchLeads = async () => {
      const { data: rows, error } = await supabase
        .from("leads")
        .select("id, name, email, phone, message, tour_type, status, read, created_at, source, chat_conversation_id")
        .eq("microsite_id", micrositeId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        // Don't crash the screen — log and show a neutral empty inbox.
        console.error("leads fetch error:", error);
        setLeads([]);
        return;
      }
      setLeads((rows || []).map(mapLeadRow));
    };
    fetchLeads();
    return () => { cancelled = true; };
  }, [step, publishedSlug, myMicrosites]);

  // Check microsite addon request status when listing changes
  useEffect(() => {
    if (!selectedListingId || !user?.id) { setAddonStatus(null); setAddonRequested(false); return; }
    const checkAddon = async () => {
      const { data: reqs } = await supabase
        .from("microsite_requests")
        .select("status")
        .eq("listing_id", selectedListingId)
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (reqs && reqs.length > 0) {
        setAddonStatus(reqs[0].status);
        setAddonRequested(true);
      } else {
        setAddonStatus(null);
        setAddonRequested(false);
      }
    };
    checkAddon();
  }, [selectedListingId, user?.id]);

  // When a listing is selected, populate form and fetch media
  useEffect(() => {
    if (!selectedListingId) return;
    const listing = listings.find(l => l.id === selectedListingId);
    if (!listing) return;

    // Auto-populate form fields — but NOT when we're restoring an existing
    // microsite for edit (skipAutofillRef), or we'd clobber the saved
    // property_data the agent already curated (Bug A). Media still loads below.
    setData(d => applyListingAutofill(d, listing, skipAutofillRef.current));

    // Fetch media files from storage
    const fetchMedia = async () => {
      setMediaLoading(true);
      try {
        // Fetch photos
        const { data: photoFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/photos`, { limit: 50 });

        const photos = (photoFiles || [])
          .filter(f => f.name !== ".emptyFolderPlaceholder")
          .map(f => {
            const { data: urlData } = supabase.storage
              .from("listing-media")
              .getPublicUrl(`${selectedListingId}/photos/${f.name}`);
            // Listing-source has no booking_media row id; use the
            // storage path as the stable identifier. Listing-source
            // publish isn't currently wired through the server, so this
            // id never round-trips — but consistent shape keeps the
            // hero-picker code below uniform.
            return { id: `listing-media:${selectedListingId}/photos/${f.name}`, url: urlData.publicUrl };
          });
        setListingPhotos(photos);
        // Only auto-set hero if the agent hasn't picked one yet (N13 fix).
        if (photos.length > 0) {
          setData(d => d.heroMediaId ? d : { ...d, heroImg: photos[0].url, heroMediaId: photos[0].id });
        }

        // Fetch video
        const { data: videoFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/video`, { limit: 5 });

        const vids = (videoFiles || []).filter(f => f.name !== ".emptyFolderPlaceholder");
        if (vids.length > 0) {
          const { data: vidUrl } = supabase.storage
            .from("listing-media")
            .getPublicUrl(`${selectedListingId}/video/${vids[0].name}`);
          setListingVideo(vidUrl.publicUrl);
        } else {
          setListingVideo(null);
        }

        // Fetch floorplan
        const { data: fpFiles } = await supabase.storage
          .from("listing-media")
          .list(`${selectedListingId}/floorplan`, { limit: 5 });

        const fps = (fpFiles || []).filter(f => f.name !== ".emptyFolderPlaceholder");
        if (fps.length > 0) {
          const { data: fpUrl } = supabase.storage
            .from("listing-media")
            .getPublicUrl(`${selectedListingId}/floorplan/${fps[0].name}`);
          setListingFloorplan(fpUrl.publicUrl);
        } else {
          setListingFloorplan(null);
        }
      } catch (err) {
        console.error("Error fetching media:", err);
      }
      setMediaLoading(false);
    };
    fetchMedia();
  }, [selectedListingId, listings]);

  // When a booking is selected, populate form and fetch media from booking-media bucket
  useEffect(() => {
    if (!selectedBookingId) return;
    const booking = bookings.find(b => b.id === selectedBookingId);
    if (!booking) return;

    // Auto-populate form fields from booking data — but NOT when restoring an
    // existing microsite for edit (skipAutofillRef), or re-editing would
    // overwrite the saved property_data with the raw booking row and silently
    // rewrite it on republish (Bug A). Media still loads below.
    setData(d => applyBookingAutofill(d, booking, skipAutofillRef.current));

    // Fetch media from booking_media table (private bucket, needs signed URLs)
    const fetchBookingMedia = async () => {
      setMediaLoading(true);
      try {
        // Match server ordering exactly (sort_order ASC NULLS LAST,
        // created_at ASC) so the photo the agent sees first in the
        // picker is the same one the server treats as the default hero.
        const { data: mediaRows, error } = await supabase
          .from("booking_media")
          .select("*")
          .eq("booking_id", selectedBookingId)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });

        if (error) { console.error("Error fetching booking media:", error); setMediaLoading(false); return; }

        // photos: { id, url }[] — id is the booking_media row id, which
        // the publish endpoint uses to resolve the agent's hero pick
        // against the post-copy published-media URLs.
        const photos = [];
        let video = null;
        let tourUrl = null;

        if (mediaRows && mediaRows.length > 0) {
          // Generate signed URLs for all files
          for (const item of mediaRows) {
            if (item.file_type === "3d_tour") {
              tourUrl = item.url || item.file_path;
              continue;
            }
            if (!item.file_path) continue;

            const { data: signedData } = await supabase.storage
              .from("booking-media")
              .createSignedUrl(item.file_path, 3600);
            const signedUrl = signedData?.signedUrl;
            if (!signedUrl) continue;

            if (item.file_type === "video") {
              video = signedUrl;
            } else {
              photos.push({ id: item.id, url: signedUrl });
            }
          }
        }

        setListingPhotos(photos);
        setListingVideo(video);
        setListingFloorplan(null); // bookings don't have separate floorplan category
        // Only auto-set hero if the agent hasn't picked one yet (N13 fix):
        // refetches on tab switches or re-renders must not clobber the
        // current selection.
        if (photos.length > 0) {
          setData(d => d.heroMediaId ? d : { ...d, heroImg: photos[0].url, heroMediaId: photos[0].id });
        }
        if (tourUrl) {
          setData(d => ({ ...d, matterportUrl: tourUrl }));
        }
      } catch (err) {
        console.error("Error fetching booking media:", err);
      }
      setMediaLoading(false);
    };
    fetchBookingMedia();
  }, [selectedBookingId, bookings]);

  // Reset state when switching source type
  useEffect(() => {
    // During an edit-load, preserve BOTH source selections — loadMicrositeForEdit
    // restores whichever applies and we must not null them out here (Bug B).
    if (editLoadRef.current) { editLoadRef.current = false; return; }
    // Fresh source switch (not an edit-load) → allow autofill again.
    skipAutofillRef.current = false;
    setSelectedListingId(null);
    setSelectedBookingId(null);
    setListingPhotos([]);
    setListingVideo(null);
    setListingFloorplan(null);
    setStep("build");
    setPublished(false);
    setData(d => ({
      ...d,
      address: "", city: "", price: "",
      beds: "", baths: "", sqft: "",
      description: "", agentName: "", agentPhone: "",
      heroImg: "",
      heroMediaId: "",
      features: ["", "", "", ""],
      matterportUrl: "", videoUrl: "",
    }));
  }, [sourceType]);

  const theme = THEMES[themeIdx];

  // Grouped theme picker — derived from THEME_LAYOUT so adding a new
  // theme + layout entry shows up here automatically. Prestige is
  // promoted to its own "Prestige" group at the top (it has
  // THEME_LAYOUT === "cinematic" but visually deserves the flagship
  // slot); every other theme falls into its THEME_LAYOUT bucket.
  const themesWithIdx = THEMES.map((t, i) => ({ ...t, idx: i }));
  const themeGroups = [
    { id: "prestige",  label: "Prestige",  themes: themesWithIdx.filter(t => t.name === "Prestige"), premium: true },
    { id: "cinematic", label: "Cinematic", themes: themesWithIdx.filter(t => THEME_LAYOUT[t.name] === "cinematic" && t.name !== "Prestige") },
    { id: "split",     label: "Split",     themes: themesWithIdx.filter(t => THEME_LAYOUT[t.name] === "split") },
    { id: "minimal",   label: "Minimal",   themes: themesWithIdx.filter(t => THEME_LAYOUT[t.name] === "minimal") },
    { id: "editorial", label: "Editorial", themes: themesWithIdx.filter(t => THEME_LAYOUT[t.name] === "editorial") },
  ];

  // Slug: if editing reuse the saved slug; for new microsites append the last 8 chars
  // of the agent's UUID so two agents with the same address never collide globally.
  const baseSlug = (data.address || "your-listing").split(" ").slice(0, 2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const agentSuffix = (user?.id || "").slice(-8);
  const slug = publishedSlug || (agentSuffix ? `${baseSlug}-${agentSuffix}` : baseSlug);
  const liveUrl = `https://app.milestonemediaphotography.com/p/${slug}`;

  const setField = (key, val) => setData(d => ({ ...d, [key]: val }));
  const setFeature = (i, val) => setData(d => { const f = [...d.features]; f[i] = val; return { ...d, features: f }; });
  const toggleMedia = (m) => setData(d => ({
    ...d, mediaTypes: d.mediaTypes.includes(m) ? d.mediaTypes.filter(x => x !== m) : [...d.mediaTypes, m],
  }));

  const showToast = (lead) => {
    setToast(lead);
    setTimeout(() => setToast(null), 4500);
  };

  // Persist a status change. Optimistic local update, then write to
  // the DB; on error, revert local state so the UI never lies about
  // what was saved. (Null-listing leads rely on the new microsite-
  // ownership UPDATE policy — see migration 024.)
  const updateLeadStatus = async (idx, status) => {
    const lead = leads[idx];
    if (!lead || lead.status === status) return;
    const prev = lead.status;
    setLeads(l => l.map((x, i) => i === idx ? { ...x, status } : x));
    if (!lead.id) return; // no real row to persist against
    const { error } = await supabase.from("leads").update({ status }).eq("id", lead.id);
    if (error) {
      console.error("lead status update error:", error);
      setLeads(l => l.map((x, i) => i === idx ? { ...x, status: prev } : x));
      alert("Couldn't save the status change. Please try again.");
    }
  };

  // Open a lead's detail view and, if unread, mark it read — locally
  // and in the DB. Revert local state on error.
  const openLead = async (idx) => {
    setSelectedLead(idx);
    setTranscriptOpen(false); // never carry a stale open modal between leads
    const lead = leads[idx];
    if (!lead || lead.read) return;
    setLeads(l => l.map((x, i) => i === idx ? { ...x, read: true } : x));
    if (!lead.id) return;
    const { error } = await supabase.from("leads").update({ read: true }).eq("id", lead.id);
    if (error) {
      console.error("lead read update error:", error);
      setLeads(l => l.map((x, i) => i === idx ? { ...x, read: false } : x));
    }
  };

  // Package tier gating helper — works for both listings and bookings
  const selectedListing = listings.find(l => l.id === selectedListingId);
  const selectedBooking = bookings.find(b => b.id === selectedBookingId);

  // Determine package based on source
  let activePackage = "";
  let micrositeIncluded = false;
  let micrositeAddonApproved = false;
  let micrositeAccessible = false;

  if (sourceType === "listing") {
    activePackage = selectedListing?.package || "";
    micrositeIncluded = activePackage === "Luxury";
    micrositeAddonApproved = selectedListing?.microsite_addon === true;
  } else {
    // Booking source
    const bookingPkg = selectedBooking?.selected_package || "";
    activePackage = bookingPkg.charAt(0).toUpperCase() + bookingPkg.slice(1); // Capitalize for display
    micrositeIncluded = bookingPkg.toLowerCase() === "luxury";
    // Check if microsite addon was purchased with this booking
    const addons = selectedBooking?.selected_addons || [];
    micrositeAddonApproved = Array.isArray(addons) && addons.some(a => a.id === "microsite" || a === "microsite");
  }
  // Invoice paid check — only the booking-entitlement path (path 5) needs it.
  const invoicePaid = sourceType === "booking" ? !!selectedBooking?.invoice_paid : true;

  // is_beta grants full microsite access (treated like admin) — see the
  // canonical rule. profile is useAuth().profile (the agents row, select *).
  const isBeta = profile?.is_beta === true;

  // Existing-microsite exemption (path 3): the agent already owns a microsite
  // for this booking, so it stays editable/re-publishable regardless of the
  // booking's package or invoice. myMicrosites is fetched owner-scoped
  // (.eq agent_id), so every row here belongs to the current agent. Match by
  // the booking the microsite was built from, and — for listing-sourced or
  // mid-edit microsites — by the slug currently loaded for edit.
  const hasExistingMicrosite =
    (!!selectedBookingId &&
      myMicrosites.some(m => m.property_data?.booking_id === selectedBookingId)) ||
    (!!publishedSlug && myMicrosites.some(m => m.slug === publishedSlug));

  // Single source of truth: defer the whole decision to the shared rule so
  // the UI mirrors the endpoint and RLS exactly (incl. the Pro/Elite
  // subscription term the UI previously omitted). Ownership is guaranteed by
  // the owner-scoped sources feeding these inputs.
  micrositeAccessible = canWriteMicrosite({
    role: profile?.role || null,
    isBeta,
    hasExistingMicrosite,
    subscriptionTier: profile?.subscription_tier ?? null,
    subscriptionStatus: profile?.subscription_status ?? null,
    selectedPackage:
      sourceType === "booking"
        ? (selectedBooking?.selected_package ?? null)
        : (selectedListing?.package ?? null),
    selectedAddons:
      sourceType === "booking"
        ? (selectedBooking?.selected_addons ?? [])
        : (selectedListing?.microsite_addon === true ? ["microsite"] : []),
    invoicePaid,
  }).allowed;
  const hasSourceSelection = sourceType === "listing" ? !!selectedListingId : !!selectedBookingId;

  const handleRequestAddon = async () => {
    if (!selectedListingId || !user?.id) return;
    const { error } = await supabase.from("microsite_requests").insert({
      listing_id: selectedListingId,
      agent_id: user.id,
      status: "pending",
    });
    if (!error) {
      setAddonRequested(true);
      setAddonStatus("pending");
    }
  };

  // Shared loader: restores all the state the published screen reads
  // from a saved microsite row. Both "Edit" and "Leads" use this and
  // differ ONLY in the final step they land on (set by the callers).
  const loadMicrositeData = (ms) => {
    const pd = ms.property_data || {};

    // We're restoring saved content — tell the source effects not to
    // overwrite these fields from the raw listing/booking row (Bug A).
    skipAutofillRef.current = true;

    // Populate all form fields from saved property_data
    setData({
      address: pd.address || "",
      city: pd.city || "",
      price: pd.price || "",
      beds: pd.beds || "",
      baths: pd.baths || "",
      sqft: pd.sqft || "",
      description: pd.description || "",
      agentName: pd.agent_name || ms.agent_name || "",
      agentPhone: pd.agent_phone || ms.agent_phone || "",
      agentEmail: pd.agent_email || "",
      heroImg: pd.hero_img || "",
      heroMediaId: pd.hero_media_id || "",
      features: pd.features?.length
        ? [...pd.features, ...Array(Math.max(0, 4 - pd.features.length)).fill("")]
        : ["", "", "", ""],
      mediaTypes: pd.media_types || ["Photos"],
      matterportUrl: pd.matterport_url || "",
      videoUrl: pd.video_url || "",
    });

    // Load gallery photos directly from published URLs as the initial
    // picker state. Wrapped in the new { id, url } shape (the id slot
    // holds the published URL itself as a synthetic identifier so the
    // picker renders something while the booking-source fetch effect
    // below replaces it with real booking_media row ids).
    if (pd.gallery_photos?.length) {
      setListingPhotos(pd.gallery_photos.map(u => ({ id: u, url: u })));
    }
    if (pd.video_url) setListingVideo(pd.video_url);
    if (pd.floorplan_url) setListingFloorplan(pd.floorplan_url);

    // Restore source context — set the ref first so the sourceType reset effect skips
    if (pd.source_type && pd.source_type !== sourceType) {
      editLoadRef.current = true;
      setSourceType(pd.source_type);
    }

    // Restore booking selection so the booking-source fetch effect
    // re-populates listingPhotos with real booking_media row ids — the
    // picker can then highlight the saved hero by id and the publish
    // payload sends a real id, not the synthetic URL placeholder.
    // N13 fix (auto-set gated on !heroMediaId) ensures this re-fetch
    // does NOT clobber the heroMediaId we just restored above.
    if (pd.booking_id) {
      setSelectedBookingId(pd.booking_id);
    }

    // Restore listing selection for listing-sourced microsites (Bug B —
    // this was never restored, so re-editing a listing-built microsite lost
    // its source binding and the media picker came up empty). The reset
    // effect now preserves selectedListingId during an edit-load too.
    if (pd.listing_id && (pd.source_type === "listing" || !pd.booking_id)) {
      setSelectedListingId(pd.listing_id);
    }

    // Restore theme
    const themeIndex = THEMES.findIndex(t => t.name === ms.theme);
    if (themeIndex >= 0) setThemeIdx(themeIndex);

    setPublishedSlug(ms.slug);
    setPublished(true);
  };

  // Edit: load the microsite into the editor (unchanged behavior).
  const loadMicrositeForEdit = (ms) => {
    loadMicrositeData(ms);
    setStep("build");
  };

  // Leads: load the same data but land directly on the published
  // screen (the inbox). selectedLead is cleared so the inbox list
  // shows, not a stale detail view. The 5a leads loader keys off
  // publishedSlug → myMicrosites → microsite_id and runs on step
  // "published", so it fetches this microsite's real leads.
  const openLeadsForMicrosite = (ms) => {
    loadMicrositeData(ms);
    setSelectedLead(null);
    setStep("published");
  };

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setStep("preview"); }, 1800);
  };

  const handlePublish = async () => {
    // Stage 6 white-label: soft, non-blocking warning when the agent has no
    // agency branding. Publishing still proceeds on confirm — the public page
    // simply falls back to the default Milestone branding.
    if (!brandingComplete) {
      const proceed = window.confirm(
        "Publish without your agency branding? Your logo and agency name won't appear — visitors will see the default Milestone branding. You can add branding in Edit Profile & Branding and republish anytime."
      );
      if (!proceed) return;
    }
    try {
      // Publish is now a server-side operation. The endpoint validates
      // entitlement, copies booking media into the public bucket, builds
      // the final property_data, and writes the microsites row using a
      // service-role key. The client just sends the form fields.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        alert("Your session expired. Please sign in again.");
        return;
      }

      const payload = {
        bookingId: selectedBookingId,
        theme: THEMES[themeIdx].name,
        slug,
        propertyData: {
          address: data.address,
          city: data.city,
          price: data.price,
          beds: data.beds,
          baths: data.baths,
          sqft: data.sqft,
          description: data.description,
          features: (data.features || []).filter(f => f),
          mediaTypes: data.mediaTypes,
          agentName: data.agentName,
          agentPhone: data.agentPhone,
          agentEmail: data.agentEmail,
          heroImg: data.heroImg,
          heroMediaId: data.heroMediaId || null,
          listingId: selectedListingId || null,
          matterportUrl: data.matterportUrl,
          videoUrl: data.videoUrl || listingVideo || "",
          floorplanUrl: listingFloorplan || null,
        },
      };

      const res = await fetch("/api/publish-microsite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        alert("Your session expired. Please sign in again.");
        return;
      }
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        alert("Failed to publish: " + (body.error || "you are not entitled to publish this microsite"));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Publish error:", body);
        alert("Failed to publish. Please try again.");
        return;
      }

      const result = await res.json();
      console.log("Microsite published successfully:", result);
      setPublished(true);
      setPublishedSlug(result.slug || slug);
      setStep("published");

      // Refresh the microsites list so it's up to date
      const { data: refreshed } = await supabase
        .from("microsites")
        .select("id, slug, theme, published, property_data, agent_name, agent_phone, created_at")
        .eq("agent_id", user?.id)
        .order("created_at", { ascending: false });
      if (refreshed) setMyMicrosites(refreshed);
    } catch (err) {
      console.error("Publish error:", err);
      alert("Failed to publish. Please try again.");
    }
  };

  const handleCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const unread = leads.filter(l => !l.read).length;

  const STATUSES = [
    { key: "new", label: "New", color: "#c9a84c", bg: "rgba(201,168,76,0.15)" },
    { key: "contacted", label: "Contacted", color: "#5fb0d8", bg: "rgba(95,176,216,0.15)" },
    { key: "scheduled", label: "Scheduled", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
    { key: "closed", label: "Closed 🎉", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
    { key: "lost", label: "Lost", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.06)" },
  ];

  const tourColors = { "in-person": "#4ade80", virtual: "#5fb0d8", offer: "#c9a84c" };
  const tourLabels = { "in-person": "🏠 Showing", virtual: "🎥 Virtual", offer: "✍️ Offer" };

  // Null-safe accessors. Contact-form leads render their tour type
  // exactly as before; chat leads (tour_type = null / source "chat")
  // fall back to a neutral gold accent and a clear "Chat" tag instead
  // of an undefined color/label.
  const leadAccent = (l) => tourColors[l?.tourType] || "#c9a84c";
  const leadTag = (l) => (l?.tourType && tourLabels[l.tourType]) ? tourLabels[l.tourType] : "💬 Chat";

  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8, padding: "11px 14px", color: "#fff",
    fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none",
    boxSizing: "border-box", colorScheme: "dark",
  };
  const labelStyle = {
    fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, display: "block",
  };

  // ── NOTIFICATION SETTINGS PANEL ──
  if (showNotifSettings) {
    const Toggle = ({ on, onToggle }) => (
      <div onClick={onToggle} style={{
        width: 42, height: 24, borderRadius: 12, cursor: "pointer",
        background: on ? "linear-gradient(135deg,#c9a84c,#e5c97e)" : "rgba(255,255,255,0.12)",
        position: "relative", transition: "background 0.25s", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 3, left: on ? 21 : 3,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          transition: "left 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }} />
      </div>
    );
    const ns = notifSettings;
    const setNS = (k, v) => setNotifSettings(s => ({ ...s, [k]: v }));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowNotifSettings(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em" }}>← Back</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: "#fff", flex: 1 }}>Notifications</div>
        </div>

        {/* Email */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff" }}>📧 Email Alerts</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Instant email when a lead submits</div>
            </div>
            <Toggle on={ns.emailEnabled} onToggle={() => setNS("emailEnabled", !ns.emailEnabled)} />
          </div>
          {ns.emailEnabled && (
            <div style={{ padding: "14px 18px" }}>
              <label style={labelStyle}>Notify email address</label>
              <input style={inputStyle} value={ns.emailAddr} onChange={e => setNS("emailAddr", e.target.value)} placeholder="you@email.com" />
            </div>
          )}
        </div>

        {/* SMS */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff" }}>📱 SMS Alerts</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Text message to your phone</div>
            </div>
            <Toggle on={ns.smsEnabled} onToggle={() => setNS("smsEnabled", !ns.smsEnabled)} />
          </div>
          {ns.smsEnabled && (
            <div style={{ padding: "14px 18px" }}>
              <label style={labelStyle}>Notify phone number</label>
              <input style={inputStyle} value={ns.smsPhone} onChange={e => setNS("smsPhone", e.target.value)} placeholder="(214) 000-0000" type="tel" />
            </div>
          )}
        </div>

        {/* Triggers */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#fff", marginBottom: 14 }}>Alert Triggers</div>
          {[
            { key: "notifyOnNew", label: "🏠 In-Person Showing Requests", sub: "Notify when someone requests an in-person tour" },
            { key: "notifyOnVirtual", label: "🎥 Virtual Tour Requests", sub: "Notify when someone requests a virtual showing" },
            { key: "notifyOnOffer", label: "✍️ Offer Inquiries", sub: "Always recommended — high intent leads" },
          ].map(t => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ flex: 1, paddingRight: 12 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff", marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{t.sub}</div>
              </div>
              <Toggle on={ns[t.key]} onToggle={() => setNS(t.key, !ns[t.key])} />
            </div>
          ))}
        </div>

        <button onClick={() => setShowNotifSettings(false)} style={{
          background: "linear-gradient(135deg,#c9a84c,#e5c97e)", border: "none", borderRadius: 10, padding: "14px",
          fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
          letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
        }}>Save Settings ✓</button>
      </div>
    );
  }

  // ── LEAD DETAIL ──
  if (step === "published" && selectedLead !== null) {
    const lead = leads[selectedLead];
    const currentStatus = STATUSES.find(s => s.key === lead.status) || STATUSES[0];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {transcriptOpen && lead.chatConversationId && (
          <TranscriptModal lead={lead} onClose={() => setTranscriptOpen(false)} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSelectedLead(null)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
            fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em",
          }}>← Inbox</button>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#fff", flex: 1 }}>Lead Detail</div>
          <span style={{ background: currentStatus.bg, color: currentStatus.color, padding: "4px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.07em", fontWeight: 600 }}>
            {currentStatus.label}
          </span>
        </div>

        {/* Lead card */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "20px", background: "rgba(201,168,76,0.05)", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
              background: `linear-gradient(135deg, ${leadAccent(lead)}, ${leadAccent(lead)}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#0a1628", fontWeight: 700,
            }}>{lead.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>{lead.name}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                <span style={{ background: `${leadAccent(lead)}20`, color: leadAccent(lead), border: `1px solid ${leadAccent(lead)}40`, padding: "2px 8px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10 }}>
                  {leadTag(lead)}
                </span>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{lead.date} · {lead.time}</span>
              </div>
            </div>
          </div>

          {/* Contact rows */}
          {[{ icon: "📧", label: "Email", val: lead.email || "—" }, { icon: "📱", label: "Phone", val: lead.phone || "—" }].map(row => (
            <div key={row.label} style={{ padding: "13px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>{row.icon} {row.label}</span>
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#fff" }}>{row.val}</span>
            </div>
          ))}

          {/* Message */}
          {lead.message && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Message</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, fontStyle: "italic" }}>"{lead.message}"</div>
            </div>
          )}

          {/* View Conversation — chat leads only */}
          {lead.source === "chat" && lead.chatConversationId && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={() => setTranscriptOpen(true)} style={{
                width: "100%", background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                borderRadius: 8, padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700,
                letterSpacing: "0.1em", textTransform: "uppercase", color: "#c9a84c", cursor: "pointer",
              }}>💬 View Conversation</button>
            </div>
          )}

          {/* Call / Email actions */}
          <div style={{ padding: "16px 20px", display: "flex", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button style={{
              flex: 1, background: "linear-gradient(135deg,#c9a84c,#e5c97e)", border: "none", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
            }}>📞 Call</button>
            <button style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}>✉️ Email</button>
            <button style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
              padding: "12px", fontFamily: "'Jost', sans-serif", fontSize: 12,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", cursor: "pointer",
            }}>💬 Text</button>
          </div>
        </div>

        {/* Status Tracker */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "18px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff", marginBottom: 14 }}>Update Status</div>

          {/* Pipeline bar */}
          <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden", height: 6 }}>
            {["new","contacted","scheduled","closed"].map((s, i) => {
              const idx = ["new","contacted","scheduled","closed"].indexOf(lead.status);
              return <div key={s} style={{ flex: 1, background: i <= idx ? "#c9a84c" : "rgba(255,255,255,0.1)", transition: "background 0.3s" }} />;
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STATUSES.map(s => (
              <div key={s.key} onClick={() => updateLeadStatus(selectedLead, s.key)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                borderRadius: 10, cursor: "pointer",
                background: lead.status === s.key ? s.bg : "rgba(255,255,255,0.02)",
                border: `1px solid ${lead.status === s.key ? s.color + "50" : "rgba(255,255,255,0.06)"}`,
                transition: "all 0.2s",
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  border: `2px solid ${lead.status === s.key ? s.color : "rgba(255,255,255,0.2)"}`,
                  background: lead.status === s.key ? s.color : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}>
                  {lead.status === s.key && <span style={{ color: "#0a1628", fontSize: 10, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: lead.status === s.key ? s.color : "rgba(255,255,255,0.5)", fontWeight: lead.status === s.key ? 600 : 400, letterSpacing: "0.04em" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (step === "published") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 100, minWidth: 300, maxWidth: 400,
          background: "rgba(10,22,40,0.97)", border: "1px solid rgba(201,168,76,0.5)",
          borderRadius: 12, padding: "14px 16px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 12,
          animation: "slideDown 0.3s ease",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg,#c9a84c,#e5c97e)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#0a1628", fontWeight: 700,
          }}>{toast.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#c9a84c", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>🔔 New Lead!</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", fontWeight: 600 }}>{toast.name}</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{leadTag(toast)} · Just now</div>
          </div>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff" }}>Your Microsite</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#4ade80", letterSpacing: "0.06em" }}>Live</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowNotifSettings(true)} style={{
            background: notifSettings.emailEnabled || notifSettings.smsEnabled ? "rgba(201,168,76,0.12)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${notifSettings.emailEnabled || notifSettings.smsEnabled ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.1)"}`,
            color: notifSettings.emailEnabled || notifSettings.smsEnabled ? "#c9a84c" : "rgba(255,255,255,0.35)",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", cursor: "pointer",
          }}>🔔 Alerts</button>
          <button onClick={() => setStep("build")} style={{
            background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
          }}>✏️ Edit</button>
          <button onClick={() => { skipAutofillRef.current = false; setSelectedBookingId(null); setSelectedListingId(null); setStep("build"); setPublished(false); setPublishedSlug(null); setLeads([]); setData({ address: "", city: "", price: "", beds: "", baths: "", sqft: "", description: "", agentName: "", agentPhone: "", heroImg: "", features: ["","","",""], mediaTypes: ["Photos","Drone","3D Tour"] }); }} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.35)",
            padding: "7px 12px", borderRadius: 7, fontFamily: "'Jost', sans-serif", fontSize: 11,
            letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
          }}>+ New</button>
        </div>
      </div>

      {/* URL card */}
      <div style={{ background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 12, padding: "15px 18px" }}>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Live URL</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#c9a84c", marginBottom: 12, wordBreak: "break-all" }}>{liveUrl}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCopy} style={{
            flex: 1, background: copied ? "rgba(74,222,128,0.12)" : "rgba(201,168,76,0.1)",
            border: `1px solid ${copied ? "rgba(74,222,128,0.3)" : "rgba(201,168,76,0.25)"}`,
            color: copied ? "#4ade80" : "#c9a84c", padding: "9px", borderRadius: 7,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
          }}>{copied ? "✓ Copied!" : "Copy Link"}</button>
          <button style={{
            flex: 1, background: "#c9a84c", border: "none", color: "#0a1628", padding: "9px", borderRadius: 7,
            fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.08em",
            textTransform: "uppercase", cursor: "pointer", fontWeight: 700,
          }}>Share ↗</button>
        </div>
      </div>

      {/* Pipeline summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {STATUSES.slice(0, 4).map(s => {
          const count = leads.filter(l => l.status === s.key).length;
          return (
            <div key={s.key} style={{ background: count > 0 ? s.bg : "rgba(255,255,255,0.02)", border: `1px solid ${count > 0 ? s.color + "30" : "rgba(255,255,255,0.06)"}`, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: count > 0 ? s.color : "rgba(255,255,255,0.2)", fontWeight: 700 }}>{count}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: count > 0 ? s.color : "rgba(255,255,255,0.2)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{s.label.replace(" 🎉","")}</div>
            </div>
          );
        })}
      </div>

      {/* Leads inbox */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff" }}>Leads Inbox</div>
            {unread > 0 && (
              <span style={{ background: "#c9a84c", color: "#0a1628", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Jost', sans-serif", fontSize: 10, fontWeight: 700 }}>{unread}</span>
            )}
          </div>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{leads.length} total</span>
        </div>

        {leads.length === 0 ? (
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12, padding: "32px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.4)" }}>No leads yet</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>Share your microsite to start collecting leads.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {leads.map((lead, i) => {
              const st = STATUSES.find(s => s.key === lead.status) || STATUSES[0];
              return (
                <div key={lead.id ?? i} onClick={() => openLead(i)} style={{
                  background: lead.read ? "rgba(255,255,255,0.02)" : "rgba(201,168,76,0.05)",
                  border: `1px solid ${lead.read ? "rgba(255,255,255,0.07)" : "rgba(201,168,76,0.2)"}`,
                  borderRadius: 12, padding: "13px 15px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = lead.read ? "rgba(255,255,255,0.07)" : "rgba(201,168,76,0.2)"}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${leadAccent(lead)}88, ${leadAccent(lead)}44)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: "#fff", fontWeight: 700,
                  }}>{lead.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", fontWeight: lead.read ? 400 : 600 }}>{lead.name}</span>
                      {!lead.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c9a84c", flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {lead.message || "No message"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <span style={{ background: st.bg, color: st.color, padding: "2px 7px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 9, letterSpacing: "0.07em", fontWeight: 600 }}>
                      {st.label.replace(" 🎉","")}
                    </span>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{lead.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share channels */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>Share Via</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {[{ icon: "📱", label: "Text" }, { icon: "📧", label: "Email" }, { icon: "💼", label: "LinkedIn" }, { icon: "📘", label: "Facebook" }, { icon: "🐦", label: "X" }, { icon: "📸", label: "Instagram" }].map(c => (
            <div key={c.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 6px", textAlign: "center", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.background = "rgba(201,168,76,0.05)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}>
              <div style={{ fontSize: 18, marginBottom: 3 }}>{c.icon}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat assistant + comparable sales — only meaningful for a
          published microsite (both FK to microsites.id). publishedSlug
          is the just-published or being-edited microsite. */}
      {publishedSlug && (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
          <ChatAssistantSection slug={publishedSlug} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
          <ComparableSalesSection slug={publishedSlug} />
        </>
      )}
    </div>
  );

  if (step === "preview") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setStep("build")} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer",
          fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 0, letterSpacing: "0.06em",
        }}>← Edit</button>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#fff", flex: 1 }}>Preview</div>
      </div>

      {/* Theme picker */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={labelStyle}>Choose Theme</span>
          <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "#c9a84c", letterSpacing: "0.06em" }}>
            {THEMES[themeIdx].name} — {THEMES[themeIdx].label}
          </span>
        </div>
        {/* Grouped picker — Prestige (premium, full-width) then four
            layout categories (2-column). Selection state and click
            behavior are unchanged from the flat picker. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {themeGroups.map(group => (
            <div key={group.id}>
              {/* Category label */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  fontFamily: "'Jost', sans-serif", fontSize: 10,
                  letterSpacing: "0.16em", textTransform: "uppercase",
                  color: group.premium ? "#c9a84c" : "rgba(255,255,255,0.4)",
                  fontWeight: group.premium ? 600 : 500,
                }}>{group.label}</div>
                {group.premium && (
                  <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(201,168,76,0.6), rgba(201,168,76,0))" }} />
                )}
              </div>

              {/* Theme cards: full-width single column for premium, 2-col grid otherwise */}
              <div style={{
                display: "grid",
                gridTemplateColumns: group.premium ? "1fr" : "repeat(2, 1fr)",
                gap: 8,
              }}>
                {group.themes.map(t => (
                  <div key={t.name} onClick={() => setThemeIdx(t.idx)} style={{
                    borderRadius: 10, cursor: "pointer", overflow: "hidden",
                    border: themeIdx === t.idx ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                    transition: "border-color 0.2s", background: t.bg,
                    position: "relative",
                  }}>
                    {/* ✦ Signature pill — Prestige only */}
                    {group.premium && (
                      <div style={{
                        position: "absolute", top: 8, right: 8, zIndex: 1,
                        background: "rgba(201,168,76,0.95)", color: "#0f0f1a",
                        fontFamily: "'Jost', sans-serif", fontSize: 8, fontWeight: 700,
                        letterSpacing: "0.14em", textTransform: "uppercase",
                        padding: "3px 9px", borderRadius: 3,
                      }}>✦ Signature</div>
                    )}
                    {/* Color swatch bar */}
                    <div style={{ display: "flex", height: 28 }}>
                      {t.swatches.map((s, si) => (
                        <div key={si} style={{ flex: 1, background: s, borderRight: si < t.swatches.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }} />
                      ))}
                    </div>
                    {/* Name row */}
                    <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 13, color: t.text, fontWeight: 600 }}>{t.name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9, color: t.sub, letterSpacing: "0.06em" }}>{t.label}</div>
                      </div>
                      {themeIdx === t.idx && (
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#c9a84c", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 8, color: "#0a1628", fontWeight: 900 }}>✓</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <MicrositePreview
        data={data}
        theme={theme}
        listingPhotos={listingPhotos}
        listingVideo={listingVideo}
        listingFloorplan={listingFloorplan}
      />

      <button onClick={handlePublish} style={{
        background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "15px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase", color: "#0a1628", cursor: "pointer",
      }}>{publishedSlug ? "✅ Save & Republish" : "🚀 Publish Microsite"}</button>
    </div>
  );

  // Build step
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>Microsite Generator</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Build a branded property page in 60 seconds.</div>
      </div>

      {/* Stage 6 white-label heads-up — shown until the agent adds agency
          name + logo. Dismiss is session-only (reappears next session if
          still incomplete). */}
      {!brandingComplete && !brandingNoticeDismissed && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.35)",
          borderRadius: 10, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 16, lineHeight: "20px" }}>✨</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, fontWeight: 600, color: "#e5c97e", marginBottom: 4 }}>
              Add your branding before you publish
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
              Add your agency name and logo under <strong style={{ color: "rgba(255,255,255,0.85)" }}>Edit Profile &amp; Branding</strong> so your branding — not Milestone's — appears on published microsites. Your brokerage name (shown in the microsite chat) lives under <strong style={{ color: "rgba(255,255,255,0.85)" }}>Voice Profile</strong>.
            </div>
          </div>
          <button onClick={() => setBrandingNoticeDismissed(true)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 16, lineHeight: "20px", padding: 0, flexShrink: 0,
          }} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* My Published Microsites */}
      {myMicrosites.length > 0 && (
        <div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
            My Published Microsites
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myMicrosites.map(ms => {
              const pd = ms.property_data || {};
              const th = THEMES.find(t => t.name === ms.theme) || THEMES[0];
              const isEditing = publishedSlug === ms.slug;
              return (
                <div key={ms.id} style={{
                  background: isEditing ? "rgba(201,168,76,0.07)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isEditing ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 12, padding: "13px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* Theme color dot */}
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    {(th.swatches || [th.bg, th.accent]).slice(0, 3).map((s, i) => (
                      <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: s, border: "1px solid rgba(255,255,255,0.15)" }} />
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {pd.address || ms.slug}
                    </div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                      {ms.theme} · /p/{ms.slug}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => loadMicrositeForEdit(ms)} style={{
                      background: isEditing ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isEditing ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.12)"}`,
                      color: isEditing ? "#c9a84c" : "rgba(255,255,255,0.6)",
                      padding: "6px 12px", borderRadius: 7,
                      fontFamily: "'Jost', sans-serif", fontSize: 10,
                      letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
                    }}>{isEditing ? "Editing" : "✏️ Edit"}</button>
                    <button onClick={() => openLeadsForMicrosite(ms)} style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.6)",
                      padding: "6px 12px", borderRadius: 7,
                      fontFamily: "'Jost', sans-serif", fontSize: 10,
                      letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
                    }}>📬 Leads</button>
                    <a href={`/p/${ms.slug}`} target="_blank" rel="noreferrer" style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.4)", padding: "6px 10px", borderRadius: 7,
                      fontFamily: "'Jost', sans-serif", fontSize: 10,
                      letterSpacing: "0.06em", textDecoration: "none", display: "flex", alignItems: "center",
                    }}>↗</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source is always Bookings — the listing source was retired (Bug C). */}

      {/* Property Selector — Bookings is the sole source: convert a completed
          shoot into a microsite. */}
      <div>
        <div style={labelStyle}>Convert a completed shoot into a microsite</div>
        <select
          style={{ ...inputStyle, cursor: "pointer" }}
          value={selectedBookingId || ""}
          onChange={e => { skipAutofillRef.current = false; setSelectedBookingId(e.target.value || null); }}
        >
          <option value="">— Choose a booking —</option>
          {bookings.map(b => (
            <option key={b.id} value={b.id}>
              {b.address || "No address"}{b.city ? ` — ${b.city}` : ""}
            </option>
          ))}
        </select>
        {/* Package info display */}
        {hasSourceSelection && (
          <div style={{ marginTop: 6, fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            Package: <span style={{ color: activePackage === "Luxury" ? "#e5c97e" : activePackage === "Signature" ? "#c9a84c" : "#8fa3b1", fontWeight: 600 }}>{activePackage || "Unknown"}</span>
            {isAdmin && <span style={{ color: "#4ade80", marginLeft: 8 }}>— Admin access</span>}
            {!isAdmin && micrositeIncluded && <span style={{ color: "rgba(201,168,76,0.7)", marginLeft: 8 }}>— Microsite included</span>}
            {!isAdmin && !micrositeIncluded && micrositeAddonApproved && <span style={{ color: "#4ade80", marginLeft: 8 }}>— Microsite add-on active</span>}
            {!isAdmin && (micrositeIncluded || micrositeAddonApproved) && !invoicePaid && <span style={{ color: "#f59e0b", marginLeft: 8 }}>— Invoice unpaid</span>}
          </div>
        )}
      </div>

      {/* Invoice not paid gate — agent has package but hasn't paid yet.
          Suppressed when access is already granted by another path (admin,
          beta, Pro/Elite subscription, or an existing owned microsite), so
          those agents never see a spurious "pay the invoice" message. */}
      {hasSourceSelection && !micrositeAccessible && (micrositeIncluded || micrositeAddonApproved) && !invoicePaid && (
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(239,168,76,0.25)",
          borderRadius: 14, padding: 28, textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 8 }}>
            Invoice Payment Required
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            Your {activePackage} package includes a microsite, but it will be available once your invoice has been paid. Please complete payment to unlock this feature.
          </div>
        </div>
      )}

      {/* Package tier gate — non-admin without microsite access */}
      {hasSourceSelection && !micrositeAccessible && !(!invoicePaid && (micrositeIncluded || micrositeAddonApproved)) && (
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(201,168,76,0.2)",
          borderRadius: 14, padding: 28, textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🌐</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", marginBottom: 8 }}>
            Unlock Your Property Microsite
          </div>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 20px" }}>
            Your {activePackage || "current"} package doesn't include a microsite. Add one for just <span style={{ color: "#c9a84c", fontWeight: 600 }}>${MICROSITE_ADDON_PRICE}</span> to give your listing a branded, shareable property page with lead capture.
          </div>
          {sourceType === "listing" && (
            <>
              {addonStatus === "pending" ? (
                <div style={{
                  display: "inline-block", padding: "12px 28px", borderRadius: 10,
                  background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                  fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c",
                  letterSpacing: "0.08em", fontWeight: 600,
                }}>
                  Request Pending — Awaiting Admin Approval
                </div>
              ) : addonStatus === "denied" ? (
                <div style={{
                  display: "inline-block", padding: "12px 28px", borderRadius: 10,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
                  letterSpacing: "0.08em", fontWeight: 600,
                }}>
                  Request Denied — Contact admin for details
                </div>
              ) : (
                <button onClick={handleRequestAddon} style={{
                  background: "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
                  border: "none", borderRadius: 10, padding: "14px 32px",
                  fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12,
                  letterSpacing: "0.1em", textTransform: "uppercase", color: "#0a1628",
                  cursor: "pointer", transition: "all 0.3s",
                }}>
                  Add Microsite — ${MICROSITE_ADDON_PRICE}
                </button>
              )}
            </>
          )}
          {sourceType === "booking" && (
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8,
            }}>
              Contact admin to add the Microsite add-on to this booking.
            </div>
          )}
          <div style={{ marginTop: 16, fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            Or upgrade to Luxury for a free microsite with every listing.
          </div>
        </div>
      )}

      {/* Show builder only if microsite is accessible (or no source selected yet) */}
      {(!hasSourceSelection || micrositeAccessible) && <>

      {/* Hero Image from uploaded photos */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={labelStyle}>Hero Photo</span>
          {listingPhotos.length > 0 && (
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              Tap a photo to set as hero
            </span>
          )}
        </div>
        {mediaLoading ? (
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", padding: "20px 0" }}>
            Loading photos...
          </div>
        ) : listingPhotos.length > 0 ? (
          <>
            {/* Selected hero preview */}
            {data.heroImg && (
              <div style={{ position: "relative", width: "100%", height: 180, borderRadius: 10, overflow: "hidden", marginBottom: 10, border: "2px solid #c9a84c" }}>
                <img src={data.heroImg} alt="Hero" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(201,168,76,0.9)", color: "#0a1628", fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 4 }}>
                  Hero Photo
                </div>
              </div>
            )}
            {/* Photo strip picker */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {listingPhotos.map((photo, i) => {
                // Selected if EITHER the id matches (modern path, real
                // booking_media row ids after fetch) OR the URL matches
                // (edit-mode bootstrap before booking-source fetch
                // replaces the synthetic-id rows with real ids).
                const isSelected = data.heroMediaId === photo.id || data.heroImg === photo.url;
                return (
                  <div key={photo.id || i}
                    onClick={() => setData(d => ({ ...d, heroImg: photo.url, heroMediaId: photo.id }))}
                    style={{
                      position: "relative", height: 72, borderRadius: 7, overflow: "hidden", cursor: "pointer",
                      border: isSelected ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.08)",
                      transition: "border-color 0.2s",
                    }}>
                    <img src={photo.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {isSelected && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(201,168,76,0.25)" }} />
                    )}
                    <div style={{ position: "absolute", bottom: 4, right: 5, fontFamily: "'Jost', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>{String(i + 1).padStart(2, "0")}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : hasSourceSelection ? (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              No photos uploaded yet.<br />Upload photos in the Bookings Manager first.
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)", padding: "12px 0" }}>
            Select a {sourceType} above to see available photos.
          </div>
        )}
      </div>

      {/* Property Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Property Details</div>
        <div>
          <label style={labelStyle}>Street Address</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "123 Main St" : "4821 Lakewood Blvd"} value={data.address} onChange={e => setField("address", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>City, State & ZIP</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "Fort Worth, TX 76109" : "Dallas, TX 75206"} value={data.city} onChange={e => setField("city", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>List Price</label>
          <input style={inputStyle} placeholder={sourceType === "booking" ? "$750,000" : "$1,250,000"} value={data.price} onChange={e => setField("price", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[{ key: "beds", ph: "4" }, { key: "baths", ph: "3.5" }, { key: "sqft", ph: "3,840" }].map(f => (
            <div key={f.key}>
              <label style={labelStyle}>{f.key}</label>
              <input style={inputStyle} placeholder={f.ph} value={data[f.key]} onChange={e => setField(f.key, e.target.value)} />
            </div>
          ))}
        </div>
        <div>
          <label style={labelStyle}>Property Description</label>
          <textarea style={{ ...inputStyle, height: 90, resize: "none", lineHeight: 1.5 }}
            placeholder={sourceType === "booking" ? "Describe the property highlights for your microsite..." : "Describe the property's best features..."}
            value={data.description} onChange={e => setField("description", e.target.value)} />
        </div>
      </div>

      {/* Highlights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Highlights</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {data.features.map((f, i) => (
            <input key={i} style={inputStyle} placeholder={sourceType === "booking"
              ? ["Open Floor Plan", "Updated Kitchen", "Large Backyard", "New Roof"][i]
              : ["Chef's Kitchen", "Pool & Spa", "Smart Home", "3-Car Garage"][i]}
              value={f} onChange={e => setFeature(i, e.target.value)} />
          ))}
        </div>
      </div>

      {/* Media included */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>Media Included</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.keys(MEDIA_ICONS).map(m => (
            <div key={m} onClick={() => toggleMedia(m)} style={{
              padding: "7px 14px", borderRadius: 20, cursor: "pointer",
              background: data.mediaTypes.includes(m) ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${data.mediaTypes.includes(m) ? "rgba(201,168,76,0.5)" : "rgba(255,255,255,0.1)"}`,
              fontFamily: "'Jost', sans-serif", fontSize: 11,
              color: data.mediaTypes.includes(m) ? "#c9a84c" : "rgba(255,255,255,0.4)",
              transition: "all 0.2s",
            }}>
              {MEDIA_ICONS[m]} {m}
            </div>
          ))}
        </div>
      </div>

      {/* Agent Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Agent Info</div>
        <div>
          <label style={labelStyle}>Agent Name</label>
          <input style={inputStyle} placeholder="Jane Doe" value={data.agentName} onChange={e => setField("agentName", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Phone Number</label>
          <input style={inputStyle} placeholder="(214) 555-0000" value={data.agentPhone} onChange={e => setField("agentPhone", e.target.value)} />
        </div>
      </div>

      {/* Media URLs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "rgba(255,255,255,0.6)" }}>Media Links</div>
        <div>
          <label style={labelStyle}>Matterport / 3D Tour URL</label>
          <input style={inputStyle} placeholder="https://my.matterport.com/show/?m=..." value={data.matterportUrl || ""} onChange={e => setField("matterportUrl", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Drone / Video URL <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>(YouTube, Vimeo, or direct .mp4)</span></label>
          <input style={inputStyle} placeholder="https://youtube.com/watch?v=..." value={data.videoUrl || ""} onChange={e => setField("videoUrl", e.target.value)} />
        </div>
        {(data.matterportUrl || data.videoUrl || listingVideo || listingFloorplan) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {(data.matterportUrl) && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>🔮 3D Tour</span>}
            {(data.videoUrl || listingVideo) && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>🚁 Drone Video</span>}
            {listingFloorplan && <span style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", padding: "3px 10px", borderRadius: 20, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.06em" }}>📐 Floorplan</span>}
          </div>
        )}
      </div>

      {/* Generate CTA */}
      <button onClick={handleGenerate} disabled={generating} style={{
        background: generating ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #c9a84c 0%, #e5c97e 100%)",
        border: "none", borderRadius: 10, padding: "16px",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: generating ? "rgba(255,255,255,0.5)" : "#0a1628", cursor: generating ? "default" : "pointer",
        transition: "all 0.3s",
      }}>
        {generating ? "✨ Generating..." : publishedSlug ? "Preview Changes →" : "Preview Microsite →"}
      </button>

      {/* When editing an already-published microsite, expose its chat
          assistant + comparable sales config here too (these FK to an
          existing microsites row, so they only apply once published). */}
      {publishedSlug && (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
          <ChatAssistantSection slug={publishedSlug} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
          <ComparableSalesSection slug={publishedSlug} />
        </>
      )}

      </>}
    </div>
  );
}

export default MicrositeView;
