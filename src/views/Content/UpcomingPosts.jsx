// Upcoming-posts section for the Content tab (Stage 3c-2). A collapsible panel,
// DEFAULT COLLAPSED, listing the agent's still-upcoming scheduled posts across
// ALL listings (future + not canceled + submitted). Each row can be canceled,
// which calls api/social-cancel and removes it from bundle.
//
// Reads from GET /api/social-posts (no contentId filter) and filters with the
// shared pure logic in src/lib/scheduledPosts.js, so the "upcoming" definition
// matches the inline indicator and the unit tests exactly.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { upcomingPosts } from "../../lib/scheduledPosts";
import { formatCentral } from "../../lib/postScheduling";

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

const panelSt = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14, padding: 20, marginTop: 20,
};

function UpcomingPosts() {
  const [open, setOpen] = useState(false);          // default collapsed
  const [rows, setRows] = useState([]);             // upcoming rows
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [canceling, setCanceling] = useState(null); // row id being canceled

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const token = await getToken();
      if (!token) { setError("Your session expired. Please sign in again."); setRows([]); return; }
      const res = await fetch("/api/social-posts", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Couldn't load (${res.status})`);
      setRows(upcomingPosts(body.posts || [], new Date()));
    } catch (e) {
      setError(typeof e?.message === "string" ? e.message : "Couldn't load upcoming posts.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on mount so the count badge is accurate even while collapsed,
  // and refresh whenever the section is opened.
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const onCancel = async (row) => {
    if (canceling) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Cancel this scheduled post (${formatCentral(row.scheduled_for)})?`)) return;
    setCanceling(row.id); setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/social-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: row.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Couldn't cancel (${res.status})`);
      // Remove from the list + update the count.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(typeof e?.message === "string" ? e.message : "Couldn't cancel that post.");
    } finally {
      setCanceling(null);
    }
  };

  const count = rows.length;

  return (
    <div style={panelSt}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
      >
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff" }}>Upcoming posts</div>
        {count > 0 && (
          <span style={{
            background: "rgba(201,168,76,0.14)", border: "1px solid rgba(201,168,76,0.35)", color: "#e8c97a",
            borderRadius: 999, padding: "1px 9px", fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 700,
          }}>{count}</span>
        )}
        <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 8 }}>Loading…</div>
          ) : error ? (
            <div style={{ color: "#f87171", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 8 }}>
              {error} <button onClick={load} style={{ background: "none", border: "none", color: "#e8c97a", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>retry</button>
            </div>
          ) : count === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Jost', sans-serif", fontSize: 12, padding: 8 }}>
              No upcoming posts. Schedule a carousel and it'll show up here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#ECE7DC", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.content_label || "Untitled post"}
                    </div>
                    <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
                      <span style={{ textTransform: "capitalize" }}>{r.platform}</span> · {formatCentral(r.scheduled_for)}
                    </div>
                  </div>
                  <button
                    onClick={() => onCancel(r)}
                    disabled={canceling === r.id}
                    style={{
                      flexShrink: 0, padding: "7px 14px", borderRadius: 8, cursor: canceling === r.id ? "default" : "pointer",
                      border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", color: "#f87171",
                      opacity: canceling === r.id ? 0.6 : 1,
                      fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                    }}
                  >{canceling === r.id ? "Canceling…" : "Cancel"}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default UpcomingPosts;
