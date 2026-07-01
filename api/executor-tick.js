// Vercel Serverless Function — Stage 2 executor tick.
// GET/POST /api/executor-tick
//
// Triggered by Vercel Cron (see vercel.json: every minute). Picks up rows in
// public.incidents that have been APPROVED by a human via Slack (Stage 1) and
// runs their per-kind executor via the dispatcher.
//
// Why cron-driven and not inline in api/slack-interactivity.js:
//   Slack expects an interactivity response within ~3 s. Real fixes can take
//   dozens of seconds. Running inline would either block Slack (timeout +
//   retry) or fire-and-forget on a serverless function that may be killed
//   after res.end(). This tick decouples the two.
//
// Concurrency model:
//   * Batch size 5 per tick (BATCH_SIZE below).
//   * Guarded per-row transition: UPDATE ... WHERE status='approved' RETURNING
//     id. Zero rows returned means another tick grabbed it — skip cleanly.
//   * A dispatched executor is expected to be idempotent by design; if it
//     dies mid-run the row stays 'running' and requires manual intervention.
//     Stage 2 does not auto-reclaim stuck 'running' rows.
//
// Auth: Authorization: Bearer ${CRON_SECRET} — same pattern as
//   api/refresh-mortgage-rates.js. Vercel Cron sends this automatically.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   CRON_SECRET
//   (optional) SLACK_WEBHOOK_URL — best-effort outcome follow-up.

import { createClient } from "@supabase/supabase-js";
import { dispatchApprovedIncident } from "./_lib/executorDispatcher.js";
import { withSentry } from "./_lib/sentry.js";

const BATCH_SIZE      = 5;
const MAX_NOTES_LEN   = 2000;
const MAX_ERROR_LEN   = 300;

let _supabase = null;
function defaultSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

function truncate(s, n) {
  if (typeof s !== "string") return s == null ? null : String(s).slice(0, n);
  return s.length > n ? s.slice(0, n) : s;
}

function appendNotes(existing, added) {
  const line = added ? String(added) : "";
  if (!line) return existing || null;
  const stamped = `[${new Date().toISOString()}] ${line}`;
  const combined = existing ? `${existing}\n${stamped}` : stamped;
  return truncate(combined, MAX_NOTES_LEN);
}

// Best-effort Slack follow-up. Uses the same webhook the notifier uses;
// silent skip if unset. Never throws.
async function postSlackOutcome({ kind, outcome, notes, errorMessage }) {
  try {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) return;
    let text;
    if (outcome === "fixed") {
      text = `:white_check_mark: Fixed \`${kind}\``;
    } else if (outcome === "failed") {
      const short = truncate(errorMessage || notes || "", 200);
      text = `:x: Fix failed for \`${kind}\`: ${short}`;
    } else {
      return;
    }
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.warn("[executor-tick] slack follow-up failed (non-fatal):", err?.message || err);
  }
}

async function handler(req, res) {
  // ── Authorize (mirrors refresh-mortgage-rates.js) ──
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const provided = req.headers?.authorization || req.headers?.Authorization;
  const isVercelCron = req.headers?.["x-vercel-cron"] !== undefined;
  if (!isVercelCron && (!expected || provided !== expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = defaultSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "supabase not configured" });
  }

  // ── Pick up the oldest approved rows first ──
  const { data: approvedRows, error: selErr } = await supabase
    .from("incidents")
    .select("id, kind, severity, subject_type, subject_id, agent_id, payload, error_message, notes, status, approver, updated_at, created_at")
    .eq("status", "approved")
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (selErr) {
    console.error("[executor-tick] select approved failed:", selErr);
    return res.status(500).json({ error: "select failed", details: selErr.message });
  }

  if (!Array.isArray(approvedRows) || approvedRows.length === 0) {
    return res.status(200).json({ processed: 0 });
  }

  const summary = { processed: 0, fixed: 0, failed: 0, no_executor: 0, skipped_race: 0 };

  for (const row of approvedRows) {
    // ── Guarded per-row transition approved → running ──
    const { data: claimed, error: claimErr } = await supabase
      .from("incidents")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "approved")
      .select("id");
    if (claimErr) {
      console.error("[executor-tick] claim failed:", claimErr);
      continue;
    }
    if (!Array.isArray(claimed) || claimed.length !== 1) {
      // Another tick grabbed it, or a human moved it out of 'approved'
      // in the millisecond since we selected. Nothing to do.
      summary.skipped_race++;
      continue;
    }

    summary.processed++;

    // ── Dispatch ──
    const outcome = await dispatchApprovedIncident({ row, supabase });

    // ── Record outcome ──
    if (outcome.outcome === "fixed" || outcome.outcome === "failed") {
      const patch = {
        status:        outcome.outcome,
        resolved_at:   new Date().toISOString(),
        updated_at:    new Date().toISOString(),
        notes:         appendNotes(row.notes, outcome.notes),
      };
      if (outcome.errorMessage) {
        patch.error_message = truncate(outcome.errorMessage, MAX_ERROR_LEN);
      }
      const { error: patchErr } = await supabase
        .from("incidents")
        .update(patch)
        .eq("id", row.id);
      if (patchErr) {
        console.error("[executor-tick] outcome patch failed:", patchErr);
      }
      if (outcome.outcome === "fixed") summary.fixed++;
      else summary.failed++;
      // Best-effort Slack follow-up.
      await postSlackOutcome({
        kind: row.kind,
        outcome: outcome.outcome,
        notes: outcome.notes,
        errorMessage: outcome.errorMessage,
      });
      continue;
    }

    // ── outcome === 'no_executor' ──
    // Revert the row to 'approved' so a future stage can add its executor
    // and the row will be picked up then. Do NOT set resolved_at.
    //
    // Tradeoff: without a hop-out mechanism, the tick re-selects the same
    // row every minute until an executor lands. That's cheap (one indexed
    // SELECT + one guarded UPDATE per row per minute) and self-heals as
    // soon as a mapping is added. We accept this over silently failing the
    // row or hiding it, either of which would obscure the queue.
    const { error: revertErr } = await supabase
      .from("incidents")
      .update({
        status:     "approved",
        updated_at: new Date().toISOString(),
        notes:      appendNotes(row.notes, outcome.notes),
      })
      .eq("id", row.id);
    if (revertErr) {
      console.error("[executor-tick] revert to approved failed:", revertErr);
    }
    summary.no_executor++;
  }

  return res.status(200).json(summary);
}

export default withSentry(handler);
