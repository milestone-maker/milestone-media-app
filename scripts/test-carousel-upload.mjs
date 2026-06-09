#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for src/views/Content/carouselUpload.js — compose-and-store
// (Stage 2b). Mocks composeCarousel + the supabase storage client via the deps
// seam; no real canvas, no network. Verifies compose invocation, per-blob
// upload path/contentType/upsert, ordered public URLs, and clean failure (no
// partial result).
//
//   node scripts/test-carousel-upload.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MOD_PATH  = resolve(REPO_ROOT, "src", "views", "Content", "carouselUpload.js");

const { composeAndUploadCarousel, CAROUSEL_BUCKET } = await import(pathToFileURL(MOD_PATH).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const AGENT_ID   = "00000000-0000-0000-0000-000000000a01";
const CONTENT_ID = "00000000-0000-0000-0000-000000000d01";

// Ordered composed files (interleaved card PNG / photo JPEG, like the real one).
const FILES = [
  { name: "01_card.png",  blob: { type: "image/png"  } },
  { name: "02_photo.jpg", blob: { type: "image/jpeg" } },
  { name: "03_card.png",  blob: { type: "image/png"  } },
  { name: "04_photo.jpg", blob: { type: "image/jpeg" } },
];

function makeComposeMock(files = FILES) {
  const calls = [];
  const fn = async (args) => { calls.push(args); return files; };
  fn.calls = calls;
  return fn;
}

// supabase storage mock. uploadErr/noPublicUrl can be a function (path)->value
// to fail a specific item, or a constant.
function makeSupabaseMock({ uploadErr = null, noPublicUrl = false } = {}) {
  const calls = { uploads: [], publicUrls: [] };
  const resolveFlag = (flag, path) => (typeof flag === "function" ? flag(path) : flag);
  const sb = {
    storage: {
      from: (bucket) => ({
        upload: async (path, blob, opts) => {
          calls.uploads.push({ bucket, path, blob, contentType: opts?.contentType, upsert: opts?.upsert });
          const err = resolveFlag(uploadErr, path);
          return { error: err ? (err === true ? { message: "boom" } : err) : null };
        },
        getPublicUrl: (path) => {
          calls.publicUrls.push({ bucket, path });
          if (resolveFlag(noPublicUrl, path)) return { data: {} };
          return { data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
        },
      }),
    },
  };
  return { sb, calls };
}

const BASE_ARGS = {
  slides: [{ is_cover: true, statement: "x" }, { subject: "final", statement: "y" }],
  stats: { beds: 4 }, footer: { contact: "c" }, brandTokens: { accentColor: "#C9A84C" },
  agentId: AGENT_ID, contentId: CONTENT_ID,
};

console.log("\n── src/views/Content/carouselUpload.js — compose-and-store ──\n");

// 1. HAPPY PATH
{
  const compose = makeComposeMock();
  const { sb, calls } = makeSupabaseMock();
  const urls = await composeAndUploadCarousel(BASE_ARGS, { composeCarousel: compose, supabase: sb });

  check("bucket constant is carousel-posts", CAROUSEL_BUCKET === "carousel-posts");
  check("composeCarousel invoked once", compose.calls.length === 1);
  check("composeCarousel got slides/stats/footer/brandTokens", (() => {
    const a = compose.calls[0];
    return a.slides === BASE_ARGS.slides && a.stats === BASE_ARGS.stats && a.footer === BASE_ARGS.footer && a.brandTokens === BASE_ARGS.brandTokens;
  })());
  check("one upload per composed file", calls.uploads.length === FILES.length);
  check("all uploads to carousel-posts bucket", calls.uploads.every((u) => u.bucket === "carousel-posts"));
  check("upload paths = agentId/contentId/name", calls.uploads.every((u, i) => u.path === `${AGENT_ID}/${CONTENT_ID}/${FILES[i].name}`));
  check("contentType from blob.type", calls.uploads.map((u) => u.contentType).join(",") === "image/png,image/jpeg,image/png,image/jpeg");
  check("upsert:true on every upload", calls.uploads.every((u) => u.upsert === true));
  check("returns one URL per slide", urls.length === FILES.length);
  check("URLs preserve slide order", urls.every((u, i) => u.endsWith(`${AGENT_ID}/${CONTENT_ID}/${FILES[i].name}`)));
  check("URLs are public-storage URLs", urls.every((u) => u.includes("/storage/v1/object/public/carousel-posts/")));
}

// 2. Missing agentId → throws BEFORE compose
{
  const compose = makeComposeMock();
  const { sb } = makeSupabaseMock();
  let err = null;
  try { await composeAndUploadCarousel({ ...BASE_ARGS, agentId: undefined }, { composeCarousel: compose, supabase: sb }); } catch (e) { err = e; }
  check("missing agentId → throws", !!err && /agentId/.test(err.message));
  check("missing agentId → compose NOT called", compose.calls.length === 0);
}

// 3. Missing contentId → throws before compose
{
  const compose = makeComposeMock();
  const { sb } = makeSupabaseMock();
  let err = null;
  try { await composeAndUploadCarousel({ ...BASE_ARGS, contentId: undefined }, { composeCarousel: compose, supabase: sb }); } catch (e) { err = e; }
  check("missing contentId → throws", !!err && /contentId/.test(err.message));
  check("missing contentId → compose NOT called", compose.calls.length === 0);
}

// 4. Nothing composed → throws
{
  const compose = makeComposeMock([]);
  const { sb, calls } = makeSupabaseMock();
  let err = null;
  try { await composeAndUploadCarousel(BASE_ARGS, { composeCarousel: compose, supabase: sb }); } catch (e) { err = e; }
  check("empty compose result → throws", !!err && /Nothing to upload/.test(err.message));
  check("empty compose → no uploads attempted", calls.uploads.length === 0);
}

// 5. Upload failure on the 2nd file → throws, NO partial array returned
{
  const compose = makeComposeMock();
  const failSecond = (path) => path.endsWith("02_photo.jpg");
  const { sb, calls } = makeSupabaseMock({ uploadErr: failSecond });
  let err = null, result = null;
  try { result = await composeAndUploadCarousel(BASE_ARGS, { composeCarousel: compose, supabase: sb }); } catch (e) { err = e; }
  check("upload failure → throws", !!err && /Failed to upload carousel image 02_photo.jpg/.test(err.message), err?.message);
  check("upload failure → no value returned (no partial)", result === null);
  check("upload failure → stops at the failing file (no 3rd upload)", calls.uploads.length === 2);
}

// 6. Missing public URL → throws
{
  const compose = makeComposeMock();
  const { sb } = makeSupabaseMock({ noPublicUrl: (path) => path.endsWith("01_card.png") });
  let err = null;
  try { await composeAndUploadCarousel(BASE_ARGS, { composeCarousel: compose, supabase: sb }); } catch (e) { err = e; }
  check("missing public URL → throws", !!err && /public URL/.test(err.message));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
