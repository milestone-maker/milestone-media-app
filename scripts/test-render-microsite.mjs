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

const mod = await import(pathToFileURL(MOD_PATH).href);
const { buildTitle, buildDescription, buildJsonLd, renderFound, renderNotFound } = mod;
const handler = mod.default;

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
  check("jsonld: geo longitude keeps NEGATIVE sign (Dallas is west)", fullLd.geo?.longitude === -96.784203772965, JSON.stringify(fullLd.geo));
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

// ── Geo coordinate sign safety (regression: toNumber stripped the '-') ────────
function geoOf(pd) {
  const raw = buildJsonLd(pd, "s", `${PUBLIC_APP_BASE}/p/s`, []);
  try { return JSON.parse(raw).geo; } catch (e) { return undefined; }
}
// Dallas-style: lat positive, lng negative — both signs + exact values preserved.
{
  const geo = geoOf({ coordinates: { lat: 32.701495386903, lng: -96.784203772965 } });
  check("geo(Dallas): longitude stays negative", geo?.longitude === -96.784203772965, JSON.stringify(geo));
  check("geo(Dallas): latitude stays positive", geo?.latitude === 32.701495386903, JSON.stringify(geo));
}
// Southern-hemisphere / eastern: lat negative, lng positive — both signs preserved.
{
  const geo = geoOf({ coordinates: { lat: -33.8688, lng: 151.2093 } });
  check("geo(Sydney): latitude stays negative", geo?.latitude === -33.8688, JSON.stringify(geo));
  check("geo(Sydney): longitude stays positive", geo?.longitude === 151.2093, JSON.stringify(geo));
}
// Numeric-string coordinates (defensive): sign still preserved.
{
  const geo = geoOf({ coordinates: { lat: "32.7", lng: "-96.8" } });
  check("geo(string coords): negative lng preserved", geo?.longitude === -96.8, JSON.stringify(geo));
}
// Non-finite coordinate → geo omitted cleanly (same as no-coordinates path).
{
  const geo = geoOf({ coordinates: { lat: "not-a-number", lng: -96.8 } });
  check("geo(bad coord): omitted when not finite", geo === undefined, JSON.stringify(geo));
}
// Regression guard: price parsing is UNCHANGED (messy string still strips to a positive number).
{
  const raw = buildJsonLd({ price: "$1,500,450" }, "s", `${PUBLIC_APP_BASE}/p/s`, []);
  let p; try { p = JSON.parse(raw).offers?.price; } catch (e) {}
  check("price still parses '$1,500,450' → 1500450", p === 1500450, String(p));
}

// ── renderFound full assembly ────────────────────────────────────────────────
const fullHtml = renderFound(TEMPLATE, FULL, "2410-luxury");
check("render: generic title replaced", !fullHtml.includes("<title>Milestone Media & Photography</title>"), "still generic");
check("render: per-listing title present", /<title>2410 Luxury Lane[^<]*<\/title>/.test(fullHtml));
check("render: generic meta description replaced", !fullHtml.includes("Premium real estate media for Dallas-Fort Worth agents.") , "still generic desc");
check("render: canonical uses PUBLIC_APP_BASE (no hardcode)", fullHtml.includes(`<link rel="canonical" href="${PUBLIC_APP_BASE}/p/2410-luxury" />`));
check("render: og:image = hero_img", fullHtml.includes(`<meta property="og:image" content="${FULL.hero_img}" />`));
// Hero preload (LCP) — exactly one, with the hero URL + as="image", in the head.
check("render: hero preload link present (as=image + hero URL)", fullHtml.includes(`<link rel="preload" as="image" href="${FULL.hero_img}" fetchpriority="high" />`));
check("render: exactly one hero preload link", (fullHtml.match(/<link rel="preload" as="image"/g) || []).length === 1, `count=${(fullHtml.match(/<link rel="preload" as="image"/g) || []).length}`);
check("render: hero preload is inside the <head>", fullHtml.indexOf(`rel="preload" as="image"`) < fullHtml.indexOf("</head>"));
// No-hero listing → no preload (clean skip).
check("render: NO hero preload when hero_img absent", !renderFound(TEMPLATE, SPARSE, "4941-shores").includes(`rel="preload" as="image"`));
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

