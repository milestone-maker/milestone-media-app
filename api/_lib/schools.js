// Stage 4 — nearby schools: geocoder + NCES directory adapter.
//
// Produces a small, directory-only list of nearby K-12 schools to be baked
// onto a microsite at publish time (a snapshot, not a live chat fetch). The
// chat reads the baked list back and always pairs it with a "confirm zoning
// with the district" disclaimer.
//
// DIRECTORY INFO ONLY — name, level, public/charter, location. This adapter
// NEVER touches demographics, enrollment, test scores, or ratings, and only
// ever calls the /directory/ endpoint. (The CCD directory row carries many
// other fields; we extract a fixed allowlist and discard the rest.)
//
// Provider-swappable by design, mirroring api/_lib/mortgageRates.js:
//   • geocodeAddress()         — the ONLY US-Census-specific code.
//   • fetchSchoolsInCounty()   — the ONLY Urban-Institute/NCES-specific code.
//   • getNearbySchools()       — provider-neutral orchestrator. To swap a
//     provider, replace one fetch function with one returning the same shape.
//
// Both data sources are FREE and need NO API key. Every external call is
// wrapped so failures resolve to null/[] — this is best-effort data and the
// orchestrator never throws.
//
// Sources:
//   US Census Geocoder (onelineaddress → geographies): address → lat/lng + county FIPS.
//   Urban Institute Education Data API, NCES CCD directory: county → schools.

const CENSUS_GEOCODER =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const CCD_DIRECTORY_BASE =
  "https://educationdata.urban.org/api/v1/schools/ccd/directory";

// Directory years to try, newest first. The latest CCD directory lags by a
// couple of years and the newest isn't always posted, so we step back until
// a year returns rows for the county.
const DIRECTORY_YEARS = [2023, 2022, 2021, 2020];

// CCD school_level coding (verified against live 48085 data):
//   1 = primary/elementary, 2 = middle, 3 = high.
//   4 = other, 0/6/7 = pre-K/adult/ungraded, -1/-2 = missing/NA.
// When the code is NOT 1/2/3 we fall back to the grade range (see
// deriveLevel); schools that are unusable on both signals are excluded.
const LEVEL_MAP = { 1: "elementary", 2: "middle", 3: "high" };

