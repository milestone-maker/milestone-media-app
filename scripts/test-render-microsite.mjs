#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/render-microsite.js — the SEO server-render pure builders.
// No DB, no env, no network: imports the module (supabase client is created
// lazily, so import is safe) and exercises the pure builders against real-shaped
// property_data fixtures pulled from the four live microsites. Verifies title +
// description length/composition, head injection (canonical/OG/Twitter), JSON-LD
// validity + numeric coercion + optional-field omission, crawlable body, HTML
// escaping of agent-entered text, and the not-found (noindex) path.
//
//   node scripts/test-render-microsite.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MOD_PATH  = resolve(REPO_ROOT, "api", "render-microsite.js");

const { buildTitle, buildDescription, buildJsonLd, renderFound, renderNotFound } =
  await import(pathToFileURL(MOD_PATH).href);

const { PUBLIC_APP_BASE } = await import(
  pathToFileURL(resolve(REPO_ROOT, "api", "_lib", "microsite.js")).href
);

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

// A minimal but faithful stand-in for the built dist/index.html shell.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Milestone Media & Photography</title>
    <meta name="description" content="Premium real estate media for Dallas-Fort Worth agents." />
    <script type="module" crossorigin src="/assets/index-BSyA2rAb.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>/* sw */</script>
  </body>
