#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for the white-label Gap 2 theme override (src/lib/theme.js):
// resolveEffectiveTheme overlays an agent's brand colors onto a base THEME when
// the opt-in toggle is on and all four tokens are present; otherwise returns the
// base theme unchanged. Also covers hexToRgba derivation + defensive fallback.
// No DB, no JSX, no network — imports the pure helpers directly.
//
//   node scripts/test-effective-theme.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD_PATH  = resolve(__dirname, "..", "src", "lib", "theme.js");
const { hexToRgba, resolveEffectiveTheme } = await import(pathToFileURL(MOD_PATH).href);

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

// Base theme mirrors a THEMES catalog entry (Prestige: dark bg, gold accent).
const BASE = {
  name: "Prestige", accent: "#C9A84C", bg: "#0f0f1a", text: "#fff",
  sub: "rgba(255,255,255,0.55)", card: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)",
};

// A complete, opted-in brand snapshot (light brand: cream bg, charcoal text).
const BRAND = {
  use_brand_colors: true,
  brand_bg_color: "#FBF7EE",
  brand_text_color: "#1A1A1A",
  brand_muted_color: "#6B6256",
  brand_accent_color: "#2A4A5E",
};

// ── hexToRgba ────────────────────────────────────────────────────────────────
check("hexToRgba: 6-digit → rgba", hexToRgba("#1A1A1A", 0.04) === "rgba(26,26,26,0.04)", hexToRgba("#1A1A1A", 0.04));
check("hexToRgba: alpha passes through", hexToRgba("#1A1A1A", 0.1) === "rgba(26,26,26,0.1)", hexToRgba("#1A1A1A", 0.1));
check("hexToRgba: no-hash accepted", hexToRgba("FBF7EE", 1) === "rgba(251,247,238,1)", hexToRgba("FBF7EE", 1));
check("hexToRgba: 3-digit expands", hexToRgba("#fff", 0.5) === "rgba(255,255,255,0.5)", hexToRgba("#fff", 0.5));
check("hexToRgba: pure white", hexToRgba("#FFFFFF", 0.1) === "rgba(255,255,255,0.1)", hexToRgba("#FFFFFF", 0.1));
check("hexToRgba: unparseable → null", hexToRgba("rebeccapurple", 0.1) === null);
check("hexToRgba: bad length → null", hexToRgba("#12345", 0.1) === null);
check("hexToRgba: non-string → null", hexToRgba(0x1a1a1a, 0.1) === null);
check("hexToRgba: null → null", hexToRgba(null, 0.1) === null);

// ── (a) opted in + all tokens → overrides applied, card/border derived ───────
{
  const t = resolveEffectiveTheme(BASE, BRAND);
  check("on: bg overridden", t.bg === "#FBF7EE", t.bg);
  check("on: text overridden", t.text === "#1A1A1A", t.text);
  check("on: accent overridden", t.accent === "#2A4A5E", t.accent);
  check("on: muted → sub", t.sub === "#6B6256", t.sub);
  check("on: card derived from text @4%", t.card === "rgba(26,26,26,0.04)", t.card);
  check("on: border derived from text @10%", t.border === "rgba(26,26,26,0.1)", t.border);
  check("on: card/border are valid rgba()", /^rgba\(\d+,\d+,\d+,0\.\d+\)$/.test(t.card) && /^rgba\(\d+,\d+,\d+,0\.\d+\)$/.test(t.border));
  check("on: name preserved from base", t.name === "Prestige", t.name);
  check("on: returns a NEW object (base untouched)", t !== BASE && BASE.bg === "#0f0f1a");
}

// ── (b) toggle off → base theme returned unchanged (same reference) ──────────
{
  const off = resolveEffectiveTheme(BASE, { ...BRAND, use_brand_colors: false });
  check("off: returns base theme reference", off === BASE);
  const missingFlag = resolveEffectiveTheme(BASE, { ...BRAND, use_brand_colors: undefined });
  check("off: missing flag → base theme", missingFlag === BASE);
  check("off: snapshot null → base theme", resolveEffectiveTheme(BASE, null) === BASE);
}

// ── (c) opted in but a token missing → base theme (no partial override) ──────
{
  for (const k of ["brand_bg_color", "brand_text_color", "brand_muted_color", "brand_accent_color"]) {
    const snap = { ...BRAND }; snap[k] = "";
    check(`missing ${k} → base theme`, resolveEffectiveTheme(BASE, snap) === BASE);
  }
  const undef = { ...BRAND }; delete undef.brand_accent_color;
  check("undefined token → base theme", resolveEffectiveTheme(BASE, undef) === BASE);
}

// ── (d) unparseable text color → bg/text/accent/sub applied, card/border fall
//        back to the base theme's values (defensive) ─────────────────────────
{
  const t = resolveEffectiveTheme(BASE, { ...BRAND, brand_text_color: "rebeccapurple" });
  check("unparseable text: still overrides bg", t.bg === "#FBF7EE", t.bg);
  check("unparseable text: text applied as-is", t.text === "rebeccapurple", t.text);
  check("unparseable text: accent overridden", t.accent === "#2A4A5E", t.accent);
  check("unparseable text: sub overridden", t.sub === "#6B6256", t.sub);
  check("unparseable text: card falls back to base", t.card === BASE.card, t.card);
  check("unparseable text: border falls back to base", t.border === BASE.border, t.border);
}

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
