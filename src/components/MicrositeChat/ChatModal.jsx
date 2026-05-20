// Modal shell. Desktop = centered card with backdrop. Mobile = full-screen slide-up.

import { useEffect, useState } from "react";

export default function ChatModal({ isMobile, onClose, title, badge, children }) {
  const [entered, setEntered] = useState(false);

  // Trigger enter animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ESC closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const desktopCard = {
    position: "relative",
    width: "min(480px, calc(100vw - 32px))",
    maxHeight: "min(70vh, 720px)",
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    transform: entered ? "scale(1)" : "scale(0.95)",
    opacity: entered ? 1 : 0,
    transition: "transform 250ms ease, opacity 250ms ease",
  };
  const mobileCard = {
    position: "fixed",
    inset: 0,
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    transform: entered ? "translateY(0)" : "translateY(100%)",
    transition: "transform 300ms ease-out",
    zIndex: 10000,
  };

  const header = (
    <div style={{
      flexShrink: 0,
      padding: "14px 16px",
      borderBottom: "1px solid #ececec",
      background: "#0f0f1a",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      gap: 10,
      position: isMobile ? "sticky" : "static",
      top: 0,
    }}>
      <div style={{
        flex: 1, fontFamily: "'Cormorant Garamond', serif",
        fontSize: 18, fontWeight: 600, letterSpacing: 0.3,
      }}>
        {title}
      </div>
      {badge ? (
        <span style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 10,
          padding: "3px 8px",
          background: "rgba(201,168,76,0.18)",
          color: "#C9A84C",
          border: "1px solid rgba(201,168,76,0.45)",
          borderRadius: 999,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}>
          {badge}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat"
        style={{
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          padding: 4,
          marginLeft: 4,
          display: "flex",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <div style={mobileCard}>
        {header}
        {children}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 10000,
        opacity: entered ? 1 : 0,
        transition: "opacity 250ms ease",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={desktopCard}>
        {header}
        {children}
      </div>
    </div>
  );
}
