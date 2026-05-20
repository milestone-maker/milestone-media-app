// Multiline input with auto-grow, Enter to send, Shift+Enter newline.
// Character counter appears at 1500+/2000.

import { useEffect, useRef, useState } from "react";

const MAX = 2000;
const COUNTER_AT = 1500;

export default function MessageInput({ disabled, onSend, placeholder, hint }) {
  const [text, setText] = useState("");
  const taRef = useRef(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 84) + "px"; // ~3 lines
  }, [text]);

  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;

  function submit() {
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={{
      borderTop: "1px solid #ececec",
      padding: "10px 12px 12px",
      background: "#fff",
    }}>
      {hint ? (
        <div style={{
          fontFamily: "'Jost', sans-serif", fontSize: 12,
          color: "rgba(0,0,0,0.55)", marginBottom: 6,
        }}>
          {hint}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder || "Ask a question about this home..."}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: "10px 12px",
            fontFamily: "'Jost', sans-serif",
            fontSize: 14,
            lineHeight: 1.4,
            outline: "none",
            background: disabled ? "#f5f5f5" : "#fff",
            color: "#111",
            maxHeight: 84,
            overflowY: "auto",
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          style={{
            width: 40, height: 40, borderRadius: 10,
            background: canSend ? "#0f0f1a" : "#cfcfcf",
            color: "#fff",
            border: "none",
            cursor: canSend ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 150ms ease",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      {text.length >= COUNTER_AT ? (
        <div style={{
          textAlign: "right",
          marginTop: 4,
          fontFamily: "'Jost', sans-serif",
          fontSize: 11,
          color: text.length >= MAX ? "#b91c1c" : "rgba(0,0,0,0.5)",
        }}>
          {text.length} / {MAX}
        </div>
      ) : null}
    </div>
  );
}
