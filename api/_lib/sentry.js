// Shared Sentry init + handler wrapper for Vercel serverless functions.
// Idempotent: initSentry() is safe to call from every wrapped handler.
// Fail-soft: if SENTRY_DSN is unset, init is a no-op and withSentry
// still rethrows so existing error responses are unchanged.
//
// Stage 0 (auto-remediation) additions:
//   * setIncidentContext(req, patch) — handlers stash subject identifiers on
//     req so the enrichment can attach them to the Sentry scope on throw.
//   * The catch branch reads req.incidentContext ONLY when truthy and attaches
//     it as Sentry context + tags. Success path is byte-identical to prior.
//     req is per-invocation (Node IncomingMessage) so there is no cross-request
//     leak risk.
import * as Sentry from "@sentry/node";

let _initialized = false;

export function initSentry() {
  if (_initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    _initialized = true; // remember we've decided to no-op
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
  });
  _initialized = true;
}

// Strip auth + cookie from headers before reporting.
function safeHeaders(headers) {
  if (!headers) return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "set-cookie") continue;
    out[k] = v;
  }
  return out;
}

// Handlers call this each time a subject identifier becomes known
// (agent_id, booking_id, microsite_id, content_id, stripe_event_id, etc.).
// The value lives on the per-invocation req object; each Vercel invocation
// gets its own IncomingMessage, so there is no cross-request leak.
// No-op if req or patch is missing / not an object.
export function setIncidentContext(req, patch) {
  if (!req || !patch || typeof patch !== "object") return;
  const prev =
    req.incidentContext && typeof req.incidentContext === "object"
      ? req.incidentContext
      : {};
  req.incidentContext = { ...prev, ...patch };
}

export function withSentry(handler) {
  return async function sentryWrappedHandler(req, res, ...rest) {
    initSentry();
    const dsnPresent = !!process.env.SENTRY_DSN;
    try {
      return await handler(req, res, ...rest);
    } catch (err) {
      if (dsnPresent) {
        try {
          Sentry.withScope((scope) => {
            scope.setContext("request", {
              method: req?.method,
              url: req?.url,
              headers: safeHeaders(req?.headers),
            });
            const userId =
              req?.user?.id ||
              req?.userId ||
              req?.auth?.userId ||
              undefined;
            if (userId) scope.setUser({ id: userId });

            // Stage 0 enrichment: only when a handler opted in.
            // Absent -> identical to prior behavior.
            const ctx = req?.incidentContext;
            if (ctx && typeof ctx === "object") {
              scope.setContext("incident", ctx);
              if (ctx.agent_id) scope.setTag("agent_id", String(ctx.agent_id));
              if (ctx.booking_id) scope.setTag("booking_id", String(ctx.booking_id));
              if (ctx.microsite_id) scope.setTag("microsite_id", String(ctx.microsite_id));
              if (ctx.stripe_event_id) scope.setTag("stripe_event_id", String(ctx.stripe_event_id));
              if (ctx.content_id) scope.setTag("content_id", String(ctx.content_id));
              if (ctx.kind) scope.setTag("incident_kind", String(ctx.kind));
            }

            Sentry.captureException(err);
          });
          await Sentry.flush(2000);
        } catch (_) {
          // never let Sentry reporting itself break the request
        }
      }
      throw err;
    }
  };
}
