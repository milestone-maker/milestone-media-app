// TEMP: remove after Sentry -> Slack relay is confirmed working in prod.
// Throws a uniquely-named error so Sentry captures it as a brand-new
// issue, which fires the issue.created webhook -> api/sentry-to-slack ->
// #milestone-alerts. The timestamp is fixed at module load (cold start)
// so repeated hits within the same deploy group into a single Sentry
// issue and only fire the Slack alert once.
import { withSentry } from "./_lib/sentry.js";

const COLD_START_TS = new Date().toISOString();

async function handler(req, res) {
  throw new Error(`RELAY TEST ${COLD_START_TS} — safe to ignore`);
}

export default withSentry(handler);
