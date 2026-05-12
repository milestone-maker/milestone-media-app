// View-shared UI bits — icon set, theme catalog, status/package
// pills. Extracted from App.jsx so views can import these without
// going back through App.jsx (which imports the views and would
// form a cycle).

export const MEDIA_ICONS = {
  Photos: "📷", Drone: "🚁", "3D Tour": "🔮", Film: "🎬",
  "Floor Plan": "📐", Microsite: "🌐", Twilight: "🌅",
};

export const THEMES = [
  // ── Luxury ──
  { name: "Prestige",  label: "Milestone Signature", slug: "prestige",  bg: "#0f0f1a", accent: "#C9A84C", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#0f0f1a","#C9A84C","#F5ECD7"] },
  { name: "Dusk",      label: "Dramatic & Rich",     slug: "dusk",      bg: "#1A1525", accent: "#9B8EC4", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#1A1525","#9B8EC4","#E8C97A","#F0E6D3"] },
  { name: "Noir",      label: "Bold Contrast",       slug: "noir",      bg: "#0A0A0A", accent: "#C41E3A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#0A0A0A","#fff","#C41E3A","#888"] },
  { name: "Obsidian",  label: "Deep & Minimal",      slug: "obsidian",  bg: "#050508", accent: "#6EC6C6", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#050508","#6EC6C6","#3A3A5C","#E8E8E8"] },
  // ── Modern ──
  { name: "Slate",     label: "Modern Professional", slug: "slate",     bg: "#2C3E50", accent: "#5D8AA8", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F2F4F6","#2C3E50","#5D8AA8","#95A5A6"] },
  { name: "Loft",      label: "Urban Edge",          slug: "loft",      bg: "#1A1A1A", accent: "#C8B400", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F0EFED","#1A1A1A","#C8B400","#8C8C8C"] },
  { name: "Ember",     label: "Warm & Bold",         slug: "ember",     bg: "#3D2B1F", accent: "#D4956A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#FAF7F2","#3D2B1F","#8B3A2A","#D4956A"] },
  { name: "Maison",    label: "French Modern",       slug: "maison",    bg: "#2C2416", accent: "#D4A853", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#FAF7F4","#2C2416","#D4A853"] },
  // ── Classic ──
  { name: "Classic",   label: "Timeless Elegance",   slug: "classic",   bg: "#1B2A4A", accent: "#C9A84C", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#fff","#1B2A4A","#C9A84C","#F5F5F0"] },
  { name: "Ivory",     label: "Soft Luxury",         slug: "ivory",     bg: "#FAF8F5", accent: "#C9A84C", text: "#1A1A1A", sub: "rgba(0,0,0,0.5)",        card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#FAF8F5","#1A1A1A","#C9A84C","#E8E0D0"] },
  { name: "Blanc",     label: "Clean & Minimal",     slug: "blanc",     bg: "#fff",    accent: "#D4AF37", text: "#111",    sub: "rgba(0,0,0,0.5)",        card: "rgba(0,0,0,0.03)",       border: "rgba(0,0,0,0.1)",        swatches: ["#fff","#111","#D4AF37"] },
  // ── Natural ──
  { name: "Coastal",   label: "Light & Airy",        slug: "coastal",   bg: "#F8F5F0", accent: "#2A4A5E", text: "#2A4A5E", sub: "rgba(0,0,0,0.45)",       card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#F8F5F0","#2A4A5E","#B5C4C1","#8B6F47"] },
  { name: "Grove",     label: "Natural Warmth",      slug: "grove",     bg: "#F5F0E8", accent: "#2D4A2D", text: "#2D4A2D", sub: "rgba(0,0,0,0.45)",       card: "rgba(0,0,0,0.04)",       border: "rgba(0,0,0,0.1)",        swatches: ["#F5F0E8","#2D4A2D","#8B7355","#C8B89A"] },
  { name: "Sage",      label: "Organic & Fresh",     slug: "sage",      bg: "#2D3D30", accent: "#5B7B6A", text: "#fff",    sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",  swatches: ["#F4F6F4","#2D3D30","#5B7B6A","#A8B8A8"] },
];

export function StatusBadge({ status }) {
  const colors = {
    Live: { bg: "rgba(74,222,128,0.15)", color: "#4ade80", dot: "#4ade80" },
    "In Production": { bg: "rgba(201,168,76,0.15)", color: "#c9a84c", dot: "#c9a84c" },
  };
  const s = colors[status] || colors.Live;
  return (
    <span style={{
      background: s.bg, color: s.color, padding: "3px 10px",
      borderRadius: 20, fontSize: 11, fontFamily: "'Jost', sans-serif",
      letterSpacing: "0.08em", fontWeight: 500, display: "inline-flex",
      alignItems: "center", gap: 5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {status}
    </span>
  );
}

export function PackageBadge({ pkg }) {
  return (
    <span style={{
      border: "1px solid rgba(201,168,76,0.4)", color: "#c9a84c",
      padding: "2px 8px", borderRadius: 4, fontSize: 10,
      fontFamily: "'Jost', sans-serif", letterSpacing: "0.12em",
      fontWeight: 600, textTransform: "uppercase",
    }}>{pkg}</span>
  );
}