</html>`;

// ── Fixtures mirroring the four live rows ────────────────────────────────────
// Full row with coords + schools + features (2410-luxury), price with commas.
const FULL = {
  address: "2410 Luxury Lane",
  city: "Dallas",
  price: "1,500,450",
  beds: "5",
  baths: "4",
  sqft: "3800",
  description: "  A stunning   estate with    soaring ceilings.  ",
  features: ["Open Floor PLan", " Chef's Kitchen ", ""],
  hero_img: "https://cbpnjuotoxtmefmedpmj.supabase.co/storage/v1/object/public/published-media/hero.jpg",
  gallery_photos: [
    "https://cbpnjuotoxtmefmedpmj.supabase.co/storage/v1/object/public/published-media/a.jpg",
    "https://cbpnjuotoxtmefmedpmj.supabase.co/storage/v1/object/public/published-media/hero.jpg", // dup of hero → skipped
  ],
  schools: [
    { distance_mi: 0.4, level: "elementary", name: "Whitney M Young Jr El", type: "public" },
  ],
  coordinates: { lat: 32.701495386903, lng: -96.784203772965 },
};

// Sparse row: no coords, empty schools/features arrays, rental-style price.
const SPARSE = {
  address: "4941 Shores Dr",
  city: "Frisco",
  price: "$3000 month",
  beds: "4",
  baths: "",
  sqft: "2415",
  description: "",
  features: [],
  hero_img: "",
  gallery_photos: [],
  schools: [],
  coordinates: null,
};

// Hostile row: agent-entered markup that must be escaped, never executed.
const XSS = {
  address: `<script>alert(1)</script> & "Quotes"`,
  city: "Dallas",
  price: "750000",
  beds: "4",
  baths: "3",
  sqft: "3840",
  description: `</title><img src=x onerror=alert(2)>`,
  features: [`<b>bold</b>`],
  hero_img: "https://cbpnjuotoxtmefmedpmj.supabase.co/storage/v1/object/public/published-media/x.jpg",
  gallery_photos: [],
};

// ── Title ────────────────────────────────────────────────────────────────────
const fullTitle = buildTitle(FULL);
check("title: contains address", fullTitle.includes("2410 Luxury Lane"), fullTitle);
check("title: contains beds/baths spec", /5 Bed \/ 4 Bath/.test(fullTitle), fullTitle);
check("title: ≤65 chars", fullTitle.length <= 65, `len=${fullTitle.length}`);
const longTitle = buildTitle({ address: "1234 Very Long Boulevard Of Broken Dreams Estates", city: "Far North Dallas Metro", beds: "5", baths: "4" });
check("title: long input clamped to ≤65", longTitle.length <= 65, `len=${longTitle.length}`);
const noSpecTitle = buildTitle({ address: "10 Main St", city: "Plano" });
check("title: degrades w/o beds/baths", noSpecTitle === "10 Main St, Plano", noSpecTitle);
const emptyTitle = buildTitle({});
check("title: empty pd → fallback", emptyTitle.length > 0 && emptyTitle.length <= 65, emptyTitle);

// ── Description ──────────────────────────────────────────────────────────────
const fullDesc = buildDescription(FULL);
check("desc: ≤160 chars", fullDesc.length <= 160, `len=${fullDesc.length}`);
check("desc: collapses whitespace (no double space)", !/\s{2,}/.test(fullDesc), fullDesc);
check("desc: includes specs", /5 bed/.test(fullDesc) && /3800 sqft/.test(fullDesc), fullDesc);
const emptyDesc = buildDescription({});
check("desc: empty pd → non-empty fallback", emptyDesc.length > 0, emptyDesc);

// ── JSON-LD ──────────────────────────────────────────────────────────────────
const canonical = `${PUBLIC_APP_BASE}/p/2410-luxury`;
const fullLdRaw = buildJsonLd(FULL, "2410-luxury", canonical, [FULL.hero_img]);
let fullLd;
try { fullLd = JSON.parse(fullLdRaw); } catch (e) { fullLd = null; }
check("jsonld: parses as JSON", fullLd !== null, fullLdRaw.slice(0, 80));
if (fullLd) {
  check("jsonld: @type RealEstateListing", fullLd["@type"] === "RealEstateListing");
  check("jsonld: url = canonical", fullLd.url === canonical, fullLd.url);
  check("jsonld: price coerced to number (commas stripped)", fullLd.offers?.price === 1500450, JSON.stringify(fullLd.offers));
  check("jsonld: priceCurrency USD", fullLd.offers?.priceCurrency === "USD");
  check("jsonld: numberOfBedrooms numeric", fullLd.numberOfBedrooms === 5);
  check("jsonld: floorSize numeric", fullLd.floorSize?.value === 3800);
  check("jsonld: geo present when coords present", fullLd.geo?.latitude === 32.701495386903, JSON.stringify(fullLd.geo));
  check("jsonld: image array hero-first", Array.isArray(fullLd.image) && fullLd.image[0] === FULL.hero_img);
  check("jsonld: address PostalAddress", fullLd.address?.["@type"] === "PostalAddress" && fullLd.address.addressLocality === "Dallas");
}

const sparseLdRaw = buildJsonLd(SPARSE, "4941-shores", `${PUBLIC_APP_BASE}/p/4941-shores`, []);
let sparseLd;
try { sparseLd = JSON.parse(sparseLdRaw); } catch (e) { sparseLd = null; }
check("jsonld(sparse): parses", sparseLd !== null);
if (sparseLd) {
  check("jsonld(sparse): geo omitted when no coords", sparseLd.geo === undefined);
  check("jsonld(sparse): image omitted when empty", sparseLd.image === undefined);
  check("jsonld(sparse): rental price → 3000 number", sparseLd.offers?.price === 3000, JSON.stringify(sparseLd.offers));
  check("jsonld(sparse): no postalCode when absent", sparseLd.address?.postalCode === undefined);
}

// ── renderFound full assembly ────────────────────────────────────────────────
const fullHtml = renderFound(TEMPLATE, FULL, "2410-luxury");
check("render: generic title replaced", !fullHtml.includes("<title>Milestone Media & Photography</title>"), "still generic");
check("render: per-listing title present", /<title>2410 Luxury Lane[^<]*<\/title>/.test(fullHtml));
check("render: generic meta description replaced", !fullHtml.includes("Premium real estate media for Dallas-Fort Worth agents.") , "still generic desc");
check("render: canonical uses PUBLIC_APP_BASE (no hardcode)", fullHtml.includes(`<link rel="canonical" href="${PUBLIC_APP_BASE}/p/2410-luxury" />`));
check("render: og:image = hero_img", fullHtml.includes(`<meta property="og:image" content="${FULL.hero_img}" />`));
check("render: og:type website", fullHtml.includes(`<meta property="og:type" content="website" />`));
check("render: twitter summary_large_image", fullHtml.includes(`content="summary_large_image"`));
check("render: ld+json script injected", fullHtml.includes(`<script type="application/ld+json">`));
check("render: hashed module script still intact", fullHtml.includes(`/assets/index-BSyA2rAb.js`));
check("render: root no longer empty", !/<div id="root">\s*<\/div>/.test(fullHtml));
check("render: body has <h1> address", fullHtml.includes("<h1>2410 Luxury Lane</h1>"));
check("render: body shows price", /\$1,500,450/.test(fullHtml), "price missing in body");
check("render: hero img eager", /<img src="[^"]*hero\.jpg" alt="[^"]*" width="1200" height="800" loading="eager"/.test(fullHtml));
check("render: gallery img lazy", /loading="lazy"/.test(fullHtml));
check("render: dup hero rendered as exactly one <img>", (fullHtml.match(/<img src="[^"]*hero\.jpg"/g) || []).length === 1, "hero <img> not deduped");
check("render: feature list rendered, blanks dropped", fullHtml.includes("<li>Open Floor PLan</li>") && fullHtml.includes("<li>Chef&#39;s Kitchen</li>"));
check("render: schools section", fullHtml.includes("<h2>Schools</h2>") && fullHtml.includes("Whitney M Young Jr El"));

// ── Escaping (security) ──────────────────────────────────────────────────────
const xssHtml = renderFound(TEMPLATE, XSS, "evil-slug");
check("xss: no raw <script>alert in output body", !xssHtml.includes("<script>alert(1)</script>"));
check("xss: address escaped in h1", xssHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
check("xss: no onerror img injected", !xssHtml.includes("<img src=x onerror=alert(2)>"));
check("xss: ld+json has no literal < (escaped to \\u003c)", (() => {
  const m = xssHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return false;
  return !m[1].includes("<");
})());

// ── Sparse render does not crash and omits empty pieces ──────────────────────
let sparseHtml = "";
let sparseThrew = false;
try { sparseHtml = renderFound(TEMPLATE, SPARSE, "4941-shores"); } catch (e) { sparseThrew = true; }
check("sparse: renders without throwing", !sparseThrew);
check("sparse: no Schools section when empty", !sparseHtml.includes("<h2>Schools</h2>"));
check("sparse: no Photos section when no images", !sparseHtml.includes("<h2>Photos</h2>"));
check("sparse: no og:image when hero missing", !sparseHtml.includes("og:image"));

// ── Empty pd does not crash ──────────────────────────────────────────────────
let emptyThrew = false;
try { renderFound(TEMPLATE, {}, "x"); } catch (e) { emptyThrew = true; }
check("empty pd: renders without throwing", !emptyThrew);

// ── Not-found path ───────────────────────────────────────────────────────────
const nf = renderNotFound(TEMPLATE);
check("notfound: adds noindex", nf.includes(`<meta name="robots" content="noindex" />`));
check("notfound: keeps generic title", nf.includes("<title>Milestone Media & Photography</title>"));
check("notfound: root stays empty (React boots)", /<div id="root">\s*<\/div>/.test(nf));
check("notfound: module script intact", nf.includes("/assets/index-BSyA2rAb.js"));

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
