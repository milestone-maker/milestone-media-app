import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";

// ──────────────────────────────────────────────────────────────────────
// Instagram (Connected Accounts) view — Stage 1 of bundle.social posting.
//
// Off-nav view reached from the profile dropdown (mirrors Subscriptions).
// Lets an agent connect their own Instagram through bundle.social's hosted
// portal. No posting here — connection only.
//
// States, driven by GET /api/social-status:
//   • none / error  → "Connect Instagram" button
//   • pending       → connecting (portal opened; poll for completion)
//   • connected     → @username + connected date
//
// Connect flow: POST /api/social-connect → returns a bundle hosted portal
// URL → open it in a new tab → poll /api/social-status (on tab refocus and
// on a short backoff) until status flips to 'connected'.
//
// No white-label: bundle.social is named in the disclaimer and inside its
// own hosted portal. All app chrome stays Milestone-branded.
// ──────────────────────────────────────────────────────────────────────

const GOLD = "#c9a84c";
const POLL_DELAYS_MS = [2000, 3000, 4000, 5000, 6000, 8000]; // backoff after return

async function authedFetch(path, { method = "GET" } = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = body?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return null; }
}

function InstagramView() {
  const [status, setStatus] = useState("loading"); // loading | none | pending | connected | error
  const [username, setUsername] = useState(null);
  const [connectedAt, setConnectedAt] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false); // gates Connect until requirements are acknowledged
  const pollTimer = useRef(null);
  const pollIdx = useRef(0);
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await authedFetch("/api/social-status");
      if (!mounted.current) return data;
      if (data?.status === "connected") {
        setStatus("connected");
        setUsername(data.username || null);
        setConnectedAt(data.connected_at || null);
      } else if (data?.status === "pending") {
        setStatus("pending");
      } else {
        setStatus((prev) => (prev === "pending" ? "pending" : "none"));
      }
      return data;
    } catch (e) {
      if (mounted.current) { setStatus("error"); setErrorMsg(e.message || "Could not load connection status."); }
      return null;
    }
  }, []);

  // Initial load.
  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refreshStatus]);

  // Scheduled backoff polling (kicked off after we open the portal).
  const scheduleNextPoll = useCallback(() => {
    if (pollIdx.current >= POLL_DELAYS_MS.length) return;
    const delay = POLL_DELAYS_MS[pollIdx.current];
    pollIdx.current += 1;
    pollTimer.current = setTimeout(async () => {
      const data = await refreshStatus();
      if (data?.status !== "connected" && mounted.current) scheduleNextPoll();
    }, delay);
  }, [refreshStatus]);

  // Re-check whenever the agent returns to this tab (they finished the portal
  // in another tab). Only meaningful while we're waiting.
  useEffect(() => {
    const onFocus = () => { if (status === "pending") { pollIdx.current = 0; refreshStatus(); } };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status, refreshStatus]);

  const handleConnect = async () => {
    setBusy(true);
    setErrorMsg("");
    try {
      const data = await authedFetch("/api/social-connect", { method: "POST" });
      if (data?.portalUrl) {
        setStatus("pending");
        pollIdx.current = 0;
        window.open(data.portalUrl, "_blank", "noopener,noreferrer");
        scheduleNextPoll();
      } else {
        setStatus("error");
        setErrorMsg("Could not start the Instagram connection. Please try again.");
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not start the Instagram connection.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // ── Render ──
  const card = {
    maxWidth: 560, margin: "0 auto", background: "rgba(14,18,32,0.7)",
    border: "1px solid rgba(201,168,76,0.15)", borderRadius: 16, padding: "32px 30px",
  };

  return (
    <div style={{ padding: "40px 20px", fontFamily: "'Jost', sans-serif", color: "#F0EDE8" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 26 }}>📷</span>
          <h2 style={{
            margin: 0, fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontWeight: 600, color: "#F5ECD7",
          }}>Instagram</h2>
        </div>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
          Connect your Instagram so you can post your generated carousels directly from Milestone.
        </p>

        {status === "loading" && (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>Loading connection status…</div>
        )}

        {status === "connected" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.25)",
            borderRadius: 12, padding: "16px 18px",
          }}>
            <span style={{ fontSize: 20 }}>✓</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#4ade80" }}>
                Connected{username ? ` · @${username}` : ""}
              </div>
              {formatDate(connectedAt) && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                  Connected {formatDate(connectedAt)}
                </div>
              )}
            </div>
          </div>
        )}

        {(status === "none" || status === "error" || status === "pending") && (
          <>
            {status === "pending" && (
              <div style={{
                fontSize: 12.5, color: GOLD, background: "rgba(201,168,76,0.07)",
                border: "1px solid rgba(201,168,76,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 16,
              }}>
                Finishing your connection… complete the steps in the bundle.social tab, then return here.
                We'll detect it automatically.
              </div>
            )}

            {status === "error" && errorMsg && (
              <div style={{
                fontSize: 12.5, color: "#f87171", background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "12px 14px", marginBottom: 16,
              }}>
                {errorMsg}
              </div>
            )}

            {/* Requirements notice — prominent, high-contrast (not fine print).
                Posting via the Instagram Graph API only works for Business/
                Creator accounts linked to a Facebook Page, so agents must
                understand this BEFORE connecting. */}
            <div style={{
              background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.35)",
              borderRadius: 12, padding: "18px 20px", marginBottom: 16,
            }}>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: 21, fontWeight: 600,
                color: "#F5ECD7", marginBottom: 10,
              }}>
                Before connecting your Instagram
              </div>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.82)", marginBottom: 8 }}>
                For posting to work, your Instagram account must be:
              </div>
              <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: "#F0EDE8" }}>
                <li>A <strong>Business or Creator account</strong> (not a personal account)</li>
                <li>Linked to a <strong>Facebook Page</strong> you manage</li>
              </ul>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.7)" }}>
                When you connect, sign in with the Facebook account that controls it and approve all
                requested permissions. If your account isn't set up this way, your posts won't publish.
              </div>
            </div>

            {/* Required acknowledgment — gates the Connect button. */}
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16,
              cursor: "pointer", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
            }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2, width: 17, height: 17, accentColor: GOLD, cursor: "pointer", flexShrink: 0 }}
              />
              <span>
                I understand my Instagram must be a Business or Creator account linked to a Facebook Page.
              </span>
            </label>

            <button
              onClick={handleConnect}
              disabled={busy || !acknowledged}
              style={{
                width: "100%", padding: "14px 18px", borderRadius: 10, border: "none",
                background: (busy || !acknowledged) ? "rgba(201,168,76,0.25)" : GOLD,
                color: (busy || !acknowledged) ? "rgba(26,18,6,0.55)" : "#1a1206",
                fontFamily: "'Jost', sans-serif", fontSize: 14, fontWeight: 600, letterSpacing: "0.02em",
                cursor: (busy || !acknowledged) ? "not-allowed" : "pointer",
              }}
              title={!acknowledged ? "Confirm the requirement above to continue" : undefined}
            >
              {busy ? "Starting…" : status === "pending" ? "Reopen connection" : "Connect Instagram"}
            </button>

            {/* Disclaimer — bundle.social named here per the no-white-label decision. */}
            <p style={{
              margin: "16px 2px 0", fontSize: 11, lineHeight: 1.6, color: "rgba(255,255,255,0.38)",
            }}>
              Instagram connection and posting are powered by{" "}
              <a href="https://bundle.social" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(201,168,76,0.8)" }}>
                bundle.social
              </a>
              , our trusted third-party provider. When you connect, you'll authorize bundle.social to
              publish posts to your Instagram on your behalf. Milestone never sees or stores your
              Instagram password.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default InstagramView;
