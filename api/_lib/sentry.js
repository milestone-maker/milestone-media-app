// Shared Sentry init + handler wrapper for Vercel serverless functions.
// Idempotent: initSentry() is safe to call from every wrapped handler.
// Fail-soft: if SENTRY_DSN is unset, init is a no-op and withSentry
// still rethrows so existing error responses are unchanged.
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