// ── Neighborhood (optional hyper-local term) ─────────────────────────────────
// Present → appears before the city in title, description, body, and JSON-LD;
// addressLocality stays the CITY. Absent → clean city-only fallback. XSS-escaped.
// TITLE uses a SHORT city (segment before the first comma); description, body,
// and JSON-LD keep the FULL city string.
const NBHD = { ...FULL, neighborhood: "Lakewood" };
{
  const t = buildTitle(NBHD);
  check("nbhd: title has neighborhood before city", /Lakewood, Dallas/.test(t), t);
  check("nbhd: title ≤65", t.length <= 65, `len=${t.length}`);
  const d = buildDescription(NBHD);
  check("nbhd: description has neighborhood before city", d.includes("Lakewood, Dallas"), d);
  const ld = JSON.parse(buildJsonLd(NBHD, "s", `${PUBLIC_APP_BASE}/p/s`, []));
  check("nbhd: JSON-LD name folds in neighborhood", ld.name.includes("Lakewood"), ld.name);
  check("nbhd: JSON-LD containedInPlace is the neighborhood", ld.containedInPlace?.["@type"] === "Place" && ld.containedInPlace?.name === "Lakewood", JSON.stringify(ld.containedInPlace));
  check("nbhd: JSON-LD addressLocality stays the CITY (not neighborhood)", ld.address?.addressLocality === "Dallas", JSON.stringify(ld.address));
  const html = renderFound(TEMPLATE, NBHD, "2410-luxury");
  check("nbhd: <title> contains neighborhood", /<title>[^<]*Lakewood[^<]*<\/title>/.test(html));
  check("nbhd: meta description contains neighborhood", /<meta name="description" content="[^"]*Lakewood[^"]*"/.test(html));
  check("nbhd: body spec line has neighborhood before city", /<p>Lakewood &middot; Dallas/.test(html), "body spec line");
}

// ── Short-city derivation in the TITLE (full city kept everywhere else) ───────
{
  // City WITH commas → only the segment before the first comma appears in the title.
  const COMMA = { ...FULL, neighborhood: "Lakewood", city: "Dallas, Texas, 75212" };
  const t = buildTitle(COMMA);
  check("shortcity: title uses 'Dallas' (pre-comma segment)", t.includes("Lakewood, Dallas —") , t);
  check("shortcity: title omits state/ZIP", !t.includes("Texas") && !t.includes("75212"), t);
  check("shortcity: title ≤65 with neighborhood + short city", t.length <= 65, `len=${t.length}`);
  // Full city preserved in description, body, and JSON-LD addressLocality.
  check("shortcity: description keeps FULL city", buildDescription(COMMA).includes("Dallas, Texas, 75212"));
  const html = renderFound(TEMPLATE, COMMA, "s");
  check("shortcity: body keeps FULL city", html.includes("Dallas, Texas, 75212"));
  check("shortcity: JSON-LD addressLocality keeps FULL city", JSON.parse(buildJsonLd(COMMA, "s", `${PUBLIC_APP_BASE}/p/s`, [])).address?.addressLocality === "Dallas, Texas, 75212");

  // City with NO comma → unchanged.
  check("shortcity: no-comma city unchanged", buildTitle({ address: "10 Main St", city: "Dallas", beds: "3", baths: "2" }).includes("10 Main St, Dallas —"));
  // Empty leading segment (", Texas") → graceful fallback to the full value.
  check("shortcity: empty pre-comma segment falls back to full city", buildTitle({ address: "10 Main St", city: ", Texas", beds: "3", baths: "2" }).includes(", Texas"));
  // Empty city → no trailing separator, no crash.
  check("shortcity: empty city → address-only place", buildTitle({ address: "10 Main St", city: "", beds: "3", baths: "2" }) === "10 Main St — 3 Bed / 2 Bath");
}

