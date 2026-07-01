// scripts/test-stage1-slack-card.mjs
//
// Stage 1 smoke test — posts an interactive Slack incident card for one
// existing row in public.incidents. Does NOT insert the row itself and
// does NOT delete it. The full flow the user runs manually:
//
//   1. Insert a synthetic 'detected' row (via supabase db query, e.g.
//        insert into public.incidents (source, kind, severity, dedupe_key,
//          payload, error_message)
//        values ('manual', 'stage1_smoke_test', 'low',
//          concat('stage1_smoke:', extract(epoch from now())::text),
//          '{"note":"stage 1 button smoke test"}'::jsonb,
//          'synthetic — safe to dismiss')
//        returning id;
//   2. Run this script:
//        node scripts/test-stage1-slack-card.mjs <returned-uuid>
//      or set INCIDENT_ID=<uuid> and run without arguments.
//   3. Tap Approve (or Dismiss) in the Slack channel.
//   4. Verify the row flipped:
//        select status, approver, updated_at from public.incidents
//         where id = '<uuid>';
//   5. Delete the synthetic row when done.
//
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_WEBHOOK_URL.

import { createClient } from "@supabase/supabase-js";
import { notifyIncident } from "../api/_lib/slackNotifier.js";

const incidentId = process.argv[2] || process.env.INCIDENT_ID;
if (!incidentId) {
  console.error(
    "Usage: node scripts/test-stage1-slack-card.mjs <incident_id>\n" +
    "  (or set INCIDENT_ID env var)"
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}
if (!process.env.SLACK_WEBHOOK_URL) {
  console.error("SLACK_WEBHOOK_URL must be set");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: row, error } = await supabase
  .from("incidents")
  .select("id, kind, severity, subject_type, subject_id, agent_id, error_message, created_at, status")
  .eq("id", incidentId)
  .maybeSingle();

if (error) {
  console.error("Lookup failed:", error.message);
  process.exit(1);
}
if (!row) {
  console.error(`No incident found with id ${incidentId}`);
  process.exit(1);
}
if (row.status !== "detected") {
  console.warn(
    `Row is currently status='${row.status}' — the buttons will report "already handled" when clicked.`
  );
}

console.log(`Posting card for incident ${row.id} (kind=${row.kind}, severity=${row.severity})…`);
await notifyIncident(row);
console.log("Done. Watch the Slack channel for the interactive card.");
