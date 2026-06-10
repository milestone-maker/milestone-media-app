#!/usr/bin/env node

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for the pure Stage 3c decision logic in src/lib/scheduledPosts.js:
// schedule-state (scheduled vs posted vs none), the upcoming filter, and the
// soft-timeout reconciliation. No DOM, no network.
//
//   node scripts/test-scheduled-posts-logic.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(__dirname, "..", "src", "lib", "scheduledPosts.js");
const {
  isActive, latestActive, isUpcoming, upcomingPosts, scheduleState,
  findRecentlyLanded, RECONCILE_WINDOW_MS,
} = await import(pathToFileURL(MOD).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const NOW = new Date("2026-06-10T20:00:00.000Z");
const FUTURE = "2026-06-10T23:00:00+00:00"; // +3h
const SOONER = "2026-06-10T21:00:00+00:00"; // +1h
const PAST   = "2026-06-10T19:00:00+00:00"; // -1h

function row(o = {}) {
  return {
    id: "r", content_id: "c", platform: "instagram", status: "submitted",
    scheduled_for: FUTURE, canceled_at: null, bundle_post_id: "bp",
    created_at: "2026-06-10T19:59:30Z", content_label: "123 Main St · Carousel",
    ...o,
  };
}

console.log("\n── src/lib/scheduledPosts.js — schedule state / upcoming / reconcile ──\n");

// isActive
{
  check("active: submitted + bundle id + not canceled", isActive(row()) === true);
  check("inactive: canceled", isActive(row({ canceled_at: "2026-06-10T19:00:00Z" })) === false);
  check("inactive: status pending", isActive(row({ status: "pending" })) === false);
  check("inactive: no bundle_post_id", isActive(row({ bundle_post_id: null })) === false);
}

// scheduleState
{
  check("scheduled: active future → 'scheduled'", scheduleState([row({ scheduled_for: FUTURE })], NOW).kind === "scheduled");
  check("posted: active past → 'posted'", scheduleState([row({ scheduled_for: PAST })], NOW).kind === "posted");
  check("none: only canceled/failed → 'none'",
    scheduleState([row({ canceled_at: "2026-06-10T19:00:00Z" }), row({ status: "failed", bundle_post_id: null })], NOW).kind === "none");
  // latest active wins (by created_at)
  const rows = [
    row({ id: "old", scheduled_for: PAST,   created_at: "2026-06-10T18:00:00Z" }),
    row({ id: "new", scheduled_for: FUTURE, created_at: "2026-06-10T19:59:00Z" }),
  ];
  const st = scheduleState(rows, NOW);
  check("latest active record wins", st.record?.id === "new" && st.kind === "scheduled");
}

// isUpcoming / upcomingPosts
{
  check("upcoming: active future", isUpcoming(row({ scheduled_for: FUTURE }), NOW) === true);
  check("not upcoming: past", isUpcoming(row({ scheduled_for: PAST }), NOW) === false);
  check("not upcoming: canceled future", isUpcoming(row({ scheduled_for: FUTURE, canceled_at: "2026-06-10T19:00:00Z" }), NOW) === false);
  check("not upcoming: failed", isUpcoming(row({ status: "failed", bundle_post_id: null }), NOW) === false);

  const mixed = [
    row({ id: "a", scheduled_for: FUTURE }),
    row({ id: "b", scheduled_for: SOONER }),
    row({ id: "past", scheduled_for: PAST }),
    row({ id: "canceled", scheduled_for: FUTURE, canceled_at: "2026-06-10T19:00:00Z" }),
    row({ id: "pending", status: "pending", bundle_post_id: null, scheduled_for: FUTURE }),
  ];
  const up = upcomingPosts(mixed, NOW);
  check("upcomingPosts keeps only future active (2)", up.length === 2);
  check("upcomingPosts soonest first", up[0].id === "b" && up[1].id === "a");
}

// findRecentlyLanded (reconciliation)
{
  // created 30s ago, submitted, bundle id → landed
  check("reconcile: recent submitted+bundle → returns row",
    !!findRecentlyLanded([row({ created_at: "2026-06-10T19:59:30Z" })], NOW));
  // created 5 min ago → outside window → null
  check("reconcile: old row → null",
    findRecentlyLanded([row({ created_at: "2026-06-10T19:55:00Z" })], NOW) === null);
  // recent but no bundle id → null
  check("reconcile: recent but no bundle id → null",
    findRecentlyLanded([row({ created_at: "2026-06-10T19:59:30Z", bundle_post_id: null })], NOW) === null);
  // recent but canceled → null
  check("reconcile: recent but canceled → null",
    findRecentlyLanded([row({ created_at: "2026-06-10T19:59:30Z", canceled_at: "2026-06-10T19:59:45Z" })], NOW) === null);
  // boundary: exactly at window edge counts (>=)
  const edge = new Date(NOW.getTime() - RECONCILE_WINDOW_MS).toISOString();
  check("reconcile: at window edge → returns row", !!findRecentlyLanded([row({ created_at: edge })], NOW));
  // empty
  check("reconcile: no rows → null", findRecentlyLanded([], NOW) === null);
}

assert.ok(typeof scheduleState === "function");
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
