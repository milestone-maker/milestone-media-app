// Pure helpers for the Search Console view — extracted so the date math, sort
// comparator, and display formatters can be unit-tested without a React renderer.

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// A days-preset → { startDate, endDate } as YYYY-MM-DD (UTC), endDate = today.
// Mirrors the backend default window. `now` is injectable for deterministic tests.
export function presetRange(days, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

// Sort a COPY of listings by column key. dir "asc" | "desc". The label column
// sorts case-insensitively; numeric columns coerce missing/undefined to 0 so a
// sparse row never throws or lands randomly.
export function sortListings(listings, key, dir) {
  const arr = Array.isArray(listings) ? listings.slice() : [];
  const sign = dir === "asc" ? 1 : -1;
  arr.sort((a, b) => {
    if (key === "label") {
      const av = String(a?.label ?? "").toLowerCase();
      const bv = String(b?.label ?? "").toLowerCase();
      return av < bv ? -sign : av > bv ? sign : 0;
    }
    const av = Number(a?.[key]) || 0;
    const bv = Number(b?.[key]) || 0;
    return (av - bv) * sign;
  });
  return arr;
}

// Integer with thousands separators; non-finite → "0".
export function formatInt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString() : "0";
}

// CTR ratio (0..1) → percent with 1 decimal, e.g. 0.0625 → "6.3%".
export function formatPct(ratio) {
  const v = Number(ratio);
  return (Number.isFinite(v) ? (v * 100).toFixed(1) : "0.0") + "%";
}

// Average position to 1 decimal, e.g. 8.75 → "8.8"; non-finite → "—".
export function formatPosition(p) {
  const v = Number(p);
  return Number.isFinite(v) ? v.toFixed(1) : "—";
}
