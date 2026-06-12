#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Regression guard for the FB album allowlist HARDENING.
//
// Listing photos live on the project's raw Storage host
// (cbpnjuotoxtmefmedpmj.supabase.co/storage/v1/object/public/published-media/…).
// We set SUPABASE_URL to the CUSTOM DOMAIN here (the worst case — the prod env
// is "Sensitive" and could be either) and prove the FB album still builds: the
// project host is allowlisted explicitly, so photos are NOT silently dropped.
//
//   node scripts/test-album-allowlist-hardening.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "social-post.js");

// Worst case: SUPABASE_URL is the CUSTOM DOMAIN, NOT the raw project host.
process.env.SUPABASE_URL              = "https://auth.milestonemediaphotography.com";
process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder";

const { default: handler } = await import(pathToFileURL(HANDLER_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = () => {}; res.writeHead = (c) => { res.statusCode = c; }; res.end = () => {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const AGENT_ID = "00000000-0000-0000-0000-000000000a01";
const CONTENT_ID = "00000000-0000-0000-0000-000000000d01";
const LISTING_ID = "00000000-0000-0000-0000-000000000c01";
// Photos on the PROJECT host (NOT the SUPABASE_URL host above).
const PROJECT_HOST = "cbpnjuotoxtmefmedpmj.supabase.co";
const pub = (n) => `https://${PROJECT_HOST}/storage/v1/object/public/published-media/${LISTING_ID}/${n}`;
const PHOTO_LABELS = [
  { id: "1", listing_id: LISTING_ID, photo_url: pub("drone.jpg"),  category: "drone",        features: [], confidence: 0.95, agent_corrected: false, sort_order: 0 },
  { id: "2", listing_id: LISTING_ID, photo_url: pub("facade.jpg"), category: "front_facade", features: [], confidence: 0.95, agent_corrected: false, sort_order: 1 },
  { id: "3", listing_id: LISTING_ID, photo_url: pub("kitchen.jpg"),category: "kitchen",      features: [], confidence: 0.95, agent_corrected: false, sort_order: 2 },
];

function makeSupabase() {
  const single = (data) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    auth: { getUser: async () => ({ data: { user: { id: AGENT_ID } }, error: null }) },
    from: (t) => {
      if (t === "agents") return single({ role: "agent", subscription_status: "active" });
      if (t === "agent_platform_connections") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { bundle_team_id: "team_1", connection_status: "connected" }, error: null }) }) }) }) };
      if (t === "generated_content") return single({ id: CONTENT_ID, agent_id: AGENT_ID, listing_id: LISTING_ID, caption: "Caption." });
      if (t === "photo_labels") return { select: () => ({ eq: () => ({ order: async () => ({ data: PHOTO_LABELS, error: null }) }) }) };
      if (t === "social_posts") return { insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "sp_1" }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) };
      throw new Error(`Unexpected table: ${t}`);
    },
  };
}

console.log("\n── FB album allowlist hardening (SUPABASE_URL = custom domain) ──\n");
{
  const uploads = [];
  const req = { method: "POST", headers: { authorization: "Bearer t" }, body: { contentId: CONTENT_ID, platform: "facebook" } };
  const res = makeRes();
  await handler(req, res, {
    supabase: makeSupabase(),
    createUpload: async ({ url }) => { uploads.push(url); return { id: `up_${uploads.length}` }; },
    createPost: async () => ({ id: "post_1", status: "SCHEDULED" }),
    resolveMicrositeUrl: async () => null,
    now: () => new Date("2026-06-12T15:00:00.000Z"),
  });
  check("post succeeds → 200 (not no_photos block)", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("project-host photos PASS the allowlist (album built)", uploads.length === 3, `uploaded ${uploads.length}`);
  check("every uploaded url is on the project host", uploads.every((u) => u.includes(PROJECT_HOST)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
