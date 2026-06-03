// PhotosPanel — Photo Intelligence section of the Content tab.
//
// Self-contained section (mirrors Microsite/ComparableSalesSection.jsx):
// given a listingId it reads that listing's photo_labels (RLS-scoped client
// read), lets the agent run vision classification via POST /api/classify-photos,
// displays photos grouped by the nine categories, and lets the agent correct a
// photo's category (direct client supabase update — RLS authorizes updates to
// labels on the agent's own listings, per migration 029).
//
// UI shows human-readable category labels but stores/sends canonical enum
// values (the nine from migration 029). Inline-styled to match the Content
// tab's dark/gold theme; the few style tokens it needs are duplicated locally
// so the generator screen isn't touched.

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";

// ── Canonical enum (migration 029) → human-readable label. Order here is the
//    locked display order: exterior establishing shots, public interior,
//    private rooms, then the catch-all. ──
const CATEGORY_ORDER = [
  "drone",
  "front_facade",
  "backyard",
  "living",
  "dining",
  "kitchen",
  "primary_bedroom",
  "primary_bathroom",
  "other",
];
const CATEGORY_LABELS = {
  drone:            "Drone / Aerial",
  front_facade:     "Front Facade",
  backyard:         "Backyard",
  living:           "Living Room",
  dining:           "Dining Room",
  kitchen:          "Kitchen",
  primary_bedroom:  "Primary Bedroom",
  primary_bathroom: "Primary Bathroom",
  other:            "Other / Unused",
};

const LOW_CONFIDENCE = 0.7; // below this → flagged for the agent's attention

// ── Duplicated style tokens (match Content/index.jsx) ──
const panelSt = {
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14, padding: 20,
};
const labelSt = {
  fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
  letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10, display: "block",
};
const goldBtn = (disabled) => ({
  padding: "13px 28px", borderRadius: 10, border: "none",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
  background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)", color: "#0a1628",
  fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase",
});
const ghostBtn = {
  padding: "11px 16px", borderRadius: 8, cursor: "pointer",
  background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c",
  fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
};

// Map an HTTP status (+ server error text) to friendly copy. 404 is handled
// by the caller (no-microsite vs listing-not-found differ).
function friendlyClassifyError(status, serverMsg) {
  switch (status) {
    case 401: return "Your session expired. Please sign in again.";
    case 402: return "An active subscription is required to analyze photos.";
    case 403: return "This listing isn't available to your account.";
    case 500:
    case 502: return "Photo analysis hit a snag, please try again.";
    default:  return serverMsg || "Couldn't analyze photos. Please try again.";
  }
}

