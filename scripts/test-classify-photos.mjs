#!/usr/bin/env node

// Fail loudly: any unhandled error must become a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Integration test for api/classify-photos.js.
//
// Mock-only (always): injects a fake service-role Supabase client AND a fake
// classifyImages via depsOverride — never hits Anthropic or a real DB. Mirrors
// scripts/test-content-generate.mjs's depsOverride approach.
//
//   node scripts/test-classify-photos.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const HANDLER_PATH = resolve(REPO_ROOT, "api", "classify-photos.js");

process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const mod = await import(pathToFileURL(HANDLER_PATH).href);
const handler = mod.default;

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; if (headers) Object.assign(res.headers, headers); };
  res.end = () => { res.ended = true; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── Fixtures ─────────────────────────────────────────────────────────
const AGENT_ID       = "00000000-0000-0000-0000-000000000a01";
const OTHER_AGENT_ID = "00000000-0000-0000-0000-0000000000ff";
const LISTING_ID     = "00000000-0000-0000-0000-000000000c01";
const MICROSITE_ID   = "00000000-0000-0000-0000-000000000d01";
const VALID_TOKEN    = "fake-bearer-token";

const CATEGORIES = [
  "front_facade", "backyard", "drone", "living", "dining",
  "kitchen", "primary_bedroom", "primary_bathroom", "other",
];

const photoUrl       = (i) => `https://cdn.test/photo-${i}.jpg`;
const idxFromUrl      = (url) => Number(url.match(/photo-(\d+)/)[1]);
const categoryFromUrl = (url) => CATEGORIES[idxFromUrl(url) % CATEGORIES.length];

const LISTING = {
  id: LISTING_ID, agent_id: AGENT_ID, address: "5912 Velasco Ave",
  city: "Dallas", status: "Live",
};

// Build a microsite whose property_data has hero_img = photo-0 AND
// gallery_photos = [photo-0 .. photo-(n-1)]. hero duplicates gallery[0] so
// the handler's dedupe is exercised — result is n unique photos, sort_order
// 0..n-1.
function makeMicrosite(n) {
  return {
    id: MICROSITE_ID, published: true, created_at: "2026-05-01T00:00:00Z",
    property_data: {
      hero_img:       photoUrl(0),
      gallery_photos: Array.from({ length: n }, (_, i) => photoUrl(i)),
    },
  };
}

function makeLabel(i, { agent_corrected = false, category } = {}) {
  return {
    id: `L-${i}`, listing_id: LISTING_ID, microsite_id: MICROSITE_ID,
    photo_url: photoUrl(i), category: category || categoryFromUrl(photoUrl(i)),
    features: [], confidence: 0.5, sort_order: i, agent_corrected,
    created_at: "2026-05-02T00:00:00Z", updated_at: "2026-05-02T00:00:00Z",
  };
}

// ── Stateful Supabase mock ───────────────────────────────────────────
// Supports: auth.getUser; agents/listings via maybeSingle; microsites as an
// awaitable ordered list; photo_labels reads (awaitable, optionally ordered)
// against a mutable store; and upsert (merge by listing_id,photo_url).
function makeSupabase({
  user        = { id: AGENT_ID },
  authError   = null,
  agent       = { role: "agent", subscription_status: "active" },
  agentErr    = null,
  listing     = LISTING,
  listingErr  = null,
  microsites  = [makeMicrosite(4)],
  micrositeErr = null,
  initialLabels = [],
  labelsErr   = null,
  upsertErr   = null,
} = {}) {
  const store = initialLabels.map((r) => ({ ...r }));
  const captured = { upserts: [] };

  function tableBuilder(table) {
    let ordered = false;
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { ordered = true; return b; },
      maybeSingle() {
        if (table === "agents")   return Promise.resolve({ data: agent,   error: agentErr });
        if (table === "listings") return Promise.resolve({ data: listing, error: listingErr });
        throw new Error(`maybeSingle unexpected for table ${table}`);
      },
      upsert(rows, options) {
        captured.upserts.push({ rows, options });
        if (upsertErr) return Promise.resolve({ error: upsertErr });
        for (const row of rows) {
          const i = store.findIndex((s) => s.listing_id === row.listing_id && s.photo_url === row.photo_url);
          if (i >= 0) store[i] = { ...store[i], ...row };
          else store.push({ id: `gen-${store.length}`, created_at: "2026-06-01T00:00:00Z", ...row });
        }
        return Promise.resolve({ error: null });
      },
      then(resolveFn, rejectFn) {
        let result;
        if (table === "microsites") {
          result = { data: micrositeErr ? null : microsites, error: micrositeErr };
        } else if (table === "photo_labels") {
          if (labelsErr) result = { data: null, error: labelsErr };
          else {
            let rows = store.slice();
            if (ordered) rows = rows.sort((a, c) => (a.sort_order ?? 0) - (c.sort_order ?? 0));
            result = { data: rows, error: null };
          }
        } else {
          result = { data: null, error: null };
        }
        return Promise.resolve(result).then(resolveFn, rejectFn);
      },
    };
    return b;
  }

  return {
    auth: { getUser: async () => (authError ? { data: null, error: authError } : { data: { user }, error: null }) },
    from: (t) => tableBuilder(t),
    __store: store,
    __captured: captured,
  };
}

