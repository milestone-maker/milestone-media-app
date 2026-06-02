#!/usr/bin/env node

// ============================================================
// Live test for the commute adapter (Stage 4 commute sub-step 1).
//
// Hits the real Google Distance Matrix API (needs GOOGLE_MAPS_API_KEY in
// .env.local, with the Distance Matrix API enabled on the GCP project). No
// DB, no chat, no deploy.
//
// Prints the two real commute results (DFW Airport, downtown Dallas) for a
// sanity check, then confirms a garbage destination returns null, no throw.
//
// Run:  node scripts/test-commute-adapter.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── load .env.local (no dotenv dep in this repo) ─────────────────────
function loadEnvLocal() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "..", ".env.local");
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch { console.error(`Could not read ${path}. Run: vercel env pull .env.local`); process.exit(1); }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

// Import AFTER env is loaded (adapter reads process.env.GOOGLE_MAPS_API_KEY).
const { getCommute } = await import("../api/_lib/commute.js");

if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.error("Missing GOOGLE_MAPS_API_KEY in .env.local");
  process.exit(1);
}

// Prosper origin (from the schools geocode of the demo area).
const ORIGIN = { originLat: 33.2337, originLng: -96.8025 };

let failed = 0;
function plausible(label, r) {
  console.log(`\n${label}:`);
  if (!r) { console.log("  → null (no result)"); return false; }
  console.log("  distance_text:       ", r.distance_text);
  console.log("  duration_text:       ", r.duration_text);
  console.log("  destination_resolved:", r.destination_resolved);
  return true;
}

const dfw = await getCommute({ ...ORIGIN, destination: "DFW Airport" });
if (!plausible('getCommute(... "DFW Airport")', dfw)) failed++;

const dtd = await getCommute({ ...ORIGIN, destination: "downtown Dallas, TX" });
if (!plausible('getCommute(... "downtown Dallas, TX")', dtd)) failed++;

// Garbage destination → null, no throw.
console.log('\ngetCommute(... "asdfqwer zzz nowhere place"):');
let threw = false, garbage;
try { garbage = await getCommute({ ...ORIGIN, destination: "asdfqwer zzz nowhere place" }); }
catch (e) { threw = true; console.log("  ✗ THREW:", e.message); }
console.log("  result:", JSON.stringify(garbage), "| threw:", threw);
console.log(!threw && garbage === null ? "  ✓ returned null gracefully" : "  ✗ expected null without throwing");
if (threw || garbage !== null) failed++;

console.log(failed ? `\n${failed} case(s) did not produce a usable/expected result.` : "\nAll commute cases OK.");
process.exit(failed ? 1 : 0);
