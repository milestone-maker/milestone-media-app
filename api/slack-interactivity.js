// Stage 1 — Slack interactivity endpoint (approval-only, NO remediation).
//
// Slack posts here when a user taps a button on a card emitted by
// api/_lib/slackNotifier.js. This endpoint verifies the request came
// from Slack (v0 HMAC signing), extracts the incident id from the
// button's value, and flips public.incidents.status.
//
// Contract:
//   * NEVER runs a remediation executor. Stage 1 only records the
//     approver's decision — Stage 2+ will pick approved rows off the
//     table and execute per-kind fixes.
//   * NEVER writes an incident about itself (would be a feedback loop).
//   * State transitions are guarded: only rows currently in 'detected'
//     are updated. A double-click / late-arriving click on an already-
//     handled row is a no-op that preserves the first approver.
//   * Rejects invalid signatures, missing headers, and timestamps older
//     than 300 seconds (replay defense).
//
// Required env vars:
//   SLACK_SIGNING_SECRET        — from the Slack app's Basic Information
//                                  page. Used to verify inbound requests.
//   SUPABASE_URL                 — already used elsewhere.
//   SUPABASE_SERVICE_ROLE_KEY    — already used elsewhere.
//
// SLACK_BOT_TOKEN is NOT required at Stage 1 — the endpoint updates the
// original card via response_url instead of chat.update.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withSentry, setIncidentContext } from "./_lib/sentry.js";

// Slack signs the raw request bytes. Any reserialization would break
// the signature check, so bodyParser must be disabled.
export const config = {
  api: { bodyParser: false },
};

const SIGNATURE_TOLERANCE_S = 300;
const ALLOWED_ACTIONS = new Set(["incident_approve", "incident_noop"]);
const ACTION_TO_STATUS = { incident_approve: "approved", incident_noop: "noop" };
const ACTION_TO_LABEL  = { incident_approve: "Approved",  incident_noop: "Dismissed" };
const ACTION_TO_EMOJI  = { incident_approve: ":white_check_mark:", incident_noop: ":no_entry_sign:" };

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key);
  return _supabase;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// Slack v0 signature scheme:
//   base = "v0:" + timestamp + ":" + rawBody
//   expected = "v0=" + HMAC_SHA256(SIGNING_SECRET, base).digest("hex")
// See https://api.slack.com/authentication/verifying-requests-from-slack
function verifySlackSignature({ signingSecret, rawBody, timestamp, signature }) {
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const nowS = Math.floor(Date.now() / 1000);
  if (Math.abs(nowS - ts) > SIGNATURE_TOLERANCE_S) return false;

  const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const expected = `v0=${digest}`;

  // Split "v0=<hex>" -> compare hex parts constant-time.
  const [, sigHex] = signature.split("=");
  const [, expHex] = expected.split("=");
  return timingSafeEqualHex(expHex, sigHex);
}

// Best-effort POST to response_url. Fail-soft — the DB write is the
// source of truth; the message update is UX.
async function postToResponseUrl(responseUrl, body) {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn("[slack-interactivity] response_url post failed:", err?.message || err);
  }
}

// Strip the original message's actions block and append a resolution line.
// Preserves everything else so scrollback stays readable.
function buildResolvedBlocks(originalBlocks, action_id, slackUserId) {
  const preserved = Array.isArray(originalBlocks)
    ? originalBlocks.filter((b) => b && b.type !== "actions")
    : [];
  const label = ACTION_TO_LABEL[action_id] || "Handled";
  const emoji = ACTION_TO_EMOJI[action_id] || ":white_check_mark:";
  return [
    ...preserved,
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${label}* by <@${slackUserId}>`,
      },
    },
  ];
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("[slack-interactivity] SLACK_SIGNING_SECRET is not set");
    return res.status(500).json({ error: "endpoint not configured" });
  }

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (typeof timestamp !== "string" || typeof signature !== "string") {
    return res.status(401).json({ error: "missing signature" });
  }

  const rawBody = await readRawBody(req);

  if (
    !verifySlackSignature({
      signingSecret,
      rawBody,
      timestamp,
      signature,
    })
  ) {
    return res.status(401).json({ error: "invalid signature" });
  }

  // Slack sends application/x-www-form-urlencoded with a single field
  // "payload" whose value is URL-encoded JSON.
  let payload;
  try {
    const params = new URLSearchParams(rawBody.toString("utf8"));
    const raw = params.get("payload");
    if (!raw) return res.status(400).json({ error: "missing payload" });
    payload = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "invalid payload" });
  }

  if (payload?.type !== "block_actions") {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = actions[0] || {};
  const action_id = action.action_id;
  const incidentId = typeof action.value === "string" ? action.value : null;
  const slackUserId = payload.user?.id || null;
  const responseUrl = payload.response_url || null;
  const originalBlocks = payload.message?.blocks || [];

  // Tag the Sentry scope in case anything downstream throws.
  setIncidentContext(req, { kind: "slack_interactivity", incident_id: incidentId });

  if (!action_id || !ALLOWED_ACTIONS.has(action_id)) {
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: `Unknown action \`${action_id || ""}\` — nothing was changed.`,
    });
    return res.status(200).end();
  }

  if (!incidentId) {
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: "Button had no incident id attached — nothing was changed.",
    });
    return res.status(200).end();
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error("[slack-interactivity] supabase not configured");
    return res.status(500).json({ error: "endpoint not configured" });
  }

  const newStatus = ACTION_TO_STATUS[action_id];
  const nowIso = new Date().toISOString();

  // Guarded UPDATE — only rows still in 'detected' are touched. Zero rows
  // returned means someone (or the same clicker twice) already handled it.
  const { data: updated, error: updErr } = await supabase
    .from("incidents")
    .update({
      status: newStatus,
      approver: slackUserId,
      updated_at: nowIso,
    })
    .eq("id", incidentId)
    .eq("status", "detected")
    .select("id, status, approver, updated_at");

  if (updErr) {
    console.error("[slack-interactivity] update error:", updErr);
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text: `Update failed: ${updErr.message}`,
    });
    return res.status(500).json({ error: "update failed" });
  }

  if (Array.isArray(updated) && updated.length === 1) {
    // Success — replace the original card so the buttons disappear and
    // the resolution shows up in scrollback.
    await postToResponseUrl(responseUrl, {
      replace_original: true,
      response_type: "in_channel",
      text: `${ACTION_TO_LABEL[action_id]} incident`,
      blocks: buildResolvedBlocks(originalBlocks, action_id, slackUserId),
    });
    return res.status(200).end();
  }

  // Zero rows updated → either not found, or already handled. Fetch
  // current state so we can attribute the earlier approver correctly.
  const { data: current } = await supabase
    .from("incidents")
    .select("id, status, approver")
    .eq("id", incidentId)
    .maybeSingle();

  if (!current) {
    await postToResponseUrl(responseUrl, {
      response_type: "in_channel",
      text: `Incident \`${incidentId}\` not found.`,
    });
    return res.status(200).end();
  }

  const attribution = current.approver
    ? ` by <@${current.approver}>`
    : "";
  await postToResponseUrl(responseUrl, {
    response_type: "in_channel",
    text: `Incident \`${incidentId}\` is already *${current.status}*${attribution} — nothing was changed.`,
  });
  return res.status(200).end();
}

export default withSentry(handler);
