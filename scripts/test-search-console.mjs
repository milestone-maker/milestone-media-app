#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/search-console.js + api/_lib/searchConsole.js.
// No real credentials, no network, no live DB:
//   • mapGscRowsToListings — pure mapping + totals math (test-sitemap style).
//   • buildSignedJwt — hand-rolled RS256 JWT verified with an EPHEMERAL keypair
//     minted in-process (proves the riskiest bit without touching Google).
//   • handler — exercised via depsOverride with an injected fetchGscRows and a
//     mocked Supabase (test-classify-photos style). Never hits Anthropic/GSC/DB.
//
//   node scripts/test-search-console.mjs

import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..");

const handler = (await import(pathToFileURL(resolve(REPO_ROOT, "api", "search-console.js")).href)).default;
const { mapGscRowsToListings, buildSignedJwt } =
  await import(pathToFileURL(resolve(REPO_ROOT, "api", "_lib", "searchConsole.js")).href);
const { PUBLIC_APP_BASE } =
  await import(pathToFileURL(resolve(REPO_ROOT, "api", "_lib", "microsite.js")).href);

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { fails.push(`${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

// ── Fixtures ─────────────────────────────────────────────────────────
const AGENT_ID    = "00000000-0000-0000-0000-000000000a01";
const VALID_TOKEN = "fake-bearer-token";
const BASE        = PUBLIC_APP_BASE;
const url = (slug) => `${BASE}/p/${slug}`;

// ── 1. Pure mapper: matching slugs → per-listing rows + correct totals ───────
{
  const rows = [
    { keys: [url("alpha")], impressions: 100, clicks: 10, ctr: 0.1,  position: 5  },
    { keys: [url("bravo")], impressions: 300, clicks: 15, ctr: 0.05, position: 10 },
  ];
  const slugMap = {
    alpha: { label: "123 Alpha St", listing_id: "L-alpha" },
    bravo: { label: "456 Bravo Ave", listing_id: "L-bravo" },
  };
  const { listings, totals } = mapGscRowsToListings(rows, slugMap, BASE);

  check("map: two listings emitted", listings.length === 2, `got ${listings.length}`);
  const a = listings.find((l) => l.slug === "alpha");
  check("map: alpha listing_id", a?.listing_id === "L-alpha");
  check("map: alpha label", a?.label === "123 Alpha St");
  check("map: alpha url is exact /p/{slug}", a?.url === url("alpha"), a?.url);
  check("map: alpha ctr = clicks/impressions", a?.ctr === 0.1, a?.ctr);
  check("map: alpha position preserved", a?.position === 5, a?.position);

  // totals: impr 400, clicks 25, ctr 25/400 = 0.0625,
  // weighted position = (5*100 + 10*300)/400 = 3500/400 = 8.75
  check("totals: impressions summed", totals.impressions === 400, totals.impressions);
  check("totals: clicks summed", totals.clicks === 25, totals.clicks);
  check("totals: ctr = clicks/impressions", totals.ctr === 0.0625, totals.ctr);
  check("totals: impression-WEIGHTED position", totals.position === 8.75, totals.position);
}

// ── 2. Pure mapper: unknown slug skipped ─────────────────────────────────────
{
  const rows = [
    { keys: [url("known")],   impressions: 50, clicks: 5, position: 3 },
    { keys: [url("unknown")], impressions: 99, clicks: 9, position: 1 }, // not in slugMap
    { keys: ["https://example.com/other"], impressions: 7, clicks: 7, position: 2 }, // wrong prefix
  ];
  const slugMap = { known: { label: "Known", listing_id: "L-known" } };
  const { listings, totals } = mapGscRowsToListings(rows, slugMap, BASE);
  check("map: only known slug kept", listings.length === 1 && listings[0].slug === "known", listings.map((l) => l.slug).join(","));
  check("map: unknown/other excluded from totals", totals.impressions === 50 && totals.clicks === 5, JSON.stringify(totals));
}

// ── 3. Pure mapper: empty rows → empty listings + zeroed totals ──────────────
{
  const { listings, totals } = mapGscRowsToListings([], {}, BASE);
  check("map(empty): no listings", listings.length === 0);
  check("map(empty): zeroed totals", totals.impressions === 0 && totals.clicks === 0 && totals.ctr === 0 && totals.position === 0, JSON.stringify(totals));
  // non-array tolerated
  const r2 = mapGscRowsToListings(null, null, BASE);
  check("map(null): treated as empty, no throw", r2.listings.length === 0 && r2.totals.impressions === 0);
}

// ── 4. Pure mapper: exact prefix strip recovers the slug ─────────────────────
{
  const rows = [{ keys: [url("1954-toronto-57402083")], impressions: 1, clicks: 0, position: 9 }];
  const slugMap = { "1954-toronto-57402083": { label: "1954 Toronto", listing_id: "L1" } };
  const { listings } = mapGscRowsToListings(rows, slugMap, BASE);
  check("map: prefix-strip yields exact slug", listings[0]?.slug === "1954-toronto-57402083", listings[0]?.slug);
  check("map: ctr 0 when no clicks", listings[0]?.ctr === 0, listings[0]?.ctr);
}

// ── 5. Hand-rolled JWT proof (ephemeral keypair, NO Google) ──────────────────
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = {
    client_email: "svc@proj.iam.gserviceaccount.com",
    private_key:  privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  const nowSec = 1700000000;
  const jwt = buildSignedJwt(sa, nowSec);

  const parts = jwt.split(".");
  check("jwt: has three parts", parts.length === 3, `got ${parts.length}`);

  const [h64, c64, s64] = parts;
  const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const header = JSON.parse(fromB64url(h64).toString("utf8"));
  const claim  = JSON.parse(fromB64url(c64).toString("utf8"));

  // Signature verifies against the public key over header.claim
  const signingInput = `${h64}.${c64}`;
  const sigOk = crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicKey, fromB64url(s64));
  check("jwt: signature verifies with public key", sigOk === true);

  check("jwt: header alg RS256", header.alg === "RS256", header.alg);
  check("jwt: header typ JWT", header.typ === "JWT", header.typ);
  check("jwt: claim iss is client_email", claim.iss === sa.client_email, claim.iss);
  check("jwt: claim scope webmasters.readonly", claim.scope === "https://www.googleapis.com/auth/webmasters.readonly", claim.scope);
  check("jwt: claim aud token endpoint", claim.aud === "https://oauth2.googleapis.com/token", claim.aud);
  check("jwt: claim iat = now", claim.iat === nowSec, claim.iat);
  check("jwt: claim exp = now + 3600", claim.exp === nowSec + 3600, claim.exp);

  // A tampered payload must fail verification (proves the signature is real).
  const tampered = JSON.parse(fromB64url(c64).toString("utf8"));
  tampered.scope = "https://www.googleapis.com/auth/webmasters"; // read-write
  const tamperedC64 = Buffer.from(JSON.stringify(tampered)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tamperedOk = crypto.verify("RSA-SHA256", Buffer.from(`${h64}.${tamperedC64}`), publicKey, fromB64url(s64));
  check("jwt: tampered claim FAILS verification", tamperedOk === false);
}

// ── Handler harness (mocked Supabase + injected fetchGscRows) ────────────────
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; if (headers) Object.assign(res.headers, headers); };
  res.end = () => { res.ended = true; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// Minimal stateful Supabase mock: auth.getUser; agents via maybeSingle (role);
// microsites as an awaitable list (select/eq/is chain).
function makeSupabase({
  user        = { id: AGENT_ID },
  authError   = null,
  agent       = { role: "admin" },
  agentErr    = null,
  microsites  = [],
  micrositeErr = null,
} = {}) {
  function tableBuilder(table) {
    const b = {
      select() { return b; },
      eq()     { return b; },
      is()     { return b; },
      order()  { return b; },
      maybeSingle() {
        if (table === "agents") return Promise.resolve({ data: agent, error: agentErr });
        throw new Error(`maybeSingle unexpected for table ${table}`);
      },
      then(resolveFn, rejectFn) {
        let result;
        if (table === "microsites") result = { data: micrositeErr ? null : microsites, error: micrositeErr };
        else result = { data: null, error: null };
        return Promise.resolve(result).then(resolveFn, rejectFn);
      },
    };
    return b;
  }
  return {
    auth: { getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }) },
    from: (t) => tableBuilder(t),
  };
}

async function callHandler({ method = "GET", auth = true, query = {}, supabase, fetchGscRows } = {}) {
  const req = { method, headers: auth ? { authorization: `Bearer ${VALID_TOKEN}` } : {}, query };
  const res = makeRes();
  await handler(req, res, {
    supabase:     supabase     || makeSupabase(),
    fetchGscRows: fetchGscRows || (async () => ({ status: "ok", rows: [] })),
  });
  return res;
}

// ── 6. admin + ok + mocked live microsites → 200 connected:true, mapped ──────
{
  const microsites = [
    { slug: "alpha", property_data: { address: "123 Alpha St" }, listing_id: "L-alpha" },
    { slug: "bravo", property_data: { city: "Dallas, TX" },      listing_id: "L-bravo" },
  ];
  const rows = [
    { keys: [url("alpha")], impressions: 200, clicks: 20, position: 4 },
    { keys: [url("bravo")], impressions: 200, clicks: 10, position: 6 },
  ];
  const res = await callHandler({
    query: { startDate: "2026-05-01", endDate: "2026-05-28" },
    supabase: makeSupabase({ microsites }),
    fetchGscRows: async () => ({ status: "ok", rows }),
  });
  check("ok: 200", res.statusCode === 200, res.statusCode);
  check("ok: connected true", res.body?.connected === true);
  check("ok: range echoed", res.body?.range?.startDate === "2026-05-01" && res.body?.range?.endDate === "2026-05-28");
  check("ok: two listings mapped", res.body?.listings?.length === 2, res.body?.listings?.length);
  check("ok: bravo label falls back to city", res.body?.listings?.find((l) => l.slug === "bravo")?.label === "Dallas, TX");
  // totals: impr 400, clicks 30 → ctr 0.075; weighted pos (4*200+6*200)/400 = 5
  check("ok: totals ctr", res.body?.totals?.ctr === 0.075, res.body?.totals?.ctr);
  check("ok: totals weighted position", res.body?.totals?.position === 5, res.body?.totals?.position);
}

// ── 7. non-admin → 403 admin_only ────────────────────────────────────────────
{
  const res = await callHandler({ supabase: makeSupabase({ agent: { role: "agent" } }) });
  check("non-admin: 403", res.statusCode === 403, res.statusCode);
  check("non-admin: admin_only", res.body?.error === "admin_only");
}

// ── 8. missing bearer → 401 ──────────────────────────────────────────────────
{
  const res = await callHandler({ auth: false });
  check("no-bearer: 401", res.statusCode === 401, res.statusCode);
}

// ── 9. invalid session → 401 ─────────────────────────────────────────────────
{
  const res = await callHandler({ supabase: makeSupabase({ authError: { message: "bad token" } }) });
  check("invalid-session: 401", res.statusCode === 401, res.statusCode);
}

// ── 10. not_configured → 200 connected:false reason not_configured ───────────
{
  const res = await callHandler({ fetchGscRows: async () => ({ status: "not_configured" }) });
  check("not_configured: 200", res.statusCode === 200, res.statusCode);
  check("not_configured: connected false", res.body?.connected === false);
  check("not_configured: reason", res.body?.reason === "not_configured", res.body?.reason);
}

// ── 11. no_access → 200 connected:false reason no_access ─────────────────────
{
  const res = await callHandler({ fetchGscRows: async () => ({ status: "no_access" }) });
  check("no_access: 200", res.statusCode === 200, res.statusCode);
  check("no_access: connected false", res.body?.connected === false);
  check("no_access: reason", res.body?.reason === "no_access", res.body?.reason);
}

// ── 12. ok but zero rows → 200 connected:true, listings:[] (graceful) ────────
{
  const res = await callHandler({
    supabase: makeSupabase({ microsites: [{ slug: "alpha", property_data: {}, listing_id: "L" }] }),
    fetchGscRows: async () => ({ status: "ok", rows: [] }),
  });
  check("zero-rows: 200", res.statusCode === 200, res.statusCode);
  check("zero-rows: connected true", res.body?.connected === true);
  check("zero-rows: listings empty", Array.isArray(res.body?.listings) && res.body.listings.length === 0);
  check("zero-rows: zeroed totals", res.body?.totals?.impressions === 0 && res.body?.totals?.ctr === 0);
}

// ── 13. malformed startDate → 400 ────────────────────────────────────────────
{
  const res = await callHandler({ query: { startDate: "05/01/2026", endDate: "2026-05-28" } });
  check("bad-date: 400", res.statusCode === 400, res.statusCode);
}

// ── 14. no date params → defaults to a 28-day range ──────────────────────────
{
  const res = await callHandler({ query: {} });
  check("default-range: 200", res.statusCode === 200, res.statusCode);
  const { startDate, endDate } = res.body?.range || {};
  check("default-range: ISO startDate", /^\d{4}-\d{2}-\d{2}$/.test(startDate || ""), startDate);
  check("default-range: ISO endDate", /^\d{4}-\d{2}-\d{2}$/.test(endDate || ""), endDate);
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
  check("default-range: span is 28 days", days === 28, `${days} days (${startDate}..${endDate})`);
}

// ── 15. method guard: non-GET → 405; OPTIONS → 204 ───────────────────────────
{
  const res = await callHandler({ method: "POST" });
  check("method: POST → 405", res.statusCode === 405, res.statusCode);
  const opt = await callHandler({ method: "OPTIONS" });
  check("method: OPTIONS → 204", opt.statusCode === 204, opt.statusCode);
}

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`\n✓ ${passed} passed, 0 failed (mock mode — no real credentials)\n`);
