import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";

// ──────────────────────────────────────────────────────────────────────
// Connected Accounts view — bundle.social multi-platform connection
// (Facebook Stage 1). Off-nav view reached from the profile dropdown.
//
// Renders one connection card per supported network (Instagram, Facebook).
// Each card connects the agent's own account through bundle.social's hosted
// portal — no posting here, connection only. Cards are independent: connecting
// Facebook never affects Instagram and vice-versa.
//
// Per card, driven by GET /api/social-status?platform=<p>:
//   • none / error  → "Connect <Platform>" button (gated on an acknowledgment)
//   • pending       → connecting (portal opened; poll for completion)
//   • connected     → @username + connected date
//
// Connect flow: POST /api/social-connect { platform } → returns a bundle hosted
// portal URL → open it in a new tab → poll status (on tab refocus + a short
// backoff) until status flips to 'connected'.
//
// No white-label: bundle.social is named in each card's disclaimer and inside
// its own hosted portal. All app chrome stays Milestone-branded.
// ──────────────────────────────────────────────────────────────────────

const GOLD = "#c9a84c";
const POLL_DELAYS_MS = [2000, 3000, 4000, 5000, 6000, 8000]; // backoff after return

// Per-platform copy + requirement gating. Each network has its own connection
// prerequisite (Instagram needs a Business/Creator account linked to a Page;
// Facebook publishes to a Page you manage), surfaced as a prominent notice +
// a required acknowledgment checkbox before Connect is enabled.
const PLATFORMS = [
  {
    key: "instagram",
    name: "Instagram",
    emoji: "📷",
    blurb: "Connect your Instagram so you can post your generated carousels directly from Milestone.",
    requirementTitle: "Before connecting your Instagram",
    requirementIntro: "For posting to work, your Instagram account must be:",
    requirements: [
      <>A <strong>Business or Creator account</strong> (not a personal account)</>,
      <>Linked to a <strong>Facebook Page</strong> you manage</>,
    ],
    requirementNote:
      "When you connect, sign in with the Facebook account that controls it and approve all requested permissions. If your account isn't set up this way, your posts won't publish.",
    ack: "I understand my Instagram must be a Business or Creator account linked to a Facebook Page.",
  },
  {
    key: "facebook",
    name: "Facebook",
    emoji: "📘",
    blurb: "Connect a Facebook Page so you can publish your generated posts to Facebook from Milestone.",
    requirementTitle: "Before connecting your Facebook",
    requirementIntro: "Facebook posting publishes to a Page, not a personal timeline. To connect you need:",
    requirements: [
      <>A <strong>Facebook Page</strong> (Business or Creator) that you manage</>,
      <>To sign in with the <strong>Facebook account that manages that Page</strong></>,
    ],
    requirementNote:
      "When you connect, sign in with Facebook, choose the Page you want to publish to, and approve all requested permissions. Posting to a personal profile isn't supported.",
    ack: "I understand Facebook posting publishes to a Facebook Page I manage, and I'll connect the account that manages it.",
  },
];

async function authedFetch(path, { method = "GET", body } = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = payload?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return payload;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return null; }
}

