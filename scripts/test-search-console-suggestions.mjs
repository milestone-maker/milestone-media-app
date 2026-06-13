#!/usr/bin/env node

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/search-console-suggestions.js.
// No real credentials, no network: GSC query seam + Anthropic + Supabase are all
// injected via depsOverride (test-classify-photos / parse-comps style). Plus the
// pure helpers (prompt assembly, JSON extraction, suggestion normalization).
//
//   node scripts/test-search-console-suggestions.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const mod = await import(pathToFileURL(resolve(REPO_ROOT, "api", "search-console-suggestions.js")).href);
const handler = mod.default;
const { extractJson, normalizeSuggestions, buildSuggestionPrompt } = mod._internals;

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; } else { fails.push(`${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

// ── Fixtures ─────────────────────────────────────────────────────────
const AGENT_ID = "00000000-0000-0000-0000-000000000a01";
const SLUG = "1954-toronto-57402083";
const PD = {
  address: "1954 Toronto St", city: "Dallas, TX", neighborhood: "Kessler Park",
  beds: "3", baths: "2", sqft: "2100", description: "Charming updated home.", features: ["pool", "marble island"],
};
const OK_GSC = {
  status: "ok",
  totals: { impressions: 400, clicks: 20, ctr: 0.05, position: 8.5 },
  queries: [
    { query: "kessler park homes", impressions: 200, clicks: 12, ctr: 0.06, position: 6 },
    { query: "dallas pool house", impressions: 100, clicks: 4, ctr: 0.04, position: 11 },
  ],
};
const GOOD_JSON = JSON.stringify({
  suggestedTitle: "1954 Toronto St, Kessler Park — 3 Bed / 2 Bath",
  suggestedDescription: "Updated Kessler Park home with a pool in Dallas. 3 bed, 2 bath, 2100 sqft.",
  recommendations: ["Add 'Kessler Park' to the title", "Mention the pool — you rank for 'dallas pool house'"],
});

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, h) => { res.statusCode = code; if (h) Object.assign(res.headers, h); };
  res.end = () => { res.ended = true; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeSupabase({
  user = { id: AGENT_ID }, authError = null,
  agent = { role: "admin" }, agentErr = null,
  microsite = { slug: SLUG, property_data: PD, listing_id: "L1" }, micErr = null,
} = {}) {
  function tb(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      maybeSingle() {
        if (table === "agents")     return Promise.resolve({ data: agent, error: agentErr });
        if (table === "microsites") return Promise.resolve({ data: microsite, error: micErr });
        throw new Error(`maybeSingle unexpected for ${table}`);
      },
    };
    return b;
  }
  return {
    auth: { getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }) },
    from: (t) => tb(t),
  };
}

function makeAnthropic(text) {
  const calls = [];
  return {
    calls,
    messages: { create: async (opts) => { calls.push(opts); return { content: [{ type: "text", text }] }; } },
  };
}

async function callHandler({ method = "GET", auth = true, query = {}, body, supabase, fetchPageQueryData, anthropic } = {}) {
  const req = { method, headers: auth ? { authorization: "Bearer tok" } : {}, query, body };
  const res = makeRes();
  await handler(req, res, {
    supabase: supabase || makeSupabase(),
    fetchPageQueryData: fetchPageQueryData || (async () => OK_GSC),
    anthropic: anthropic || makeAnthropic(GOOD_JSON),
  });
  return res;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
{
  check("extractJson: plain", extractJson('{"a":1}').a === 1);
  check("extractJson: code-fenced", extractJson('```json\n{"a":2}\n```').a === 2);
  check("extractJson: stray prose around object", extractJson('Here:\n{"a":3} thanks').a === 3);
  let threw = false; try { extractJson("no json here"); } catch { threw = true; }
  check("extractJson: throws when no object", threw);

  const n = normalizeSuggestions({ suggestedTitle: " T ", suggestedDescription: 5, recommendations: ["a", "", null, "b", "c", "d", "e"] });
  check("normalize: title trimmed", n.suggestedTitle === "T");
  check("normalize: non-string description → ''", n.suggestedDescription === "");
  check("normalize: recs filtered + capped at 4", n.recommendations.length === 4 && n.recommendations.join(",") === "a,b,c,d", n.recommendations.join(","));
  const n2 = normalizeSuggestions({});
  check("normalize: missing recs → []", Array.isArray(n2.recommendations) && n2.recommendations.length === 0);

  const { system, user } = buildSuggestionPrompt({ pd: PD, currentTitle: "CUR TITLE", currentDescription: "CUR DESC", metrics: OK_GSC.totals, queries: OK_GSC.queries });
  check("prompt: system mentions JSON-only", /ONLY a JSON object/i.test(system));
  check("prompt: includes current title", user.includes("CUR TITLE"));
  check("prompt: includes current description", user.includes("CUR DESC"));
  check("prompt: includes a real query", user.includes("kessler park homes"));
  check("prompt: includes neighborhood detail", user.includes("Kessler Park"));
}

// ── 1. admin + ok → 200 connected/hasData + parsed suggestions ───────────────
{
  const res = await callHandler({ query: { slug: SLUG, startDate: "2026-03-15", endDate: "2026-06-13" } });
  check("ok: 200", res.statusCode === 200, res.statusCode);
  check("ok: connected true", res.body?.connected === true);
  check("ok: hasData true", res.body?.hasData === true);
  check("ok: currentTitle computed", typeof res.body?.currentTitle === "string" && res.body.currentTitle.length > 0, res.body?.currentTitle);
  check("ok: currentDescription computed", typeof res.body?.currentDescription === "string" && res.body.currentDescription.length > 0);
  check("ok: metrics echoed", res.body?.metrics?.impressions === 400);
  check("ok: topQueries echoed", res.body?.topQueries?.length === 2);
  check("ok: suggestedTitle parsed", res.body?.suggestions?.suggestedTitle?.includes("Kessler Park"));
  check("ok: recommendations parsed", res.body?.suggestions?.recommendations?.length === 2);
}

// ── 2. non-admin → 403 ───────────────────────────────────────────────────────
{
  const res = await callHandler({ query: { slug: SLUG }, supabase: makeSupabase({ agent: { role: "agent" } }) });
  check("non-admin: 403", res.statusCode === 403, res.statusCode);
  check("non-admin: admin_only", res.body?.error === "admin_only");
}

// ── 3. missing bearer → 401 ──────────────────────────────────────────────────
{
  const res = await callHandler({ query: { slug: SLUG }, auth: false });
  check("no-bearer: 401", res.statusCode === 401, res.statusCode);
}

// ── 4. not_configured pass-through ───────────────────────────────────────────
{
  const res = await callHandler({ query: { slug: SLUG }, fetchPageQueryData: async () => ({ status: "not_configured" }) });
  check("not_configured: 200", res.statusCode === 200, res.statusCode);
  check("not_configured: connected false", res.body?.connected === false && res.body?.reason === "not_configured");
}

// ── 5. no_access pass-through ────────────────────────────────────────────────
{
  const res = await callHandler({ query: { slug: SLUG }, fetchPageQueryData: async () => ({ status: "no_access" }) });
  check("no_access: 200", res.statusCode === 200, res.statusCode);
  check("no_access: reason", res.body?.connected === false && res.body?.reason === "no_access");
}

// ── 6. ok but no query data → hasData:false; Claude NOT called ───────────────
{
  const anthropic = makeAnthropic(GOOD_JSON);
  const res = await callHandler({
    query: { slug: SLUG },
    fetchPageQueryData: async () => ({ status: "ok", totals: null, queries: [] }),
    anthropic,
  });
  check("no-data: 200", res.statusCode === 200, res.statusCode);
  check("no-data: connected true, hasData false", res.body?.connected === true && res.body?.hasData === false);
  check("no-data: Claude not called", anthropic.calls.length === 0, `calls=${anthropic.calls.length}`);
}

// ── 7. malformed Claude output → 500 suggestions_failed (no crash) ───────────
{
  const res = await callHandler({ query: { slug: SLUG }, anthropic: makeAnthropic("sorry, I cannot do that") });
  check("bad-model: 500", res.statusCode === 500, res.statusCode);
  check("bad-model: suggestions_failed", res.body?.error === "suggestions_failed", JSON.stringify(res.body));
}

// ── 8. missing slug → 400 ────────────────────────────────────────────────────
{
  const res = await callHandler({ query: {} });
  check("no-slug: 400", res.statusCode === 400, res.statusCode);
}

// ── 9. microsite not found → 404 ─────────────────────────────────────────────
{
  const res = await callHandler({ query: { slug: "nope" }, supabase: makeSupabase({ microsite: null }) });
  check("not-found: 404", res.statusCode === 404, res.statusCode);
}

// ── 10. malformed date → 400 ; default range path → 200 ──────────────────────
{
  const bad = await callHandler({ query: { slug: SLUG, startDate: "03-15-2026", endDate: "2026-06-13" } });
  check("bad-date: 400", bad.statusCode === 400, bad.statusCode);
  const def = await callHandler({ query: { slug: SLUG } }); // no dates → 90-day default
  check("default-range: 200", def.statusCode === 200, def.statusCode);
}

// ── 11. body input also accepted (POST) ──────────────────────────────────────
{
  const res = await callHandler({ method: "POST", query: {}, body: { slug: SLUG } });
  check("post-body slug: 200", res.statusCode === 200, res.statusCode);
}

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`\n✓ ${passed} passed, 0 failed (mock mode — no real credentials)\n`);