// ── Fake classifyImages ──────────────────────────────────────────────
// Default: classify each image in the chunk by its in-chunk index, deriving
// category from the URL (so index→url mapping is verifiable downstream).
// `behavior(ctx, callIdx)` may override / throw to simulate chunk failures.
function makeClassifier(behavior) {
  const calls = [];
  const fn = async (opts) => {
    const callIdx = calls.length;
    calls.push(opts);
    if (behavior) {
      const r = behavior(opts, callIdx); // may throw
      if (r !== undefined) return r;
    }
    return {
      classifications: opts.imageUrls.map((url, i) => ({
        index: i,
        category: categoryFromUrl(url),
        features: [`f-${idxFromUrl(url)}`],
        confidence: 0.8,
      })),
    };
  };
  fn.calls = calls;
  return fn;
}

async function callHandler({ method = "POST", auth = true, body = {}, supabase, classifier } = {}) {
  const req = { method, headers: auth ? { authorization: `Bearer ${VALID_TOKEN}` } : {}, body };
  const res = makeRes();
  await handler(req, res, { supabase: supabase || makeSupabase(), classifyImages: classifier || makeClassifier() });
  return res;
}

console.log("\n── api/classify-photos.js ──\n");

// 1. Method guard
{
  const res = await callHandler({ method: "GET", body: { listing_id: LISTING_ID } });
  check("GET → 405", res.statusCode === 405, `got ${res.statusCode}`);
}

// 2. Missing auth → 401
{
  const res = await callHandler({ auth: false, body: { listing_id: LISTING_ID } });
  check("missing auth → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

// 3. Missing listing_id → 400
{
  const res = await callHandler({ body: {} });
  check("missing listing_id → 400", res.statusCode === 400, `got ${res.statusCode}`);
}

// 4. No agent profile → 401
{
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ agent: null }) });
  check("no agent profile → 401", res.statusCode === 401, `got ${res.statusCode}`);
}

// 5. Subscription gate — unsubscribed non-admin → 402
{
  for (const status of [null, "canceled", "unpaid", "paused"]) {
    const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ agent: { role: "agent", subscription_status: status } }) });
    check(`unsubscribed non-admin (status=${status}) → 402`, res.statusCode === 402, `got ${res.statusCode}`);
    check(`unsubscribed → subscription_required body`, res.body?.error === "subscription_required");
  }
}

// 6. Listing not found → 404
{
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ listing: null }) });
  check("listing not found → 404", res.statusCode === 404, `got ${res.statusCode}`);
}

