#!/usr/bin/env node

// Fail loudly: any unhandled error must translate to a non-zero exit.
process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for api/sitemap.js + api/robots.js — the SEO stage 2 discovery files.
// No DB, no env, no network: imports the modules (supabase client is created
// lazily, so import is safe) and exercises the pure builders against mock rows.
// Verifies well-formed sitemap XML, one <url> per row, <loc> built from the
// centralized base, ISO <lastmod> (omitted when no date), XML-escaped slugs, the
// empty-result empty <urlset>, and the robots.txt Sitemap + Disallow lines.
//
//   node scripts/test-sitemap.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const { buildSitemapXml } = await import(pathToFileURL(resolve(REPO_ROOT, "api", "sitemap.js")).href);
const { buildRobotsTxt }  = await import(pathToFileURL(resolve(REPO_ROOT, "api", "robots.js")).href);
const { PUBLIC_APP_BASE }  = await import(pathToFileURL(resolve(REPO_ROOT, "api", "_lib", "microsite.js")).href);

let passed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── Sitemap: typical rows (two with dates, one without) ──────────────────────
const ROWS = [
  { slug: "1954-toronto-57402083", created_at: "2026-05-01T12:34:56.789Z" },
  { slug: "2410-luxury",           created_at: "2026-06-10T08:00:00.000Z" },
  { slug: "no-date-listing",       created_at: null },
];
const xml = buildSitemapXml(ROWS);

check("sitemap: starts with XML declaration", xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`), xml.slice(0, 40));
check("sitemap: has urlset with sitemaps.org ns", xml.includes(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`));
check("sitemap: closes urlset", xml.trimEnd().endsWith("</urlset>"));
check("sitemap: one <url> per row", (xml.match(/<url>/g) || []).length === 3, `count=${(xml.match(/<url>/g) || []).length}`);
check("sitemap: <loc> uses centralized base + /p/{slug}", xml.includes(`<loc>${PUBLIC_APP_BASE}/p/1954-toronto-57402083</loc>`));
check("sitemap: second row loc", xml.includes(`<loc>${PUBLIC_APP_BASE}/p/2410-luxury</loc>`));
check("sitemap: lastmod is ISO YYYY-MM-DD", xml.includes("<lastmod>2026-05-01</lastmod>") && xml.includes("<lastmod>2026-06-10</lastmod>"));
check("sitemap: exactly 2 lastmod (the dated rows)", (xml.match(/<lastmod>/g) || []).length === 2, `count=${(xml.match(/<lastmod>/g) || []).length}`);
check("sitemap: dateless row has loc but no lastmod", /<url><loc>[^<]*\/p\/no-date-listing<\/loc><\/url>/.test(xml), "no-date url shape");

// ── Sitemap: XML escaping of an ampersand in a slug ──────────────────────────
const escXml = buildSitemapXml([{ slug: "a&b<c>\"d'", created_at: "2026-01-02T00:00:00Z" }]);
check("sitemap: slug XML-escaped (& < > \" ')", escXml.includes("<loc>" + PUBLIC_APP_BASE + "/p/a&amp;b&lt;c&gt;&quot;d&apos;</loc>"), escXml);
check("sitemap: no raw ampersand outside entities", !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(escXml), "raw & present");

// ── Sitemap: rows without slug are skipped; Date objects accepted ────────────
const mixed = buildSitemapXml([{ slug: "", created_at: "2026-01-01T00:00:00Z" }, { created_at: "x" }, { slug: "ok", created_at: new Date("2026-03-04T00:00:00Z") }]);
check("sitemap: skips slugless rows", (mixed.match(/<url>/g) || []).length === 1);
check("sitemap: accepts Date object for lastmod", mixed.includes("<lastmod>2026-03-04</lastmod>"), mixed);

// ── Sitemap: empty result → valid empty urlset ───────────────────────────────
const empty = buildSitemapXml([]);
check("sitemap(empty): valid empty urlset", empty.includes("<urlset") && empty.includes("</urlset>") && !empty.includes("<url>"), empty);
check("sitemap(empty): still has XML declaration", empty.startsWith(`<?xml`));
check("sitemap(non-array): treated as empty, no throw", (() => { try { const e = buildSitemapXml(null); return e.includes("</urlset>") && !e.includes("<url>"); } catch (_) { return false; } })());

// ── Sitemap: explicit base override + updated_at preference ──────────────────
const overridden = buildSitemapXml([{ slug: "s", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-09T00:00:00Z" }], "https://example.test");
check("sitemap: honors explicit base arg", overridden.includes("<loc>https://example.test/p/s</loc>"));
check("sitemap: prefers updated_at over created_at when present", overridden.includes("<lastmod>2026-09-09</lastmod>"), overridden);

// ── Sitemap: SOLD rows stay included; sold_at wins as lastmod ────────────────
const soldXml = buildSitemapXml([{ slug: "sold-home", created_at: "2026-01-01T00:00:00Z", sold_at: "2026-06-12T00:00:00Z" }]);
check("sitemap: sold row is INCLUDED (still published)", (soldXml.match(/<url>/g) || []).length === 1);
check("sitemap: sold_at wins as lastmod over created_at", soldXml.includes("<lastmod>2026-06-12</lastmod>") && !soldXml.includes("2026-01-01"), soldXml);

// ── Robots.txt ───────────────────────────────────────────────────────────────
const robots = buildRobotsTxt();
check("robots: User-agent *", robots.includes("User-agent: *"));
check("robots: Allow /", /^Allow: \/$/m.test(robots));
check("robots: Disallow /api/", robots.includes("Disallow: /api/"));
check("robots: Sitemap line uses centralized base", robots.includes(`Sitemap: ${PUBLIC_APP_BASE}/sitemap.xml`));
check("robots: honors explicit base arg", buildRobotsTxt("https://example.test").includes("Sitemap: https://example.test/sitemap.xml"));

// ── Report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) FAILED:`);
  for (const f of fails) console.error("  ✗ " + f);
  console.error(`\n${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${passed} checks passed`);
