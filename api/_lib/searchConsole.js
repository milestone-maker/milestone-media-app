// Google Search Console client + pure row→listing mapper.
//
// Stage 1 of the admin-only Search Console monitor. The property was verified
// as a DOMAIN property, so the GSC site identifier is
// "sc-domain:milestonemediaphotography.com" (stored in GSC_SITE_URL), and the
// pages we care about are the public listing pages at {PUBLIC_APP_BASE}/p/{slug}.
//
// Auth is a HAND-ROLLED service-account JWT (no googleapis / google-auth-library
// dependency), mirroring api/calendar.js's "mint the token yourself with fetch"
// style. The service account JSON is stored base64-encoded in a single Vercel
// env var (GSC_SERVICE_ACCOUNT_B64) since every other secret here is single-line
// and a raw multi-line JSON blob is fragile to paste.
//
// fetchGscRows() is the injectable seam the handler calls — tests inject a fake
// so they never need real credentials or network. mapGscRowsToListings() is a
// pure, exported function so the mapping/totals math is fully unit-testable.
//
// Required env vars (only when actually wired to a live property):
//   GSC_SERVICE_ACCOUNT_B64  base64 of the service-account JSON key file
//   GSC_SITE_URL             e.g. "sc-domain:milestonemediaphotography.com"

import crypto from "node:crypto";
import { PUBLIC_APP_BASE } from "./microsite.js";

const TOKEN_URL  = "https://oauth2.googleapis.com/token";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const JWT_GRANT  = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// ── encoding helpers ─────────────────────────────────────────────────
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

// ── service account ──────────────────────────────────────────────────

/**
 * Read + decode the service-account JSON from GSC_SERVICE_ACCOUNT_B64.
 * Returns null when the env var is absent (→ "not_configured" upstream).
 */
export function loadServiceAccount() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_B64;
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

/**
 * Build a signed RS256 service-account assertion JWT (no SDK).
 * Exported so a test can verify the signing path with an ephemeral keypair —
 * the riskiest hand-rolled bit, provable without touching Google.
 *
 * @param {{client_email:string, private_key:string}} sa
 * @param {number} nowSec  unix seconds (injectable for deterministic tests)
 */
export function buildSignedJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss:   sa.client_email,
    scope: TOKEN_SCOPE,
    aud:   TOKEN_URL,
    iat:   nowSec,
    exp:   nowSec + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

// Simple in-module token cache so we don't re-mint on every call. Refresh ~60s
// before expiry. Module-scoped (one per warm function instance).
let _tokenCache = null; // { token, exp }  exp = unix seconds

/**
 * Mint (or reuse a cached) OAuth access token for the service account.
 * Throws on a failed token mint — callers turn that into a 500. The thrown
 * message comes from Google's response, never the service-account contents.
 */
export async function getAccessToken(sa, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const nowSec  = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.exp - 60 > nowSec) return _tokenCache.token;

  const jwt = buildSignedJwt(sa, nowSec);
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: JWT_GRANT, assertion: jwt }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GSC token mint failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  _tokenCache = { token: data.access_token, exp: nowSec + (data.expires_in || 3600) };
  return data.access_token;
}

/**
 * Query Search Analytics for the given site + date range, filtered to pages
 * under pagePrefix. Returns the rows array. Throws on a non-OK response with
 * the HTTP status attached as err.status (so callers can detect 401/403).
 */
export async function querySearchAnalytics(
  { accessToken, siteUrl, startDate, endDate, pagePrefix },
  deps = {},
) {
  const fetchFn = deps.fetch || fetch;
  const url =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ["page"],
      rowLimit: 1000,
      dimensionFilterGroups: [
        { filters: [{ dimension: "page", operator: "contains", expression: pagePrefix }] },
      ],
    }),
  });
  if (!res.ok) {
    const err = new Error(`GSC query failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data.rows) ? data.rows : [];
}

/**
 * The injectable seam the handler calls. Contract:
 *   • sa missing OR GSC_SITE_URL missing      → { status: "not_configured" }
 *   • GSC query responds 401/403 (SA not yet
 *     granted on the property)                → { status: "no_access" }
 *   • success                                 → { status: "ok", rows }
 *   • any other failure (token mint, 5xx,
 *     network)                                → throws (handler → 500)
 */
export async function fetchGscRows({ startDate, endDate }, deps = {}) {
  const sa      = (deps.loadServiceAccount || loadServiceAccount)();
  const siteUrl = process.env.GSC_SITE_URL;
  if (!sa || !siteUrl) return { status: "not_configured" };

  // A token-mint failure here propagates (not caught) → handler 500.
  const accessToken = await (deps.getAccessToken || getAccessToken)(sa, deps);

  try {
    const rows = await (deps.querySearchAnalytics || querySearchAnalytics)(
      { accessToken, siteUrl, startDate, endDate, pagePrefix: `${PUBLIC_APP_BASE}/p/` },
      deps,
    );
    return { status: "ok", rows };
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) return { status: "no_access" };
    throw err;
  }
}

/**
 * PURE. Map GSC page-dimension rows back to listings via slugMap.
 *
 * Each row's keys[0] is the page URL. Strip the exact `${base}/p/` prefix to
 * recover the slug; skip rows whose slug isn't in slugMap (non-listing or
 * unpublished pages). Emit per-listing
 *   { slug, listing_id, label, url, impressions, clicks, ctr, position }
 * plus totals { impressions, clicks, ctr, position } where ctr = clicks/impr
 * (0 when no impressions) and position is the impression-WEIGHTED average.
 *
 * @param {Array}  rows     GSC rows ([{ keys:[url], impressions, clicks, ctr, position }])
 * @param {Object} slugMap  { slug → { label, listing_id } }
 * @param {string} base     PUBLIC_APP_BASE
 */
export function mapGscRowsToListings(rows, slugMap, base) {
  const prefix = `${base}/p/`;
  const map = slugMap || {};
  const listings = [];
  let sumImpr = 0, sumClicks = 0, weightedPos = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const url = row && Array.isArray(row.keys) ? row.keys[0] : undefined;
    if (typeof url !== "string" || !url.startsWith(prefix)) continue;
    const slug = url.slice(prefix.length);
    const entry = map[slug];
    if (!entry) continue; // unknown / unpublished page → skip

    const impressions = row.impressions || 0;
    const clicks      = row.clicks || 0;
    const position    = row.position || 0;

    listings.push({
      slug,
      listing_id: entry.listing_id ?? null,
      label:      entry.label,
      url,
      impressions,
      clicks,
      ctr:      impressions > 0 ? round4(clicks / impressions) : 0,
      position: round2(position),
    });

    sumImpr     += impressions;
    sumClicks   += clicks;
    weightedPos += position * impressions;
  }

  const totals = {
    impressions: sumImpr,
    clicks:      sumClicks,
    ctr:         sumImpr > 0 ? round4(sumClicks / sumImpr) : 0,
    position:    sumImpr > 0 ? round2(weightedPos / sumImpr) : 0,
  };

  return { listings, totals };
}
