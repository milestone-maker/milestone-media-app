// Post-scheduling timing — pure, DOM-free, and importable by BOTH the React app
// (CarouselView) and node tests. Single source of truth for:
//   • the Central wall-clock ⇄ UTC conversion 3a introduced (moved out of
//     CarouselView so manual + smart scheduling share one implementation),
//   • the platform-keyed recommended posting windows, and
//   • nextRecommendedSlot(), the engine behind the Stage 3b "Smart schedule"
//     button.
//
// The whole app treats wall-clock times as America/Chicago (Central) — see
// api/calendar.js and api/microsite-chat.js — so everything here is anchored to
// that zone, regardless of the viewer's browser timezone. DST is handled by
// asking Intl for Central's offset on the specific date, never a fixed ±offset.

export const TZ = "America/Chicago";

// Minimum lead time between "now" and a post's effective time. Mirrors
// SCHEDULE_BUFFER_MS in api/social-post.js — the floor any scheduled time
// (manual or smart) must clear so the server never rejects a too-soon pick.
export const SCHEDULE_BUFFER_MS = 3 * 60 * 1000; // 3 minutes

const pad2 = (n) => String(n).padStart(2, "0");

// ── Central ⇄ UTC ────────────────────────────────────────────────────
// Convert a <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm"), read as a
// Central wall-clock time, into the UTC ISO string for that exact instant.
// DST-correct: we derive Central's offset for THAT specific date via
// Intl.DateTimeFormat rather than assuming a fixed -5/-6h or trusting the
// browser's own zone. (Moved verbatim from CarouselView.jsx in Stage 3b.)
export function centralWallClockToUtcIso(localValue) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue || "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Instant if the wall clock were UTC.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // What Central wall clock does that instant render as? (numbered in UTC)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(asUtc));
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const centralAsUtc = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second,
  );
  const offset = centralAsUtc - asUtc; // Central's offset from UTC for this date
  return new Date(asUtc - offset).toISOString();
}

// Render a UTC ISO instant as a friendly Central calendar label, e.g.
// "Tue, Jun 9, 2026 at 3:30 PM CT". Used by the scheduled success state.
export function formatCentral(iso) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
  return `${label} CT`;
}

// Render a UTC ISO instant as a recommended-slot label, e.g.
// "Wednesday 12:00 PM CT" (weekday + time only — the slot's identity).
function formatSlotLabel(iso) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(iso));
  const p = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = x.value;
  return `${p.weekday} ${p.hour}:${p.minute} ${p.dayPeriod} CT`;
}

// ── Recommended posting windows (Central wall-clock) ─────────────────
// weekday: 0=Sun … 6=Sat. Engagement-driven windows; per-platform because the
// strong windows differ by network.
//
// Instagram (DFW real-estate audience): midday Tue/Wed/Thu is primary, an
// early-evening Tue/Wed/Thu pass is secondary, and Monday midday is a softer
// fallback. Deliberately NO Fri/Sat/Sun — weekend reach is weak for this niche.
//
// facebook / threads are intentionally EMPTY for now — forward hooks so the
// engine and the platform column are ready when those launch. nextRecommendedSlot
// returns null for an empty table (callers treat that as "no smart slot yet").
export const RECOMMENDED_SLOTS = {
  instagram: [
    { weekday: 1, hour: 12, minute: 0 }, // Mon 12:00 — softer fallback
    { weekday: 2, hour: 12, minute: 0 }, // Tue 12:00 — primary midday
    { weekday: 2, hour: 18, minute: 0 }, // Tue 18:00 — secondary early-evening
    { weekday: 3, hour: 12, minute: 0 }, // Wed 12:00 — primary midday
    { weekday: 3, hour: 18, minute: 0 }, // Wed 18:00 — secondary early-evening
    { weekday: 4, hour: 12, minute: 0 }, // Thu 12:00 — primary midday
    { weekday: 4, hour: 18, minute: 0 }, // Thu 18:00 — secondary early-evening
  ],
  facebook: [], // TODO: fill when Facebook posting launches
  threads:  [], // TODO: fill when Threads posting launches
};

// Central calendar Y-M-D of an instant (used only as a calendar, never for
// timezone math).
function centralYmd(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day };
}

// ── The engine ───────────────────────────────────────────────────────
// nextRecommendedSlot(now, platform): the SOONEST recommended slot strictly
// after now + SCHEDULE_BUFFER_MS, computed in Central. Returns
//   { postDate: <UTC ISO>, label: "<Weekday h:mm AM/PM CT>" }
// or null when the platform has no slots defined. Deterministic for a fixed now.
export function nextRecommendedSlot(now, platform = "instagram") {
  const slots = RECOMMENDED_SLOTS[platform] || [];
  if (!slots.length) return null;

  const thresholdMs = now.getTime() + SCHEDULE_BUFFER_MS;
  const { y, m, d } = centralYmd(now);

  // A UTC-midnight Date used purely as a calendar counter: its getUTCDay()
  // weekday equals the Central calendar date's weekday (weekday is zone-
  // independent). Walk forward day-by-day; the first matching slot whose instant
  // beats the threshold is the soonest (days ascending, times ascending within
  // a day ⇒ chronological order).
  const cal = new Date(Date.UTC(y, m - 1, d));
  for (let offset = 0; offset < 14; offset++) {
    const cy = cal.getUTCFullYear();
    const cm = cal.getUTCMonth() + 1;
    const cd = cal.getUTCDate();
    const weekday = cal.getUTCDay();

    const daySlots = slots
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

    for (const s of daySlots) {
      const localValue = `${cy}-${pad2(cm)}-${pad2(cd)}T${pad2(s.hour)}:${pad2(s.minute)}`;
      const iso = centralWallClockToUtcIso(localValue);
      if (iso && new Date(iso).getTime() > thresholdMs) {
        return { postDate: iso, label: formatSlotLabel(iso) };
      }
    }

    cal.setUTCDate(cal.getUTCDate() + 1);
  }

  return null; // no slot within the search horizon (shouldn't happen for IG)
}
