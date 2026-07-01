// Stage 2 dispatcher — routes an approved incident row to its executor by
// row.kind. Slice-1 wires ONLY 'cron_missed_run'; other approved incident
// kinds fall through to a 'no_executor' outcome and are LEFT ALONE
// (see api/executor-tick.js — it reverts status back to 'approved').
//
// Contract:
//   * Never throws. A thrown executor becomes { outcome:'failed', ... }.
//   * A missing/unmapped kind returns { outcome:'no_executor', ... } and does
//     NOT touch the row — the tick decides how to handle it.
//   * Executors themselves return { outcome, notes, errorMessage? }; the
//     dispatcher just forwards their return value on the happy path.

import { cronRerun } from "./executors/cronRerun.js";
import { publishMicrositeRerun } from "./executors/publishMicrositeRerun.js";
import { classifyPhotosRerun } from "./executors/classifyPhotosRerun.js";

// Kind -> executor function. Adding a new executor is one line here.
// Stage 2 slices 1 + 2b — DO NOT expand without an authorized slice bump.
const KIND_TO_EXECUTOR = Object.freeze({
  cron_missed_run:                       cronRerun,
  publish_microsite_storage_move_failed: publishMicrositeRerun,
  classify_photos_partial_failure:       classifyPhotosRerun,
});

/**
 * @param {{ row: object, supabase?: object }} args
 * @returns {Promise<{
 *   outcome: 'fixed'|'failed'|'no_executor',
 *   notes: string,
 *   errorMessage?: string,
 * }>}
 */
export async function dispatchApprovedIncident({ row, supabase } = {}) {
  const kind = row?.kind;
  if (!kind) {
    return {
      outcome: "failed",
      notes: "dispatcher: incident row is missing 'kind'",
      errorMessage: "missing kind",
    };
  }

  const executor = KIND_TO_EXECUTOR[kind];
  if (!executor) {
    return {
      outcome: "no_executor",
      notes: `dispatcher: no executor mapped for kind '${kind}' at this stage`,
    };
  }

  try {
    const result = await executor({ row, supabase });
    // Defensive: an executor that returns a malformed shape is treated as
    // failed rather than silently succeeding.
    if (!result || (result.outcome !== "fixed" && result.outcome !== "failed")) {
      return {
        outcome: "failed",
        notes: `dispatcher: executor for '${kind}' returned an invalid outcome`,
        errorMessage: "invalid executor outcome",
      };
    }
    return result;
  } catch (err) {
    return {
      outcome: "failed",
      notes: `dispatcher: executor for '${kind}' threw: ${err?.message || String(err)}`,
      errorMessage: err?.message || String(err),
    };
  }
}

// Exposed for tests / introspection. Frozen so callers can't mutate the map.
export const _KIND_TO_EXECUTOR = KIND_TO_EXECUTOR;
