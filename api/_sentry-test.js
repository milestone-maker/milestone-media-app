// TEMP: remove before deploy
// Endpoint that always throws on GET so we can confirm Sentry server
// reporting works end-to-end. Wrapped with withSentry; expect a 500
// response AND a Sentry event for the same request.
import { withSentry } from "./_lib/sentry.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }
  throw new Error("Sentry server test error — fired from /api/_sentry-test");
}

export default withSentry(handler);
