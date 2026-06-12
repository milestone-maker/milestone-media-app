#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for the Stage 3b smart-schedule engine in src/lib/postScheduling.js.
// Pure functions, no DOM, no network. Verifies nextRecommendedSlot() across
// fixed `now` values: strictly-future, lands on a real Instagram slot, Monday
// behavior, Fri/Sat/Sun skipping, label↔ISO consistency, a DST-crossing case,
// and empty facebook/threads tables.
//
//   node scripts/test-post-scheduling-engine.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD_PATH  = resolve(__dirname, "..", "src", "lib", "postScheduling.js");
const {
  nextRecommendedSlot,
  centralWallClockToUtcIso,
  RECOMMENDED_SLOTS,
  SCHEDULE_BUFFER_MS,
} = await import(pathToFileURL(MOD_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const TZ = "America/Chicago";
// Independent re-derivation of a Central "Weekday HH:MM" (24h) for an instant —
// used to confirm the engine's label and ISO describe the SAME wall-clock,
// without reusing the engine's own formatter.
function centralWeekdayTime(iso) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const p = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = x.value;
  return { weekday: p.weekday, hh: p.hour === "24" ? "00" : p.hour, mm: p.minute };
}

// Is this instant exactly one of Instagram's defined slots (in Central)?
function isInstagramSlot(iso) {
  const { weekday, hh, mm } = centralWeekdayTime(iso);
  const NAME_TO_DOW = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  return RECOMMENDED_SLOTS.instagram.some(
    (s) => s.weekday === NAME_TO_DOW[weekday] && s.hour === +hh && s.minute === +mm,
  );
}

console.log("\n── src/lib/postScheduling.js — nextRecommendedSlot engine ──\n");

// Each case: a fixed `now` (UTC ISO) and the slot we expect back.
const CASES = [
  // (now ISO,                 Central meaning,        expected postDate ISO,        expected label)
  ["2026-06-08T15:00:00Z", "Mon 10:00 CDT → Mon noon", "2026-06-08T17:00:00.000Z", "Monday 12:00 PM CT"],
  ["2026-06-08T23:30:00Z", "Mon 18:30 CDT → Tue noon", "2026-06-09T17:00:00.000Z", "Tuesday 12:00 PM CT"],
  ["2026-06-09T11:00:00Z", "Tue 06:00 CDT → Tue noon", "2026-06-09T17:00:00.000Z", "Tuesday 12:00 PM CT"],
  ["2026-06-10T17:30:00Z", "Wed 12:30 CDT → Wed 6pm",  "2026-06-10T23:00:00.000Z", "Wednesday 6:00 PM CT"],
  ["2026-06-11T23:30:00Z", "Thu 18:30 CDT → skip wknd → Mon noon", "2026-06-15T17:00:00.000Z", "Monday 12:00 PM CT"],
  ["2026-01-12T15:00:00Z", "Mon 09:00 CST → Mon noon (winter, -6)", "2026-01-12T18:00:00.000Z", "Monday 12:00 PM CT"],
  ["2026-03-08T06:00:00Z", "Sun 00:00 CST → Mon noon CDT (DST cross)", "2026-03-09T17:00:00.000Z", "Monday 12:00 PM CT"],
];

for (const [nowIso, meaning, expIso, expLabel] of CASES) {
  const now = new Date(nowIso);
  const slot = nextRecommendedSlot(now, "instagram");
  check(`[${meaning}] returns a slot`, !!slot, "got null");
  if (!slot) continue;

  // (a) strictly future (beyond now + buffer)
  check(`[${meaning}] strictly after now + buffer`,
    new Date(slot.postDate).getTime() > now.getTime() + SCHEDULE_BUFFER_MS,
    `slot ${slot.postDate} vs now ${nowIso}`);

  // (b) lands on a real Instagram slot day/time
  check(`[${meaning}] lands on a defined IG slot`, isInstagramSlot(slot.postDate), slot.postDate);

  // exact expected instant + label (encodes (c) Monday and (d) weekend-skip)
  check(`[${meaning}] postDate = ${expIso}`, slot.postDate === expIso, `got ${slot.postDate}`);
  check(`[${meaning}] label = "${expLabel}"`, slot.label === expLabel, `got "${slot.label}"`);

  // (e) label ↔ ISO consistency (independently derived weekday + hour appear in label)
  const { weekday, hh } = centralWeekdayTime(slot.postDate);
  const hour12 = ((+hh + 11) % 12) + 1; // 24h → 12h
  check(`[${meaning}] label matches ISO (weekday+hour)`,
    slot.label.startsWith(weekday) && slot.label.includes(`${hour12}:`),
    `label "${slot.label}" vs derived ${weekday} ${hour12}`);
}

// (d) explicit: a Fri/Sat/Sun `now` never returns a weekend slot.
for (const [nowIso, day] of [["2026-06-12T15:00:00Z", "Fri"], ["2026-06-13T15:00:00Z", "Sat"], ["2026-03-08T20:00:00Z", "Sun"]]) {
  const slot = nextRecommendedSlot(new Date(nowIso), "instagram");
  check(`[${day} now] returns a weekday slot, not weekend`, !!slot && isInstagramSlot(slot.postDate), slot?.postDate);
  if (slot) {
    const { weekday } = centralWeekdayTime(slot.postDate);
    check(`[${day} now] result is Mon–Thu`, ["Monday", "Tuesday", "Wednesday", "Thursday"].includes(weekday), weekday);
  }
}

// (f) DST: the spring-forward case above produced a CDT slot from a CST `now`.
// Confirm the offset actually changed: 12:00 Central is 18:00Z in winter (CST)
// but 17:00Z in summer (CDT) — the DST case must be 17:00Z, the winter case 18:00Z.
check("DST: winter Mon-noon = 18:00Z (CST -6)", centralWallClockToUtcIso("2026-01-12T12:00") === "2026-01-12T18:00:00.000Z");
check("DST: summer Mon-noon = 17:00Z (CDT -5)", centralWallClockToUtcIso("2026-03-09T12:00") === "2026-03-09T17:00:00.000Z");

// (g) facebook now HAS slots (Stage 3) — returns a real upcoming slot, not null.
// threads stays empty → null. Unknown platform → null. None crash.
{
  // Tue 2026-06-09 06:00 CT (11:00Z). The soonest FB slot is Wed 08:00 CT.
  const fbSlot = nextRecommendedSlot(new Date("2026-06-09T11:00:00Z"), "facebook");
  check("facebook (populated) → a slot object", fbSlot && typeof fbSlot.postDate === "string" && typeof fbSlot.label === "string", JSON.stringify(fbSlot));
  check("facebook slot is in the future", fbSlot && new Date(fbSlot.postDate).getTime() > Date.parse("2026-06-09T11:00:00Z"));
  check("facebook soonest from Tue morning = Wed 8:00 AM CT", fbSlot?.label === "Wednesday 8:00 AM CT", fbSlot?.label);
}
check("threads (empty table) → null", nextRecommendedSlot(new Date("2026-06-09T11:00:00Z"), "threads") === null);
check("unknown platform → null", nextRecommendedSlot(new Date("2026-06-09T11:00:00Z"), "tiktok") === null);

// Determinism: same now → same result.
{
  const now = new Date("2026-06-09T11:00:00Z");
  const a = nextRecommendedSlot(now, "instagram");
  const b = nextRecommendedSlot(now, "instagram");
  check("deterministic for a fixed now", a.postDate === b.postDate && a.label === b.label);
}

assert.ok(typeof nextRecommendedSlot === "function", "engine export present");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
