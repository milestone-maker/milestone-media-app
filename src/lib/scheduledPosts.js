// Pure decision logic for the Stage 3c "upcoming posts" UI — DOM-free and
// importable by both the React app and node tests. Operates on the rows
// returned by GET /api/social-posts (one social_posts row + content_label).
//
// A row is "active" when it represents a real, live bundle post: status
// 'submitted', a bundle_post_id, and not canceled. Pending/failed/canceled rows
// are inert here.

// ~2 minutes: the window in which a just-attempted schedule should show up in
// the list, used to reconcile a soft-timeout into a confirmed success.
export const RECONCILE_WINDOW_MS = 2 * 60 * 1000;

export function isActive(row) {
  return !!row
    && row.status === "submitted"
    && !row.canceled_at
    && !!row.bundle_post_id;
}

// The most-recent active record in a set of rows (by created_at desc), or null.
export function latestActive(rows) {
  const active = (rows || []).filter(isActive);
  if (!active.length) return null;
  return active.slice().sort(
    (a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0),
  )[0];
}

// Whether a row is an UPCOMING post: active AND scheduled strictly in the
// future relative to `now` (a Date).
export function isUpcoming(row, now) {
  if (!isActive(row)) return false;
  const ms = row.scheduled_for ? Date.parse(row.scheduled_for) : NaN;
  return !Number.isNaN(ms) && ms > now.getTime();
}

// All upcoming posts across listings, soonest first.
export function upcomingPosts(rows, now) {
  return (rows || [])
    .filter((r) => isUpcoming(r, now))
    .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
}

// Schedule state for ONE carousel's rows (already filtered to a contentId):
//   { kind: "scheduled", record } — an active record is scheduled in the future
//   { kind: "posted",    record } — an active record's time is in the past
//   { kind: "none",      record: null } — no active record
export function scheduleState(rows, now) {
  const record = latestActive(rows);
  if (!record) return { kind: "none", record: null };
  const ms = record.scheduled_for ? Date.parse(record.scheduled_for) : NaN;
  if (!Number.isNaN(ms) && ms > now.getTime()) return { kind: "scheduled", record };
  return { kind: "posted", record };
}

// Reconciliation: after a soft "may have been scheduled" timeout, did it
// actually land? Returns the matching row (a submitted row with a bundle_post_id
// created within `windowMs`) or null. A non-null result means the schedule
// really succeeded and the UI should flip to the success state.
export function findRecentlyLanded(rows, now, windowMs = RECONCILE_WINDOW_MS) {
  const cutoff = now.getTime() - windowMs;
  const matches = (rows || []).filter((r) =>
    r
    && r.status === "submitted"
    && !!r.bundle_post_id
    && !r.canceled_at
    && typeof r.created_at === "string"
    && Date.parse(r.created_at) >= cutoff,
  );
  if (!matches.length) return null;
  // Prefer the newest match.
  return matches.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}
