// Stage 4 — commute: Google Routes API adapter.
//
// Unlike mortgage (cron-cached) and schools (baked at publish), commute is
// LIVE and on-demand: the visitor names a destination mid-conversation and
// the chat calls this adapter with the listing's baked coordinates as origin
// and the visitor's free text as destination. Returns a typical (non-traffic)
// driving distance + duration.
//
// Uses the Google Routes API (routes.googleapis.com/directions/v2:computeRoutes)
// rather than the legacy Distance Matrix API, which is not enabled for newer
// GCP projects. routingPreference=TRAFFIC_UNAWARE gives typical drive time
// with no live-traffic dependency (per our decision).
//
// Provider-swappable by design, mirroring api/_lib/mortgageRates.js and
// api/_lib/schools.js: getCommute() is the ONLY Google-specific code. To swap
// providers, write a new function returning the same
// { distance_text, duration_text } shape.
//
// Best-effort: every failure (non-200 response, empty routes, missing field,
// network error) resolves to null. NEVER throws.
//
// Required env vars:
//   GOOGLE_MAPS_API_KEY — Google Maps key with the Routes API enabled.
//                         Read here only.

const COMPUTE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

// Fallback formatters, used only when localizedValues is absent.
function metersToMilesText(meters) {
  const mi = Number(meters) / 1609.34;
  if (!Number.isFinite(mi)) return null;
  return `${Math.round(mi * 10) / 10} mi`;
}

// Routes API duration is a protobuf-style string like "1841s".
function durationToText(duration) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(duration || "").trim());
  if (!m) return null;
  const totalMin = Math.round(Number(m[1]) / 60);
  if (!Number.isFinite(totalMin)) return null;
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min ? `${h} hr ${min} min` : `${h} hr`;
}

/**
 * Look up the typical driving distance + time from a listing's coordinates to
 * a visitor-named destination. Typical drive time only — TRAFFIC_UNAWARE, no
 * live-traffic.
 *
 * @param {{originLat:number, originLng:number, destination:string}} args
 * @returns {Promise<{distance_text:string, duration_text:string}|null>}
 */
export async function getCommute({ originLat, originLng, destination } = {}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("getCommute: GOOGLE_MAPS_API_KEY is not set");
    return null;
  }
  if (
    !Number.isFinite(Number(originLat)) ||
    !Number.isFinite(Number(originLng)) ||
    !destination ||
    typeof destination !== "string" ||
    !destination.trim()
  ) {
    return null;
  }

  try {
    const res = await fetch(COMPUTE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.localizedValues",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: Number(originLat), longitude: Number(originLng) } } },
        destination: { address: destination.trim() },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        units: "IMPERIAL",
        languageCode: "en-US",
      }),
    });

    // 400 = unresolvable destination, 403 = key/API not set up, etc.
    if (!res.ok) {
      console.error(`getCommute: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null; // empty routes → destination couldn't be routed

    // Prefer the already-formatted localized values; fall back to computing
    // from the raw distanceMeters / duration fields.
    const distance_text =
      route.localizedValues?.distance?.text || metersToMilesText(route.distanceMeters);
    const duration_text =
      route.localizedValues?.duration?.text || durationToText(route.duration);

    if (!distance_text || !duration_text) return null;

    return { distance_text, duration_text };
  } catch (err) {
    console.error("getCommute: error:", err);
    return null;
  }
}
