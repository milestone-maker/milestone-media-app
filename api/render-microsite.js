// Vercel Serverless Function — Server-rendered public microsite (SEO foundation).
// GET /api/render-microsite?slug=<slug>   (wired to /p/:slug via vercel.json rewrite)
//
// Public listing microsites (/p/{slug}) are a client-rendered Vite SPA: a crawler
// or social scraper hitting the route gets a generic empty shell with no per-listing
// <title>, description, canonical, Open Graph, Twitter card, or JSON-LD — so SEO can't
// work and a shared link shows a generic, image-less card.
//
// This function fixes that WITHOUT full hydration: it reads the BUILT dist/index.html,
// fetches the microsite server-side (service-role), injects a per-listing <head> and a
// crawlable <body> into the empty <div id="root">, and leaves the hashed <script> intact
// so React still boots via createRoot and replaces the injected body for human visitors.
//
// Anonymous, unauthenticated. DB access goes through the service-role client. The public
// RLS policy only checks published=true, so this function ALSO filters retired_at IS NULL
// (a retired microsite must not be served as an indexable 200).
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// dist/index.html is a BUILD ARTIFACT (gitignored), not auto-traced into the function's
// filesystem — vercel.json "functions" uses includeFiles: "dist/**" to bundle it. This
// read is the thing Stage 1 is proving on a preview deploy.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

// ── Built template, read once per cold start ─────────────────────────────────
// Resolve from process.cwd()/dist first (Vercel runs functions with cwd at the
// project root), falling back to a path relative to this file (api/ → ../dist).
let _templateCache = null;
async function loadTemplate() {
  if (_templateCache) return _templateCache;
  const candidates = [
    join(process.cwd(), "dist", "index.html"),
    join(__dirname, "..", "dist", "index.html"),
  ];
  let lastErr = null;
  for (const p of candidates) {
    try {
      _templateCache = await readFile(p, "utf8");
      return _templateCache;
    } catch (err) {
      lastErr = err;
    }
  }
  const tried = candidates.join(", ");
  console.error(`[render-microsite] could not read built dist/index.html (tried: ${tried})`, lastErr);
  throw new Error("template-unreadable");
}

// ── Escaping helpers ─────────────────────────────────────────────────────────
// All listing-derived text is agent-entered — escape before injecting so it can't
// break the page or inject markup. Used for both element text and attribute values.
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON-LD goes inside a <script> — escape `<` so a "</script>" or "<" in agent text
// can't terminate the block. (JSON.stringify already handles quotes/backslashes.)
function jsonLdSafe(jsonString) {
  return jsonString.replace(/</g, "\\u003c");
}