// Title overflow SAFETY (rare now with the short city): a pathologically long
// address + neighborhood still overflows even with a short city → drop the city
// from the TITLE, keep the neighborhood. City still present in body + JSON-LD.
{
  // address+neighborhood (~43) fits the no-city title (~60); +", Dallas" overflows 65.
  const LONG = { ...FULL, address: "1954 Toronto Boulevard", neighborhood: "Preston Hollow West", city: "Dallas, Texas, 75212" };
  const full = `${LONG.address}, ${LONG.neighborhood}, Dallas — 5 Bed / 4 Bath`;
  check("nbhd(overflow): the short-city form still overflows 65", full.length > 65, `len=${full.length}`);
  const t = buildTitle(LONG);
  check("nbhd(overflow): title ≤65", t.length <= 65, `len=${t.length}`);
  check("nbhd(overflow): keeps neighborhood in title", t.includes("Preston Hollow West"), t);
  check("nbhd(overflow): drops city from title (even short city)", !t.includes("Dallas"), t);
  const html = renderFound(TEMPLATE, LONG, "s");
  check("nbhd(overflow): city still in body", html.includes("Dallas, Texas, 75212"));
  const ld = JSON.parse(buildJsonLd(LONG, "s", `${PUBLIC_APP_BASE}/p/s`, []));
  check("nbhd(overflow): city still in JSON-LD addressLocality", ld.address?.addressLocality === "Dallas, Texas, 75212");
}

// Absent neighborhood → clean city-only fallback (short city in title), no stray separators.
{
  const noNbhdHtml = renderFound(TEMPLATE, FULL, "2410-luxury"); // FULL has no neighborhood key (city "Dallas")
  check("nbhd(absent): title city-only, no ', ,'", /<title>2410 Luxury Lane, Dallas /.test(noNbhdHtml) && !noNbhdHtml.includes(", , "));
  check("nbhd(absent): body spec line starts at city, no leading separator", /<p>Dallas &middot;/.test(noNbhdHtml));
  const ld = JSON.parse(buildJsonLd(FULL, "s", `${PUBLIC_APP_BASE}/p/s`, []));
  check("nbhd(absent): JSON-LD has no containedInPlace", ld.containedInPlace === undefined);
  // Absent neighborhood + comma'd city → title shows short city, full city elsewhere.
  const commaNoNbhd = { ...FULL, city: "Dallas, Texas, 75212" };
  const t2 = buildTitle(commaNoNbhd);
  check("nbhd(absent)+comma: title short city only", t2.includes("Luxury Lane, Dallas —") && !t2.includes("Texas"), t2);
  check("nbhd(absent)+comma: description keeps full city", buildDescription(commaNoNbhd).includes("Dallas, Texas, 75212"));
}

// XSS: neighborhood with markup must be escaped in head + body; raw value survives
// only inside the JSON-LD (decoded by JSON.parse), never as live markup.
{
  const XSS_NBHD = { ...FULL, neighborhood: `<b>Oak"&'Cliff</b>` };
  const html = renderFound(TEMPLATE, XSS_NBHD, "s");
  check("nbhd(xss): no raw <b> in body/head", !html.includes("<b>Oak"), "raw markup leaked");
  check("nbhd(xss): escaped form present in body", html.includes("&lt;b&gt;Oak"), "expected escaped neighborhood");
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  check("nbhd(xss): ld+json has no literal '<'", m && !m[1].includes("<"));
  const ld = JSON.parse(m[1]);
  check("nbhd(xss): JSON-LD containedInPlace decodes to raw value", ld.containedInPlace?.name === `<b>Oak"&'Cliff</b>`, JSON.stringify(ld.containedInPlace));
}

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

