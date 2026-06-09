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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