// ── Defensive parsing ────────────────────────────────────────────────────────
// beds/baths/price/sqft are stored as STRINGS, free-form ("752000", "1,500,450",
// "$3000 month"). Keep the readable string for the visible body/title; parse a clean
// number ONLY for numeric JSON-LD fields. Returns null when no sane number is found.
function toNumber(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

// Sign-safe parse for latitude/longitude. Coordinates are clean numeric values
// (number or numeric string) and MUST keep their sign — the price-oriented
// toNumber() above strips '-', which would flip every US longitude (and any
// southern-hemisphere latitude) to the wrong hemisphere. Returns null for
// non-finite input so the caller omits geo cleanly, like the no-coordinates path.
function toCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(str, max) {
  const s = String(str);
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

// ── Title + description ──────────────────────────────────────────────────────
export function buildTitle(pd) {
  const address = (pd.address || "").trim();
  const city = (pd.city || "").trim();
  const beds = (pd.beds || "").toString().trim();
  const baths = (pd.baths || "").toString().trim();

  const place = [address, city].filter(Boolean).join(", ");
  const specBits = [];
  if (beds) specBits.push(`${beds} Bed`);
  if (baths) specBits.push(`${baths} Bath`);
  const specs = specBits.join(" / ");

  let title;
  if (place && specs) title = `${place} — ${specs}`;
  else if (place) title = place;
  else title = "Property Listing — Milestone Media & Photography";
  return clamp(title, 65);
}

export function buildDescription(pd) {
  const specBits = [];
  if (pd.beds) specBits.push(`${String(pd.beds).trim()} bed`);
  if (pd.baths) specBits.push(`${String(pd.baths).trim()} bath`);
  if (pd.sqft) specBits.push(`${String(pd.sqft).trim()} sqft`);
  const specs = specBits.join(", ");

  const place = [pd.address, pd.city].map((v) => (v || "").trim()).filter(Boolean).join(", ");
  const desc = (pd.description || "").replace(/\s+/g, " ").trim();

  const lead = [place, specs].filter(Boolean).join(" · ");
  const combined = [lead, desc].filter(Boolean).join(". ");
  const fallback = "Premium real estate media for Dallas-Fort Worth agents.";
  return clamp(combined || fallback, 160);
}

// ── JSON-LD (schema.org RealEstateListing) ───────────────────────────────────
// Every optional field is omitted cleanly when absent (coordinates/schools/postalCode
// are present on only 50–75% of rows).
export function buildJsonLd(pd, slug, canonical, images) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    url: canonical,
  };
  const name = [pd.address, pd.city].map((v) => (v || "").trim()).filter(Boolean).join(", ");
  if (name) ld.name = name;
  if (images.length) ld.image = images;
  const desc = (pd.description || "").replace(/\s+/g, " ").trim();
  if (desc) ld.description = desc;

  const price = toNumber(pd.price);
  if (price !== null) {
    ld.offers = { "@type": "Offer", price, priceCurrency: "USD" };
  }

  const postalAddress = { "@type": "PostalAddress" };
  if (pd.address) postalAddress.streetAddress = String(pd.address).trim();
  if (pd.city) postalAddress.addressLocality = String(pd.city).trim();
  if (pd.zip || pd.postal_code) postalAddress.postalCode = String(pd.zip || pd.postal_code).trim();
  if (Object.keys(postalAddress).length > 1) ld.address = postalAddress;

  const beds = toNumber(pd.beds);
  if (beds !== null) ld.numberOfBedrooms = beds;
  const baths = toNumber(pd.baths);
  if (baths !== null) ld.numberOfBathroomsTotal = baths;
  const sqft = toNumber(pd.sqft);
  if (sqft !== null) {
    ld.floorSize = { "@type": "QuantitativeValue", value: sqft, unitCode: "FTK" };
  }

  const coords = pd.coordinates;
  if (coords && typeof coords === "object") {
    const lat = toCoordinate(coords.lat);
    const lng = toCoordinate(coords.lng);
    if (lat !== null && lng !== null) {
      ld.geo = { "@type": "GeoCoordinates", latitude: lat, longitude: lng };
    }
  }

  return jsonLdSafe(JSON.stringify(ld));
}

// ── Head injection ───────────────────────────────────────────────────────────
function buildHeadTags(pd, slug, title, description, canonical, ogImage) {
  const t = esc(title);
  const d = esc(description);
  const c = esc(canonical);
  const img = ogImage ? esc(ogImage) : "";
  const jsonLd = buildJsonLd(pd, slug, canonical, ogImage ? [ogImage] : []);

  const tags = [
    `<link rel="canonical" href="${c}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${c}" />`,
    `<meta property="og:site_name" content="Milestone Media &amp; Photography" />`,
  ];
  if (img) tags.push(`<meta property="og:image" content="${img}" />`);
  tags.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  );
  if (img) tags.push(`<meta name="twitter:image" content="${img}" />`);
  tags.push(`<script type="application/ld+json">${jsonLd}</script>`);
  return tags.join("\n    ");
}