function PhotosPanel({ listingId, listingAddress }) {
  const [labels, setLabels]     = useState([]);
  const [reading, setReading]   = useState(true);     // initial RLS read in flight
  const [analyzing, setAnalyzing] = useState(false);  // model call in flight
  const [error, setError]       = useState("");
  const [warnings, setWarnings] = useState([]);
  const [banner, setBanner]     = useState("");       // transient success info
  // After an analyze call returns no photos: "no_microsite" | "no_photos" | ""
  const [emptyReason, setEmptyReason] = useState("");
  const [selectedId, setSelectedId]   = useState(null);
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  const [savingId, setSavingId] = useState(null);     // tile currently persisting a correction

  // ── Initial read: existing labels for this listing (no model call) ──
  const loadLabels = useCallback(async () => {
    if (!listingId) { setLabels([]); setReading(false); return; }
    setReading(true);
    setError(""); setWarnings([]); setBanner(""); setEmptyReason(""); setSelectedId(null);
    const { data, error: readErr } = await supabase
      .from("photo_labels")
      .select("*")
      .eq("listing_id", listingId)
      .order("sort_order", { ascending: true });
    if (readErr) {
      console.error("[PhotosPanel] label read error:", readErr);
      setError("Couldn't load photo labels. Please refresh.");
      setLabels([]);
    } else {
      setLabels(data || []);
    }
    setReading(false);
  }, [listingId]);

  useEffect(() => { loadLabels(); }, [loadLabels]);

  // ── Classify (force=false incremental, or force=true refresh) ──
  const runClassify = async (force) => {
    setConfirmReanalyze(false);
    setError(""); setWarnings([]); setBanner(""); setEmptyReason("");
    setAnalyzing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { setError("Your session expired. Please sign in again."); setAnalyzing(false); return; }

      const res = await fetch("/api/classify-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_id: listingId, force }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 404 && /no microsite/i.test(body?.error || "")) {
          setEmptyReason("no_microsite"); setLabels([]);
        } else if (res.status === 404) {
          setError("That listing couldn't be found. Refresh and try again.");
        } else {
          setError(friendlyClassifyError(res.status, body?.error));
        }
        setAnalyzing(false);
        return;
      }

      const newLabels = Array.isArray(body?.labels) ? body.labels : [];
      setLabels(newLabels);
      if (Array.isArray(body?.warnings) && body.warnings.length) setWarnings(body.warnings);
      if (newLabels.length === 0) {
        setEmptyReason("no_photos");
      } else if (force) {
        const kept = body?.skipped_agent_corrected_count || 0;
        setBanner(`Refreshed ${body?.classified_count ?? 0}${kept ? ` · ${kept} correction${kept === 1 ? "" : "s"} kept` : ""}`);
      }
    } catch (e) {
      console.error("[PhotosPanel] classify error:", e);
      setError("Couldn't reach the analyzer. Please try again.");
    }
    setAnalyzing(false);
  };

  // ── Correction: change a photo's category (direct client update; RLS ok) ──
  const correctCategory = async (label, newCategory) => {
    if (newCategory === label.category) return;
    const prev = labels;
    // Optimistic: update category + mark corrected; tile auto-moves group.
    setLabels((ls) => ls.map((l) => (l.id === label.id ? { ...l, category: newCategory, agent_corrected: true } : l)));
    setSavingId(label.id);
    const { error: upErr } = await supabase
      .from("photo_labels")
      .update({ category: newCategory, agent_corrected: true, updated_at: new Date().toISOString() })
      .eq("id", label.id);
    setSavingId(null);
    if (upErr) {
      console.error("[PhotosPanel] correction save error:", upErr);
      setLabels(prev); // revert
      setError("Couldn't save that change. Please try again.");
    }
  };

  // ── Reset a correction back to auto (re-opens it to future re-analysis) ──
  const resetToAuto = async (label) => {
    const prev = labels;
    setLabels((ls) => ls.map((l) => (l.id === label.id ? { ...l, agent_corrected: false } : l)));
    setSavingId(label.id);
    const { error: upErr } = await supabase
      .from("photo_labels")
      .update({ agent_corrected: false, updated_at: new Date().toISOString() })
      .eq("id", label.id);
    setSavingId(null);
    if (upErr) {
      console.error("[PhotosPanel] reset save error:", upErr);
      setLabels(prev);
      setError("Couldn't reset that photo. Please try again.");
    }
  };

  // ── Header ──
  const hasLabels = labels.length > 0;
  const Header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff" }}>Listing Photos</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
          {listingAddress ? `Auto-sorted photos for ${listingAddress}` : "Auto-sorted photos"}
        </div>
      </div>
      {hasLabels && !analyzing && (
        confirmReanalyze ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              Re-analyze all photos? Your manual corrections are kept.
            </span>
            <button onClick={() => runClassify(true)} style={ghostBtn}>Yes, re-analyze</button>
            <button onClick={() => setConfirmReanalyze(false)} style={{ ...ghostBtn, background: "transparent", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.15)" }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmReanalyze(true)} style={ghostBtn}>↻ Re-analyze</button>
        )
      )}
    </div>
  );

  // ── Body: loading / reading ──
  let body;
  if (reading) {
    body = <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 24, textAlign: "center" }}>Loading photos…</div>;
  } else if (analyzing) {
    body = (
      <div style={{ padding: 36, textAlign: "center" }}>
        <div style={{ fontSize: 26, marginBottom: 10 }}>✦</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
          Analyzing photos… this takes a few seconds.
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <div style={{ padding: 20 }}>
        <div style={{
          fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171",
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8, padding: "12px 14px", lineHeight: 1.5, marginBottom: 14,
        }}>{error}</div>
        <button onClick={() => { setError(""); hasLabels ? loadLabels() : runClassify(false); }} style={ghostBtn}>Try again</button>
      </div>
    );
  } else if (!hasLabels && emptyReason === "no_microsite") {
    body = (
      <div style={{ padding: "32px 20px", textAlign: "center", fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        Publish this listing's microsite to enable photo analysis.
      </div>
    );
  } else if (!hasLabels && emptyReason === "no_photos") {
    body = (
      <div style={{ padding: "32px 20px", textAlign: "center", fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        No photos found for this listing yet.
      </div>
    );
  } else if (!hasLabels) {
    // Not-yet-classified — inviting empty state.
    body = (
      <div style={{ padding: "32px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 30, marginBottom: 12 }}>🖼</div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 380, margin: "0 auto 20px", lineHeight: 1.6 }}>
          Auto-sort this listing's photos into rooms and exterior shots — so your captions and carousels can reference the right spaces.
        </div>
        <button onClick={() => runClassify(false)} style={goldBtn(false)}>✦ Analyze Photos</button>
      </div>
    );
  } else {
    // ── Grouped grid ──
    const groups = CATEGORY_ORDER
      .map((cat) => ({ cat, items: labels.filter((l) => l.category === cat).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }))
      .filter((g) => g.items.length > 0);

    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {warnings.length > 0 && (
          <div style={{
            fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e8c97a",
            background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)",
            borderRadius: 8, padding: "10px 12px", lineHeight: 1.5,
          }}>Some photos couldn't be analyzed — try Re-analyze.</div>
        )}
        {banner && (
          <div style={{
            fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#4ade80",
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)",
            borderRadius: 8, padding: "10px 12px",
          }}>{banner}</div>
        )}
        {groups.map(({ cat, items }) => (
          <div key={cat}>
            <label style={{ ...labelSt, marginBottom: 12 }}>
              {CATEGORY_LABELS[cat]} <span style={{ color: "rgba(255,255,255,0.25)" }}>· {items.length}</span>
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {items.map((l) => (
                <PhotoTile
                  key={l.id}
                  label={l}
                  selected={selectedId === l.id}
                  saving={savingId === l.id}
                  onSelect={() => setSelectedId(selectedId === l.id ? null : l.id)}
                  onCorrect={(cat2) => correctCategory(l, cat2)}
                  onReset={() => resetToAuto(l)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={panelSt}>
      {Header}
      {body}
    </div>
  );
}

// ── Single photo tile ──
function PhotoTile({ label, selected, saving, onSelect, onCorrect, onReset }) {
  const conf = typeof label.confidence === "number" ? label.confidence : null;
  const flagged = conf !== null && conf < LOW_CONFIDENCE; // 'other' flags only if also low-confidence (same rule)
  const corrected = !!label.agent_corrected;
  const features = Array.isArray(label.features) ? label.features : [];

  return (
    <div style={{ width: 150 }}>
      <div
        onClick={onSelect}
        style={{
          position: "relative", width: 150, height: 100, borderRadius: 10, overflow: "hidden", cursor: "pointer",
          border: selected ? "2px solid #c9a84c" : flagged ? "2px solid rgba(201,168,76,0.55)" : "2px solid transparent",
          transition: "border-color 0.15s",
        }}
      >
        <img src={label.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

        {/* Confidence — subtle corner */}
        {conf !== null && (
          <span style={{
            position: "absolute", bottom: 4, right: 4, background: "rgba(8,18,40,0.7)",
            color: "rgba(255,255,255,0.7)", borderRadius: 4, padding: "1px 5px",
            fontFamily: "'Jost', sans-serif", fontSize: 9,
          }}>{Math.round(conf * 100)}%</span>
        )}

        {/* Corrected lock badge */}
        {corrected && (
          <span title="You set this — re-analyze won't change it" style={{
            position: "absolute", top: 4, left: 4, background: "rgba(74,222,128,0.18)",
            color: "#4ade80", borderRadius: 4, padding: "1px 6px",
            fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3,
          }}>🔒 edited</span>
        )}

        {/* Review flag */}
        {flagged && !selected && (
          <span style={{
            position: "absolute", top: 4, right: 4, background: "rgba(201,168,76,0.85)",
            color: "#0a1628", borderRadius: 4, padding: "1px 6px",
            fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
          }}>review</span>
        )}

        {/* Selected → features overlay */}
        {selected && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(8,18,40,0.82)", padding: "8px 9px",
            display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 9.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.45 }}>
              {features.length ? features.join(", ") : "No features noted"}
            </div>
          </div>
        )}
      </div>

      {/* Category dropdown (readable labels, canonical values) */}
      <select
        value={label.category}
        disabled={saving}
        onChange={(e) => onCorrect(e.target.value)}
        style={{
          width: 150, marginTop: 6, background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "5px 7px",
          color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 11, outline: "none", cursor: saving ? "default" : "pointer",
        }}
      >
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c} style={{ background: "#0f0f1a" }}>{CATEGORY_LABELS[c]}</option>
        ))}
      </select>

      {/* Reset-to-auto affordance for corrected tiles */}
      {corrected && (
        <button
          onClick={onReset}
          disabled={saving}
          style={{
            marginTop: 4, background: "transparent", border: "none", cursor: saving ? "default" : "pointer",
            color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", fontSize: 9.5, letterSpacing: "0.04em",
            textDecoration: "underline", padding: 0,
          }}
        >reset to auto</button>
      )}
    </div>
  );
}

export default PhotosPanel;
