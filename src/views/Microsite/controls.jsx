// Shared form controls + style tokens for the microsite publish-flow
// sections (Chat assistant, Comparable sales). Matches the inline-style
// conventions used throughout src/views/Microsite/index.jsx and the
// gold/dark design system.

export const inputStyle = {
  width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "11px 14px", color: "#fff",
  fontFamily: "'Jost', sans-serif", fontSize: 13, outline: "none",
  boxSizing: "border-box", colorScheme: "dark",
};

export const labelStyle = {
  fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)",
  letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, display: "block",
};

export const sectionTitleStyle = {
  fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 600,
};

export const helperStyle = {
  fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6,
};

// Sliding switch — same geometry as the Toggle in index.jsx. `disabled`
// renders a locked-on state (used for the always-available Listing topic).
export function Switch({ on, onToggle, disabled = false }) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      style={{
        width: 42, height: 24, borderRadius: 12, flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        background: on ? "linear-gradient(135deg,#c9a84c,#e5c97e)" : "rgba(255,255,255,0.12)",
        position: "relative", transition: "background 0.25s",
      }}
    >
      <div style={{
        position: "absolute", top: 3, left: on ? 21 : 3,
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        transition: "left 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

// Primary gold button. Shows a transient "saved" success state when the
// `saved` prop is true (matches EditProfileModal's save affordance).
export function PrimaryButton({ children, onClick, disabled, saved, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "12px 22px", borderRadius: 10,
        cursor: disabled ? "default" : "pointer",
        background: saved ? "rgba(74,222,128,0.15)" : disabled ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg,#c9a84c 0%,#e5c97e 100%)",
        color: saved ? "#4ade80" : "#0a1628",
        border: saved ? "1px solid rgba(74,222,128,0.35)" : "none",
        fontFamily: "'Jost', sans-serif", fontWeight: 700, fontSize: 12,
        letterSpacing: "0.08em", textTransform: "uppercase", transition: "all 0.25s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "12px 22px", borderRadius: 10, cursor: disabled ? "default" : "pointer",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)",
        color: "rgba(255,255,255,0.7)", fontFamily: "'Jost', sans-serif", fontWeight: 500,
        fontSize: 12, letterSpacing: "0.06em", transition: "all 0.2s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
