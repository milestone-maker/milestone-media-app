#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/_lib/bundle.js — the bundle.social adapter. Mocks fetch;
// uses no real key and makes no network call. Verifies base URL, x-api-key
// header, JSON body handling, error normalization, and the per-function
// response shaping (create-team / create-portal-link / by-type).
//
//   node scripts/test-bundle-helper.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MOD_PATH  = resolve(REPO_ROOT, "api", "_lib", "bundle.js");

const {
  bundleFetch,
  createTeam,
  createPortalLink,
  getSocialAccountByType,
  createUploadFromUrl,
  createPost,
  deletePost,
  BundleApiError,
} = await import(pathToFileURL(MOD_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// A fetch mock that records the last call and returns a canned response.
function makeFetch({ status = 200, json = {}, throwErr = null } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throwErr) throw throwErr;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      text: async () => (json === undefined ? "" : JSON.stringify(json)),
    };
  };
  fn.calls = calls;
  return fn;
}

const KEY = "test-key-not-real";

console.log("\n── api/_lib/bundle.js — bundle.social adapter ──\n");

// 1. bundleFetch — base URL + x-api-key header + GET (no body)
{
  const f = makeFetch({ json: { ok: true } });
  const out = await bundleFetch("/team/", { apiKey: KEY, fetchImpl: f });
  const { url, init } = f.calls[0];
  check("hits api.bundle.social/api/v1 base", url === "https://api.bundle.social/api/v1/team/", url);
  check("sends x-api-key header", init.headers["x-api-key"] === KEY);
  check("GET sends no body", init.body === undefined);
  check("parses JSON response", out?.ok === true);
}

// 2. bundleFetch — POST serializes JSON body + content-type
{
  const f = makeFetch({ status: 201, json: { id: "t_1" } });
  await bundleFetch("/team/", { method: "POST", body: { name: "Acme" }, apiKey: KEY, fetchImpl: f });
  const { init } = f.calls[0];
  check("POST sets Content-Type json", init.headers["Content-Type"] === "application/json");
  check("POST serializes body", init.body === JSON.stringify({ name: "Acme" }));
}

// 3. bundleFetch — missing key throws BundleApiError (no network)
{
  let err = null;
  try { await bundleFetch("/team/", { fetchImpl: makeFetch() }); } catch (e) { err = e; }
  check("missing key → BundleApiError", err instanceof BundleApiError, String(err));
  check("missing key error mentions BUNDLE_API_KEY", /BUNDLE_API_KEY/.test(err?.message || ""));
}

