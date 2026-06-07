// VoiceProfileModal — agent-facing editor for the row in
// public.agent_voice_profiles that @milestone-maker/content-engine
// consumes when generating Instagram listing content (Stage 5c).
//
// Front-end only. Writes directly from the authenticated browser client;
// RLS on agent_voice_profiles (migration 015) already permits an agent to
// INSERT / UPDATE / SELECT their own row (agent_id = auth.uid()). No
// backend endpoint is involved.
//
// Styling intentionally mirrors EditProfileModal in App.jsx (same dark
// #0e1220 card, gold accents, sticky header/footer, scrollable body,
// saving/saved state) so the two editors feel like one product.
//
// One profile per agent: on open we load the single existing row (if any)
// → EDIT mode; otherwise → CREATE mode. No profile picker.

import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";

// ── Shared inline styles (copied verbatim from EditProfileModal so the
//    two modals stay visually identical) ──────────────────────────────
const inputSt = {
  width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "11px 14px", color: "#fff",
  fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none", boxSizing: "border-box",
  transition: "border-color 0.2s",
};
const labelSt = {
  fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
  letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 7, display: "block",
};
const sectionTitle = (icon, text) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#C9A84C", fontWeight: 600 }}>{icon} {text}</div>
    <div style={{ flex: 1, height: 1, background: "rgba(201,168,76,0.2)" }} />
  </div>
);
const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "24px 0" }} />;

const noteSt = {
  fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.22)", marginTop: 5, lineHeight: 1.5,
};
const sectionIntroSt = {
  fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 18, lineHeight: 1.6,
};

// ── ChipInput: type + Enter to add a short value; × to remove ─────────
function ChipInput({ label, values, setValues, placeholder, note, required }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) setValues([...values, v]);
    setDraft("");
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !draft && values.length) {
      setValues(values.slice(0, -1));
    }
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelSt}>{label}{required && <span style={{ color: "#C9A84C" }}> *</span>}</label>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "8px 10px", boxSizing: "border-box",
      }}>
        {values.map((v, i) => (
          <span key={`${v}-${i}`} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)",
            color: "#e8c97a", borderRadius: 6, padding: "4px 8px",
            fontFamily: "'Jost', sans-serif", fontSize: 12,
          }}>
            {v}
            <button type="button" onClick={() => setValues(values.filter((_, j) => j !== i))} style={{
              background: "none", border: "none", color: "rgba(232,201,122,0.7)", cursor: "pointer",
              fontSize: 13, lineHeight: 1, padding: 0,
            }}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={values.length ? "" : placeholder}
          style={{
            flex: 1, minWidth: 120, background: "none", border: "none", outline: "none",
            color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 13, padding: "3px 2px",
          }}
        />
      </div>
      {note && <div style={noteSt}>{note}</div>}
    </div>
  );
}

// ── RowListInput: add-a-row list of text inputs for sentence-length
//    values (hook_lines, take_lines) ────────────────────────────────
function RowListInput({ label, values, setValues, placeholder, note }) {
  const rows = values.length ? values : [""];
  const setRow = (i, val) => {
    const next = [...rows];
    next[i] = val;
    setValues(next);
  };
  const addRow = () => setValues([...rows, ""]);
  const removeRow = (i) => {
    const next = rows.filter((_, j) => j !== i);
    setValues(next);
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelSt}>{label}</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              style={inputSt}
              value={row}
              onChange={(e) => setRow(i, e.target.value)}
              placeholder={placeholder}
            />
            <button type="button" onClick={() => removeRow(i)} style={{
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
              color: "#f87171", borderRadius: 7, padding: "9px 12px", cursor: "pointer",
              fontFamily: "'Jost', sans-serif", fontSize: 12, flexShrink: 0,
            }}>×</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} style={{
        marginTop: 8, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
        color: "#c9a84c", borderRadius: 7, padding: "7px 14px", cursor: "pointer",
        fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.05em",
      }}>+ Add another</button>
      {note && <div style={noteSt}>{note}</div>}
    </div>
  );
}

