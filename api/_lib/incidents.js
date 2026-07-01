// Shared incident-registry logger for Stage 0 auto-remediation observability.
//
// Contract:
//   * Every call is wrapped in try/catch and MUST NEVER propagate an error to
//     the request path. The handler's response is unaffected whether the write
//     succeeds, silently duplicates, or fails outright.
//   * Writes go through the service-role Supabase client and therefore bypass
//     RLS on public.incidents (migration 055).
//   * Duplicate (kind, dedupe_key) is absorbed via the UNIQUE constraint added
//     in migration 055 — repeat detections of the same failure collapse to a
//     single row.
//   * error_message is truncated to protect the row size.
//
// Stage 0 records incidents but does NOT act on them. Later stages will read
// this table from a two-way Slack app and dispatch per-kind executors.
//
// Stage 1 addition: after a genuinely NEW row lands (not a dedupe), fire a
// Slack Block Kit card with Approve / Dismiss buttons via slackNotifier.js.
// The notifier is fire-and-forget and internally try/catch-guarded — a Slack
// outage never affects the DB write or the caller's response.

import { createClient } from "@supabase/supabase-js";
import { notifyIncident } from "./slackNotifier.js";

let _supabase = null;
function getClient() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

function safeErrorMessage(err) {
  if (err == null) return null;
  if (typeof err === "string") return err.slice(0, 500);
  if (typeof err === "object" && typeof err.message === "string") {
    return err.message.slice(0, 500);
  }
  try {
    return String(err).slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Log a detected failure into public.incidents.
 *
 * Required: source, kind, dedupeKey.
 * Optional: severity ('low'|'medium'|'high'), subjectType, subjectId,
 *           agentId, payload, errorMessage.
 *
 * Idempotent by (kind, dedupe_key). Fail-soft: a Supabase error is logged
 * and swallowed; the caller never sees a throw from this function.
 */
export async function logIncident({
  source,
  kind,
  severity = "medium",
  subjectType = null,
  subjectId = null,
  dedupeKey,
  agentId = null,
  payload = null,
  errorMessage = null,
} = {}) {
  try {
    if (!source || !kind || !dedupeKey) {
      console.warn("[incidents] skipped: missing source/kind/dedupeKey");
      return;
    }
    const client = getClient();
    if (!client) return;

    const row = {
      source,
      kind,
      severity,
      subject_type: subjectType,
      subject_id: subjectId != null ? String(subjectId) : null,
      dedupe_key: dedupeKey,
      agent_id: agentId || null,
      payload: payload || {},
      error_message: safeErrorMessage(errorMessage),
    };

    // Idempotent by (kind, dedupe_key). With ignoreDuplicates:true, PostgREST
    // sends Prefer: resolution=ignore-duplicates → ON CONFLICT DO NOTHING.
    // .select() returns the inserted row array for a NEW insert and an EMPTY
    // array for a conflicting insert — that's how we distinguish "genuinely
    // new" (fire the notifier) from "already tracked" (do nothing).
    const { data: inserted, error } = await client
      .from("incidents")
      .upsert(row, { onConflict: "kind,dedupe_key", ignoreDuplicates: true })
      .select("id, kind, severity, subject_type, subject_id, agent_id, error_message, created_at");

    if (error) {
      console.warn("[incidents] insert failed (non-fatal):", error.message);
      return;
    }

    if (Array.isArray(inserted) && inserted.length === 1) {
      // Fire-and-forget Slack notifier. The notifier is itself try/catch-
      // guarded and returns a resolved promise even on error, so the .catch
      // here is belt-and-suspenders — it must never let a Slack failure
      // reach the caller.
      try {
        notifyIncident(inserted[0]).catch(() => { /* logged inside */ });
      } catch { /* noop */ }
    }
  } catch (err) {
    try {
      console.warn(
        "[incidents] logger crashed (non-fatal):",
        err?.message || err
      );
    } catch {
      /* noop */
    }
  }
}