// 7. Listing owned by someone else (non-admin) → 403
{
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ listing: { ...LISTING, agent_id: OTHER_AGENT_ID } }) });
  check("listing not owned by caller → 403", res.statusCode === 403, `got ${res.statusCode}`);
}

// 8. Admin-any bypass — admin classifies a listing owned by someone else → 200
{
  const classifier = makeClassifier();
  const res = await callHandler({
    body: { listing_id: LISTING_ID },
    supabase: makeSupabase({ agent: { role: "admin", subscription_status: null }, listing: { ...LISTING, agent_id: OTHER_AGENT_ID } }),
    classifier,
  });
  check("admin can classify any listing → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("admin bypass actually classified", classifier.calls.length >= 1);
}

// 9. No linked microsite → 404
{
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ microsites: [] }) });
  check("no microsite for listing → 404", res.statusCode === 404, `got ${res.statusCode}`);
  check("no microsite → correct error body", res.body?.error === "no microsite for listing");
}

// 10. Empty photo list → 200 { labels: [] }, no model call
{
  const micro = { id: MICROSITE_ID, published: true, created_at: "2026-05-01T00:00:00Z", property_data: { hero_img: null, gallery_photos: [] } };
  const classifier = makeClassifier();
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ microsites: [micro] }), classifier });
  check("empty photos → 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("empty photos → labels []", Array.isArray(res.body?.labels) && res.body.labels.length === 0);
  check("empty photos → no model call", classifier.calls.length === 0);
}

