// Vercel Serverless Function — weekly mortgage-rate refresh.
// POST/GET /api/refresh-mortgage-rates
//
// Triggered by Vercel Cron (see vercel.json: daily at 20:00 UTC). Daily +
// idempotent means a missed run self-heals the next day — the weekly
// Freddie Mac PMMS survey only changes the as_of_date once a week, so
// repeat runs are no-ops until a new survey lands.
//
// Pulls the latest 30-year and 15-year fixed PMMS figures from the FRED
// API (via the provider-swappable adapter in api/_lib/mortgageRates.js)
// and caches one row per survey week in public.mortgage_rates. The chat
// endpoint reads that cached row later — no external call happens
// mid-conversation.
//
// Authorization: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel
// Cron sends this header automatically; the same header lets an operator
// trigger a manual refresh with curl.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   FRED_API_KEY   — St. Louis Fed FRED API key (free). Used by the adapter.
//   CRON_SECRET    — shared secret guarding this endpoint. Vercel Cron
//                    sends it as a Bearer token; also used for manual runs.

import { createClient } from "@supabase/supabase-js";
import { refreshMortgageRates } from "./_lib/mortgageRates.js";
import { withSentry } from "./_lib/sentry.js";

// ── supabase singleton (matches microsite-chat.js idiom) ─────────────
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

async function handler(req, res) {
  // ── Authorize ──
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const provided = req.headers?.authorization || req.headers?.Authorization;
  if (!process.env.CRON_SECRET || provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = defaultSupabase();
  const result = await refreshMortgageRates(supabase);

  const statusCode = result.status === "error" ? 502 : 200;
  return res.status(statusCode).json(result);
}

export default withSentry(handler);