// One connection card for a single platform. Owns its own status + polling so
// the two platforms are fully independent.
function PlatformCard({ platform }) {
  const { key, name, emoji, blurb, requirementTitle, requirementIntro, requirements, requirementNote, ack } = platform;

  const [status, setStatus] = useState("loading"); // loading | none | pending | connected | error
  const [username, setUsername] = useState(null);
  const [connectedAt, setConnectedAt] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pollTimer = useRef(null);
  const pollIdx = useRef(0);
  const mounted = useRef(true);

  const STATUS_PATH = `/api/social-status?platform=${encodeURIComponent(key)}`;

  const refreshStatus = useCallback(async () => {
    try {
      const data = await authedFetch(STATUS_PATH);
      if (!mounted.current) return data;
      // connected_at lives on the per-platform summary in the platforms array.
      const summary = Array.isArray(data?.platforms)
        ? data.platforms.find((p) => p.platform === key)
        : null;
      if (data?.status === "connected") {
        setStatus("connected");
        setUsername(data.username || null);
        setConnectedAt(summary?.connected_at || null);
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
  }, [STATUS_PATH, key]);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refreshStatus]);

  const scheduleNextPoll = useCallback(() => {
    if (pollIdx.current >= POLL_DELAYS_MS.length) return;
    const delay = POLL_DELAYS_MS[pollIdx.current];
    pollIdx.current += 1;
    pollTimer.current = setTimeout(async () => {
      const data = await refreshStatus();
      if (data?.status !== "connected" && mounted.current) scheduleNextPoll();
    }, delay);
  }, [refreshStatus]);

  useEffect(() => {
    const onFocus = () => { if (status === "pending") { pollIdx.current = 0; refreshStatus(); } };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status, refreshStatus]);

  const handleConnect = async () => {
    setBusy(true);
    setErrorMsg("");
    try {
      const data = await authedFetch("/api/social-connect", { method: "POST", body: { platform: key } });
      if (data?.portalUrl) {
        setStatus("pending");
        pollIdx.current = 0;
        window.open(data.portalUrl, "_blank", "noopener,noreferrer");
        scheduleNextPoll();
      } else {
        setStatus("error");
        setErrorMsg(`Could not start the ${name} connection. Please try again.`);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || `Could not start the ${name} connection.`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const card = {
    maxWidth: 560, margin: "0 auto 22px", background: "rgba(14,18,32,0.7)",
    border: "1px solid rgba(201,168,76,0.15)", borderRadius: 16, padding: "32px 30px",
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 26 }}>{emoji}</span>
        <h2 style={{
          margin: 0, fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontWeight: 600, color: "#F5ECD7",
        }}>{name}</h2>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
        {blurb}
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

          {/* Requirements notice — prominent, high-contrast (not fine print). */}
          <div style={{
            background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.35)",
            borderRadius: 12, padding: "18px 20px", marginBottom: 16,
          }}>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: 21, fontWeight: 600,
              color: "#F5ECD7", marginBottom: 10,
            }}>
              {requirementTitle}
            </div>
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.82)", marginBottom: 8 }}>
              {requirementIntro}
            </div>
            <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: "#F0EDE8" }}>
              {requirements.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.7)" }}>
              {requirementNote}
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
            <span>{ack}</span>
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
            {busy ? "Starting…" : status === "pending" ? "Reopen connection" : `Connect ${name}`}
          </button>

          {/* Disclaimer — bundle.social named here per the no-white-label decision. */}
          <p style={{
            margin: "16px 2px 0", fontSize: 11, lineHeight: 1.6, color: "rgba(255,255,255,0.38)",
          }}>
            {name} connection and posting are powered by{" "}
            <a href="https://bundle.social" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(201,168,76,0.8)" }}>
              bundle.social
            </a>
            , our trusted third-party provider. When you connect, you'll authorize bundle.social to
            publish posts to your {name} on your behalf. Milestone never sees or stores your {name} password.
          </p>
        </>
      )}
    </div>
  );
}

function InstagramView() {
  return (
    <div style={{ padding: "40px 20px", fontFamily: "'Jost', sans-serif", color: "#F0EDE8" }}>
      <div style={{ maxWidth: 560, margin: "0 auto 18px", textAlign: "center" }}>
        <h1 style={{
          margin: "0 0 6px", fontFamily: "'Cormorant Garamond', serif", fontSize: 34, fontWeight: 600, color: "#F5ECD7",
        }}>Connected Accounts</h1>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
          Connect your social accounts to publish your generated content from Milestone.
        </p>
      </div>
      {PLATFORMS.map((p) => <PlatformCard key={p.key} platform={p} />)}
    </div>
  );
}

export default InstagramView;