// ── Resilience: hostile / malformed property_data into the pure builders ─────
// The handler wraps these in a try/catch, so a builder MAY throw on garbage —
// what must never happen is broken or unescaped HTML reaching the page. For each
// hostile input we assert the builder either (a) produces safe, escaped output, or
// (b) throws cleanly (contained by the handler). Never: silently emit raw markup.
const HOSTILE = [
  { name: "null-ish core fields", pd: { address: null, city: null, price: null, beds: null, baths: null, sqft: null, description: null, features: null, hero_img: null, gallery_photos: null, schools: null, coordinates: null } },
  { name: "wrong types", pd: { address: 12345, city: { nested: "obj" }, price: 99, beds: 4, baths: 3.5, sqft: 3000, description: ["array", "desc"], features: "not-an-array", hero_img: 42, gallery_photos: { 0: "x" }, schools: "nope", coordinates: "12,34" } },
  { name: "empty arrays + empty strings", pd: { address: "", city: "", price: "", beds: "", baths: "", sqft: "", description: "", features: [], hero_img: "", gallery_photos: [], schools: [], coordinates: {} } },
  { name: "absurd price string", pd: { address: "1 A St", city: "Dallas", price: "call for price!!! $$$ ~~~ NaN", beds: "3", baths: "2", sqft: "1k" } },
  { name: "script tags in every text field", pd: { address: `<script>x()</script>`, city: `"><img src=x onerror=y>`, price: "<b>500</b>", beds: "</title>", baths: "<svg/onload=z>", sqft: "<", description: `</script><script>evil()</script>`, features: [`<iframe>`, `</li><script>`], hero_img: `javascript:alert(1)`, schools: [{ name: `<script>s()</script>`, level: `<x>`, distance_mi: `<y>` }] } },
];

// Detect agent text that BROKE OUT of escaping into real markup. Agent fields go
// through esc() (all of < > " ' & escaped), so a genuine breakout shows as an
// UNescaped tag. First strip the page's own trusted markup — the template's module
// script, its inline sw script, and the JSON-LD <script> we inject (built via
// JSON.stringify with '<' escaped) — then look for any remaining real tag/handler
// that could only have come from un-escaped agent input. (Inert escaped text like
// "&lt;img src=x onerror=y&gt;" is fine — the '<' is already neutralized.)
// esc() escapes < > " ' & — so agent text can never open a real tag or break out
// of a quoted attribute. A breakout therefore shows as a literal tag-opener that the
// trusted page markup doesn't legitimately contain (after stripping the page's own
// <script> blocks). We do NOT scan for bare on*= handlers: with quotes escaped, an
// "onerror=" can only ever appear as inert text inside a quoted value, never as a
// real attribute — matching it would be a false positive.
function emitsUnescapedMarkup(html) {
  const scrubbed = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return /<script\b/i.test(scrubbed)
    || /<iframe\b/i.test(scrubbed)
    || /<svg[\s/>]/i.test(scrubbed)
    || /<img\s+src=x/i.test(scrubbed);
}

// Per the spec contract: on hostile garbage a builder MAY throw (the handler net
// contains it) OR return — but it must NEVER emit broken/unescaped HTML. So each
// check passes if the builder threw cleanly, else asserts the output is safe.
for (const { name, pd } of HOSTILE) {
  // buildTitle returns RAW text (escaped downstream at injection) — assert only the
  // length bound, or a clean throw (handler net contains it).
  let t, tThrew = false;
  try { t = buildTitle(pd); } catch (e) { tThrew = true; }
  check(`hostile(${name}): buildTitle bounded-or-throws`, tThrew || String(t).length <= 65, `len=${String(t).length}`);

  // buildDescription likewise returns RAW text — assert only the length bound.
  let d, dThrew = false;
  try { d = buildDescription(pd); } catch (e) { dThrew = true; }
  check(`hostile(${name}): buildDescription bounded-or-throws`, dThrew || String(d).length <= 160, `len=${String(d).length}`);

  // buildJsonLd — if it returns, it must be valid JSON with no literal '<'.
  let ldThrew = false, ldStr = "";
  try { ldStr = buildJsonLd(pd, "slug", `${PUBLIC_APP_BASE}/p/slug`, []); } catch (e) { ldThrew = true; }
  if (!ldThrew) {
    let ok = false;
    try { JSON.parse(ldStr); ok = true; } catch (e) { ok = false; }
    check(`hostile(${name}): JSON-LD parses`, ok, ldStr.slice(0, 80));
    check(`hostile(${name}): JSON-LD has no literal '<'`, !ldStr.includes("<"));
  }

  // renderFound — either safe escaped HTML, or a clean throw (handler-contained).
  let html = "", threw = false;
  try { html = renderFound(TEMPLATE, pd, "slug"); } catch (e) { threw = true; }
  check(`hostile(${name}): renderFound safe-or-throws`, threw || !emitsUnescapedMarkup(html), "markup leaked");
}

