// Relay: Sentry alert webhook -> Slack Incoming Webhook.
//
// Required env vars (set in Vercel, Preview + Production):
//   SENTRY_WEBHOOK_SECRET  Client secret of the Sentry Internal Integration.
//                          Used to verify the Sentry-Hook-Signature header
//                          (HMAC-SHA256 of the raw request body).
//   SLACK_WEBHOOK_URL      Slack Incoming Webhook URL for #milestone-alerts.
//
// Manual setup (do once per environment):
//   1. Slack: create an Incoming Webhook in the Milestone workspace pointed
//      at #milestone-alerts. Copy the URL into SLACK_WEBHOOK_URL.
//   2. Sentry: Settings -> Developer Settings -> New Internal Integration.
//      Webhook URL: https://<your-prod-host>/api/sentry-to-slack
//      Enable "Alerts" + "Issue" webhooks. Copy the client secret into
//      SENTRY_WEBHOOK_SECRET.
//   3. Sentry: Alerts -> Create Alert Rule. Scope:
//        Environment = production
//        When: a new issue is created
//        Action: send a notification via <Internal Integration name>
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

function buildSlackMessage(payload) {
  // Sentry payload shapes vary between "issue" and "event_alert" webhooks.
  // Try both locations for each field.
  const title =
    pick(payload, "data.event.title", "data.event.metadata.title", "data.issue.title", "data.event.message") ||
    "Sentry alert";
  const level =
    pick(payload, "data.event.level", "data.issue.level") || "error";
  const environment =
    pick(payload, "data.event.environment", "data.issue.project.environment") || "unknown";
  const project =
    pick(payload, "data.event.project_slug", "data.issue.project.slug", "data.event.project") || "unknown";
  const url =
    pick(payload, "data.event.web_url", "data.issue.web_url", "data.event.url") || null;
  const rule = pick(payload, "data.triggered_rule");

  const headerText = url ? `<${url}|${title}>` : title;
  const fields = [
    { type: "mrkdwn", text: `*Project:*\n${project}` },
    { type: "mrkdwn", text: `*Environment:*\n${environment}` },
    { type: "mrkdwn", text: `*Level:*\n${level}` },
  ];
  if (rule) fields.push({ type: "mrkdwn", text: `*Rule:*\n${rule}` });

  return {
    text: `Sentry: ${title}`, // fallback for notifications
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:rotating_light: *${headerText}*` } },
      { type: "section", fields },
    ],
  };
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

  const message = buildSlackMessage(payload);

  let slackRes;
  try {
    slackRes = await fetch(slackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (err) {
    return res.status(502).json({ error: "slack request failed", detail: err?.message });
  }

  if (!slackRes.ok) {
    const body = await slackRes.text().catch(() => "");
    return res.status(502).json({ error: "slack rejected", status: slackRes.status, body });
  }

  return res.status(200).json({ ok: true });
}

export default withSentry(handler);
