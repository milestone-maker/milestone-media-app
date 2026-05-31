// Chat assistant settings — agent-facing config for the microsite chat
// widget. Reads/writes public.microsite_chat_settings (one row per
// microsite, unique on microsite_id). Self-contained: resolves the
// microsite id from the slug on mount so the parent only passes a slug.

import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import {
  inputStyle, labelStyle, sectionTitleStyle, helperStyle,
  Switch, PrimaryButton,
} from "./controls.jsx";

const LEAD_MODES = [
  { key: "name_email_phone_upfront", label: "Require name, email, and phone before chatting",
    desc: "Visitors share full contact info before sending any message." },
  { key: "name_email_upfront", label: "Require name and email before chatting",
    desc: "Visitors share name and email before sending any message." },
  { key: "after_first_message", label: "Let visitors send one message before asking for contact info",
    desc: "The first question is answered, then contact info is requested." },
  { key: "never", label: "Never ask for contact info",
    desc: "Visitors can chat freely without sharing anything." },
];

// listing is always-on and non-toggleable; the rest are switchable.
const TOPICS = [
  { key: "listing",   label: "Listing details", desc: "Facts about this specific property.", locked: true },
  { key: "schools",   label: "Schools",         desc: "School names, district info, public ratings." },
  { key: "commute",   label: "Commute",         desc: "Drive times and distances to nearby destinations." },
  { key: "comps",     label: "Comparable sales", desc: "Reference sales you've provided." },
  { key: "financing", label: "Financing",       desc: "Typical mortgage rates and rough payment math." },
];

const DEFAULTS = {
  chat_enabled: true,
  lead_capture_mode: "name_email_phone_upfront",
  topics_enabled: { listing: true, schools: true, commute: true, comps: true, financing: true },
  monthly_cap: 500,
};

export default function ChatAssistantSection({ slug }) {
  const [micrositeId, setMicrositeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const [enabled, setEnabled] = useState(DEFAULTS.chat_enabled);
  const [leadMode, setLeadMode] = useState(DEFAULTS.lead_capture_mode);
  const [topics, setTopics] = useState(DEFAULTS.topics_enabled);
  const [cap, setCap] = useState(String(DEFAULTS.monthly_cap));

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Resolve microsite id from slug (RLS scopes to the agent's own rows).
      const { data: ms } = await supabase
        .from("microsites").select("id").eq("slug", slug).maybeSingle();
      if (cancelled) return;
      if (!ms) { setErr("Could not load this microsite."); setLoading(false); return; }
      setMicrositeId(ms.id);

      const { data: row } = await supabase
        .from("microsite_chat_settings")
        .select("chat_enabled, topics_enabled, lead_capture_mode, monthly_cap")
        .eq("microsite_id", ms.id)
        .maybeSingle();
      if (cancelled) return;
      if (row) {
        setEnabled(row.chat_enabled ?? true);
        setLeadMode(row.lead_capture_mode || DEFAULTS.lead_capture_mode);
        setTopics({ ...DEFAULTS.topics_enabled, ...(row.topics_enabled || {}), listing: true });
        setCap(String(row.monthly_cap ?? DEFAULTS.monthly_cap));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const toggleTopic = (key) => {
    if (key === "listing") return;
    setTopics(t => ({ ...t, [key]: !t[key] }));
  };

  const handleSave = async () => {
    if (!micrositeId) return;
    setSaving(true);
    setErr(null);
    const capNum = Math.max(1, parseInt(cap, 10) || DEFAULTS.monthly_cap);
    const payload = {
      microsite_id: micrositeId,
      chat_enabled: enabled,
      lead_capture_mode: leadMode,
      topics_enabled: { ...topics, listing: true },
      monthly_cap: capNum,
      updated_at: new Date().toISOString(),
    };
    const { data: savedRow, error } = await supabase
      .from("microsite_chat_settings")
      .upsert(payload, { onConflict: "microsite_id" })
      .select("chat_enabled, topics_enabled, lead_capture_mode, monthly_cap")
      .single();
    if (error) {
      console.error("[chat-settings] save error:", error);
      setErr("Couldn't save. Please try again.");
      setSaving(false);
      return;
    }
    // Refresh form state from the persisted row.
    if (savedRow) {
      setEnabled(savedRow.chat_enabled ?? true);
      setLeadMode(savedRow.lead_capture_mode);
      setTopics({ ...DEFAULTS.topics_enabled, ...(savedRow.topics_enabled || {}), listing: true });
      setCap(String(savedRow.monthly_cap));
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={sectionTitleStyle}>Chat assistant</div>

      {loading ? (
        <div style={helperStyle}>Loading chat settings…</div>
      ) : (
        <>
          {/* Master toggle */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            padding: "14px 16px", borderRadius: 12,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>Enable chat on this listing</div>
              <div style={{ ...helperStyle, marginTop: 3 }}>When off, the chat widget is hidden from visitors entirely.</div>
            </div>
            <Switch on={enabled} onToggle={() => setEnabled(v => !v)} />
          </div>

          {/* Lead capture mode */}
          <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
            <div style={labelStyle}>Lead capture</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {LEAD_MODES.map(m => {
                const active = leadMode === m.key;
                return (
                  <div key={m.key} onClick={() => setLeadMode(m.key)} style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px",
                    borderRadius: 10, cursor: "pointer",
                    background: active ? "rgba(201,168,76,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.06)"}`,
                    transition: "all 0.2s",
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      border: `2px solid ${active ? "#c9a84c" : "rgba(255,255,255,0.25)"}`,
                      background: active ? "#c9a84c" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {active && <span style={{ color: "#0a1628", fontSize: 9, fontWeight: 900 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: active ? "#fff" : "rgba(255,255,255,0.7)" }}>{m.label}</div>
                      <div style={{ ...helperStyle, marginTop: 2 }}>{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Topic toggles */}
          <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
            <div style={labelStyle}>Topics visitors can ask about</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TOPICS.map(t => (
                <div key={t.key} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                  padding: "12px 14px", borderRadius: 10,
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
                      {t.label}
                      {t.locked && <span style={{
                        fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
                        color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)",
                        borderRadius: 4, padding: "1px 6px", fontWeight: 600,
                      }}>Always on</span>}
                    </div>
                    <div style={{ ...helperStyle, marginTop: 2 }}>{t.desc}</div>
                  </div>
                  <Switch
                    on={t.locked ? true : !!topics[t.key]}
                    onToggle={() => toggleTopic(t.key)}
                    disabled={t.locked}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Monthly cap */}
          <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
            <label style={labelStyle}>Monthly answer limit</label>
            <input
              style={{ ...inputStyle, maxWidth: 160 }}
              type="number" min="1" inputMode="numeric"
              value={cap}
              onChange={e => setCap(e.target.value)}
            />
            <div style={{ ...helperStyle, marginTop: 6 }}>
              After this many visitor messages in a month, the chat asks visitors to share contact info instead of answering. Default is 500.
            </div>
          </div>

          {err && <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#f87171" }}>{err}</div>}

          <div>
            <PrimaryButton onClick={handleSave} disabled={saving || saved} saved={saved}>
              {saved ? "✓ Saved" : saving ? "Saving…" : "Save chat settings"}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