// ── Handler-level safety net ─────────────────────────────────────────────────
// Minimal req/res doubles. The handler reads the REAL built dist/index.html
// (present after `npm run build`); the Supabase client is injected so we can force
// the failure paths with no DB or network.
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    end(b) { this.body = b; return this; },
  };
  return res;
}
// A supabase double whose terminal maybeSingle() resolves to {data, error} or throws.
function fakeSupabase(outcome) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    is() { return chain; },
    async maybeSingle() {
      if (outcome.throw) throw new Error("forced fetch failure");
      return { data: outcome.data ?? null, error: outcome.error ?? null };
    },
  };
  return { from() { return chain; } };
}

// (1) Forced THROW in the data fetch → 200 plain shell, no per-listing head, no noindex.
{
  const res = makeRes();
  await handler({ query: { slug: "boom" } }, res, { supabase: fakeSupabase({ throw: true }) });
  check("handler(throw): HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("handler(throw): text/html", (res.headers["content-type"] || "").includes("text/html"));
  check("handler(throw): plain shell — generic title retained", /<title>Milestone Media & Photography<\/title>/.test(res.body || ""));
  check("handler(throw): plain shell — NO per-listing canonical", !/<link rel="canonical"/.test(res.body || ""));
  check("handler(throw): plain shell — NO noindex", !/name="robots" content="noindex"/.test(res.body || ""));
  check("handler(throw): root left empty for React", /<div id="root">\s*<\/div>/.test(res.body || ""));
}

// (2) Returned query ERROR → treated as unexpected → 200 plain shell, no noindex.
{
  const res = makeRes();
  await handler({ query: { slug: "x" } }, res, { supabase: fakeSupabase({ error: { message: "db down" } }) });
  check("handler(query-error): HTTP 200 (not 404/noindex)", res.statusCode === 200, `got ${res.statusCode}`);
  check("handler(query-error): NO noindex", !/name="robots" content="noindex"/.test(res.body || ""));
}

// (3) Builder forced to throw via a poison row → 200 plain shell (renderFound throws on a
//     property_data getter that explodes; handler net catches it).
{
  const res = makeRes();
  const poison = {};
  Object.defineProperty(poison, "address", { get() { throw new Error("boom getter"); }, enumerable: true });
  await handler({ query: { slug: "p" } }, res, { supabase: fakeSupabase({ data: { published: true, property_data: poison } }) });
  check("handler(builder-throw): HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("handler(builder-throw): plain shell, no canonical", !/<link rel="canonical"/.test(res.body || ""));
  check("handler(builder-throw): no noindex", !/name="robots" content="noindex"/.test(res.body || ""));
}

// (4) Intentional NOT-FOUND (clean null, no error) → still 404 + noindex (net must NOT swallow).
{
  const res = makeRes();
  await handler({ query: { slug: "missing" } }, res, { supabase: fakeSupabase({ data: null }) });
  check("handler(not-found): HTTP 404 preserved", res.statusCode === 404, `got ${res.statusCode}`);
  check("handler(not-found): NO hero preload", !/rel="preload" as="image"/.test(res.body || ""));
  check("handler(not-found): noindex present", /name="robots" content="noindex"/.test(res.body || ""));
}

// (5) Intentional empty slug → 404 + noindex (normal return, unaffected by the net).
{
  const res = makeRes();
  await handler({ query: {} }, res, { supabase: fakeSupabase({ data: { property_data: {} } }) });
  check("handler(empty-slug): HTTP 404", res.statusCode === 404, `got ${res.statusCode}`);
  check("handler(empty-slug): noindex present", /name="robots" content="noindex"/.test(res.body || ""));
}

// (6) Happy path / LIVE through the handler → 200 with injected per-listing head.
{
  const res = makeRes();
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: { published: true, retired_at: null, sold_at: null, property_data: FULL } }) });
  check("handler(live): HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("handler(live): per-listing canonical injected", /<link rel="canonical" href="[^"]+\/p\/2410-luxury"/.test(res.body || ""));
  check("handler(live): ld+json injected", /application\/ld\+json/.test(res.body || ""));
  check("handler(live): no noindex on a real listing", !/name="robots" content="noindex"/.test(res.body || ""));
  check("handler(live): cache-control set", /s-maxage=600/.test(res.headers["cache-control"] || ""));
  check("handler(live): NO sold badge", !/sold-badge/.test(res.body || ""));
  check("handler(live): offer is NOT SoldOut", !/SoldOut/.test(res.body || ""));
}

