// Stage 4 — mortgage rates: FRED adapter + refresh logic.
//
// Provides the single national Freddie Mac PMMS figure (30-year and
// 15-year fixed) that the microsite chat prompt will quote. The value
// is cached in public.mortgage_rates (migration 021), refreshed weekly
// by /api/refresh-mortgage-rates, and shared across all microsites.
//
// Provider-swappable by design: fetchMortgageRatesFromFred() is the ONLY
// FRED-specific code. To change providers, write a new fetch function
// returning the same { rate_30yr, rate_15yr, as_of_date, source } shape
// and point refreshMortgageRates() at it — nothing else changes, and the
// chat endpoint never touches a provider.
//
// Effectful function takes a supabase client as an argument (matching
// api/_lib/credits.js) so tests can pass a mock without monkey-patching.
//
// Required env vars:
//   FRED_API_KEY  — St. Louis Fed FRED API key (free). Read here only.
//
// FRED series:
//   MORTGAGE30US — 30-Year Fixed Rate Mortgage Average (Freddie Mac PMMS)
//   MORTGAGE15US — 15-Year Fixed Rate Mortgage Average (Freddie Mac PMMS)

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const SERIES_30YR = "MORTGAGE30US";
const SERIES_15YR = "MORTGAGE15US";
const SOURCE = "Freddie Mac PMMS via FRED";

// Fetch the latest single observation for one FRED series.
// Returns the raw observation object { date, value, ... } and logs the
// raw JSON so the operator can confirm series ids on first run.
async function fetchLatestObservation(seriesId, apiKey) {
  const url =
    `${FRED_BASE}?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=desc&limit=1`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FRED request for ${seriesId} failed: ${res.status} ${res.statusText} ${body}`);
  }

  const data = await res.json();
  // Log the raw response (key not included — it's in the URL, not here).
  console.log(`FRED raw response for ${seriesId}:`, JSON.stringify(data));

  const obs = data?.observations?.[0];
  if (!obs) {
    throw new Error(`FRED returned no observations for ${seriesId}`);
  }
  return obs;
}

// Parse a FRED observation "value" to a number. FRED uses "." to mark a
// missing value, so a non-numeric value is a hard error here.
function parseRate(seriesId, obs) {
  const raw = obs?.value;
  const n = Number(raw);
  if (raw == null || raw === "." || raw === "" || !Number.isFinite(n)) {
    throw new Error(`FRED ${seriesId} latest value is non-numeric ("${raw}") — series may have no current data`);
  }
  return n;
}

/**
 * The ONLY FRED-specific code. Fetches the latest 30-year and 15-year
 * fixed PMMS observations, validates them, and returns a provider-neutral
 * shape. Throws on any non-OK HTTP response or non-numeric value.
 *
 * @returns {Promise<{rate_30yr:number, rate_15yr:number, as_of_date:string, source:string}>}
 */
export async function fetchMortgageRatesFromFred() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error("FRED_API_KEY is not set");
  }

  const obs30 = await fetchLatestObservation(SERIES_30YR, apiKey);
  const obs15 = await fetchLatestObservation(SERIES_15YR, apiKey);

  const rate_30yr = parseRate(SERIES_30YR, obs30);
  const rate_15yr = parseRate(SERIES_15YR, obs15);

  // The 30-year observation's date is canonical. PMMS releases both
  // series together, but if they differ, warn and keep the 30-year date.
  const as_of_date = obs30.date;
  if (obs15.date !== obs30.date) {
    console.warn(
      `FRED 15-year latest date (${obs15.date}) differs from 30-year (${obs30.date}); using 30-year date as as_of_date`
    );
  }

  return { rate_30yr, rate_15yr, as_of_date, source: SOURCE };
}

/**
 * Fetch the latest rates and idempotently store them. Selects by
 * as_of_date first: if the current survey week is already stored, it's a
 * no-op. Otherwise inserts one row. Never throws — adapter/storage errors
 * are returned as { status: 'error', message } so a cron run can't crash.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function refreshMortgageRates(supabase) {
  let rates;
  try {
    rates = await fetchMortgageRatesFromFred();
  } catch (err) {
    console.error("refreshMortgageRates: adapter error:", err);
    return { status: "error", message: err.message };
  }

  try {
    const { data: existing, error: selErr } = await supabase
      .from("mortgage_rates")
      .select("id, as_of_date")
      .eq("as_of_date", rates.as_of_date)
      .maybeSingle();
    if (selErr) {
      console.error("refreshMortgageRates: select error:", selErr);
      return { status: "error", message: selErr.message };
    }

    if (existing) {
      return { status: "already-current", as_of_date: rates.as_of_date };
    }

    const { error: insErr } = await supabase
      .from("mortgage_rates")
      .insert({
        as_of_date: rates.as_of_date,
        rate_30yr:  rates.rate_30yr,
        rate_15yr:  rates.rate_15yr,
        source:     rates.source,
      });
    if (insErr) {
      // A concurrent run may have inserted the same week between our
      // select and insert; the unique constraint (23505) means the row
      // is already current — treat as success, not error.
      if (insErr.code === "23505") {
        return { status: "already-current", as_of_date: rates.as_of_date };
      }
      console.error("refreshMortgageRates: insert error:", insErr);
      return { status: "error", message: insErr.message };
    }

    return {
      status:     "inserted",
      as_of_date: rates.as_of_date,
      rate_30yr:  rates.rate_30yr,
      rate_15yr:  rates.rate_15yr,
      source:     rates.source,
    };
  } catch (err) {
    console.error("refreshMortgageRates: unexpected error:", err);
    return { status: "error", message: err.message };
  }
}

// ── read path (consumed by the chat prompt) ──────────────────────────

/**
 * Pure freshness check. True when the survey date is no more than
 * maxAgeDays whole days old relative to `now` (16 inclusive by default —
 * a little over two weekly survey cycles, so a single missed weekly
 * refresh still reads as fresh). No side effects.
 *
 * @param {string} asOfDate    YYYY-MM-DD calendar date of the survey.
 * @param {Date}   now
 * @param {number} maxAgeDays  inclusive upper bound on age in whole days.
 * @returns {boolean}
 */
export function isRateFresh(asOfDate, now = new Date(), maxAgeDays = 16) {
  if (!asOfDate) return false;
  // Parse as a UTC calendar date (midnight) and compare whole days against
  // the UTC calendar date of `now`, so the result is timezone-stable.
  const surveyMs = Date.parse(`${asOfDate}T00:00:00Z`);
  if (Number.isNaN(surveyMs)) return false;
  const nowUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const ageDays = Math.floor((nowUtcMidnight - surveyMs) / 86_400_000);
  return ageDays <= maxAgeDays;
}

/**
 * Read the most recent cached mortgage figure, but only if it's still
 * fresh. Returns null when there's no row or the latest row is stale —
 * the caller treats null as "no current figure, defer to the agent". This
 * is the only DB read; takes supabase as an argument per house convention.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{as_of_date:string, rate_30yr:number, rate_15yr:number}|null>}
 */
export async function getFreshMortgageRates(supabase, { now = new Date() } = {}) {
  const { data, error } = await supabase
    .from("mortgage_rates")
    .select("as_of_date, rate_30yr, rate_15yr")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getFreshMortgageRates: read error:", error);
    return null;
  }
  if (!data) return null;
  if (!isRateFresh(data.as_of_date, now)) return null;

  return {
    as_of_date: data.as_of_date,
    rate_30yr:  data.rate_30yr,
    rate_15yr:  data.rate_15yr,
  };
}
