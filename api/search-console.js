// Vercel Serverless Function — Search Console monitor (admin-only).
// GET /api/search-console?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   Headers: Authorization: Bearer <supabase access token>
//
// Returns per-listing search performance (impressions, clicks, CTR, average
// position) for the verified DOMAIN property, mapping each /p/{slug} page back
// to its listing. Stage 1: backend only, no UI.
//
// Auth is stricter than classify-photos: this endpoint is ADMIN-ONLY (a
// non-admin gets 403, not just a subscription gate). The Google call is an
// injectable seam (fetchGscRows) so tests use canned responses — no real
// credentials. With no env vars set, fetchGscRows returns "not_configured" and
// the endpoint responds 200 { connected:false } — it never crashes.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auth + microsite lookup)
//   GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_REFRESH_TOKEN, GSC_SITE_URL
//                                             (read inside _lib/searchConsole.js)

import { createClient } from "@supabase/supabase-js";
import { fetchGscRows as realFetchGscRows, mapGscRowsToListings } from "./_lib/searchConsole.js";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabaseSingleton;
}

// ── helpers ──────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isoDay(d) { return d.toISOString().slice(0, 10); }

// Default window: the last 28 days ending today (UTC).
function defaultRange() {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 28);
  return { startDate: isoDay(start), endDate: isoDay(today) };
}

// ── main handler ─────────────────────────────────────────────────────
async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase     = depsOverride?.supabase     || defaultSupabase();
  const fetchGscRows = depsOverride?.fetchGscRows  || realFetchGscRows;

  // ── 1. Auth (admin-only) ──
  const token = bearerFrom(req);
  if (!token) return res.status(401).json({ error: "missing Authorization header" });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return res.status(401).json({ error: "invalid or expired session" });
  }

  const { data: agentRow, error: agentErr } = await supabase
    .from("agents")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (agentErr) {
    console.error("[search-console] agent lookup error:", agentErr);
    return res.status(500).json({ error: "agent lookup failed", details: agentErr.message });
  }
  if (agentRow?.role !== "admin") {
    return res.status(403).json({ error: "admin_only" });
  }

  // ── 2. Date range (default = last 28 days; validate format) ──
  const q = req.query || {};
  let { startDate, endDate } = q;
  if (startDate === undefined && endDate === undefined) {
    ({ startDate, endDate } = defaultRange());
  }
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) {
    return res.status(400).json({ error: "startDate and endDate must be YYYY-MM-DD" });
  }

  // ── 3. Fetch GSC rows + map to listings ──
  try {
    const result = await fetchGscRows({ startDate, endDate });

    if (result.status === "not_configured") {
      return res.status(200).json({ connected: false, reason: "not_configured" });
    }
    if (result.status === "no_access") {
      return res.status(200).json({ connected: false, reason: "no_access" });
    }

    // status "ok" → resolve LIVE microsites and build slug → listing map.
    const { data: micrositeRows, error: msErr } = await supabase
      .from("microsites")
      .select("slug, property_data, listing_id")
      .eq("published", true)
      .is("retired_at", null);
    if (msErr) throw msErr;

    const slugMap = {};
    for (const m of micrositeRows || []) {
      if (!m?.slug) continue;
      const pd = m.property_data || {};
      slugMap[m.slug] = {
        label:      pd.address || pd.city || m.slug,
        listing_id: m.listing_id ?? null,
      };
    }

    const { listings, totals } = mapGscRowsToListings(result.rows || [], slugMap, PUBLIC_APP_BASE);
    return res.status(200).json({
      connected: true,
      range: { startDate, endDate },
      listings,
      totals,
    });
  } catch (err) {
    // Never leak service-account contents — err.message here is a GSC/Supabase
    // status or message, not credential material.
    console.error("[search-console] error:", err?.message || err);
    return res.status(500).json({ error: "search_console_failed", details: err?.message || String(err) });
  }
}

export default withSentry(handler);