// 11. Happy path (4 photos, hero dups gallery[0]) → dedupe + classify all
{
  const classifier = makeClassifier();
  const sb = makeSupabase({ microsites: [makeMicrosite(4)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: sb, classifier });
  check("happy: 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  check("happy: dedupe → 4 unique photos classified", res.body?.classified_count === 4, `got ${res.body?.classified_count}`);
  check("happy: one chunk (4 ≤ 10)", classifier.calls.length === 1);
  check("happy: chunk got 4 urls", classifier.calls[0]?.imageUrls?.length === 4);
  check("happy: 4 labels returned", res.body?.labels?.length === 4);
  check("happy: labels ordered by sort_order", res.body.labels.every((l, i) => l.sort_order === i));
  check("happy: microsite_id in response", res.body?.microsite_id === MICROSITE_ID);
  check("happy: no warnings", res.body?.warnings === undefined);
  // The engine receives our tool + system prompt + Haiku model.
  check("happy: classifier got tool name classify_photos", classifier.calls[0]?.tool?.name === "classify_photos");
  check("happy: tool enum === the nine categories",
    JSON.stringify(classifier.calls[0]?.tool?.input_schema?.properties?.classifications?.items?.properties?.category?.enum) === JSON.stringify(CATEGORIES));
  check("happy: model is Haiku", classifier.calls[0]?.model === "claude-haiku-4-5-20251001");
  check("happy: systemPrompt defines categories", /front_facade/.test(classifier.calls[0]?.systemPrompt || ""));
}

// 12. Upsert field correctness
{
  const classifier = makeClassifier();
  const sb = makeSupabase({ microsites: [makeMicrosite(2)] });
  await callHandler({ body: { listing_id: LISTING_ID }, supabase: sb, classifier });
  const up = sb.__captured.upserts[0];
  check("upsert: conflict target listing_id,photo_url", up?.options?.onConflict === "listing_id,photo_url");
  const row0 = up.rows.find((r) => r.photo_url === photoUrl(0));
  check("upsert: row has listing_id",        row0?.listing_id === LISTING_ID);
  check("upsert: row has microsite_id",       row0?.microsite_id === MICROSITE_ID);
  check("upsert: category from classifier",   row0?.category === categoryFromUrl(photoUrl(0)));
  check("upsert: features array",             Array.isArray(row0?.features) && row0.features[0] === "f-0");
  check("upsert: confidence number",          row0?.confidence === 0.8);
  check("upsert: sort_order 0 for hero",      row0?.sort_order === 0);
  check("upsert: agent_corrected === false",  row0?.agent_corrected === false);
  check("upsert: updated_at present",         typeof row0?.updated_at === "string" && row0.updated_at.length > 0);
}

// 13. Incremental (force=false): only photos with NO existing label classified
{
  const classifier = makeClassifier();
  // 4 photos; photo-0 and photo-1 already labeled (non-corrected).
  const sb = makeSupabase({ microsites: [makeMicrosite(4)], initialLabels: [makeLabel(0), makeLabel(1)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: false }, supabase: sb, classifier });
  check("incremental: 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("incremental: only 2 unlabeled classified", res.body?.classified_count === 2, `got ${res.body?.classified_count}`);
  const urls = classifier.calls.flatMap((c) => c.imageUrls);
  check("incremental: classified photo-2 + photo-3 only",
    urls.length === 2 && urls.includes(photoUrl(2)) && urls.includes(photoUrl(3)) && !urls.includes(photoUrl(0)));
  check("incremental: 4 total labels after", res.body?.labels?.length === 4);
}

// 14. Nothing to classify (all labeled, force=false) → skip model, return existing
{
  const classifier = makeClassifier();
  const sb = makeSupabase({ microsites: [makeMicrosite(3)], initialLabels: [makeLabel(0), makeLabel(1), makeLabel(2)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: sb, classifier });
  check("nothing-to-do: 200", res.statusCode === 200);
  check("nothing-to-do: no model call", classifier.calls.length === 0, `calls=${classifier.calls.length}`);
  check("nothing-to-do: classified_count 0", res.body?.classified_count === 0);
  check("nothing-to-do: returns the 3 existing labels", res.body?.labels?.length === 3);
}

// 15. force=true re-classifies all non-corrected (even already-labeled)
{
  const classifier = makeClassifier();
  const sb = makeSupabase({ microsites: [makeMicrosite(3)], initialLabels: [makeLabel(0), makeLabel(1), makeLabel(2)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: true }, supabase: sb, classifier });
  check("force: 200", res.statusCode === 200);
  check("force: all 3 reclassified", res.body?.classified_count === 3, `got ${res.body?.classified_count}`);
}

// 16. agent_corrected NEVER reclassified and NEVER overwritten (force=true)
{
  const classifier = makeClassifier();
  // photo-0 is an agent correction with a hand-picked category that the
  // classifier would NOT produce (classifier would give categoryFromUrl).
  const corrected = makeLabel(0, { agent_corrected: true, category: "dining" });
  const sb = makeSupabase({ microsites: [makeMicrosite(3)], initialLabels: [corrected] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: true }, supabase: sb, classifier });
  check("corrected: 200", res.statusCode === 200);
  check("corrected: skipped count === 1", res.body?.skipped_agent_corrected_count === 1, `got ${res.body?.skipped_agent_corrected_count}`);
  const sentUrls = classifier.calls.flatMap((c) => c.imageUrls);
  check("corrected: photo-0 never sent to classifier", !sentUrls.includes(photoUrl(0)));
  check("corrected: only photo-1 + photo-2 classified", res.body?.classified_count === 2);
  // Upsert rows must not touch photo-0.
  const touchedCorrected = sb.__captured.upserts.flatMap((u) => u.rows).some((r) => r.photo_url === photoUrl(0));
  check("corrected: upsert never targets the corrected row", touchedCorrected === false);
  // Final label for photo-0 still the agent's category.
  const finalCorrected = res.body?.labels?.find((l) => l.photo_url === photoUrl(0));
  check("corrected: photo-0 still category 'dining'", finalCorrected?.category === "dining");
  check("corrected: photo-0 still agent_corrected true", finalCorrected?.agent_corrected === true);
}

// 17. Chunking + index→photo_url + global sort_order mapping (12 photos)
{
  const classifier = makeClassifier();
  const sb = makeSupabase({ microsites: [makeMicrosite(12)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: true }, supabase: sb, classifier });
  check("chunking: 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("chunking: 12 classified", res.body?.classified_count === 12, `got ${res.body?.classified_count}`);
  check("chunking: 2 chunks (10 + 2)", classifier.calls.length === 2, `calls=${classifier.calls.length}`);
  check("chunking: chunk0 has 10 urls", classifier.calls[0]?.imageUrls?.length === 10);
  check("chunking: chunk1 has 2 urls",  classifier.calls[1]?.imageUrls?.length === 2);
  const rows = sb.__captured.upserts.flatMap((u) => u.rows);
  // photo-11 lived at in-chunk index 1 of chunk 1, but must map to global sort_order 11.
  const r11 = rows.find((r) => r.photo_url === photoUrl(11));
  check("chunking: photo-11 sort_order === 11 (not chunk-relative)", r11?.sort_order === 11, `got ${r11?.sort_order}`);
  check("chunking: photo-11 category from its own url", r11?.category === categoryFromUrl(photoUrl(11)));
  const r10 = rows.find((r) => r.photo_url === photoUrl(10));
  check("chunking: photo-10 sort_order === 10", r10?.sort_order === 10, `got ${r10?.sort_order}`);
  const r0 = rows.find((r) => r.photo_url === photoUrl(0));
  check("chunking: photo-0 sort_order === 0", r0?.sort_order === 0);
  check("chunking: every photo mapped to its own category", rows.every((r) => r.category === categoryFromUrl(r.photo_url)));
}

// 18. Partial failure — some chunks fail → 200 + warnings + partial labels
{
  // 25 photos → 3 chunks [10,10,5]; fail the 2nd chunk (callIdx 1).
  const classifier = makeClassifier((opts, callIdx) => { if (callIdx === 1) throw new Error("simulated chunk failure"); });
  const sb = makeSupabase({ microsites: [makeMicrosite(25)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: true }, supabase: sb, classifier });
  check("partial: 200 despite one failed chunk", res.statusCode === 200, `got ${res.statusCode}`);
  check("partial: warnings present", Array.isArray(res.body?.warnings) && res.body.warnings.length >= 1);
  check("partial: warning mentions chunk 1", res.body.warnings.some((w) => /chunk 1/.test(w)));
  // chunks 0 (10) + 2 (5) succeeded = 15.
  check("partial: classified_count === 15 (10 + 5)", res.body?.classified_count === 15, `got ${res.body?.classified_count}`);
}

// 19. All chunks fail → 502
{
  const classifier = makeClassifier(() => { throw new Error("total failure"); });
  const sb = makeSupabase({ microsites: [makeMicrosite(5)] });
  const res = await callHandler({ body: { listing_id: LISTING_ID, force: true }, supabase: sb, classifier });
  check("all-fail: 502", res.statusCode === 502, `got ${res.statusCode}`);
  check("all-fail: error body 'classification failed'", res.body?.error === "classification failed");
  check("all-fail: details carried", res.body?.details !== undefined);
}

// 20. Existing-labels read error → 500
{
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: makeSupabase({ labelsErr: { message: "boom" } }) });
  check("labels read error → 500", res.statusCode === 500, `got ${res.statusCode}`);
}

// 21. Upsert error → 500
{
  const sb = makeSupabase({ microsites: [makeMicrosite(2)], upsertErr: { message: "upsert boom" } });
  const res = await callHandler({ body: { listing_id: LISTING_ID }, supabase: sb });
  check("upsert error → 500", res.statusCode === 500, `got ${res.statusCode}`);
}

console.log(`\n${passed} passed, ${failed} failed (mock mode)\n`);
if (failed > 0) process.exit(1);
