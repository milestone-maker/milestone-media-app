// Pure theme helpers — no JSX, so they import cleanly under plain `node` for
// unit tests. Re-exported from ./ui.jsx so component code keeps a single import
// surface (`../lib/ui`).

// Convert a hex color (#RRGGBB or #RGB) to an `rgba(r,g,b,alpha)` string.
// Returns null when the input isn't a parseable hex color, so callers can fall
// back defensively rather than emit a broken color value.
export function hexToRgba(hex, alpha) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Relative luminance (0 = black … 1 = white) of a hex color, via the standard
// sRGB coefficients (0.2126 R + 0.7152 G + 0.0722 B over the 0–1 channels).
// Returns null when the input isn't a parseable hex color so callers can fall
// back defensively. Good enough to decide "is this background dark or light?".
export function luminance(hex) {
  const rgba = hexToRgba(hex, 1);
  if (rgba === null) return null;
  const [r, g, b] = rgba.slice(5, -1).split(",").slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// True when a background color reads as "dark" (luminance below ~0.5). Used to
// pick dark-vs-light secondary surfaces in the renderer. Unparseable input falls
// back to `fallback` (caller passes the base theme's own dark/light verdict).
export function isDarkBg(hex, fallback = true) {
  const l = luminance(hex);
  return l === null ? fallback : l < 0.5;
}

// The Milestone signature theme — locked: it always renders in Milestone's own
// colors and is NEVER overridden by an agent's brand colors, even with the
// toggle on. (Matches the THEMES entry name in ./ui.jsx. Only this one is
// locked — Classic/Ivory merely default to the same gold accent but stay
// overridable.)
export const LOCKED_THEME_NAME = "Prestige";

// White-label Gap 2: given a base THEME object and a published-microsite
// property_data SNAPSHOT, return the theme actually used to render the listing
// page. When the agent opted in (`snapshot.use_brand_colors === true`) AND all
// four brand color tokens are present, overlay them onto the base theme:
//   brand_bg_color → bg, brand_text_color → text, brand_accent_color → accent,
//   brand_muted_color → sub.
// card/border have no brand-token equivalent, so they're DERIVED as low-alpha
// overlays of the brand TEXT color (card ≈ text @ 4%, border ≈ text @ 10%) so
// they stay legible over whatever background the agent chose. If the text color
// can't be parsed to rgba, card/border fall back to the base theme's values
// (defensive). If the toggle is off OR any of the four tokens is missing, the
// base theme is returned UNCHANGED — preserving the Milestone template default.
// The Milestone-signature "Prestige" theme is ALWAYS returned unchanged (locked).
// Reads from the snapshot only (the agents table is not anon-readable), the
// same source as agency_name.
export function resolveEffectiveTheme(baseTheme, snapshot) {
  // Prestige is the Milestone signature — never white-labeled, toggle or not.
  if (baseTheme && baseTheme.name === LOCKED_THEME_NAME) return baseTheme;
  const s = snapshot || {};
  if (s.use_brand_colors !== true) return baseTheme;
  const bg = s.brand_bg_color, text = s.brand_text_color,
        muted = s.brand_muted_color, accent = s.brand_accent_color;
  if (!bg || !text || !muted || !accent) return baseTheme;
  const card = hexToRgba(text, 0.04) || baseTheme.card;
  const border = hexToRgba(text, 0.1) || baseTheme.border;
  return { ...baseTheme, bg, text, accent, sub: muted, card, border };
}
