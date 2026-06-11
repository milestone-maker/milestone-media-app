#!/usr/bin/env node

// Fail loudly: any unhandled error in this test script must
// translate to a non-zero exit so CI catches it.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit tests for api/publish-microsite.js — Phase 2 hero resolution.
//
// All four scenarios from the Phase 2 design:
//   1. Hero resolution by heroMediaId → publishedUrlForId[id]
//   2. sort_order ASC NULLS LAST ordering (booking_media fetch)
//   3. Auto-fallback to publishedPhotos[0] when heroMediaId omitted
//   4. Back-compat for clients that omit heroMediaId AND publishedPhotos
//      is empty — heroImg URL string passes through
//
// No real Supabase, no real Storage. The handler's `supabase` dep is
// fully mocked via depsOverride-style injection — we can't inject
// directly because publish-microsite.js uses the module-level
// getServiceClient(), so this script uses a process-env strategy: we
// stub the @supabase/supabase-js createClient before importing the
// handler.
//
//   node scripts/test-publish-microsite.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..");

process.env.SUPABASE_URL              = "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder";

// ── Mock createClient ──────────────────────────────────────────────
// The publish handler calls createClient() at first request, then uses
// chained query builders. We replace the @supabase/supabase-js module in
// require.cache before the handler imports it.

// Mutable per-test mock state — each test resets via resetMock().
let mockState = {
  authUser:        { id: "agent-1" },
  agent:           { id: "agent-1", role: "agent", subscription_tier: "elite", subscription_status: "active", agency_name: "Bluebonnet Realty", agency_logo_url: "https://example.test/logo.png", profile_photo_url: "https://example.test/photo.png", full_name: "Dana Agent" },
  voiceProfile:    { brokerage_name: "Bluebonnet Brokerage" },
  booking:         { id: "booking-1", agent_id: "agent-1", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "5912 Velasco" },
  mediaRows:       [],
  storageBlobs:    {},          // { file_path → fake blob }
  publishedPath:   null,        // last destination uploaded to
  publishOrder:    [],          // list of file_paths in the order copied
  micrositeWrites: [],          // captured writes to microsites table
  liveCount:       0,           // agent's current LIVE-microsite count (cap query)
};

function resetMock(overrides = {}) {
  mockState = {
    authUser:        { id: "agent-1" },
    agent:           { id: "agent-1", role: "agent", subscription_tier: "elite", subscription_status: "active", agency_name: "Bluebonnet Realty", agency_logo_url: "https://example.test/logo.png", profile_photo_url: "https://example.test/photo.png", full_name: "Dana Agent" },
    voiceProfile:    { brokerage_name: "Bluebonnet Brokerage" },
    booking:         { id: "booking-1", agent_id: "agent-1", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "5912 Velasco" },
    mediaRows:       [],
    storageBlobs:    {},
    publishedPath:   null,
    publishOrder:    [],
    micrositeWrites: [],
    liveCount:       0,            // agent's current LIVE-microsite count (cap query)
    ...overrides,
  };
}

// Track booking_media .order() calls so we can verify the sort applied
let lastOrderArgs = [];

