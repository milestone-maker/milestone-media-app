// Comparable sales management — agent-facing CRUD for public.microsite_comps.
// Comps are visible to the chat assistant only (not rendered on the public
// microsite). Two entry paths: smart paste (AI parse via /api/parse-comps)
// and manual entry. Self-contained: resolves microsite id from the slug.

import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import Modal from "./Modal.jsx";
import {
  inputStyle, labelStyle, sectionTitleStyle, helperStyle,
  PrimaryButton, SecondaryButton,
} from "./controls.jsx";

// ── formatting helpers ───────────────────────────────────────────────
function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtDate(d) {
  if (!d) return "";
  // Parse YYYY-MM-DD as a local date (avoid UTC off-by-one).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-US") : null;
}

// distance asc (closest first); comps without distance fall to the bottom
// ordered by most recent sale date.
function sortComps(list) {
  return [...list].sort((a, b) => {
    const da = a.distance_miles, db = b.distance_miles;
    const aHas = da != null, bHas = db != null;
    if (aHas && bHas) return da - db;
    if (aHas) return -1;
    if (bHas) return 1;
    return String(b.sale_date || "").localeCompare(String(a.sale_date || ""));
  });
}

const EMPTY_COMP = {
  address: "", sale_price: "", sale_date: "",
  sqft: "", beds: "", baths: "", distance_miles: "", notes: "",
};

// ── shared field set (used by manual modal + review cards) ───────────
function CompFields({ comp, onChange, compact = false }) {
  const set = (k, v) => onChange({ ...comp, [k]: v });
  const grid = compact ? "1fr 1fr" : "1fr 1fr 1fr";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label style={labelStyle}>Address *</label>
        <input style={inputStyle} value={comp.address ?? ""} onChange={e => set("address", e.target.value)} placeholder="123 Oak St, Frisco" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Sale price *</label>
          <input style={inputStyle} type="number" inputMode="numeric" value={comp.sale_price ?? ""} onChange={e => set("sale_price", e.target.value)} placeholder="450000" />
        </div>
        <div>
          <label style={labelStyle}>Sale date *</label>
          <input style={inputStyle} type="date" value={comp.sale_date ?? ""} onChange={e => set("sale_date", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10 }}>
        <div>
          <label style={labelStyle}>Sq ft</label>
          <input style={inputStyle} type="number" inputMode="numeric" value={comp.sqft ?? ""} onChange={e => set("sqft", e.target.value)} placeholder="2100" />
        </div>
        <div>
          <label style={labelStyle}>Beds</label>
          <input style={inputStyle} type="number" inputMode="numeric" value={comp.beds ?? ""} onChange={e => set("beds", e.target.value)} placeholder="3" />
        </div>
        <div>
          <label style={labelStyle}>Baths</label>
          <input style={inputStyle} type="number" step="0.5" inputMode="decimal" value={comp.baths ?? ""} onChange={e => set("baths", e.target.value)} placeholder="2.5" />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Distance (miles)</label>
        <input style={{ ...inputStyle, maxWidth: 160 }} type="number" step="0.1" inputMode="decimal" value={comp.distance_miles ?? ""} onChange={e => set("distance_miles", e.target.value)} placeholder="0.5" />
      </div>
      <div>
        <label style={labelStyle}>Notes</label>
        <textarea style={{ ...inputStyle, height: 60, resize: "vertical", lineHeight: 1.5 }} value={comp.notes ?? ""} onChange={e => set("notes", e.target.value)} placeholder="e.g. renovated kitchen, pool" />
      </div>
    </div>
  );
}