// 4. bundleFetch — non-OK response normalizes to BundleApiError w/ status+body
{
  const f = makeFetch({ status: 422, json: { message: "bad name" } });
  let err = null;
  try { await bundleFetch("/team/", { method: "POST", body: {}, apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("non-OK → BundleApiError", err instanceof BundleApiError);
  check("error carries status", err?.status === 422, `got ${err?.status}`);
  check("error message includes bundle message", /bad name/.test(err?.message || ""));
  check("error carries parsed body", err?.body?.message === "bad name");
}

// 5. bundleFetch — network throw normalizes to BundleApiError status 0
{
  const f = makeFetch({ throwErr: new Error("ECONNRESET") });
  let err = null;
  try { await bundleFetch("/team/", { apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("network error → BundleApiError status 0", err instanceof BundleApiError && err.status === 0);
}

// 6. createTeam — happy path returns team
{
  const f = makeFetch({ status: 201, json: { id: "team_abc", name: "Milestone — Sarah" } });
  const team = await createTeam({ name: "Milestone — Sarah", apiKey: KEY, fetchImpl: f });
  check("createTeam returns team id", team.id === "team_abc");
  check("createTeam POSTs to /team/", f.calls[0].url.endsWith("/team/") && f.calls[0].init.method === "POST");
}

// 7. createTeam — name < 3 chars throws before any fetch
{
  const f = makeFetch();
  let err = null;
  try { await createTeam({ name: "ab", apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("createTeam short name → throws", err instanceof BundleApiError);
  check("createTeam short name → no fetch made", f.calls.length === 0);
}

// 8. createTeam — name capped at 80 chars in the request body
{
  const f = makeFetch({ status: 201, json: { id: "team_x" } });
  const longName = "M".repeat(200);
  await createTeam({ name: longName, apiKey: KEY, fetchImpl: f });
  const sent = JSON.parse(f.calls[0].init.body);
  check("createTeam caps name at 80", sent.name.length === 80, `len=${sent.name.length}`);
}

// 9. createPortalLink — returns url, defaults to INSTAGRAM, includes redirectUrl
{
  const f = makeFetch({ json: { url: "https://portal.bundle.social/abc" } });
  const url = await createPortalLink({ teamId: "team_abc", redirectUrl: "https://app.example/?social=connected", apiKey: KEY, fetchImpl: f });
  check("createPortalLink returns url", url === "https://portal.bundle.social/abc");
  const sent = JSON.parse(f.calls[0].init.body);
  check("portal body defaults socialAccountTypes=[INSTAGRAM]", JSON.stringify(sent.socialAccountTypes) === JSON.stringify(["INSTAGRAM"]));
  check("portal body includes teamId", sent.teamId === "team_abc");
  check("portal body includes redirectUrl", sent.redirectUrl === "https://app.example/?social=connected");
  check("portal POSTs to create-portal-link", f.calls[0].url.endsWith("/social-account/create-portal-link"));
}

// 10. createPortalLink — missing teamId throws before fetch
{
  const f = makeFetch();
  let err = null;
  try { await createPortalLink({ apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("portal missing teamId → throws", err instanceof BundleApiError && f.calls.length === 0);
}

// 11. getSocialAccountByType — connected account returned
{
  const f = makeFetch({ json: { id: "sa_1", type: "INSTAGRAM", username: "sarah.sells" } });
  const acct = await getSocialAccountByType({ teamId: "team_abc", apiKey: KEY, fetchImpl: f });
  check("by-type returns account", acct?.username === "sarah.sells");
  check("by-type GET query has type+teamId", /type=INSTAGRAM&teamId=team_abc/.test(f.calls[0].url), f.calls[0].url);
}

// 12. getSocialAccountByType — empty/no id → null (not connected)
{
  const f = makeFetch({ json: null });
  const acct = await getSocialAccountByType({ teamId: "team_abc", apiKey: KEY, fetchImpl: f });
  check("by-type empty → null", acct === null);
}

// 13. getSocialAccountByType — 404 treated as null, not error
{
  const f = makeFetch({ status: 404, json: { message: "not found" } });
  const acct = await getSocialAccountByType({ teamId: "team_abc", apiKey: KEY, fetchImpl: f });
  check("by-type 404 → null (not throw)", acct === null);
}

// 14. getSocialAccountByType — non-404 error still throws
{
  const f = makeFetch({ status: 500, json: { message: "boom" } });
  let err = null;
  try { await getSocialAccountByType({ teamId: "team_abc", apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("by-type 500 → throws", err instanceof BundleApiError && err.status === 500);
}

// ── Posting helpers (Stage 2) ────────────────────────────────────────

// 15. createUploadFromUrl — POSTs url (+teamId) to /upload/from-url, returns upload
{
  const f = makeFetch({ status: 201, json: { id: "up_1", url: "https://cdn.bundle/up_1.jpg", type: "image" } });
  const up = await createUploadFromUrl({ teamId: "team_abc", url: "https://x.supabase.co/storage/v1/object/public/b/a.jpg", apiKey: KEY, fetchImpl: f });
  check("uploadFromUrl returns upload id", up.id === "up_1");
  check("uploadFromUrl POSTs to /upload/from-url", f.calls[0].url.endsWith("/upload/from-url") && f.calls[0].init.method === "POST");
  const sent = JSON.parse(f.calls[0].init.body);
  check("uploadFromUrl body has url", sent.url === "https://x.supabase.co/storage/v1/object/public/b/a.jpg");
  check("uploadFromUrl body has teamId", sent.teamId === "team_abc");
  check("uploadFromUrl sends x-api-key", f.calls[0].init.headers["x-api-key"] === KEY);
}

// 16. createUploadFromUrl — missing url throws before fetch
{
  const f = makeFetch();
  let err = null;
  try { await createUploadFromUrl({ teamId: "team_abc", apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("uploadFromUrl missing url → throws", err instanceof BundleApiError && f.calls.length === 0);
}

// 17. createUploadFromUrl — response without id → BundleApiError
{
  const f = makeFetch({ json: { url: "x" } });
  let err = null;
  try { await createUploadFromUrl({ teamId: "t", url: "https://x.supabase.co/storage/v1/object/public/b/a.jpg", apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("uploadFromUrl no id → throws", err instanceof BundleApiError && err.status === 502);
}

// 18. createPost — POSTs the full Instagram carousel body, returns post
{
  const f = makeFetch({ status: 201, json: { id: "post_1", status: "SCHEDULED" } });
  const post = await createPost({
    teamId: "team_abc",
    title: "Milestone carousel · 2026-06-09",
    postDate: "2026-06-09T12:00:00.000Z",
    status: "SCHEDULED",
    text: "Caption here\n\n#dallas #realestate",
    uploadIds: ["up_1", "up_2", "up_3"],
    apiKey: KEY, fetchImpl: f,
  });
  check("createPost returns post id", post.id === "post_1");
  check("createPost returns status", post.status === "SCHEDULED");
  check("createPost POSTs to /post/", f.calls[0].url.endsWith("/post/") && f.calls[0].init.method === "POST");
  const sent = JSON.parse(f.calls[0].init.body);
  check("createPost body teamId", sent.teamId === "team_abc");
  check("createPost body postDate passthrough", sent.postDate === "2026-06-09T12:00:00.000Z");
  check("createPost body status passthrough", sent.status === "SCHEDULED");
  check("createPost socialAccountTypes=[INSTAGRAM]", JSON.stringify(sent.socialAccountTypes) === JSON.stringify(["INSTAGRAM"]));
  check("createPost data.INSTAGRAM.type=POST", sent.data?.INSTAGRAM?.type === "POST");
  check("createPost data.INSTAGRAM.text passthrough", sent.data?.INSTAGRAM?.text === "Caption here\n\n#dallas #realestate");
  check("createPost data.INSTAGRAM.uploadIds in order", JSON.stringify(sent.data?.INSTAGRAM?.uploadIds) === JSON.stringify(["up_1", "up_2", "up_3"]));
}

// 19. createPost — status defaults to SCHEDULED when omitted
{
  const f = makeFetch({ status: 201, json: { id: "post_2" } });
  await createPost({ teamId: "t", title: "x", postDate: "2026-06-09T12:00:00.000Z", text: "x", uploadIds: ["u1"], apiKey: KEY, fetchImpl: f });
  const sent = JSON.parse(f.calls[0].init.body);
  check("createPost status defaults to SCHEDULED", sent.status === "SCHEDULED");
}

// 20. createPost — missing teamId / empty uploadIds throw before fetch
{
  const f1 = makeFetch();
  let e1 = null;
  try { await createPost({ title: "x", postDate: "d", text: "x", uploadIds: ["u1"], apiKey: KEY, fetchImpl: f1 }); } catch (e) { e1 = e; }
  check("createPost missing teamId → throws", e1 instanceof BundleApiError && f1.calls.length === 0);

  const f2 = makeFetch();
  let e2 = null;
  try { await createPost({ teamId: "t", title: "x", postDate: "d", text: "x", uploadIds: [], apiKey: KEY, fetchImpl: f2 }); } catch (e) { e2 = e; }
  check("createPost empty uploadIds → throws", e2 instanceof BundleApiError && f2.calls.length === 0);
}

// 21. deletePost — DELETEs /post/{id}, returns true, handles empty 204 body
{
  const f = makeFetch({ status: 204, json: undefined });
  const out = await deletePost({ postId: "bp_123", apiKey: KEY, fetchImpl: f });
  check("deletePost returns true on success", out === true);
  check("deletePost uses DELETE", f.calls[0].init.method === "DELETE");
  check("deletePost hits /post/{id}", f.calls[0].url.endsWith("/post/bp_123"), f.calls[0].url);
  check("deletePost sends x-api-key", f.calls[0].init.headers["x-api-key"] === KEY);
  check("deletePost (DELETE) sends no body", f.calls[0].init.body === undefined);
}

// 22. deletePost — missing postId throws before any fetch
{
  const f = makeFetch();
  let err = null;
  try { await deletePost({ apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("deletePost missing postId → throws", err instanceof BundleApiError && f.calls.length === 0);
}

// 23. deletePost — non-2xx surfaces a BundleApiError (string message)
{
  const f = makeFetch({ status: 404, json: { message: "not found" } });
  let err = null;
  try { await deletePost({ postId: "missing", apiKey: KEY, fetchImpl: f }); } catch (e) { err = e; }
  check("deletePost non-2xx → BundleApiError", err instanceof BundleApiError && err.status === 404);
  check("deletePost error message is a string", typeof err?.message === "string" && /not found/.test(err.message));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
