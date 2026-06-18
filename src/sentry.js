// Sentry client init. Fail-soft: if VITE_SENTRY_DSN is missing (local dev,
// preview without secrets), this is a no-op so the app still boots.
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_VERCEL_ENV || "development",
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

export { Sentry };
