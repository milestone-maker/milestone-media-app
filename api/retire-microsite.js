// Vercel Serverless Function — Retire ("mark sold / take down") a microsite
// POST /api/retire-microsite
//   Body: { micrositeId }  (or { slug })
//   Headers: Authorization: Bearer <supabase access token>
//
// Retiring takes a live microsite down: it sets published = false (the
// public /p/<slug> page stops serving) AND stamps retired_at = now(). A
// retired microsite is no longer LIVE (see isMicrositeLive /
// MICROSITE_LIVE_SQL in shared/micrositeAccess.js), which is what frees a
// slot under the per-tier live-microsite cap (step 2).
//
// Retiring DELETES NOTHING — the row, slug, and property_data survive, so
// the owner can re-publish/edit via /api/publish-microsite, which clears
// retired_at and restores LIVE.
//
// Mirrors api/publish-microsite.js: same Supabase service-role singleton
// (RLS-exempt; ownership enforced explicitly in code here), same CORS set,
// same bearer extraction, same depsOverride third arg so the unit tests can
// inject a mock without a live DB.
//
// Required Vercel environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

// ── CORS helper (matches publish-microsite.js) ───────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Lazy singleton so unit tests can inject a mock via depsOverride without
// forcing a new client per request in production.
let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabaseSingleton;
}

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// ── main handler ─────────────────────────────────────────────────────
//
// depsOverride is for unit tests only — production callers use the 2-arg
// form and the lazy default supabase singleton.
async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── 1. Authenticate the caller ──
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }
    const authUser = authData.user;

    // ── 2. Validate request body ──
    const { micrositeId, slug } = req.body || {};
    if (!micrositeId && !slug) {
      return res.status(400).json({ error: "micrositeId (or slug) is required" });
    }

    // ── 3. Fetch the microsite, scoped to the calling agent ──
    //   Owner-scoping the query means a missing row OR a row owned by
    //   someone else both resolve to null → a single clean 404 that never
    //   leaks whether another agent's microsite exists.
    let query = supabase
      .from("microsites")
      .select("id, agent_id, slug, published, retired_at, sold_at")
      .eq("agent_id", authUser.id);
    query = micrositeId ? query.eq("id", micrositeId) : query.eq("slug", slug);

    const { data: microsite, error: fetchErr } = await query.maybeSingle();
    if (fetchErr) {
      console.error("retire-microsite fetch error:", fetchErr);
      return res.status(500).json({ error: "failed to load microsite" });
    }
    if (!microsite) {
      return res.status(404).json({ error: "microsite not found" });
    }

    // ── 4. Guard: a take-down is allowed for any PUBLICLY-SERVING listing ──
    //   i.e. published = true AND retired_at IS NULL. This INTENTIONALLY does
    //   NOT use isMicrositeLive (which also excludes sold): a SOLD page is
    //   still publicly served, so it CAN be taken down. Only an already-retired
    //   or unpublished row is rejected (409, no write).
    const publiclyServing =
      microsite.published === true &&
      (microsite.retired_at === null || microsite.retired_at === undefined);
    if (!publiclyServing) {
      return res.status(409).json({ error: "microsite is not live — nothing to retire" });
    }

    // ── 5. Retire: take the page down and stamp retirement ──
    const { data: updated, error: updateErr } = await supabase
      .from("microsites")
      .update({ published: false, retired_at: new Date().toISOString() })
      .eq("id", microsite.id)
      .eq("agent_id", authUser.id)
      .select()
      .single();
    if (updateErr) {
      console.error("retire-microsite update error:", updateErr);
      return res.status(500).json({ error: "failed to retire microsite: " + updateErr.message });
    }

    // ── 6. Done ──
    return res.json({ microsite: updated });
  } catch (err) {
    console.error("retire-microsite error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

export default withSentry(handler);
