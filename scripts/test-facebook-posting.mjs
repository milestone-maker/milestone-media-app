#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for src/lib/facebookPosting.js — the pure logic behind the FB
// post/schedule control. Verifies buildFacebookPostRequest (now/schedule/smart
// + validation) and interpretFacebookPostResponse (success/scheduled/blocked/
// conflict/error). DOM-free; matches the postScheduling/scheduledPosts test style.
//
//   node scripts/test-facebook-posting.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(__dirname, "..", "src", "lib", "facebookPosting.js");
const { buildFacebookPostRequest, interpretFacebookPostResponse } = await import(pathToFileURL(MOD).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const CONTENT_ID = "c1";
const NOW = new Date("2026-06-09T12:00:00.000Z"); // fixed clock

console.log("\n── src/lib/facebookPosting.js ──\n");

// buildFacebookPostRequest
{
  // Post now → no postDate.
  const r = buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "now", now: NOW });
  check("now → body { contentId, platform:facebook }", JSON.stringify(r.body) === JSON.stringify({ contentId: CONTENT_ID, platform: "facebook" }));
  check("now → no postDate (immediate)", !("postDate" in (r.body || {})));

  // Missing content.
  check("missing contentId → error", !!buildFacebookPostRequest({ mode: "now", now: NOW }).error);

  // Schedule, valid future Central time → postDate present + platform facebook.
  const future = "2026-06-10T13:00"; // next-day 1pm Central, well in the future
  const rs = buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "schedule", scheduleLocal: future, now: NOW });
  check("schedule valid → body has postDate", typeof rs.body?.postDate === "string");
  check("schedule valid → platform facebook", rs.body?.platform === "facebook");
  check("schedule valid → postDate is in the future", new Date(rs.body.postDate).getTime() > NOW.getTime());

  // Schedule, blank → error.
  check("schedule blank → error", !!buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "schedule", scheduleLocal: "", now: NOW }).error);

  // Schedule, too-soon (a minute from now) → error (buffer guard).
  const tooSoon = "2026-06-09T07:00"; // 07:00 Central = 12:00Z == NOW → not > now+buffer
  check("schedule too-soon → error", !!buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "schedule", scheduleLocal: tooSoon, now: NOW }).error);

  // Smart with a slot → uses the slot's postDate.
  const slot = { postDate: "2026-06-10T13:00:00.000Z", label: "Wednesday 1:00 PM CT" };
  const rsmart = buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "smart", smartSlot: slot, now: NOW });
  check("smart → uses slot postDate", rsmart.body?.postDate === slot.postDate && rsmart.body?.platform === "facebook");

  // Smart with no slot → error.
  check("smart no slot → error", !!buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "smart", smartSlot: null, now: NOW }).error);

  // Unknown mode → error.
  check("unknown mode → error", !!buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "??", now: NOW }).error);

  // Agent-added extra photos: attached as extraPhotoUrls; absent/empty omitted.
  const withExtras = buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "now", extraPhotoUrls: ["u1", "u2"], now: NOW });
  check("extras → body.extraPhotoUrls in order", JSON.stringify(withExtras.body?.extraPhotoUrls) === JSON.stringify(["u1", "u2"]));
  check("extras attach to scheduled too", "extraPhotoUrls" in (buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "smart", smartSlot: { postDate: "2026-06-10T13:00:00.000Z" }, extraPhotoUrls: ["u1"], now: NOW }).body || {}));
  check("no extras → no extraPhotoUrls key", !("extraPhotoUrls" in buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "now", now: NOW }).body));
  check("empty extras → no extraPhotoUrls key", !("extraPhotoUrls" in buildFacebookPostRequest({ contentId: CONTENT_ID, mode: "now", extraPhotoUrls: [], now: NOW }).body));
}

// interpretFacebookPostResponse
{
  const ok = interpretFacebookPostResponse(200, { postId: "p1", status: "SCHEDULED", scheduledFor: "2026-06-10T13:00:00.000Z" });
  check("200 → success", ok.kind === "success");
  check("200 → carries scheduledFor + postId", ok.scheduledFor === "2026-06-10T13:00:00.000Z" && ok.postId === "p1");

  const blocked = interpretFacebookPostResponse(409, { error: "run photo analysis before posting to Facebook", code: "no_photos" });
  check("409 no_photos → blocked", blocked.kind === "blocked");
  check("409 no_photos → actionable message", /photo analysis/i.test(blocked.message));

  const conflict = interpretFacebookPostResponse(409, { error: "Facebook not connected" });
  check("409 (no code) → conflict", conflict.kind === "conflict" && /not connected/i.test(conflict.message));

  const err = interpretFacebookPostResponse(502, { error: "could not create Facebook post" });
  check("5xx → error with message", err.kind === "error" && /Facebook post/i.test(err.message));

  const errObj = interpretFacebookPostResponse(504, {}); // object/empty error body
  check("504 empty body → generic error message", errObj.kind === "error" && typeof errObj.message === "string");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