// Title-case a school name without expanding abbreviations:
//   "PROSPER H S" → "Prosper H S", "FOUNDERS ACADEMY - FRISCO" → "Founders Academy - Frisco".
function titleCase(name) {
  if (!name || typeof name !== "string") return name;
  return name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// A CCD grade-offered value is usable only when it's a real non-negative
// integer (the API uses null and -1 for missing/NA).
function usableGrade(g) {
  return Number.isInteger(g) && g >= 0;
}

// Resolve a school's level. A valid school_level code (1/2/3) always wins;
// only when the code is absent do we derive from the highest grade offered:
//   offers grade 9+ → high; grades 6–8 → middle; highest ≤ 5 → elementary.
// Returns null (exclude) when neither signal is usable.
function deriveLevel(school_level, highest_grade_offered) {
  if (LEVEL_MAP[school_level]) return LEVEL_MAP[school_level];
  if (!usableGrade(highest_grade_offered)) return null;
  if (highest_grade_offered >= 9) return "high";
  if (highest_grade_offered >= 6) return "middle";
  return "elementary"; // highest grade offered ≤ 5
}

const EARTH_RADIUS_MI = 3958.7613;

// ── geocoding (US Census) ────────────────────────────────────────────

/**
 * Geocode a one-line address via the free US Census geocoder.
 * Returns { lat, lng, state_fips, county_fips } or null when there are no
 * matches or on any error. county_fips is the 5-digit county GEOID.
 *
 * @param {string} address
 * @returns {Promise<{lat:number, lng:number, state_fips:string, county_fips:string}|null>}
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  try {
    const url =
      `${CENSUS_GEOCODER}?address=${encodeURIComponent(address)}` +
      `&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`geocodeAddress: HTTP ${res.status} for "${address}"`);
      return null;
    }
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match) return null;

    const lng = Number(match.coordinates?.x);
    const lat = Number(match.coordinates?.y);
    const county = match.geographies?.Counties?.[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !county) return null;

    const state_fips  = county.STATE;          // 2-digit
    const county_fips = county.GEOID;          // 5-digit (state+county)
    if (!state_fips || !county_fips) return null;

    return { lat, lng, state_fips, county_fips };
  } catch (err) {
    console.error("geocodeAddress: error:", err);
    return null;
  }
}

// ── NCES CCD directory (Urban Institute) ─────────────────────────────

// Pull one school object down to the directory-only allowlist. Returns null
// when the school has no usable coordinates (can't be distance-ranked).
function pickSchoolFields(row) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return null;
  }
  return {
    name:                  row.school_name,
    school_level:          row.school_level,
    charter:               row.charter,
    lat,
    lng,
    ncessch:               row.ncessch,
    // Directory-only grade range, kept solely for the level fallback in
    // getNearbySchools when school_level is missing. Not demographics.
    lowest_grade_offered:  row.lowest_grade_offered,
    highest_grade_offered: row.highest_grade_offered,
  };
}

/**
 * Fetch the CCD directory rows for one county. Tries DIRECTORY_YEARS newest-
 * first and uses the first year that yields county rows.
 *
 * The API's `county_code` query param does NOT narrow results server-side
 * (verified: it returns the whole state), so we request the state with
 * `fips` and filter to the county client-side — that client filter is the
 * guarantee regardless of whether the server ever honors county_code.
 * Pagination via `next` is followed to exhaustion (a single state is
 * typically one page).
 *
 * Returns an array of { name, school_level, charter, lat, lng, ncessch }, or
 * [] on any error.
 *
 * @param {{state_fips:string, county_fips:string}} loc
 * @returns {Promise<Array>}
 */
export async function fetchSchoolsInCounty({ state_fips, county_fips } = {}) {
  if (!state_fips || !county_fips) return [];

  for (const year of DIRECTORY_YEARS) {
    try {
      // Send county_code too (harmless if ignored), but rely on the client filter.
      let next =
        `${CCD_DIRECTORY_BASE}/${year}/?fips=${encodeURIComponent(state_fips)}` +
        `&county_code=${encodeURIComponent(county_fips)}`;

      const matched = [];
      let pages = 0;
      const MAX_PAGES = 25; // safety backstop; a single state is usually 1 page

      while (next && pages < MAX_PAGES) {
        const res = await fetch(next);
        if (!res.ok) {
          console.error(`fetchSchoolsInCounty: HTTP ${res.status} for ${year}`);
          matched.length = 0;
          break;
        }
        const data = await res.json();
        for (const row of (data?.results || [])) {
          if (String(row.county_code) !== String(county_fips)) continue;
          // Keep ONLY regular schools (CCD school_type: 1=Regular, 2=Special
          // education, 3=Vocational/CTE, 4=Alternative/other e.g. DAEP/JJAEP).
          // This is a structural school-type filter, not demographics. Regular
          // charters survive — charter is a separate flag from school_type, so
          // a (school_type=1, charter=1) row is kept.
          if (Number(row.school_type) !== 1) continue;
          const picked = pickSchoolFields(row);
          if (picked) matched.push(picked);
        }
        next = data?.next || null;
        pages++;
      }

      if (matched.length) {
        console.log(
          `fetchSchoolsInCounty: year=${year} path=fips+client-filter ` +
          `county=${county_fips} matched=${matched.length} pages=${pages}`
        );
        return matched;
      }
      console.log(`fetchSchoolsInCounty: year=${year} returned 0 rows for ${county_fips}, trying older year`);
    } catch (err) {
      console.error(`fetchSchoolsInCounty: error for year ${year}:`, err);
      // try the next (older) year
    }
  }
  return [];
}

// ── orchestrator ─────────────────────────────────────────────────────

// Haversine great-circle distance in miles.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const LEVEL_ORDER = { elementary: 0, middle: 1, high: 2 };

/**
 * Best-effort nearby-schools lookup. Geocodes the address, pulls the county's
 * CCD directory, computes straight-line distance to each school, and keeps the
 * nearest `perLevel` per elementary/middle/high.
 *
 * Returns a clean array sorted by level then distance:
 *   [{ name, level, type, distance_mi }]
 * Returns [] (never throws) when the address can't be geocoded or no schools
 * are found.
 *
 * @param {string} address
 * @param {{perLevel?:number}} [opts]
 * @returns {Promise<Array<{name:string, level:string, type:string, distance_mi:number}>>}
 */
export async function getNearbySchools(address, { perLevel = 3 } = {}) {
  try {
    const geo = await geocodeAddress(address);
    if (!geo) return [];

    const candidates = await fetchSchoolsInCounty({
      state_fips:  geo.state_fips,
      county_fips: geo.county_fips,
    });
    if (!candidates.length) return [];

    // Bucket by resolved level (code first, grade-range fallback when the
    // code is missing), attaching distance + type.
    const buckets = { elementary: [], middle: [], high: [] };
    for (const s of candidates) {
      const level = deriveLevel(s.school_level, s.highest_grade_offered);
      if (!level) continue; // unusable on both signals → exclude
      buckets[level].push({
        name:        titleCase(s.name),
        level,
        type:        Number(s.charter) === 1 ? "charter" : "public",
        distance_mi: Math.round(haversineMiles(geo.lat, geo.lng, s.lat, s.lng) * 10) / 10,
      });
    }

    const out = [];
    for (const level of ["elementary", "middle", "high"]) {
      buckets[level].sort((a, b) => a.distance_mi - b.distance_mi);
      out.push(...buckets[level].slice(0, perLevel));
    }

    // Final sort: level order, then distance within level.
    out.sort((a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.distance_mi - b.distance_mi
    );
    return out;
  } catch (err) {
    console.error("getNearbySchools: unexpected error:", err);
    return [];
  }
}
