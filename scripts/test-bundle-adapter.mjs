#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/_lib/bundle.js platform generalization (Facebook Stage 1):
//   • platformToBundleType maps app slugs → bundle account types and throws on
//     unknown slugs.
//   • createPortalLink translates `platforms` slugs → socialAccountTypes in the
//     request body, and keeps the Instagram default when neither `platforms`
//     nor `socialAccountTypes` is supplied (back-compat).
// fetch is stubbed via the fetchImpl seam — no network, no key.
//
//   node scripts/test-bundle-adapter.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT    = resolve(__dirname, "..");
const MOD_PATH     = resolve(REPO_ROOT, "api", "_lib", "bundle.js");

const { platformToBundleType, PLATFORM_TO_BUNDLE_TYPE, createPortalLink } =
  await import(pathToFileURL(MOD_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// Stub fetch: capture the request body and return a portal url.
function makeFetchStub({ url = "https://portal.bundle.social/abc" } = {}) {
  const calls = { count: 0, lastBody: null };
  const fetchImpl = async (_url, init) => {
    calls.count++;
    calls.lastBody = init?.body ? JSON.parse(init.body) : null;
    return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ url }) };
  };
  return { calls, fetchImpl };
}

console.log("\n── api/_lib/bundle.js — platform generalization ──\n");

// 1. platformToBundleType mapping
{
  check("instagram → INSTAGRAM", platformToBundleType("instagram") === "INSTAGRAM");
  check("facebook → FACEBOOK", platformToBundleType("facebook") === "FACEBOOK");
  check("threads → THREADS", platformToBundleType("threads") === "THREADS");
  check("case-insensitive (FaceBook)", platformToBundleType("FaceBook") === "FACEBOOK");
  check("map export covers 3 platforms", Object.keys(PLATFORM_TO_BUNDLE_TYPE).length === 3);
  let threw = false;
  try { platformToBundleType("tiktok"); } catch { threw = true; }
  check("unknown slug throws", threw);
}

// 2. createPortalLink translates `platforms` → socialAccountTypes
{
  const stub = makeFetchStub();
  const url = await createPortalLink({ teamId: "t1", platforms: ["facebook"], apiKey: "k", fetchImpl: stub.fetchImpl });
  check("returns portal url", url === "https://portal.bundle.social/abc");
  check("body teamId", stub.calls.lastBody?.teamId === "t1");
  check("facebook → socialAccountTypes [FACEBOOK]", JSON.stringify(stub.calls.lastBody?.socialAccountTypes) === JSON.stringify(["FACEBOOK"]));
}

// 3. createPortalLink default stays INSTAGRAM (back-compat: no platforms/types)
{
  const stub = makeFetchStub();
  await createPortalLink({ teamId: "t1", apiKey: "k", fetchImpl: stub.fetchImpl });
  check("default → socialAccountTypes [INSTAGRAM]", JSON.stringify(stub.calls.lastBody?.socialAccountTypes) === JSON.stringify(["INSTAGRAM"]));
}

// 4. createPortalLink still honours explicit socialAccountTypes when no platforms
{
  const stub = makeFetchStub();
  await createPortalLink({ teamId: "t1", socialAccountTypes: ["INSTAGRAM"], apiKey: "k", fetchImpl: stub.fetchImpl });
  check("explicit socialAccountTypes honoured", JSON.stringify(stub.calls.lastBody?.socialAccountTypes) === JSON.stringify(["INSTAGRAM"]));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
