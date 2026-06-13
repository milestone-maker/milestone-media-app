// Vercel Serverless Function — dynamic XML sitemap of live public microsites.
// GET /api/sitemap   (wired to /sitemap.xml via vercel.json rewrite)
//
// SEO stage 2 (discovery): lists every LIVE microsite (published = true AND
// retired_at IS NULL) so search engines can find /p/{slug} pages. Anonymous,
// unauthenticated; DB access via the service-role client.
//
// lastmod: the microsites table has no updated_at column (confirmed against the
// schema), so created_at is used. buildSitemapXml prefers row.updated_at when
// present, so this upgrades automatically if an updated_at is ever added.
//
// Error policy: a DB/unexpected error returns HTTP 503 (so Google retries and
// keeps its last-known sitemap) — NEVER an empty 200, which could read as "all
// listings removed." A genuinely empty result IS a valid empty <urlset> at 200.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

// ── Pure builders (exported for tests) ───────────────────────────────────────
function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Coerce a timestamptz (string or Date) to YYYY-MM-DD, or null if unusable.
function isoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Build a valid urlset from rows of { slug, sold_at?, created_at?, updated_at? }.
// Rows without a slug are skipped; <lastmod> is omitted when no usable date
// exists. A freshly-SOLD page uses sold_at so the change signals freshness;
// otherwise updated_at (if ever added) then created_at. An empty (or
// all-skipped) input yields a valid empty <urlset></urlset>.
export function buildSitemapXml(rows, base = PUBLIC_APP_BASE) {
  const urls = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.slug)
    .map((r) => {
      const loc = escapeXml(`${base}/p/${r.slug}`);
      const lastmod = isoDate(r.sold_at || r.updated_at || r.created_at);
      return lastmod
        ? `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`
        : `  <url><loc>${loc}</loc></url>`;
    });
  const body = urls.length ? `\n${urls.join("\n")}\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res, deps = {}) {
  try {
    const supabase = deps.supabase || defaultSupabase();
    // published = true AND retired_at IS NULL deliberately INCLUDES sold pages
    // (a sold listing keeps published=true; only retiring takes it down).
    const { data, error } = await supabase
      .from("microsites")
      .select("slug, sold_at, created_at")
      .eq("published", true)
      .is("retired_at", null);
    if (error) throw error;

    const xml = buildSitemapXml(data || []);
    res.status(200);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.end(xml);
  } catch (err) {
    // 503 (not an empty 200) so crawlers retry and keep their last-known sitemap.
    console.error("[sitemap] error, returning 503:", err);
    res.status(503).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Sitemap temporarily unavailable.");
  }
}
