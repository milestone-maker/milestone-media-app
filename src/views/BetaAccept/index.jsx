import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

// /beta/accept?token=... — public landing for beta invite redemption.
//
// Flow:
//   1. Read token from URL. Look it up via /api/beta-invite-lookup (no auth).
//   2. If link is invalid/expired/revoked, render an error card and stop.
//   3. If valid:
//        • not signed in → render an inline auth card (login/signup), same
//          shape as AuthView in App.jsx, with the invite's suggested email
//          prefilled. On success, the auth state listener flips us to the
//          accept step on next render.
//        • signed in → POST /api/beta-invite-accept and render success.
//
// Self-contained on purpose: this route is reached when not signed in,
// so it cannot rely on useAuth() / AppShell. Styling mirrors AuthView.

const PALETTE = {
  bg: "#080c16",
  card: "rgba(255,255,255,0.03)",
  cardBorder: "rgba(255,255,255,0.08)",
  text: "#fff",
  muted: "rgba(255,255,255,0.55)",
  accent: "#c9a84c",
  danger: "#f87171",
  success: "#34d399",
};

const inputStyle = {
  width: "100%", padding: "14px 16px", borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
  color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 14,
  outline: "none", boxSizing: "border-box",
};
const labelStyle = {
  fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.5)",
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, display: "block",
};
const buttonStyle = {
  width: "100%", padding: "14px 16px", borderRadius: 10, border: 0,
  background: PALETTE.accent, color: "#080c16",
  fontFamily: "'Jost', sans-serif", fontSize: 14, fontWeight: 600,
  cursor: "pointer", letterSpacing: "0.04em",
};

function getTokenFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("token") || "";
  } catch {
    return "";
  }
}