// ── Crawlable body ───────────────────────────────────────────────────────────
function buildBody(pd, title) {
  const parts = [];
  const address = (pd.address || "").trim();
  const city = (pd.city || "").trim();

  parts.push(`<h1>${esc(address || "Property Listing")}</h1>`);

  const specLine = [
    esc(city),
    (pd.price || "").toString().trim() ? `$${esc(String(pd.price).trim().replace(/^\$/, ""))}` : "",
    pd.beds ? `${esc(String(pd.beds).trim())} bed` : "",
    pd.baths ? `${esc(String(pd.baths).trim())} bath` : "",
    pd.sqft ? `${esc(String(pd.sqft).trim())} sqft` : "",
  ].filter(Boolean);
  if (specLine.length) parts.push(`<p>${specLine.join(" &middot; ")}</p>`);

  const desc = (pd.description || "").trim();
  if (desc) parts.push(`<p>${esc(desc)}</p>`);

  const features = Array.isArray(pd.features)
    ? pd.features.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean)
    : [];
  if (features.length) {
    parts.push(`<ul>${features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
  }

  const schools = Array.isArray(pd.schools)
    ? pd.schools.filter((s) => s && typeof s === "object" && s.name)
    : [];
  if (schools.length) {
    parts.push(`<h2>Schools</h2>`);
    parts.push(
      `<ul>${schools
        .map((s) => {
          const bits = [s.name, s.level, s.distance_mi != null ? `${s.distance_mi} mi` : ""]
            .map((v) => (v == null ? "" : String(v).trim()))
            .filter(Boolean);
          return `<li>${esc(bits.join(" — "))}</li>`;
        })
        .join("")}</ul>`,
    );
  }

  // Photos: hero first (eager), then gallery (lazy). Descriptive alt from the address.
  const altBase = address || city || "Property photo";
  const photos = [];
  if (pd.hero_img) photos.push({ src: pd.hero_img, eager: true });
  const gallery = Array.isArray(pd.gallery_photos) ? pd.gallery_photos : [];
  for (const g of gallery) {
    if (typeof g === "string" && g && g !== pd.hero_img) photos.push({ src: g, eager: false });
  }
  if (photos.length) {
    parts.push(`<h2>Photos</h2>`);
    parts.push(
      photos
        .map(
          (ph, i) =>
            `<img src="${esc(ph.src)}" alt="${esc(`${altBase} — photo ${i + 1}`)}" width="1200" height="800" loading="${ph.eager ? "eager" : "lazy"}" />`,
        )
        .join("\n      "),
    );
  }

  return parts.join("\n      ");
}

// ── Template assembly ────────────────────────────────────────────────────────
export function renderFound(template, pd, slug) {
  const title = buildTitle(pd);
  const description = buildDescription(pd);
  const canonical = `${PUBLIC_APP_BASE}/p/${slug}`;
  const ogImage = typeof pd.hero_img === "string" && pd.hero_img ? pd.hero_img : "";

  const headTags = buildHeadTags(pd, slug, title, description, canonical, ogImage);
  const body = buildBody(pd, title);

  let html = template;
  // Replace the generic <title>.
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${esc(title)}</title>`,
  );
  // Replace the generic meta description.
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${esc(description)}" />`,
  );
  // Inject per-listing head tags right before </head>.
  html = html.replace(/<\/head>/i, `    ${headTags}\n  </head>`);
  // Inject the crawlable body into the empty root (React replaces it on boot).
  html = html.replace(
    /<div id="root">\s*<\/div>/,
    `<div id="root">\n      ${body}\n    </div>`,
  );
  return html;
}

export function renderNotFound(template) {
  // Same shell, but noindex + generic title; React boots and shows its not-found screen.
  return template.replace(/<\/head>/i, `    <meta name="robots" content="noindex" />\n  </head>`);
}

// ── Handler ──────────────────────────────────────────────────────────────────
// Failure model: reading the built dist/index.html is the ONE hard dependency —
// if that genuinely can't be read, it's a clear 500. EVERYTHING else (slug parse,
// Supabase fetch, row processing, head/body injection) runs inside one try/catch:
// any UNEXPECTED throw degrades to exactly today's behavior — the plain built shell
// at HTTP 200, indexable, rendered client-side by React — never a 500, never a
// broken page. The INTENTIONAL not-found / retired path is a normal `return` of the
// 404 + noindex shell (data === null with no error), so the catch never swallows it.
export default async function handler(req, res, deps = {}) {
  let template;
  try {
    template = await loadTemplate();
  } catch (err) {
    // The one hard dependency. Cannot serve anything without the built shell.
    res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Microsite renderer is temporarily unavailable.");
  }

  let slug = "";
  try {
    const rawSlug = req.query?.slug;
    slug = typeof rawSlug === "string"
      ? rawSlug.trim()
      : Array.isArray(rawSlug)
        ? String(rawSlug[0] || "").trim()
        : "";

    // Intentional not-found: empty/missing slug → 404 + noindex (normal return).
    if (!slug) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(renderNotFound(template));
    }

    const supabase = deps.supabase || defaultSupabase();
    const { data, error } = await supabase
      .from("microsites")
      .select("*")
      .eq("slug", slug)
      .eq("published", true)
      .is("retired_at", null)
      .maybeSingle();

    // A returned query error is an UNEXPECTED failure (e.g. a transient outage),
    // not a genuine "no such listing" — throw so the safety net serves the plain
    // indexable shell rather than wrongly noindex-ing a real listing.
    if (error) throw error;

    // Intentional not-found / retired: a clean null result → 404 + noindex.
    if (!data) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(renderNotFound(template));
    }

    const pd = data.property_data && typeof data.property_data === "object" ? data.property_data : {};
    const html = renderFound(template, pd, slug);

    res.status(200);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    return res.end(html);
  } catch (err) {
    // Safety net: any unforeseen failure degrades to today's behavior — the plain
    // built shell at 200, indexable, rendered client-side. No noindex: the listing
    // is real, we just couldn't server-render it this once.
    console.error(`[render-microsite] unexpected failure for slug="${slug}", serving plain shell:`, err);
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(template);
  }
}
