// Reusable modal shell for the microsite publish flow. Matches the
// position:fixed overlay pattern established by EditProfileModal in
// App.jsx (no portal abstraction exists in this codebase). Click the
// backdrop or the ✕ to close; the body scrolls inside a fixed-height card.

export default function Modal({ title, onClose, children, maxWidth = 560 }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#0e1220", border: "1px solid rgba(201,168,76,0.18)",
        borderRadius: 18, width: "100%", maxWidth,
        boxShadow: "0 40px 100px rgba(0,0,0,0.9)",
        maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#fff", fontWeight: 600 }}>
            {title}
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.4)",
            fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