// ── SOLD-pages state model (precedence: withdrawn > sold > live > draft) ─────
const LIVE_ROW = { published: true, retired_at: null, sold_at: null, property_data: FULL };

// Byte-identical LIVE regression: handler(live) output must equal renderFound(FULL) directly.
{
  const res = makeRes();
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: LIVE_ROW }) });
  const direct = renderFound(await (await import("node:fs/promises")).readFile(new URL("../dist/index.html", import.meta.url), "utf8"), FULL, "2410-luxury");
  check("state(live): byte-identical to renderFound(no sold)", res.body === direct, "live output drifted");
}

// SOLD (no sold_price): badge + sold date + SoldOut, indexable 200, price omitted.
{
  const res = makeRes();
  const SOLD_ROW = { published: true, retired_at: null, sold_at: "2026-06-12T10:00:00.000Z", sold_price: null, property_data: FULL };
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: SOLD_ROW }) });
  const body = res.body || "";
  check("state(sold): HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("state(sold): NOT noindex (indexable)", !/name="robots" content="noindex"/.test(body));
  check("state(sold): SOLD badge in body", /class="sold-badge"[^>]*>[\s\S]*SOLD/.test(body));
  check("state(sold): sold date present in body", body.includes("Sold 2026-06-12"));
  check("state(sold): SOLD in <title>", /<title>\s*SOLD —/.test(body));
  check("state(sold): SOLD + date in meta description", /<meta name="description" content="SOLD \(2026-06-12\)/.test(body));
  check("state(sold): hero preload present (sold path also prioritizes LCP)", body.includes(`<link rel="preload" as="image" href="${FULL.hero_img}" fetchpriority="high" />`));
  check("state(sold): JSON-LD offer availability SoldOut", body.includes("https://schema.org/SoldOut"));
  check("state(sold): NO price in sold offer (price undisclosed)", (() => {
    const m = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!m) return false;
    try { const o = JSON.parse(m[1]); return o.offers && o.offers.availability === "https://schema.org/SoldOut" && o.offers.price === undefined; } catch { return false; }
  })());
  check("state(sold): list price NOT shown as sale price (no $1,500,450 in offer)", (() => {
    const m = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    try { const o = JSON.parse(m[1]); return !o.offers || o.offers.price !== 1500450; } catch { return false; }
  })());
}

// SOLD (with sold_price): price appears in the SoldOut offer + body.
{
  const res = makeRes();
  const SOLD_PRICED = { published: true, retired_at: null, sold_at: "2026-06-12T10:00:00.000Z", sold_price: "1,425,000", property_data: FULL };
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: SOLD_PRICED }) });
  const body = res.body || "";
  const m = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let offer = null; try { offer = JSON.parse(m[1]).offers; } catch {}
  check("state(sold+price): offer.price = parsed sold price", offer?.price === 1425000, JSON.stringify(offer));
  check("state(sold+price): offer SoldOut", offer?.availability === "https://schema.org/SoldOut");
  check("state(sold+price): sale price shown in body", body.includes("Sold for $1,425,000"));
}

// WITHDRAWN (retired_at set, published false) → 404 + noindex (precedence over sold).
{
  const res = makeRes();
  const WITHDRAWN = { published: false, retired_at: "2026-06-01T00:00:00.000Z", sold_at: "2026-06-12T00:00:00.000Z", property_data: FULL };
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: WITHDRAWN }) });
  check("state(withdrawn): HTTP 404", res.statusCode === 404, `got ${res.statusCode}`);
  check("state(withdrawn): noindex present", /name="robots" content="noindex"/.test(res.body || ""));
  check("state(withdrawn): no sold badge (withdrawn beats sold)", !/sold-badge/.test(res.body || ""));
  check("state(withdrawn): NO hero preload", !/rel="preload" as="image"/.test(res.body || ""));
}

