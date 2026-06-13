#!/usr/bin/env node

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for the pure helpers behind the Search Console view
// (src/views/SearchConsole/helpers.js) — date presets, sort comparator, and the
// display formatters. No React renderer, no network.
//
//   node scripts/test-search-console-view.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const { presetRange, sortListings, formatInt, formatPct, formatPosition } =
  await import(pathToFileURL(resolve(REPO_ROOT, "src", "views", "SearchConsole", "helpers.js")).href);

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; } else { fails.push(`${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

// ── presetRange ──────────────────────────────────────────────────────────────
{
  const now = new Date("2026-06-13T12:00:00.000Z");
  const r28 = presetRange(28, now);
  check("presetRange(28): endDate is today", r28.endDate === "2026-06-13", r28.endDate);
  check("presetRange(28): startDate is 28 days back", r28.startDate === "2026-05-16", r28.startDate);
  const r7 = presetRange(7, now);
  check("presetRange(7): startDate", r7.startDate === "2026-06-06", r7.startDate);
  const r90 = presetRange(90, now);
  check("presetRange(90): startDate", r90.startDate === "2026-03-15", r90.startDate);
  // span is exactly N days
  const span = (Date.parse(r28.endDate) - Date.parse(r28.startDate)) / 86400000;
  check("presetRange(28): span is 28 days", span === 28, `${span}`);
}

// ── sortListings ─────────────────────────────────────────────────────────────
{
  const data = [
    { label: "Bravo", impressions: 100, clicks: 5,  ctr: 0.05, position: 8 },
    { label: "alpha", impressions: 300, clicks: 30, ctr: 0.1,  position: 3 },
    { label: "Charlie", impressions: 200, clicks: 10, ctr: 0.05, position: 5 },
  ];
  const impDesc = sortListings(data, "impressions", "desc");
  check("sort: impressions desc order", impDesc.map((r) => r.impressions).join(",") === "300,200,100", impDesc.map((r) => r.impressions).join(","));
  const impAsc = sortListings(data, "impressions", "asc");
  check("sort: impressions asc order", impAsc.map((r) => r.impressions).join(",") === "100,200,300");
  const labelAsc = sortListings(data, "label", "asc");
  check("sort: label asc is case-insensitive", labelAsc.map((r) => r.label).join(",") === "alpha,Bravo,Charlie", labelAsc.map((r) => r.label).join(","));
  // does not mutate the input
  check("sort: input not mutated", data[0].label === "Bravo");
  // missing field coerces to 0, no throw
  const sparse = sortListings([{ label: "x" }, { label: "y", impressions: 5 }], "impressions", "desc");
  check("sort: missing numeric coerced to 0", sparse[0].impressions === 5 && (sparse[1].impressions ?? 0) === 0);
  // non-array tolerated
  check("sort: non-array → []", Array.isArray(sortListings(null, "impressions", "desc")) && sortListings(null, "x", "desc").length === 0);
}

// ── formatters ───────────────────────────────────────────────────────────────
{
  check("formatInt: thousands", formatInt(12345) === (12345).toLocaleString(), formatInt(12345));
  check("formatInt: rounds", formatInt(9.7) === "10");
  check("formatInt: non-finite → 0", formatInt(undefined) === "0" && formatInt(NaN) === "0");

  check("formatPct: ratio → 1-decimal %", formatPct(0.0625) === "6.3%", formatPct(0.0625));
  check("formatPct: zero", formatPct(0) === "0.0%");
  check("formatPct: non-finite → 0.0%", formatPct(undefined) === "0.0%");

  check("formatPosition: 1 decimal", formatPosition(8.75) === "8.8", formatPosition(8.75));
  check("formatPosition: integer-ish", formatPosition(3) === "3.0");
  check("formatPosition: non-finite → —", formatPosition(undefined) === "—");
}

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`\n✓ ${passed} passed, 0 failed\n`);
