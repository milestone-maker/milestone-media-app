// Stage 1 — Slack notifier for public.incidents.
//
// Called from api/_lib/incidents.js after a genuinely NEW row lands
// (see the .select() + length check there). Posts an interactive Block
// Kit card to the existing SLACK_WEBHOOK_URL with two buttons: Approve
// (primary) and Dismiss (no-op). The button value carries the row's
// incidents.id so api/slack-interactivity.js can flip status on click.
//
// Contract:
//   * Fully try/catch-guarded — a Slack outage, malformed row, missing
//     env var, or fetch throw is logged and swallowed. This function
//     can NEVER propagate an error to the caller (incidents.js is
//     already fire-and-forget with its own outer try, but this is
//     defense in depth).
//   * NEW env vars are NOT required at this stage. We keep using the
//     existing SLACK_WEBHOOK_URL that api/sentry-to-slack.js already
//     posts to; interactivity only requires SLACK_SIGNING_SECRET on
//     the inbound endpoint side.
//   * If SLACK_WEBHOOK_URL is unset, we return quietly (dev/preview
//     without Slack wired up must not crash).
//
// Stage 1 does NOT perform remediation. Approving only flips the row's
// status — executors are a later stage.

const MAX_ERROR_LEN = 300;

function severityEmoji(severity) {
  if (severity === "high") return ":rotating_light:";
  if (severity === "low") return ":information_source:";
  return ":warning:";
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Slack markdown code-block escape — backticks in the error would break
// the fence. Replace triple-backticks with a visually equivalent form.
function safeCodeBlock(s) {
  return String(s).replace(/```/g, "``​`");
}

function buildBlocks(row) {
  const {
    id,
    kind = "unknown",
    severity = "medium",
    subject_type,
    subject_id,
    agent_id,
    error_message,
  } = row || {};

  const emoji = severityEmoji(severity);

  const fields = [
    { type: "mrkdwn", text: `*Kind*\n\`${kind}\`` },
    { type: "mrkdwn", text: `*Severity*\n${severity}` },
  ];
  if (subject_type || subject_id) {
    fields.push({
      type: "mrkdwn",
      text: `*Subject*\n${subject_type || "—"}: \`${subject_id || "—"}\``,
    });
  }
  if (agent_id) {
    fields.push({ type: "mrkdwn", text: `*Agent*\n\`${agent_id}\`` });
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${String(severity).toUpperCase()} · incident detected*`,
      },
    },
    { type: "section", fields },
  ];

  if (error_message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\`\`\`${safeCodeBlock(truncate(error_message, MAX_ERROR_LEN))}\`\`\``,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Incident \`${id}\`` }],
  });

  blocks.push({
    type: "actions",
    block_id: "incident_actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "Approve" },
        action_id: "incident_approve",
        value: String(id),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Dismiss (no-op)" },
        action_id: "incident_noop",
        value: String(id),
      },
    ],
  });

  return blocks;
}

/**
 * Post an interactive Stage-1 card for one incident row.
 * Fail-soft: never throws, never rejects; a Slack failure is logged only.
 */
export async function notifyIncident(row) {
  try {
    if (!row || !row.id) {
      console.warn("[slackNotifier] skipped: row without id");
      return;
    }
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      // Preview / dev without Slack wired up — silent skip.
      return;
    }

    const blocks = buildBlocks(row);
    const message = {
      text: `Incident detected: ${row.kind || "unknown"}`, // fallback for clients that can't render blocks
      blocks,
    };

    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
    } catch (err) {
      console.warn("[slackNotifier] fetch failed (non-fatal):", err?.message || err);
      return;
    }

    if (!resp.ok) {
      let body = "";
      try { body = await resp.text(); } catch { /* ignore */ }
      console.warn(
        `[slackNotifier] slack rejected (non-fatal): status=${resp.status} body=${body.slice(0, 200)}`
      );
    }
  } catch (err) {
    try {
      console.warn(
        "[slackNotifier] notifier crashed (non-fatal):",
        err?.message || err
      );
    } catch {
      /* noop */
    }
  }
}