export default function BetaAccept() {
  const [token] = useState(getTokenFromUrl());
  const [lookup, setLookup] = useState({ state: "loading" }); // loading | invalid | valid | error
  const [session, setSession] = useState(null);
  const [accept, setAccept] = useState({ state: "idle" }); // idle | accepting | done | error
  const [acceptResult, setAcceptResult] = useState(null);

  // Lookup the invite once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLookup({ state: "invalid", reason: "no token in link" });
        return;
      }
      try {
        const resp = await fetch(`/api/beta-invite-lookup?token=${encodeURIComponent(token)}`);
        const body = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setLookup({ state: "invalid", reason: body?.error || `lookup failed (${resp.status})` });
          return;
        }
        if (!body.valid) {
          const reason = body.link_expired
            ? "this invite link has expired"
            : body.status === "accepted"
              ? "this invite has already been accepted"
              : body.status === "revoked"
                ? "this invite has been revoked"
                : "this invite is no longer valid";
          setLookup({ state: "invalid", reason });
          return;
        }
        setLookup({ state: "valid", info: body });
      } catch (err) {
        if (!cancelled) setLookup({ state: "error", reason: err?.message || "network error" });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Track auth session so we know whether to show the auth card or proceed.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data?.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s || null));
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Once the visitor is signed in AND the lookup says the invite is valid,
  // POST accept automatically.
  useEffect(() => {
    if (lookup.state !== "valid" || !session || accept.state !== "idle") return;
    let cancelled = false;
    (async () => {
      setAccept({ state: "accepting" });
      try {
        const resp = await fetch("/api/beta-invite-accept", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token }),
        });
        const body = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setAccept({ state: "error", reason: body?.error || `accept failed (${resp.status})` });
          return;
        }
        setAcceptResult(body);
        setAccept({ state: "done" });
      } catch (err) {
        if (!cancelled) setAccept({ state: "error", reason: err?.message || "network error" });
      }
    })();
    return () => { cancelled = true; };
  }, [lookup.state, session, accept.state, token]);

  return (
    <div style={{
      minHeight: "100vh", background: PALETTE.bg, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Jost', sans-serif", padding: "40px 24px",
    }}>
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 460 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src="/icons/icon-192.png" alt="Milestone Media" style={{
            width: 64, height: 64, borderRadius: "50%",
            border: "2px solid rgba(201,168,76,0.3)", marginBottom: 14,
          }} />
          <div style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 26,
            color: PALETTE.accent, letterSpacing: "0.04em",
          }}>Milestone Beta</div>
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.3)",
            letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 4,
          }}>You're invited</div>
        </div>

        <div style={{
          background: PALETTE.card, border: `1px solid ${PALETTE.cardBorder}`,
          borderRadius: 16, padding: 28,
        }}>
          {lookup.state === "loading" && (
            <div style={{ color: PALETTE.muted, textAlign: "center", padding: "12px 0" }}>
              Validating invite…
            </div>
          )}

          {(lookup.state === "invalid" || lookup.state === "error") && (
            <>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
                color: PALETTE.text, textAlign: "center", marginBottom: 12,
              }}>Invite unavailable</div>
              <div style={{ color: PALETTE.danger, textAlign: "center", fontSize: 14 }}>
                {lookup.reason}
              </div>
              <div style={{ color: PALETTE.muted, textAlign: "center", fontSize: 13, marginTop: 14 }}>
                Ask whoever sent you the link for a fresh one.
              </div>
            </>
          )}

          {lookup.state === "valid" && !session && (
            <SignupCard suggestedEmail={lookup.info?.email || ""} duration={lookup.info?.beta_duration_days} />
          )}

          {lookup.state === "valid" && session && accept.state === "accepting" && (
            <div style={{ color: PALETTE.muted, textAlign: "center", padding: "12px 0" }}>
              Granting beta access…
            </div>
          )}

          {accept.state === "done" && acceptResult && (
            <>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: 24,
                color: PALETTE.success, textAlign: "center", marginBottom: 10,
              }}>You're in.</div>
              <div style={{ color: PALETTE.text, textAlign: "center", fontSize: 14 }}>
                Beta access lasts {acceptResult.beta_duration_days} days.
                {acceptResult.beta_expires_at && (
                  <div style={{ color: PALETTE.muted, marginTop: 4 }}>
                    Expires {new Date(acceptResult.beta_expires_at).toLocaleDateString()}
                  </div>
                )}
              </div>
              <button
                style={{ ...buttonStyle, marginTop: 24 }}
                onClick={() => { window.location.href = "/"; }}
              >Continue to Milestone</button>
            </>
          )}

          {accept.state === "error" && (
            <>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
                color: PALETTE.text, textAlign: "center", marginBottom: 10,
              }}>Couldn't redeem</div>
              <div style={{ color: PALETTE.danger, textAlign: "center", fontSize: 14 }}>
                {accept.reason}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SignupCard({ suggestedEmail, duration }) {
  const [mode, setMode] = useState("signup"); // signup | login
  const [email, setEmail] = useState(suggestedEmail || "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName } },
        });
        if (err) { setError(err.message); return; }
        if (data?.user) {
          await supabase.from("agents").upsert(
            { id: data.user.id, full_name: fullName, email, role: "agent" },
            { onConflict: "id" },
          );
        }
        if (!data?.session) {
          setInfo("Check your email to confirm, then click the invite link again.");
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(err.message);
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <div style={{
        fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
        color: PALETTE.text, textAlign: "center", marginBottom: 6,
      }}>{mode === "signup" ? "Create your account" : "Sign in"}</div>
      <div style={{ color: PALETTE.muted, fontSize: 13, textAlign: "center", marginBottom: 18 }}>
        {duration ? `You'll get ${duration} days of beta access.` : "You'll get beta access."}
      </div>

      <form onSubmit={submit}>
        {mode === "signup" && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Full name</label>
            <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Password</label>
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </div>
        {error && <div style={{ color: PALETTE.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {info && <div style={{ color: PALETTE.muted, fontSize: 13, marginBottom: 10 }}>{info}</div>}
        <button type="submit" disabled={busy} style={{ ...buttonStyle, opacity: busy ? 0.7 : 1 }}>
          {busy ? "…" : (mode === "signup" ? "Create account & accept" : "Sign in & accept")}
        </button>
      </form>
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: PALETTE.muted }}>
        {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); setMode(mode === "signup" ? "login" : "signup"); }}
          style={{ color: PALETTE.accent, textDecoration: "none" }}
        >{mode === "signup" ? "Sign in" : "Create an account"}</a>
      </div>
    </>
  );
}
