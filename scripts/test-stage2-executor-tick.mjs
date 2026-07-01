// scripts/test-stage2-executor-tick.mjs
//
// Stage 2 (slice 1) smoke test — invokes the executor-tick endpoint locally.
// Uses production if TARGET_URL is set, otherwise defaults to the prod host.
// This script does NOT insert or delete any rows — it just triggers the
// tick and prints the response. The synthetic-row + Slack-approval flow is
// driven manually (like the Stage 1 test).
//
// Usage:
//   CRON_SECRET=<...> node scripts/test-stage2-executor-tick.mjs
//   TARGET_URL=https://example.vercel.app CRON_SECRET=<...> node ...
//
// Env vars required: CRON_SECRET.
// Optional: TARGET_URL (default: https://milestone-media-app.vercel.app).

const target = process.env.TARGET_URL || "https://milestone-media-app.vercel.app";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const url = `${target.replace(/\/+$/, "")}/api/executor-tick`;
console.log(`POST ${url} …`);

const start = Date.now();
const resp = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const elapsedMs = Date.now() - start;

const bodyText = await resp.text().catch(() => "");
let body;
try { body = JSON.parse(bodyText); } catch { body = bodyText; }

console.log(`status=${resp.status} elapsed=${elapsedMs}ms`);
console.log("body:", body);
process.exit(resp.ok ? 0 : 1);