// DRAFT (published false, not sold/retired) → 404 + noindex.
{
  const res = makeRes();
  const DRAFT = { published: false, retired_at: null, sold_at: null, property_data: FULL };
  await handler({ query: { slug: "2410-luxury" } }, res, { supabase: fakeSupabase({ data: DRAFT }) });
  check("state(draft): HTTP 404", res.statusCode === 404, `got ${res.statusCode}`);
  check("state(draft): noindex present", /name="robots" content="noindex"/.test(res.body || ""));
}

// ── White-label head metadata (Stage 6) ─────────────────────────────────────
// og:site_name and the title's brand suffix come from the agent's branding
// snapshot (property_data.agency_name) — the SAME field the visible body reads —
// with the Milestone fallback preserved for unbranded agents, and the agency name
// escaped at every head injection point (it's agent-entered, same XSS class).
{
  // (a) WITH a brand name → og:site_name uses it (escaped), never "Milestone".
  const BRANDED = { ...FULL, agency_name: "Premier Realty Group" };
  const html = renderFound(TEMPLATE, BRANDED, "2410-luxury");
  check("wl: og:site_name uses agency_name", html.includes(`<meta property="og:site_name" content="Premier Realty Group" />`), "agency name missing from og:site_name");
  check("wl: og:site_name is NOT Milestone when branded", !html.includes(`<meta property="og:site_name" content="Milestone Media &amp; Photography" />`));

  // (b) Brand name in the TITLE fallback path (no address/city/specs → the
  //     "Property Listing — {brand}" suffix is what's exercised).
  const BARE_BRANDED = { agency_name: "Premier Realty Group" };
  check("wl: buildTitle brand suffix uses agency_name", buildTitle(BARE_BRANDED) === "Property Listing — Premier Realty Group", buildTitle(BARE_BRANDED));
  const bareHtml = renderFound(TEMPLATE, BARE_BRANDED, "s");
  check("wl: title tag uses agency_name (no Milestone)", /<title>Property Listing — Premier Realty Group<\/title>/.test(bareHtml) && !bareHtml.includes("<title>Property Listing — Milestone"), "title brand suffix not white-labeled");

  // (c) WITHOUT a brand name → Milestone fallback preserved (no regression). Both
  //     og:site_name (escaped & → &amp;) and the bare-title brand suffix.
  const PLAIN = { ...FULL }; // FULL has no agency_name
  const plainHtml = renderFound(TEMPLATE, PLAIN, "2410-luxury");
  check("wl(fallback): og:site_name is Milestone (escaped)", plainHtml.includes(`<meta property="og:site_name" content="Milestone Media &amp; Photography" />`), "Milestone fallback lost");
  check("wl(fallback): brandName() default", mod.brandName({}) === "Milestone Media & Photography");
  check("wl(fallback): brandName() empty/whitespace → Milestone", mod.brandName({ agency_name: "   " }) === "Milestone Media & Photography");
  check("wl(fallback): bare title falls back to Milestone", buildTitle({}) === "Property Listing — Milestone Media & Photography", buildTitle({}));

  // (d) XSS: agency name with markup/quotes must be escaped in the head, never raw.
  const XSS_BRAND = { ...FULL, agency_name: `<script>alert(1)</script>&"'X` };
  const xssBrandHtml = renderFound(TEMPLATE, XSS_BRAND, "s");
  check("wl(xss): og:site_name escaped", xssBrandHtml.includes(`content="&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;X"`), "agency name not escaped in og:site_name");
  check("wl(xss): no raw <script> from agency name in head", !xssBrandHtml.includes(`<script>alert(1)</script></`) && !/og:site_name" content="[^"]*<script/.test(xssBrandHtml));
  // XSS brand name in the bare-title path → escaped in the <title> too.
  const xssBareHtml = renderFound(TEMPLATE, { agency_name: `<b>"&'</b>` }, "s");
  check("wl(xss): title brand suffix escaped", /<title>Property Listing — &lt;b&gt;&quot;&amp;&#39;&lt;\/b&gt;<\/title>/.test(xssBareHtml), "agency name not escaped in title");
}

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
