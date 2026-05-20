// Renders the conversation thread. Auto-scrolls to bottom on changes.

import { useEffect, useRef } from "react";
import TypingIndicator from "./TypingIndicator";

function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Bubble({ role, text, ts, isDisclosure }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "82%",
        padding: "10px 14px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isUser ? "#C9A84C" : (isDisclosure ? "#fff7df" : "#f1eee7"),
        color: isUser ? "#0f0f1a" : "#1a1a1a",
        fontFamily: "'Jost', sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        border: isDisclosure ? "1px solid rgba(201,168,76,0.45)" : "none",
      }}>
        {text}
      </div>
      {ts ? (
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: 11,
          color: "rgba(0,0,0,0.45)",
          marginTop: 3,
          padding: "0 4px",
        }}>
          {relativeTime(ts)}
        </div>
      ) : null}
    </div>
  );
}

export default function MessageThread({ disclosure, messages, isTyping, errorBanner }) {
  const endRef = useRef(null);
  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isTyping]);

  return (
    <div style={{
      flex: 1,
      overflowY: "auto",
      padding: "16px 16px 8px",
      background: "#fafafa",
      display: "flex",
      flexDirection: "column",
    }}>
      {disclosure ? (
        <Bubble role="assistant" text={disclosure} isDisclosure />
      ) : null}
      {messages.map((m, i) => (
        <Bubble key={i} role={m.role} text={m.content} ts={m.ts} />
      ))}
      {isTyping ? <TypingIndicator /> : null}
      {errorBanner ? (
        <div style={{
          margin: "10px 0",
          padding: "10px 12px",
          background: "#fff4f4",
          border: "1px solid rgba(220,38,38,0.35)",
          borderRadius: 10,
          fontFamily: "'Jost', sans-serif",
          fontSize: 13,
          color: "#7a1a1a",
        }}>
          {errorBanner}
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