function makeFakeClient() {
  return {
    auth: { getUser: async (_token) => ({ data: { user: mockState.authUser }, error: null }) },
    from: (table) => {
      if (table === "agents") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: mockState.agent, error: null }) }),
          }),
        };
      }
      if (table === "agent_voice_profiles") {
        // Stage 6 white-label: handler reads brokerage_name to snapshot it.
        // Chain: select → eq → limit → maybeSingle.
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: mockState.voiceProfile, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "bookings") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: mockState.booking, error: null }) }),
          }),
        };
      }
      if (table === "booking_media") {
        // Capture .order() args so we can assert what the handler asked for
        const builder = {
          _orderCalls: [],
          select: () => builder,
          eq: () => builder,
          order: (col, opts) => {
            builder._orderCalls.push({ col, opts });
            lastOrderArgs = builder._orderCalls;
            // Last .order() in the chain returns awaitable
            return new Proxy(Promise.resolve({ data: mockState.mediaRows, error: null }), {
              get(target, prop) {
                if (prop === "order") return builder.order;
                return target[prop]?.bind ? target[prop].bind(target) : target[prop];
              },
            });
          },
        };
        return builder;
      }
      if (table === "microsites") {
        const captured = mockState.micrositeWrites;
        const existing = mockState.existingMicrosite ?? null;
        // Two SELECT shapes hit this table:
        //   • step 4b existing-microsite-by-booking: select→eq→eq→limit→maybeSingle
        //   • step 9 existing-by-slug write check:    select→eq→eq→maybeSingle
        // Both terminate in maybeSingle and return the same existing row (or
        // null). Default null preserves the insert-path hero scenarios.
        const terminal = {
          maybeSingle: async () => ({ data: existing, error: null }),
          limit: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }),
          // step 5b live-microsite cap count: select("id",{count,head})→eq(agent)
          // →eq(published)→is(retired_at,null), awaited as { count, error }.
          is: async () => ({ count: mockState.liveCount ?? 0, error: null }),
        };
        return {
          select: () => ({ eq: () => ({ eq: () => terminal }) }),
          insert: (row) => {
            captured.push({ op: "insert", row });
            return {
              select: () => ({
                single: async () => ({ data: { id: "ms-1", ...row }, error: null }),
              }),
            };
          },
          update: (row) => {
            captured.push({ op: "update", row });
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: "ms-1", ...row }, error: null }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected from(${table})`);
    },
    storage: {
      from: (bucket) => {
        if (bucket === "booking-media") {
          return {
            download: async (path) => {
              const blob = mockState.storageBlobs[path];
              if (!blob) return { data: null, error: new Error("not found") };
              return { data: blob, error: null };
            },
          };
        }
        if (bucket === "published-media") {
          return {
            upload: async (dest, _blob, _opts) => {
              mockState.publishOrder.push(dest);
              mockState.publishedPath = dest;
              return { error: null };
            },
            getPublicUrl: (dest) => ({ data: { publicUrl: `https://example.test/published-media/${dest}` } }),
          };
        }
        throw new Error(`Unexpected storage.from(${bucket})`);
      },
    },
  };
}

