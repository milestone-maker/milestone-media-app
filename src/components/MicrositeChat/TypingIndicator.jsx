// Three-dot staggered bounce, rendered inside an assistant-style bubble.

export default function TypingIndicator() {
  const dot = (delay) => ({
    width: 7, height: 7, borderRadius: "50%",
    background: "rgba(15,15,26,0.55)",
    animation: "ms-chat-dot 1.2s infinite ease-in-out",
    animationDelay: delay,
    display: "inline-block",
  });
  return (
    <div style={{
      display: "inline-flex", gap: 5, padding: "10px 14px",
      background: "#f1eee7", borderRadius: "16px 16px 16px 4px",
      maxWidth: "75%", alignItems: "center",
    }}>
      <span style={dot("0s")} />
      <span style={dot("0.18s")} />
      <span style={dot("0.36s")} />
      <style>{`
        @keyframes ms-chat-dot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