// Strip blank/whitespace-only entries from an array before persisting.
const cleanArr = (arr) => arr.map((s) => String(s).trim()).filter((s) => s !== "");

function VoiceProfileModal({ onClose }) {
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState(null); // null = CREATE, set = EDIT

  // ── Identity
  const [displayName, setDisplayName] = useState("");
  const [fullName, setFullName] = useState("");
  const [brokerageName, setBrokerageName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [brokerageTagline, setBrokerageTagline] = useState("");
  const [headshotFile, setHeadshotFile] = useState(null);
  const [headshotPreview, setHeadshotPreview] = useState(null);
  const headshotInputRef = useRef(null);

  // ── Market
  const [primaryMetro, setPrimaryMetro] = useState("");
  const [primaryNeighborhoods, setPrimaryNeighborhoods] = useState([]);
  const [secondaryNeighborhoods, setSecondaryNeighborhoods] = useState([]);
  const [propertyTypeFocus, setPropertyTypeFocus] = useState([]);
  const [specializationTags, setSpecializationTags] = useState([]);

  // ── Voice
  const [toneDescriptors, setToneDescriptors] = useState([]);
  const [hookLines, setHookLines] = useState([]);
  const [takeLines, setTakeLines] = useState([]);
  const [ctaVerbs, setCtaVerbs] = useState([]);
  const [phrasesToAvoid, setPhrasesToAvoid] = useState([]);

  // ── Hashtags
  const [poolHyperLocal, setPoolHyperLocal] = useState([]);
  const [poolNicheFeature, setPoolNicheFeature] = useState([]);
  const [poolBroadIndustry, setPoolBroadIndustry] = useState([]);
  const [poolAction, setPoolAction] = useState([]);

  // ── Socials
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialThreads, setSocialThreads] = useState("");
  const [socialLinkedin, setSocialLinkedin] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Load existing profile on open (single row per agent) ──
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("agent_voice_profiles")
        .select("*")
        .eq("agent_id", user.id)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Voice profile load error:", error);
        setErrorMsg("Could not load your voice profile: " + error.message);
        setLoading(false);
        return;
      }
      if (data) {
        setProfileId(data.id);
        setDisplayName(data.display_name || "");
        setFullName(data.full_name || "");
        setBrokerageName(data.brokerage_name || "");
        setLicenseNumber(data.license_number || "");
        setBrokerageTagline(data.brokerage_tagline || "");
        setHeadshotPreview(data.headshot_url || null);
        setPrimaryMetro(data.primary_metro || "");
        setPrimaryNeighborhoods(data.primary_neighborhoods || []);
        setSecondaryNeighborhoods(data.secondary_neighborhoods || []);
        setPropertyTypeFocus(data.property_type_focus || []);
        setSpecializationTags(data.specialization_tags || []);
        setToneDescriptors(data.tone_descriptors || []);
        setHookLines(data.hook_lines || []);
        setTakeLines(data.take_lines || []);
        setCtaVerbs(data.cta_verbs || []);
        setPhrasesToAvoid(data.phrases_to_avoid || []);
        setPoolHyperLocal(data.hashtag_pool_hyper_local || []);
        setPoolNicheFeature(data.hashtag_pool_niche_feature || []);
        setPoolBroadIndustry(data.hashtag_pool_broad_industry || []);
        setPoolAction(data.hashtag_pool_action || []);
        setSocialInstagram(data.social_instagram || "");
        setSocialFacebook(data.social_facebook_url || "");
        setSocialThreads(data.social_threads || "");
        setSocialLinkedin(data.social_linkedin_url || "");
      } else {
        // CREATE (no existing row): pre-fill editable defaults from the agent
        // record so they don't retype info already on file. EDIT (the if-branch
        // above) is untouched — a saved profile's values always win. Falls back
        // to blank when the agent record has no value. profile is intentionally
        // NOT in the dep array so this seeds once on open and never clobbers
        // what the agent has started typing.
        setFullName(profile?.full_name || "");
        setBrokerageName(profile?.agency_name || "");
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user?.id]);

  const pickHeadshot = (file) => {
    if (!file) return;
    setHeadshotFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setHeadshotPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  // Upload headshot to the agent-branding bucket (same bucket/pattern as
  // EditProfileModal). Returns the public URL or null on failure.
  const uploadHeadshot = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `${user.id}/voice-headshot.${ext}`;
    await supabase.storage.from("agent-branding").remove([path]).catch(() => {});
    const { error } = await supabase.storage.from("agent-branding").upload(path, file, { contentType: file.type, upsert: true });
    if (error) { console.error("Headshot upload error:", error); return null; }
    const { data } = supabase.storage.from("agent-branding").getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
  };

  // ── Required-to-save validation (UI-level, non-empty) ──
  const missingRequired = () => {
    const missing = [];
    if (!displayName.trim()) missing.push("Display Name");
    if (!fullName.trim()) missing.push("Full Name");
    if (!brokerageName.trim()) missing.push("Brokerage Name");
    if (!primaryMetro.trim()) missing.push("Primary Metro");
    if (!licenseNumber.trim()) missing.push("License Number");
    return missing;
  };

  const handleSave = async () => {
    setErrorMsg("");
    const missing = missingRequired();
    if (missing.length) {
      setErrorMsg(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);

    // Resolve headshot URL (upload new file if one was picked).
    let headshotUrl = headshotPreview && !headshotFile ? headshotPreview : null;
    if (headshotFile) {
      const url = await uploadHeadshot(headshotFile);
      if (url) headshotUrl = url;
    }

    // Build the payload. Every NOT-NULL array column is always sent as an
    // array ([] when blank). reference_accounts is NOT NULL with no default
    // and has no form field → send []. framework_weights_inferred has a DB
    // default and framework_weights_override is nullable → omit both.
    const payload = {
      display_name: displayName.trim(),
      full_name: fullName.trim(),
      brokerage_name: brokerageName.trim(),
      license_number: licenseNumber.trim(),
      brokerage_tagline: brokerageTagline.trim() || null,
      headshot_url: headshotUrl,

      primary_metro: primaryMetro.trim(),
      primary_neighborhoods: cleanArr(primaryNeighborhoods),
      secondary_neighborhoods: cleanArr(secondaryNeighborhoods),
      property_type_focus: cleanArr(propertyTypeFocus),
      specialization_tags: cleanArr(specializationTags),

      reference_accounts: [],

      tone_descriptors: cleanArr(toneDescriptors),
      hook_lines: cleanArr(hookLines),
      take_lines: cleanArr(takeLines),
      cta_verbs: cleanArr(ctaVerbs),
      phrases_to_avoid: cleanArr(phrasesToAvoid),

      hashtag_pool_hyper_local: cleanArr(poolHyperLocal),
      hashtag_pool_niche_feature: cleanArr(poolNicheFeature),
      hashtag_pool_broad_industry: cleanArr(poolBroadIndustry),
      hashtag_pool_action: cleanArr(poolAction),

      social_instagram: socialInstagram.trim() || null,
      social_facebook_url: socialFacebook.trim() || null,
      social_threads: socialThreads.trim() || null,
      social_linkedin_url: socialLinkedin.trim() || null,

      updated_at: new Date().toISOString(), // no DB trigger — app sets it
    };

    let result;
    if (profileId) {
      // EDIT — update existing row by id (agent_id unchanged).
      result = await supabase
        .from("agent_voice_profiles")
        .update(payload)
        .eq("id", profileId)
        .select()
        .maybeSingle();
    } else {
      // CREATE — insert with agent_id = auth.uid() (RLS with-check).
      result = await supabase
        .from("agent_voice_profiles")
        .insert({ ...payload, agent_id: user.id })
        .select()
        .maybeSingle();
    }

    const { data, error } = result;
    if (error) {
      console.error("Voice profile save error:", error);
      setErrorMsg("Save failed: " + error.message);
      setSaving(false); // keep the modal open — never lose the agent's input
      return;
    }

    // Refresh from the saved row so a subsequent save is an EDIT.
    if (data?.id) {
      setProfileId(data.id);
      if (data.headshot_url) { setHeadshotPreview(data.headshot_url); setHeadshotFile(null); }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#0e1220", border: "1px solid rgba(201,168,76,0.18)",
        borderRadius: 18, width: "100%", maxWidth: 520,
        boxShadow: "0 40px 100px rgba(0,0,0,0.9)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* ── Header ── */}
        <div style={{
          padding: "24px 28px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 600, lineHeight: 1.1 }}>
              Voice Profile
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", marginTop: 3 }}>
              {profileId ? "Editing your saved profile" : "Set up the voice your AI content is written in"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: "auto", padding: "24px 28px 28px", flex: 1 }}>
          {loading ? (
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "40px 0" }}>
              Loading your voice profile…
            </div>
          ) : (
            <>
              {/* ── IDENTITY ── */}
              {sectionTitle("👤", "Identity")}

              {/* Headshot */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelSt}>Headshot <span style={{ color: "rgba(255,255,255,0.2)" }}>— optional</span></label>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                    background: "rgba(201,168,76,0.1)", border: "2px solid rgba(201,168,76,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {headshotPreview
                      ? <img src={headshotPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 24, color: "#c9a84c" }}>👤</span>}
                  </div>
                  <div>
                    <input ref={headshotInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pickHeadshot(e.target.files[0])} />
                    <button onClick={() => headshotInputRef.current?.click()} style={{
                      background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)",
                      color: "#c9a84c", borderRadius: 7, padding: "7px 14px", cursor: "pointer",
                      fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.05em",
                    }}>{headshotPreview ? "Change Headshot" : "Upload Headshot"}</button>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Display Name <span style={{ color: "#C9A84C" }}>*</span></label>
                <input style={inputSt} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane @ DFW Luxury" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Full Name <span style={{ color: "#C9A84C" }}>*</span></label>
                <input style={inputSt} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Brokerage Name <span style={{ color: "#C9A84C" }}>*</span></label>
                <input style={inputSt} value={brokerageName} onChange={(e) => setBrokerageName(e.target.value)} placeholder="Compass Real Estate" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>License Number <span style={{ color: "#C9A84C" }}>*</span></label>
                <input style={inputSt} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="0123456" />
                <div style={noteSt}>Required — appears on your posts for TREC compliance</div>
              </div>
              <div style={{ marginBottom: 0 }}>
                <label style={labelSt}>Brokerage Tagline <span style={{ color: "rgba(255,255,255,0.2)" }}>— optional</span></label>
                <input style={inputSt} value={brokerageTagline} onChange={(e) => setBrokerageTagline(e.target.value)} placeholder="Luxury homes, white-glove service" />
              </div>

              {divider}

              {/* ── MARKET ── */}
              {sectionTitle("📍", "Market")}
              <div style={{ marginBottom: 16 }}>
                <label style={labelSt}>Primary Metro <span style={{ color: "#C9A84C" }}>*</span></label>
                <input style={inputSt} value={primaryMetro} onChange={(e) => setPrimaryMetro(e.target.value)} placeholder="Dallas–Fort Worth" />
              </div>
              <ChipInput label="Primary Neighborhoods" values={primaryNeighborhoods} setValues={setPrimaryNeighborhoods}
                placeholder="Type a neighborhood, press Enter" note="The core areas you farm. Press Enter or comma to add each one." />
              <ChipInput label="Secondary Neighborhoods" values={secondaryNeighborhoods} setValues={setSecondaryNeighborhoods}
                placeholder="Type a neighborhood, press Enter" note="Optional — additional areas you cover." />
              <ChipInput label="Property Type Focus" values={propertyTypeFocus} setValues={setPropertyTypeFocus}
                placeholder="e.g. Single-family, Luxury condo" note="The property types you specialize in." />
              <ChipInput label="Specialization Tags" values={specializationTags} setValues={setSpecializationTags}
                placeholder="e.g. First-time buyers, Relocation" note="How you'd describe your niche." />

              {divider}

              {/* ── VOICE ── */}
              {sectionTitle("🗣", "Voice")}
              <div style={sectionIntroSt}>
                This is what shapes how your AI-generated content sounds. The more specific you are, the more the captions sound like you.
              </div>
              <ChipInput label="Tone Descriptors" values={toneDescriptors} setValues={setToneDescriptors}
                placeholder="e.g. warm, confident, direct" note="A few adjectives that describe how you communicate." />
              <RowListInput label="Hook Lines" values={hookLines} setValues={setHookLines}
                placeholder="An opening line you'd actually use…" note="Example opening lines in your voice — one per row." />
              <RowListInput label="Take Lines" values={takeLines} setValues={setTakeLines}
                placeholder="A reflective / signature line you'd use…" note="Signature reflective lines in your voice — one per row." />
              <ChipInput label="CTA Verbs" values={ctaVerbs} setValues={setCtaVerbs}
                placeholder="e.g. send, schedule, ask" note="Your preferred call-to-action verbs." />
              <ChipInput label="Phrases to Avoid" values={phrasesToAvoid} setValues={setPhrasesToAvoid}
                placeholder="Words you never want in your posts" note="Optional — the AI will avoid these." />

              {divider}

              {/* ── HASHTAGS ── */}
              {sectionTitle("#️⃣", "Hashtag Pools")}
              <div style={sectionIntroSt}>
                The AI draws from these pools when adding hashtags to your posts. Add the tags without the # if you like — either works.
              </div>
              <ChipInput label="Hyper-Local" values={poolHyperLocal} setValues={setPoolHyperLocal}
                placeholder="#LakewoodDallas" note="Neighborhood- and city-specific tags." />
              <ChipInput label="Niche / Feature" values={poolNicheFeature} setValues={setPoolNicheFeature}
                placeholder="#MidCenturyModern" note="Home-style or feature tags." />
              <ChipInput label="Broad Industry" values={poolBroadIndustry} setValues={setPoolBroadIndustry}
                placeholder="#RealEstate" note="Wider real-estate tags." />
              <ChipInput label="Action" values={poolAction} setValues={setPoolAction}
                placeholder="#JustListed" note="Action / status tags." />

              {divider}

              {/* ── SOCIALS ── */}
              {sectionTitle("🔗", "Socials")}
              <div style={sectionIntroSt}>All optional.</div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Instagram</label>
                <input style={inputSt} value={socialInstagram} onChange={(e) => setSocialInstagram(e.target.value)} placeholder="@yourhandle" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Facebook URL</label>
                <input style={inputSt} type="url" value={socialFacebook} onChange={(e) => setSocialFacebook(e.target.value)} placeholder="https://facebook.com/…" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Threads</label>
                <input style={inputSt} value={socialThreads} onChange={(e) => setSocialThreads(e.target.value)} placeholder="@yourhandle" />
              </div>
              <div style={{ marginBottom: 0 }}>
                <label style={labelSt}>LinkedIn URL</label>
                <input style={inputSt} type="url" value={socialLinkedin} onChange={(e) => setSocialLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
              </div>
            </>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div style={{
          padding: "16px 28px 20px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0,
          background: "#0e1220",
        }}>
          {errorMsg && (
            <div style={{
              fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8, padding: "10px 12px", marginBottom: 12, lineHeight: 1.5,
            }}>{errorMsg}</div>
          )}
          <button onClick={handleSave} disabled={saving || saved || loading} style={{
            width: "100%", padding: "14px 0", borderRadius: 10, cursor: saving || saved || loading ? "default" : "pointer",
            background: saved ? "rgba(74,222,128,0.15)" : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
            color: saved ? "#4ade80" : "#0a1628",
            fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase",
            border: saved ? "1px solid rgba(74,222,128,0.35)" : "none",
            opacity: loading ? 0.5 : 1,
            transition: "all 0.25s",
          }}>
            {saved ? "✓ Voice Profile Saved!" : saving ? "Saving…" : profileId ? "Save Changes" : "Create Voice Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceProfileModal;