// Convert form strings → DB row payload. Returns null with a reason on
// validation failure.
function toRow(comp, micrositeId) {
  const address = String(comp.address || "").trim();
  if (!address) return { error: "Address is required." };
  const price = Number(String(comp.sale_price).replace(/[,$]/g, ""));
  if (!Number.isFinite(price) || price <= 0) return { error: "Sale price must be a number." };
  if (!comp.sale_date) return { error: "Sale date is required." };
  const optNum = (v) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(String(v).replace(/[,]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    row: {
      microsite_id: micrositeId,
      address,
      sale_price: price,
      sale_date: comp.sale_date,
      sqft: optNum(comp.sqft) != null ? Math.round(optNum(comp.sqft)) : null,
      beds: optNum(comp.beds) != null ? Math.round(optNum(comp.beds)) : null,
      baths: optNum(comp.baths),
      distance_miles: optNum(comp.distance_miles),
      notes: String(comp.notes || "").trim() || null,
    },
  };
}

// ── Manual entry / edit modal ────────────────────────────────────────
function ManualCompModal({ micrositeId, initial, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [comp, setComp] = useState(initial ? {
    address: initial.address || "", sale_price: initial.sale_price ?? "",
    sale_date: initial.sale_date || "", sqft: initial.sqft ?? "",
    beds: initial.beds ?? "", baths: initial.baths ?? "",
    distance_miles: initial.distance_miles ?? "", notes: initial.notes || "",
  } : { ...EMPTY_COMP });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    const res = toRow(comp, micrositeId);
    if (res.error) { setErr(res.error); return; }
    setSaving(true); setErr(null);
    let error;
    if (editing) {
      ({ error } = await supabase.from("microsite_comps")
        .update({ ...res.row, updated_at: new Date().toISOString() }).eq("id", initial.id));
    } else {
      ({ error } = await supabase.from("microsite_comps").insert(res.row));
    }
    setSaving(false);
    if (error) { console.error("[comps] save error:", error); setErr("Couldn't save. Please try again."); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal title={editing ? "Edit comparable sale" : "Add comparable sale"} onClose={onClose} maxWidth={520}>
      <CompFields comp={comp} onChange={setComp} />
      {err && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171", marginTop: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
      </div>
    </Modal>
  );
}

// ── Smart paste modal ────────────────────────────────────────────────
const PASTE_PLACEHOLDER =
`123 Oak St, sold $450,000 on 3/15/2026, 3 bed / 2 bath, 2100 sqft, 0.5 miles from subject.
456 Elm Ave, sold for $475K on 02/22/26, 4/2.5, 2300 sf, 0.8 mi, renovated kitchen.
789 Pine Rd, $520,000, sold 1/10/2026, 4 bed 3 bath 2500 square feet, 1.1 miles.`;

function SmartPasteModal({ micrositeId, slug, onClose, onSaved, onSwitchToManual }) {
  const [phase, setPhase] = useState("paste"); // paste | review
  const [raw, setRaw] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [parsed, setParsed] = useState([]); // [{...comp, confidence}]

  const parse = async () => {
    setParsing(true); setErr(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { setErr("Your session expired. Please sign in again."); setParsing(false); return; }
      const res = await fetch("/api/parse-comps", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ microsite_slug: slug, raw_text: raw }),
      });
      const bodyJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(bodyJson.error || "Couldn't parse that text. Please try again.");
        setParsing(false);
        return;
      }
      const comps = Array.isArray(bodyJson.comps) ? bodyJson.comps : [];
      if (comps.length === 0) {
        setErr("No comparable sales were found in that text. Try reformatting, or add one manually.");
        setParsing(false);
        return;
      }
      // Map into editable form rows (stringify numbers for inputs).
      setParsed(comps.map(c => ({
        address: c.address || "", sale_price: c.sale_price ?? "",
        sale_date: c.sale_date || "", sqft: c.sqft ?? "", beds: c.beds ?? "",
        baths: c.baths ?? "", distance_miles: c.distance_miles ?? "",
        notes: c.notes || "", confidence: c.confidence || "low",
      })));
      setPhase("review");
    } catch (e) {
      console.error("[comps] parse error:", e);
      setErr("Couldn't reach the parser. Please try again.");
    }
    setParsing(false);
  };

  const updateAt = (i, next) => setParsed(p => p.map((c, idx) => idx === i ? next : c));
  const removeAt = (i) => setParsed(p => p.filter((_, idx) => idx !== i));

  const saveAll = async () => {
    setSaving(true); setErr(null);
    const rows = [];
    for (const c of parsed) {
      const res = toRow(c, micrositeId);
      if (res.error) { setErr(`Fix the highlighted comps: ${res.error}`); setSaving(false); return; }
      rows.push(res.row);
    }
    const { error } = await supabase.from("microsite_comps").insert(rows);
    setSaving(false);
    if (error) { console.error("[comps] batch insert error:", error); setErr("Couldn't save the comps. Please try again."); return; }
    onSaved();
    onClose();
  };

  const confColor = (c) => c === "high" ? "#4ade80" : c === "medium" ? "#e5c97e" : "rgba(255,255,255,0.4)";

  return (
    <Modal title={phase === "paste" ? "Add comparable sales" : "Review parsed comps"} onClose={onClose} maxWidth={620}>
      {phase === "paste" ? (
        <>
          <div style={{ ...helperStyle, marginBottom: 14 }}>
            Paste comparable sales data from your MLS or CMA tool. The system will parse it into individual comps for you to review.
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 220, resize: "vertical", lineHeight: 1.5, fontFamily: "'Jost', sans-serif" }}
            rows={10}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder={PASTE_PLACEHOLDER}
          />
          {err && (
            <div style={{ marginTop: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171" }}>
              {err} <span onClick={onSwitchToManual} style={{ color: "#c9a84c", cursor: "pointer", textDecoration: "underline" }}>Add manually instead</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton onClick={parse} disabled={parsing || raw.trim().length < 1}>
              {parsing ? "⏳ Parsing…" : "Parse comps"}
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...helperStyle, marginBottom: 14 }}>
            Review and edit the {parsed.length} parsed comp{parsed.length === 1 ? "" : "s"} below, then save them all.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {parsed.map((c, i) => (
              <div key={i} style={{
                padding: 14, borderRadius: 12,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{
                    fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                    color: confColor(c.confidence),
                  }}>
                    {c.confidence} confidence
                  </span>
                  <span onClick={() => removeAt(i)} style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171", cursor: "pointer" }}>
                    Remove this comp
                  </span>
                </div>
                <CompFields comp={c} onChange={next => updateAt(i, { ...next, confidence: c.confidence })} compact />
              </div>
            ))}
          </div>
          {err && <div style={{ marginTop: 12, fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171" }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "space-between" }}>
            <SecondaryButton onClick={() => { setPhase("paste"); setErr(null); }}>← Back to paste</SecondaryButton>
            <PrimaryButton onClick={saveAll} disabled={saving || parsed.length === 0}>
              {saving ? "Saving…" : `Save all (${parsed.length})`}
            </PrimaryButton>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Comp card ────────────────────────────────────────────────────────
function CompCard({ comp, onEdit, onDelete }) {
  const stats = [];
  if (fmtNum(comp.sqft)) stats.push(`${fmtNum(comp.sqft)} sqft`);
  if (comp.beds != null) stats.push(`${comp.beds} bd`);
  if (comp.baths != null) stats.push(`${comp.baths} ba`);
  if (comp.distance_miles != null) stats.push(`${comp.distance_miles} mi away`);
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 19, color: "#fff", fontWeight: 600 }}>
          {comp.address}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit} style={{
            background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c",
            borderRadius: 7, padding: "5px 11px", cursor: "pointer", fontFamily: "'Jost', sans-serif", fontSize: 11,
          }}>Edit</button>
          <button onClick={onDelete} style={{
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", color: "#f87171",
            borderRadius: 7, padding: "5px 11px", cursor: "pointer", fontFamily: "'Jost', sans-serif", fontSize: 11,
          }}>Delete</button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 18, color: "#e5c97e", fontWeight: 600 }}>{fmtPrice(comp.sale_price)}</span>
        <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{fmtDate(comp.sale_date)}</span>
      </div>
      {stats.length > 0 && (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          {stats.join("  ·  ")}
        </div>
      )}
      {comp.notes && (
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, fontStyle: "italic", color: "rgba(255,255,255,0.45)" }}>
          {comp.notes}
        </div>
      )}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────
export default function ComparableSalesSection({ slug }) {
  const [micrositeId, setMicrositeId] = useState(null);
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  const [manualComp, setManualComp] = useState(null); // null = closed; {} = new; row = edit

  const loadComps = async (msId) => {
    const { data } = await supabase
      .from("microsite_comps")
      .select("id, address, sale_price, sale_date, sqft, beds, baths, distance_miles, notes")
      .eq("microsite_id", msId);
    setComps(sortComps(data || []));
  };

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ms } = await supabase
        .from("microsites").select("id").eq("slug", slug).maybeSingle();
      if (cancelled) return;
      if (!ms) { setErr("Could not load this microsite."); setLoading(false); return; }
      setMicrositeId(ms.id);
      await loadComps(ms.id);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const refresh = () => { if (micrositeId) loadComps(micrositeId); };

  const del = async (comp) => {
    if (!window.confirm(`Delete the comp at ${comp.address}? This can't be undone.`)) return;
    const { error } = await supabase.from("microsite_comps").delete().eq("id", comp.id);
    if (error) { console.error("[comps] delete error:", error); setErr("Couldn't delete. Please try again."); return; }
    refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={sectionTitleStyle}>Comparable sales</div>
      <div style={helperStyle}>
        Add recent comparable sales for this listing. The chat assistant uses these to answer visitor questions about market value. These are visible to the chat widget only — visitors don't see them directly on the microsite.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <PrimaryButton onClick={() => setShowPaste(true)} disabled={!micrositeId}>+ Add comps</PrimaryButton>
        <span onClick={() => micrositeId && setManualComp({})} style={{
          fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c",
          cursor: micrositeId ? "pointer" : "default", textDecoration: "underline",
        }}>Add manually</span>
      </div>

      {err && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171" }}>{err}</div>}

      {loading ? (
        <div style={helperStyle}>Loading comps…</div>
      ) : comps.length === 0 ? (
        <div style={{ ...helperStyle, padding: "18px 0" }}>No comparable sales added yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comps.map(c => (
            <CompCard key={c.id} comp={c} onEdit={() => setManualComp(c)} onDelete={() => del(c)} />
          ))}
        </div>
      )}

      {showPaste && micrositeId && (
        <SmartPasteModal
          micrositeId={micrositeId}
          slug={slug}
          onClose={() => setShowPaste(false)}
          onSaved={refresh}
          onSwitchToManual={() => { setShowPaste(false); setManualComp({}); }}
        />
      )}
      {manualComp !== null && micrositeId && (
        <ManualCompModal
          micrositeId={micrositeId}
          initial={manualComp}
          onClose={() => setManualComp(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