// Import the handler — it accepts a 3rd `depsOverride` arg for tests
// (the same pattern create-booking.js uses). We pass a fake supabase
// per call so the real @supabase/supabase-js never gets exercised.
const handlerMod = await import(pathToFileURL(resolve(REPO_ROOT, "api", "publish-microsite.js")).href);
const rawHandler = handlerMod.default;
const handler = (req, res) => rawHandler(req, res, { supabase: makeFakeClient() });

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (c, h) => { res.statusCode = c; if (h) Object.assign(res.headers, h); };
  res.end = () => {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeReq(body) {
  return {
    method:  "POST",
    headers: { authorization: "Bearer fake-token" },
    body,
  };
}

// Fake blob factory — the handler does `blob.type` so we need a .type
function fakeBlob(type = "image/jpeg") {
  return { type, fake: true };
}

const BASE_PROPERTY_DATA = {
  address: "5912 Velasco", city: "Dallas", price: "$875,000",
  beds: 4, baths: 3, sqft: "2,850",
  description: "Restored Tudor",
  features: ["a", "b"],
  mediaTypes: ["Photos"],
  agentName: "Sarah", agentPhone: "555", agentEmail: "s@x.com",
  listingId: "listing-1",
  matterportUrl: "", videoUrl: "", floorplanUrl: null,
};

// ── Scenario 1 — Hero resolution by heroMediaId ──────────────────────
{
  console.log("\n── Scenario 1: hero by heroMediaId resolves to published URL ──\n");
  const photo1Path = `booking-1/photo-uno.jpg`;
  const photo2Path = `booking-1/photo-dos.jpg`;
  const photo3Path = `booking-1/photo-tres.jpg`;
  resetMock({
    mediaRows: [
      { id: "media-A", booking_id: "booking-1", file_type: "photo", file_path: photo1Path, sort_order: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: "media-B", booking_id: "booking-1", file_type: "photo", file_path: photo2Path, sort_order: 1, created_at: "2026-01-02T00:00:00Z" },
      { id: "media-C", booking_id: "booking-1", file_type: "photo", file_path: photo3Path, sort_order: 2, created_at: "2026-01-03T00:00:00Z" },
    ],
    storageBlobs: { [photo1Path]: fakeBlob(), [photo2Path]: fakeBlob(), [photo3Path]: fakeBlob() },
  });

  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "5912-velasco-deadbeef",
    propertyData: { ...BASE_PROPERTY_DATA, heroMediaId: "media-B" },
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const write = mockState.micrositeWrites[0];
  const pd = write?.row?.property_data;
  check("write captured",                       !!write);
  check("hero_img is media-B's published URL",  pd?.hero_img === "https://example.test/published-media/5912-velasco-deadbeef/photo-dos.jpg");
  check("hero_media_id === 'media-B'",          pd?.hero_media_id === "media-B");
  check("gallery_photos has 3 URLs",            Array.isArray(pd?.gallery_photos) && pd.gallery_photos.length === 3);
}

// ── Scenario 2 — sort_order ASC ordering applied ────────────────────
{
  console.log("\n── Scenario 2: booking_media ordered by sort_order ASC NULLS LAST then created_at ASC ──\n");
  // After Scenario 1 the lastOrderArgs already captured the call. Assert.
  check("first order call: sort_order ascending, NULLS LAST",
    lastOrderArgs[0]?.col === "sort_order" && lastOrderArgs[0]?.opts?.ascending === true && lastOrderArgs[0]?.opts?.nullsFirst === false);
  check("second order call: created_at ascending tiebreaker",
    lastOrderArgs[1]?.col === "created_at" && lastOrderArgs[1]?.opts?.ascending === true);
}

// ── Scenario 3 — Auto-fallback to publishedPhotos[0] ────────────────
{
  console.log("\n── Scenario 3: heroMediaId absent → publishedPhotos[0] auto-fallback (first by sort_order) ──\n");
  const photo1Path = `booking-1/photo-uno.jpg`;
  const photo2Path = `booking-1/photo-dos.jpg`;
  resetMock({
    mediaRows: [
      // sort_order=0 first → media-A is "first" → its URL must become hero
      { id: "media-A", booking_id: "booking-1", file_type: "photo", file_path: photo1Path, sort_order: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: "media-B", booking_id: "booking-1", file_type: "photo", file_path: photo2Path, sort_order: 1, created_at: "2026-01-02T00:00:00Z" },
    ],
    storageBlobs: { [photo1Path]: fakeBlob(), [photo2Path]: fakeBlob() },
  });

  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "auto-default",
    propertyData: { ...BASE_PROPERTY_DATA },  // no heroMediaId
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const pd = mockState.micrositeWrites[0]?.row?.property_data;
  check("hero_img defaults to first photo (sort_order=0)",
    pd?.hero_img === "https://example.test/published-media/auto-default/photo-uno.jpg");
  check("hero_media_id back-resolved to 'media-A'",
    pd?.hero_media_id === "media-A");
}

// ── Scenario 4 — Back-compat: heroMediaId absent + UNKNOWN media id passed ─
{
  console.log("\n── Scenario 4: back-compat — unknown heroMediaId silently falls through to auto ──\n");
  const photo1Path = `booking-1/only.jpg`;
  resetMock({
    mediaRows: [
      { id: "media-X", booking_id: "booking-1", file_type: "photo", file_path: photo1Path, sort_order: 0, created_at: "2026-01-01T00:00:00Z" },
    ],
    storageBlobs: { [photo1Path]: fakeBlob() },
  });

  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "compat",
    propertyData: { ...BASE_PROPERTY_DATA, heroMediaId: "media-NONEXISTENT", heroImg: "https://legacy/url.jpg" },
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const pd = mockState.micrositeWrites[0]?.row?.property_data;
  // Unknown heroMediaId is not in publishedUrlForId, so falls to publishedPhotos[0]
  check("falls to publishedPhotos[0] when heroMediaId unknown",
    pd?.hero_img === "https://example.test/published-media/compat/only.jpg");
  check("hero_media_id back-resolved to 'media-X' (not the unknown one)",
    pd?.hero_media_id === "media-X");
}

// ── Scenario 4b — Truly no media: legacy heroImg passes through ─────
{
  console.log("\n── Scenario 4b: no media at all → legacy heroImg passes through ──\n");
  resetMock({
    mediaRows:    [],
    storageBlobs: {},
  });

  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "no-media",
    propertyData: { ...BASE_PROPERTY_DATA, heroImg: "https://legacy/url.jpg" },
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const pd = mockState.micrositeWrites[0]?.row?.property_data;
  check("hero_img falls all the way through to legacy heroImg",
    pd?.hero_img === "https://legacy/url.jpg");
  check("hero_media_id is empty string when no media",
    pd?.hero_media_id === "");
}

// ── Scenario 5 — Skip-on-download-failure still produces sane map ───
{
  console.log("\n── Scenario 5: failed downloads skipped, surviving id wins ──\n");
  const okPath  = `booking-1/ok.jpg`;
  const badPath = `booking-1/bad.jpg`;
  resetMock({
    mediaRows: [
      { id: "media-OK",  booking_id: "booking-1", file_type: "photo", file_path: okPath,  sort_order: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: "media-BAD", booking_id: "booking-1", file_type: "photo", file_path: badPath, sort_order: 1, created_at: "2026-01-02T00:00:00Z" },
    ],
    storageBlobs: { [okPath]: fakeBlob() },  // bad path absent → download error → skip
  });

  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "skip",
    propertyData: { ...BASE_PROPERTY_DATA, heroMediaId: "media-BAD" },
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const pd = mockState.micrositeWrites[0]?.row?.property_data;
  // heroMediaId=media-BAD has no published URL → falls back to publishedPhotos[0] = media-OK's URL
  check("requested hero failed to publish → falls back to first surviving photo",
    pd?.hero_img === "https://example.test/published-media/skip/ok.jpg");
  check("hero_media_id reflects the actually-published file",
    pd?.hero_media_id === "media-OK");
  check("gallery_photos has only the surviving 1 photo",
    Array.isArray(pd?.gallery_photos) && pd.gallery_photos.length === 1);
}

// ── Scenario 6 — Stage 6 white-label: branding snapshotted into property_data
{
  console.log("\n── Scenario 6: agency branding + brokerage_name snapshot into property_data ──\n");
  resetMock();
  const req = makeReq({
    bookingId: "booking-1",
    theme:     "Prestige",
    slug:      "5912-velasco-deadbeef",
    propertyData: { ...BASE_PROPERTY_DATA },
  });
  const res = makeRes();
  await handler(req, res);

  check("status 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
  const pd = mockState.micrositeWrites[0]?.row?.property_data;
  check("agency_name snapshotted",       pd?.agency_name === "Bluebonnet Realty");
  check("agency_logo_url snapshotted",   pd?.agency_logo_url === "https://example.test/logo.png");
  check("profile_photo_url snapshotted", pd?.profile_photo_url === "https://example.test/photo.png");
  check("brokerage_name snapshotted",    pd?.brokerage_name === "Bluebonnet Brokerage");

  // Empty-branding agent → keys present but "" (fallback path, never undefined)
  resetMock({
    agent:        { id: "agent-1", role: "agent", subscription_tier: "elite", subscription_status: "active" },
    voiceProfile: null,
  });
  const req2 = makeReq({
    bookingId: "booking-1", theme: "Prestige", slug: "5912-velasco-deadbeef",
    propertyData: { ...BASE_PROPERTY_DATA },
  });
  const res2 = makeRes();
  await handler(req2, res2);
  const pd2 = mockState.micrositeWrites[0]?.row?.property_data;
  check("status 200 (empty branding)",   res2.statusCode === 200, `got ${res2.statusCode}`);
  check("agency_name === '' when absent", pd2?.agency_name === "");
  check("brokerage_name === '' when absent", pd2?.brokerage_name === "");
}

// ── Scenario 5 — Entitlement gate: beta / existing / ownership ──────
{
  console.log("\n── Scenario 5: entitlement gate (beta, existing-microsite, cross-owner) ──\n");

  // 5a. Beta agent, NON-microsite booking (signature, no addons, UNPAID),
  //     no subscription → still publishes (beta path 2).
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: true, subscription_tier: null, subscription_status: null },
    booking: { id: "booking-1", agent_id: "agent-1", invoice_paid: false, selected_package: "signature", selected_addons: [], address: "5912 Velasco" },
    voiceProfile: null,
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "beta-slug", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("beta agent publishes unpaid non-microsite booking → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("beta publish wrote a microsite row", mockState.micrositeWrites.length === 1);
  }

  // 5b. Existing owned microsite for the booking, Starter tier, UNPAID
  //     signature booking → publishes (existing path 3), via UPDATE.
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: false, subscription_tier: "starter", subscription_status: "active" },
    booking: { id: "booking-1", agent_id: "agent-1", invoice_paid: false, selected_package: "signature", selected_addons: [], address: "5912 Velasco" },
    existingMicrosite: { id: "ms-1", agent_id: "agent-1" },
    voiceProfile: null,
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "existing-slug", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("existing-microsite owner re-publishes unpaid Starter booking → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("re-publish used UPDATE (existing row found)", mockState.micrositeWrites[0]?.op === "update");
  }

  // 5c. Non-owner: booking belongs to agent-2, caller is agent-1 (no beta,
  //     no sub, no existing) → 403 ownership.
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: false, subscription_tier: null, subscription_status: null },
    booking: { id: "booking-1", agent_id: "agent-2", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "Someone Else Rd" },
    voiceProfile: null,
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "stolen-slug", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("cross-owner publish → 403", res.statusCode === 403, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("cross-owner publish wrote nothing", mockState.micrositeWrites.length === 0);
    check("403 reason mentions ownership", /does not belong to you/i.test(res.body?.error || ""), res.body?.error);
  }
}

