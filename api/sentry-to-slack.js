// Relay: Sentry Internal Integration webhook -> Slack Incoming Webhook.
//
// Required env vars (set in Vercel, Preview + Production):
//   SENTRY_WEBHOOK_SECRET  Client secret of the Sentry Internal Integration.
//                          Used to verify the Sentry-Hook-Signature header
//                          (HMAC-SHA256 of the raw request body).
//   SLACK_WEBHOOK_URL      Slack Incoming Webhook URL for #milestone-alerts.
//
// Manual setup (do once):
//   1. Slack: create an Incoming Webhook pointed at #milestone-alerts;
//      put the URL in SLACK_WEBHOOK_URL.
//   2. Sentry: Settings -> Developer Settings -> New Internal Integration.
//      Webhook URL: https://<prod-host>/api/sentry-to-slack
//      Enable the "Issue" webhook. Copy the client secret into
//      SENTRY_WEBHOOK_SECRET.
//
// Routing:
//   We dispatch on the Sentry-Hook-Resource request header. Today only
//   "issue" is wired up, and only its "created" action posts to Slack —
//   resolved/assigned/archived/unresolved are acknowledged with 200 and
//   silently dropped to keep #milestone-alerts low-noise.
//
// Wrapped with withSentry so failures in this relay also report to Sentry.

import crypto from "node:crypto";
import { withSentry } from "./_lib/sentry.js";

// Disable Vercel's automatic body parsing so we can HMAC the raw bytes.
// Sentry signs the exact bytes it sent; any reserialization would differ.
export const config = {
  api: { bodyParser: false },
};

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

function pick(obj, ...paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path.split(".")) {
      if (cur == null || typeof cur !== "object") { ok = false; break; }
      cur = cur[key];
    }
    if (ok && cur != null && cur !== "") return cur;
  }
  return undefined;
}

function buildIssueMessage(payload) {
  const issue = payload?.data?.issue ?? {};
  const title =
    pick(issue, "title", "metadata.title", "metadata.value", "culprit") ||
    "Sentry issue";
  const level = pick(issue, "level", "metadata.level") || "error";
  const project =
    pick(issue, "project.slug", "project.name") ||
    pick(payload, "data.project.slug", "data.project.name") ||
    "unknown";
  const culprit = pick(issue, "culprit");
  const url = pick(issue, "web_url", "permalink") || null;
  const count = pick(issue, "count");
  const timesSeen = pick(issue, "timesSeen", "times_seen");

  const headerText = url ? `<${url}|${title}>` : title;
  const fields = [
    { type: "mrkdwn", text: `*Project:*\n${project}` },
    { type: "mrkdwn", text: `*Level:*\n${level}` },
  ];
  if (culprit && culprit !== title) {
    fields.push({ type: "mrkdwn", text: `*Culprit:*\n${culprit}` });
  }
  const seen = timesSeen ?? count;
  if (seen != null) {
    fields.push({ type: "mrkdwn", text: `*Times seen:*\n${seen}` });
  }

  return {
    text: `Sentry: ${title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:rotating_light: *New Sentry issue:* ${headerText}` } },
      { type: "section", fields },
    ],
  };
}

async function postToSlack(slackUrl, message) {
  let slackRes;
  try {
    slackRes = await fetch(slackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (err) {
    return { ok: false, status: 0, body: err?.message || "fetch failed" };
  }
  if (!slackRes.ok) {
    const body = await slackRes.text().catch(() => "");
    return { ok: false, status: slackRes.status, body };
  }
  return { ok: true };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const secret = process.env.SENTRY_WEBHOOK_SECRET;
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!secret || !slackUrl) {
    return res.status(500).json({ error: "relay not configured" });
  }

  const raw = await readRawBody(req);
  const signature = req.headers["sentry-hook-signature"];
  if (!signature || typeof signature !== "string") {
    return res.status(401).json({ error: "missing signature" });
  }
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!timingSafeEqualHex(expected, signature)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  const resource = (req.headers["sentry-hook-resource"] || "").toString().toLowerCase();
  const action = (payload?.action || "").toString().toLowerCase();

  // Route on the resource. Today only "issue" + action "created" is forwarded;
  // every other (resource, action) pair is acknowledged and dropped.
  if (resource !== "issue" || action !== "created") {
    return res.status(200).json({ ok: true, skipped: true, resource, action });
  }

  const message = buildIssueMessage(payload);
  const slack = await postToSlack(slackUrl, message);
  if (!slack.ok) {
    return res.status(502).json({ error: "slack rejected", status: slack.status, body: slack.body });
  }
  return res.status(200).json({ ok: true });
}

export default withSentry(handler);
