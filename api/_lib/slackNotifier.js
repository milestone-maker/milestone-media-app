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
//   * NEW env vars are NOT required. Uses the existing SLACK_WEBHOOK_URL
//     that api/sentry-to-slack.js already posts to; interactivity only
//     requires SLACK_SIGNING_SECRET on the inbound endpoint side.
//   * If SLACK_WEBHOOK_URL is unset, we return quietly (dev/preview
//     without Slack wired up must not crash).
//
// Card layout (this file's job):
//   1. Header:      severity emoji + "<SEVERITY> · incident detected"
//   2. What happened:   plain-English sentence for the non-technical reader.
//   3. What it affects: the business/customer surface impacted.
//   4. What Approve does: plain sentence, ending with "Safe to approve."
//        when the executor is a proven idempotent retry, or
//        "No automatic fix available yet — for your awareness." otherwise.
//   5. Divider.
//   6. Compact context row (small, muted): kind · subject · agent.
//   7. Error code-block, if present.
//   8. Incident id (small context line).
//   9. Approve / Dismiss buttons — value carries the incident id verbatim.

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

// ─────────────────────────────────────────────────────────────────────
// Plain-English "stories" keyed by incident.kind.
//
// Each entry is a pure function of the row that returns three short lines:
//   { happened, affects, approve }
//
// The `approve` line ends with "Safe to approve." ONLY for kinds whose
// executor is a proven idempotent retry (Stage 2 slice-1 + 2b). Kinds
// with no executor mapped end with "No automatic fix available yet —
// this is for your awareness."
//
// Lines interpolate row.subject_id and row.payload where useful so the
// reader can identify the scope without opening the DB. NO async lookups
// here — the notifier is fire-and-forget and must stay fast.
// ─────────────────────────────────────────────────────────────────────

const KIND_STORIES = {
  publish_microsite_storage_move_failed: (row) => {
    const slug = row?.payload?.slug || row?.payload?.file_path?.split("/")[0] || "the listing";
    return {
      happened: `A photo didn't finish copying when publishing the microsite \`${slug}\`.`,
      affects: "That microsite's photo gallery — one photo isn't in the live gallery yet.",
      approve: "Re-copies the missing photo into the live gallery. Safe to approve — running it again can't cause any harm.",
    };
  },

  classify_photos_partial_failure: (row) => {
    const listing = row?.subject_id || "one listing";
    return {
      happened: `Some photos on listing \`${listing}\` didn't get auto-labeled the last time labeling ran.`,
      affects: "That listing's photo tags — some photos are missing their category and features.",
      approve: "Re-runs labeling on only the photos that missed it. Photos an agent already corrected by hand are never touched. Safe to approve — running it again can't cause any harm.",
    };
  },

  cron_missed_run: (row) => {
    const job = row?.subject_id || "";
    const jobLabel = job === "refresh-mortgage-rates"
      ? "The weekly mortgage-rate refresh"
      : job === "beta-reminders"
        ? "The daily beta-expiry reminder emails"
        : `The scheduled job \`${job || "unknown"}\``;
    const affects = job === "refresh-mortgage-rates"
      ? "The mortgage-rate cache the microsite chatbot reads. Visitors would see last week's rate."
      : job === "beta-reminders"
        ? "Beta agents nearing expiry might not receive their reminder email today."
        : "Whatever this scheduled job normally does.";
    return {
      happened: `${jobLabel} didn't run at its scheduled time.`,
      affects,
      approve: "Re-runs the job now. Safe to approve — if the job already ran, it simply exits without changing anything.",
    };
  },

  stripe_webhook_handler_error: () => ({
    happened: "A payment-system update from Stripe couldn't be processed.",
    affects: "One customer's subscription or credit balance might be out of sync with what Stripe shows.",
    approve: "No automatic fix available yet — this is for your awareness. You may need to check the Stripe dashboard and adjust the customer's record by hand.",
  }),

  social_post_bundle_upload_failed: () => ({
    happened: "A social-media post's images couldn't be uploaded to our posting provider.",
    affects: "One agent's scheduled post — it's marked failed and won't publish.",
    approve: "No automatic fix available yet — this is for your awareness. The agent can retry from the app.",
  }),

  social_post_bundle_create_failed: () => ({
    happened: "Images for a social-media post uploaded successfully, but the post itself couldn't be sent.",
    affects: "One agent's scheduled post — the images may have arrived at the posting provider even though the post itself didn't.",
    approve: "No automatic fix available yet — this is for your awareness. Retrying automatically could create duplicate posts.",
  }),

  social_post_handler_error: () => ({
    happened: "An unexpected error occurred while publishing a social-media post.",
    affects: "One agent's scheduled post.",
    approve: "No automatic fix available yet — this is for your awareness.",
  }),

  publish_microsite_write_failed: (row) => {
    const slug = row?.payload?.slug || "the listing";
    return {
      happened: `A microsite publish failed at the final save step for \`${slug}\`.`,
      affects: "That listing — the microsite was NOT saved.",
      approve: "No automatic fix available yet — the agent needs to re-publish the listing from their browser.",
    };
  },

  publish_microsite_handler_error: (row) => {
    const slug = row?.payload?.slug || row?.subject_id || "a listing";
    return {
      happened: `A microsite publish hit an unexpected error for \`${slug}\`.`,
      affects: "That listing — the publish may have partially completed; the microsite may or may not exist.",
      approve: "No automatic fix available yet — investigate and consider a manual re-publish.",
    };
  },
};

function storyFor(row) {
  const kind = row?.kind;
  const fn = kind && KIND_STORIES[kind];
  if (fn) {
    try {
      return fn(row);
    } catch {
      /* fall through to generic */
    }
  }
  return {
    happened: `An incident of kind \`${kind || "unknown"}\` was detected.`,
    affects: "See technical details below.",
    approve: "No automatic fix available yet — this is for your awareness.",
  };
}

export function buildBlocks(row) {
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
  const story = storyFor(row);

  const blocks = [
    // 1. Header
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${String(severity).toUpperCase()} · incident detected*`,
      },
    },
    // 2-4. Plain-English lines — the primary content for the human reader.
    { type: "section", text: { type: "mrkdwn", text: `*What happened*\n${story.happened}` } },
    { type: "section", text: { type: "mrkdwn", text: `*What it affects*\n${story.affects}` } },
    { type: "section", text: { type: "mrkdwn", text: `*What Approve does*\n${story.approve}` } },
    // 5. Divider — visually separates the story from the raw metadata.
    { type: "divider" },
  ];

  // 6. Compact technical metadata — smaller/muted context block.
  const techParts = [`*Kind:* \`${kind}\``];
  if (subject_type || subject_id) {
    techParts.push(`*Subject:* ${subject_type || "—"}: \`${subject_id || "—"}\``);
  }
  if (agent_id) techParts.push(`*Agent:* \`${agent_id}\``);
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: techParts.join(" · ") }],
  });

  // 7. Error code-block, when present.
  if (error_message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\`\`\`${safeCodeBlock(truncate(error_message, MAX_ERROR_LEN))}\`\`\``,
      },
    });
  }

  // 8. Incident id — a small context line for cross-reference.
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Incident \`${id}\`` }],
  });

  // 9. Actions — unchanged action_ids and values, so the interactivity
  //    endpoint still routes clicks exactly as it did before.
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
 * Post an interactive card for one incident row.
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
