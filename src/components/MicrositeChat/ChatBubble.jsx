// Floating chat bubble button. Fixed bottom-right.
// Renders nothing visual until mounted (fades in 300ms).

import { useState, useEffect } from "react";

export default function ChatBubble({ onClick, isMobile }) {
  const [mounted, setMounted] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 800);
    return () => clearTimeout(t);
  }, []);

  const edge = isMobile ? 16 : 24;
  const size = 56;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Open chat assistant"
      style={{
        position: "fixed",
        bottom: edge,
        right: edge,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#0f0f1a",
        border: "1.5px solid #C9A84C",
        color: "#fff",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: hover
          ? "0 12px 32px rgba(0,0,0,0.45), 0 0 0 4px rgba(201,168,76,0.18)"
          : "0 6px 20px rgba(0,0,0,0.35)",
        transform: mounted
          ? (hover ? "translateY(-2px) scale(1.02)" : "translateY(0) scale(1)")
          : "translateY(8px) scale(0.92)",
        opacity: mounted ? 1 : 0,
        transition: "transform 200ms ease, box-shadow 200ms ease, opacity 300ms ease",
        zIndex: 9999,
        padding: 0,
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </button>
  );
}
