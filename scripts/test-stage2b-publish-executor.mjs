// scripts/test-stage2b-publish-executor.mjs
//
// Stage 2b — targeted helper that invokes the publish-microsite executor
// directly against an already-existing incident row. Does NOT insert or
// delete rows. Useful for developer debugging before trusting the tick.
//
// Usage:
//   node scripts/test-stage2b-publish-executor.mjs <incident_id>
//   (or set INCIDENT_ID env var)
//
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { publishMicrositeRerun } from "../api/_lib/executors/publishMicrositeRerun.js";

const incidentId = process.argv[2] || process.env.INCIDENT_ID;
if (!incidentId) {
  console.error(
    "Usage: node scripts/test-stage2b-publish-executor.mjs <incident_id>\n" +
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

const supabase = createClient(url, key);

const { data: row, error } = await supabase
  .from("incidents")
  .select("id, kind, severity, subject_type, subject_id, agent_id, payload, error_message, status")
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
if (row.kind !== "publish_microsite_storage_move_failed") {
  console.warn(`Row kind is '${row.kind}', not 'publish_microsite_storage_move_failed' — running anyway.`);
}

console.log(`Running publish-microsite executor for incident ${row.id}…`);
const result = await publishMicrositeRerun({ row, supabase });
console.log("outcome:", result.outcome);
console.log("notes:  ", result.notes);
if (result.errorMessage) console.log("error:  ", result.errorMessage);
process.exit(result.outcome === "fixed" ? 0 : 1);
