// Vercel Serverless Function — Mark a microsite SOLD (sold-pages step 2a)
// POST /api/mark-sold
//   Body: { micrositeId }  (or { slug }), optional { sold_price }
//   Headers: Authorization: Bearer <supabase access token>
//
// Marking a listing SOLD is DISTINCT from retiring it. Unlike retire (which
// unpublishes → 404 + noindex), mark-sold KEEPS published = true and stamps
// sold_at, so api/render-microsite.js serves a public, INDEXABLE "Sold" page
// (SOLD badge + SoldOut JSON-LD). A sold listing is no longer strictly LIVE
// (published = true AND retired_at IS NULL AND sold_at IS NULL — see
// isMicrositeLive / MICROSITE_LIVE_SQL), so it FREES the agent's live-cap slot,
// just like retiring — but the page stays up.
//
// Marking sold DELETES NOTHING. The owner can relist via /api/publish-microsite,
// which clears sold_at (and retired_at) and restores LIVE.
//
// Mirrors api/retire-microsite.js: same service-role singleton (RLS-exempt;
// ownership enforced explicitly here), same CORS, same bearer extraction, same
// depsOverride third arg so unit tests can inject a mock without a live DB.
//
// Required Vercel environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { isMicrositeLive } from "../shared/micrositeAccess.js";

// ── CORS helper (matches retire-microsite.js) ────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

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

// Normalize an optional sold_price: a non-empty trimmed string, or null.
// Stored as free-form TEXT to match list price; null = undisclosed.
function normalizeSoldPrice(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

// ── main handler ─────────────────────────────────────────────────────
//
// depsOverride is for unit tests only — production callers use the 2-arg
// form and the lazy default supabase singleton.
export default async function handler(req, res, depsOverride) {
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
    const { micrositeId, slug, sold_price } = req.body || {};
    if (!micrositeId && !slug) {
      return res.status(400).json({ error: "micrositeId (or slug) is required" });
    }
    const soldPrice = normalizeSoldPrice(sold_price);

    // ── 3. Fetch the microsite, scoped to the calling agent ──
    //   Owner-scoping means a missing row OR another agent's row both resolve
    //   to null → one clean 404 that never leaks another agent's microsite.
    let query = supabase
      .from("microsites")
      .select("id, agent_id, slug, published, retired_at, sold_at")
      .eq("agent_id", authUser.id);
    query = micrositeId ? query.eq("id", micrositeId) : query.eq("slug", slug);

    const { data: microsite, error: fetchErr } = await query.maybeSingle();
    if (fetchErr) {
      console.error("mark-sold fetch error:", fetchErr);
      return res.status(500).json({ error: "failed to load microsite" });
    }
    if (!microsite) {
      return res.status(404).json({ error: "microsite not found" });
    }

    // ── 4. Guard: must currently be LIVE ──
    //   Already-sold, retired, or unpublished → clean 409, no write.
    //   (isMicrositeLive checks published = true AND retired_at IS NULL AND
    //    sold_at IS NULL — sold_at is selected above so the check is exact.)
    if (!isMicrositeLive(microsite)) {
      return res.status(409).json({ error: "microsite is not live — nothing to mark sold" });
    }

    // ── 5. Mark sold: stamp sold_at, optionally sold_price; KEEP published ──
    const { data: updated, error: updateErr } = await supabase
      .from("microsites")
      .update({ sold_at: new Date().toISOString(), sold_price: soldPrice })
      .eq("id", microsite.id)
      .eq("agent_id", authUser.id)
      .select()
      .single();
    if (updateErr) {
      console.error("mark-sold update error:", updateErr);
      return res.status(500).json({ error: "failed to mark microsite sold: " + updateErr.message });
    }

    // ── 6. Done ──
    return res.json({ microsite: updated });
  } catch (err) {
    console.error("mark-sold error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
