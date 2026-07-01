// Stage 2 executor — replay a missed cron by importing the cron's shared
// library function and calling it directly with the service-role client.
//
// Scope (deliberately tiny):
//   * kind: 'cron_missed_run'
//   * subject_id: one of the ALLOWLISTED cron identifiers.
//
// The allowlist is the WHOLE guard. subject_id values not in the allowlist
// return a 'failed' outcome and DO NOTHING — no HTTP call, no dynamic import,
// no code path picks up an attacker-controlled value.
//
// Both allowed crons are idempotent by design:
//   * refresh-mortgage-rates: unique constraint on mortgage_rates.as_of_date
//     absorbs same-week re-runs (returns { status: 'already-current' }).
//   * beta-reminders: one-way boolean flags per agent; a re-run can only send
//     emails that were genuinely missed by the previous run.
//
// The executor NEVER throws — a caught error becomes { outcome:'failed', ... }.

import { createClient } from "@supabase/supabase-js";
import { refreshMortgageRates } from "../mortgageRates.js";
import { processBetaReminders } from "../../beta-reminders.js";
import { createTransporter } from "../mailer.js";

let _supabase = null;
function serviceRoleClient() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

const ALLOWLIST = new Set(["refresh-mortgage-rates", "beta-reminders"]);

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    try { return String(v); } catch { return "<unserializable>"; }
  }
}

/**
 * Rerun one allowlisted cron.
 *
 * @param {{ row: object, supabase?: object }} args
 * @returns {Promise<{ outcome: 'fixed'|'failed', notes: string, errorMessage?: string }>}
 */
export async function cronRerun({ row, supabase } = {}) {
  const subjectId = row?.subject_id ? String(row.subject_id) : null;

  if (!subjectId) {
    return {
      outcome: "failed",
      notes: "cronRerun: missing subject_id (expected a cron identifier)",
      errorMessage: "missing subject_id",
    };
  }
  if (!ALLOWLIST.has(subjectId)) {
    return {
      outcome: "failed",
      notes: `cronRerun: subject_id '${subjectId}' is not in the allowlist`,
      errorMessage: "cron not in allowlist",
    };
  }

  const client = supabase || serviceRoleClient();
  if (!client) {
    return {
      outcome: "failed",
      notes: "cronRerun: service-role Supabase client not configured",
      errorMessage: "supabase not configured",
    };
  }

  try {
    if (subjectId === "refresh-mortgage-rates") {
      const result = await refreshMortgageRates(client);
      // refreshMortgageRates itself never throws — it returns { status: 'error', message }
      // on failure. Treat that as failed.
      if (result?.status === "error") {
        return {
          outcome: "failed",
          notes: `refresh-mortgage-rates returned error: ${result.message || "unknown"}`,
          errorMessage: result.message || "refresh-mortgage-rates error",
        };
      }
      return {
        outcome: "fixed",
        notes: `refresh-mortgage-rates: ${safeStringify(result)}`,
      };
    }

    if (subjectId === "beta-reminders") {
      const transporter = await createTransporter();
      const result = await processBetaReminders({ supabase: client, transporter });
      return {
        outcome: "fixed",
        notes: `beta-reminders: scanned=${result?.scanned ?? 0} sent=${result?.sent ?? 0} skipped=${result?.skipped ?? 0} failed=${result?.failed ?? 0}`,
      };
    }

    // Unreachable — ALLOWLIST covers every branch above.
    return {
      outcome: "failed",
      notes: `cronRerun: no branch for allowlisted subject_id '${subjectId}' (bug)`,
      errorMessage: "no branch",
    };
  } catch (err) {
    return {
      outcome: "failed",
      notes: `cronRerun for '${subjectId}' threw: ${err?.message || String(err)}`,
      errorMessage: err?.message || String(err),
    };
  }
}