// ── Scenario 6 — per-tier live-microsite cap (NEW-create only) ───────
{
  console.log("\n── Scenario 6: live-microsite cap gates NEW publishes only ──\n");

  // 6a. NEW publish AT cap (Solo/starter cap 4, already 4 live) → 403, no write.
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: false, subscription_tier: "starter", subscription_status: "active" },
    booking: { id: "booking-1", agent_id: "agent-1", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "5912 Velasco" },
    voiceProfile: null,
    liveCount: 4,                 // at the Solo cap
    existingMicrosite: null,      // brand-new create
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "cap-5th", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("new publish at cap → 403", res.statusCode === 403, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("at cap wrote nothing", mockState.micrositeWrites.length === 0);
    check("403 message names the cap + retire guidance", /used your 4 live microsites.*retire one/i.test(res.body?.error || ""), res.body?.error);
  }

  // 6b. NEW publish UNDER cap (3 of 4 live) → proceeds (insert happens).
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: false, subscription_tier: "starter", subscription_status: "active" },
    booking: { id: "booking-1", agent_id: "agent-1", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "5912 Velasco" },
    voiceProfile: null,
    liveCount: 3,                 // under the Solo cap
    existingMicrosite: null,
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "cap-4th", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("new publish under cap → 200", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("under cap inserted a row", mockState.micrositeWrites[0]?.op === "insert");
  }

  // 6c. RE-PUBLISH of an existing owned microsite while OVER cap → proceeds.
  //     existingMicrosite present → cap skipped entirely; endpoint UPDATEs.
  resetMock({
    agent:   { id: "agent-1", role: "agent", is_beta: false, subscription_tier: "starter", subscription_status: "active" },
    booking: { id: "booking-1", agent_id: "agent-1", invoice_paid: true, selected_package: "luxury", selected_addons: [], address: "5912 Velasco" },
    voiceProfile: null,
    liveCount: 99,                // way over cap — must NOT matter for re-publish
    existingMicrosite: { id: "ms-1", agent_id: "agent-1" },
  });
  {
    const res = makeRes();
    await handler(makeReq({ bookingId: "booking-1", theme: "Prestige", slug: "existing-slug", propertyData: { ...BASE_PROPERTY_DATA } }), res);
    check("re-publish over cap → 200 (cap exempt)", res.statusCode === 200, `got ${res.statusCode} ${JSON.stringify(res.body)}`);
    check("re-publish over cap used UPDATE", mockState.micrositeWrites[0]?.op === "update");
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
