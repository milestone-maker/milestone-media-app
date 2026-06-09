// bundle.social API adapter (Stage 1 — agent connection flow).
//
// Single place that talks to api.bundle.social. The org-level API key is a
// server-side secret read ONLY here as process.env.BUNDLE_API_KEY and sent as
// the `x-api-key` header (bundle's auth scheme — confirmed against the live
// OpenAPI at /swagger-json, securityScheme ApiKeyAuth: { in: header, name:
// x-api-key }). The key value never appears in code and is added separately
// in the Vercel dashboard.
//
// Provider-swappable by design, matching api/_lib/mortgageRates.js: callers
// use the three named functions (createTeam / createPortalLink /
// getSocialAccountByType) and never construct bundle URLs themselves.
//
// Endpoints used (base https://api.bundle.social, all x-api-key auth):
//   POST /api/v1/team/                          → create-team    → { id, name, ... }
//   POST /api/v1/social-account/create-portal-link → { url }
//   GET  /api/v1/social-account/by-type?type=&teamId= → social account | null
//
// The leading underscore on the parent folder marks this as a private helper,
// not a deployable Vercel function.

const BUNDLE_API_BASE = "https://api.bundle.social/api/v1";

/**
 * Error thrown by bundleFetch on a non-OK response. Carries the HTTP status
 * and the parsed/raw bundle error body so callers can map to their own codes.
 */
export class BundleApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "BundleApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Low-level bundle.social request. Sets the x-api-key header from
 * process.env.BUNDLE_API_KEY, sends/parses JSON, and normalizes failures into
 * a BundleApiError. A `fetchImpl` override seam lets unit tests inject a mock
 * without a real key or network.
 *
 * @param {string} path        path under /api/v1 (e.g. "/team/")
 * @param {object} [opts]
 * @param {string} [opts.method="GET"]
 * @param {object} [opts.body]            JSON body (omitted for GET)
 * @param {string} [opts.apiKey]          override the env key (tests)
 * @param {typeof fetch} [opts.fetchImpl] override fetch (tests)
 * @returns {Promise<any>} parsed JSON response body
 */
export async function bundleFetch(path, { method = "GET", body, apiKey, fetchImpl } = {}) {
  const key = apiKey || process.env.BUNDLE_API_KEY;
  if (!key) throw new BundleApiError("BUNDLE_API_KEY is not set", { status: 0 });

  const doFetch = fetchImpl || fetch;
  const url = `${BUNDLE_API_BASE}${path}`;

  const init = {
    method,
    headers: {
      "x-api-key": key,
      "Accept": "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await doFetch(url, init);
  } catch (err) {
    throw new BundleApiError(`bundle request failed: ${err?.message || err}`, { status: 0 });
  }

  const text = await res.text().catch(() => "");
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }

  if (!res.ok) {
    const msg = (parsed && parsed.message) || res.statusText || `HTTP ${res.status}`;
    throw new BundleApiError(`bundle ${method} ${path} failed: ${res.status} ${msg}`, {
      status: res.status,
      body: parsed,
    });
  }

  return parsed;
}

/**
 * Create a bundle team for an agent. Returns the created team. bundle does NOT
 * dedupe by name, so idempotency is the caller's responsibility — only call
 * this when the agent has no stored bundle_team_id.
 *
 * @param {{ name: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createTeam({ name, fetchImpl, apiKey } = {}) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 3) throw new BundleApiError("team name must be at least 3 characters", { status: 0 });
  // bundle caps team name at 80 chars.
  const safeName = trimmed.slice(0, 80);
  const team = await bundleFetch("/team/", { method: "POST", body: { name: safeName }, fetchImpl, apiKey });
  if (!team || !team.id) throw new BundleApiError("bundle create-team returned no team id", { status: 502, body: team });
  return team;
}

/**
 * Create a hosted portal link the agent opens to connect a social account.
 * Scoped to Instagram by default. `redirectUrl` is where bundle returns the
 * agent after the portal flow.
 *
 * @param {{ teamId: string, redirectUrl?: string, socialAccountTypes?: string[], fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<string>} the portal URL
 */
export async function createPortalLink({ teamId, redirectUrl, socialAccountTypes = ["INSTAGRAM"], fetchImpl, apiKey } = {}) {
  if (!teamId) throw new BundleApiError("teamId is required for create-portal-link", { status: 0 });
  const body = { teamId, socialAccountTypes };
  if (redirectUrl) body.redirectUrl = redirectUrl;
  const out = await bundleFetch("/social-account/create-portal-link", { method: "POST", body, fetchImpl, apiKey });
  if (!out || !out.url) throw new BundleApiError("bundle create-portal-link returned no url", { status: 502, body: out });
  return out.url;
}

/**
 * Fetch a team's connected social account of a given type. Returns the account
 * object (with username/displayName) when connected, or null when none exists.
 * bundle returns 404 for "no such account" — treated here as null, not error.
 *
 * @param {{ teamId: string, type?: string, fetchImpl?: typeof fetch, apiKey?: string }} args
 * @returns {Promise<{ id: string, username?: string|null, displayName?: string|null }|null>}
 */
export async function getSocialAccountByType({ teamId, type = "INSTAGRAM", fetchImpl, apiKey } = {}) {
  if (!teamId) throw new BundleApiError("teamId is required for by-type lookup", { status: 0 });
  const qs = `?type=${encodeURIComponent(type)}&teamId=${encodeURIComponent(teamId)}`;
  try {
    const acct = await bundleFetch(`/social-account/by-type${qs}`, { method: "GET", fetchImpl, apiKey });
    // bundle may return null / empty for "not connected".
    return acct && acct.id ? acct : null;
  } catch (err) {
    if (err instanceof BundleApiError && err.status === 404) return null;
    throw err;
  }
}
