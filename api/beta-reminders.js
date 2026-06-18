// Vercel Serverless Function — Daily beta-access reminder emails
// GET/POST /api/beta-reminders
//
// Triggered by Vercel Cron (see vercel.json: daily at 14:00 UTC). For
// each beta agent with a non-null beta_expires_at, sends at most ONE
// reminder per run — the most urgent unsent one:
//
//   expired (today or earlier)  → expiry email,  set beta_notified_expiry
//   <= 3 days remaining         → 3-day email,   set beta_notified_3d
//   <= 14 days remaining        → 14-day email,  set beta_notified_14d
//
// When a more-urgent email is sent, the less-urgent flags get set too
// (an agent who hit 3 days without us catching the 14-day window
// shouldn't receive a stale "14 days remaining" email the next day).
// Already-true flags are never re-cleared, so nothing ever re-sends.
//
// EMAILS ONLY. This handler does not modify is_beta, beta_expires_at, or
// any access state. Real-time enforcement lives in the entitlement
// chain (migrations 045 + 046, shared/micrositeAccess.js).
//
// Auth: Authorization: Bearer ${CRON_SECRET} (mirrors api/refresh-
// mortgage-rates.js). Vercel Cron sends this header automatically.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   CRON_SECRET,
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   (for the shared Gmail OAuth2 transporter via api/_lib/mailer.js)

import { createClient } from "@supabase/supabase-js";
import {
  createTransporter, defaultFrom,
  BUSINESS_EMAIL, BUSINESS_NAME, FROM_EMAIL,
} from "./_lib/mailer.js";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";
import { withSentry } from "./_lib/sentry.js";

let _supabaseSingleton = null;
function defaultSupabase() {
  if (!_supabaseSingleton) {
    _supabaseSingleton = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabaseSingleton;
}

// Pick the most-urgent unsent reminder this agent qualifies for, or null
// if none is due. Returns:
//   { kind: 'expiry'|'3d'|'14d', flagsToSet: string[] }
// flagsToSet ALWAYS includes the kind's own flag, PLUS any less-urgent
// flag, so an agent who jumped windows doesn't get a stale follow-up.
export function pickReminder(agent, now = Date.now()) {
  if (!agent || agent.is_beta !== true || !agent.beta_expires_at) return null;
  const msLeft = new Date(agent.beta_expires_at).getTime() - now;
  const daysLeft = msLeft / 86400000;

  if (daysLeft <= 0 && !agent.beta_notified_expiry) {
    return { kind: "expiry", flagsToSet: ["beta_notified_expiry", "beta_notified_3d", "beta_notified_14d"] };
  }
  if (daysLeft > 0 && daysLeft <= 3 && !agent.beta_notified_3d) {
    return { kind: "3d", flagsToSet: ["beta_notified_3d", "beta_notified_14d"] };
  }
  if (daysLeft > 3 && daysLeft <= 14 && !agent.beta_notified_14d) {
    return { kind: "14d", flagsToSet: ["beta_notified_14d"] };
  }
  return null;
}

// ── Email body templates ─────────────────────────────────────────────
// Same gold-on-navy palette as the invite + media-ready emails so the
// brand reads as one voice. Body content is warm + plain-language;
// urgency rises across the three variants.

const HEADER_GRADIENT = "linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%)";

function shell({ heading, body, ctaLabel, ctaHref, footerNote }) {
  return `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:${HEADER_GRADIENT};padding:32px;text-align:center;">
      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#0a1628;opacity:0.7;margin-bottom:8px;">${BUSINESS_NAME}</div>
      <h1 style="margin:0;font-size:26px;color:#0a1628;font-weight:700;">${heading}</h1>
    </div>
    <div style="padding:36px 32px;">
      ${body}
      ${ctaLabel && ctaHref ? `
        <div style="text-align:center;margin:32px 0 12px;">
          <a href="${ctaHref}" style="display:inline-block;background:${HEADER_GRADIENT};color:#0a1628;text-decoration:none;font-weight:700;font-size:15px;padding:16px 40px;border-radius:8px;letter-spacing:0.05em;">${ctaLabel}</a>
        </div>` : ""}
      ${footerNote ? `<p style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.6;margin-top:24px;">${footerNote}</p>` : ""}
    </div>
    <div style="background:rgba(255,255,255,0.03);border-top:1px solid rgba(255,255,255,0.07);padding:24px 32px;text-align:center;">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">
        Questions? Reply to this email or reach us at
        <a href="mailto:${FROM_EMAIL}" style="color:#c9a84c;text-decoration:none;">${FROM_EMAIL}</a>.
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,0.2);">${BUSINESS_NAME} — Dallas–Fort Worth Metroplex</p>
    </div>
  </div>`;
}

function buildBody({ kind, agent }) {
  const firstName = ((agent.full_name || "").split(" ")[0]) || "there";
  const subscribeUrl = `${PUBLIC_APP_BASE}/?subscriptions`;
  const expiryDate = agent.beta_expires_at
    ? new Date(agent.beta_expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  if (kind === "14d") {
    return {
      subject: "Your Milestone beta ends in about two weeks",
      heading: "About two weeks left",
      html: shell({
        heading: "About two weeks left",
        body: `
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;margin-top:0;">
            Hi <strong>${firstName}</strong>,
          </p>
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
            Just a quick heads-up — your Milestone beta wraps up on <strong>${expiryDate}</strong>, about two weeks from now. No action needed today; we just want to make sure it doesn't sneak up on you.
          </p>
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
            If the platform's been earning its keep on your listings, you can roll right into a subscription whenever you're ready and keep going without a break.
          </p>`,
        ctaLabel: "Continue with a subscription →",
        ctaHref: subscribeUrl,
        footerNote: "Anything you've already published stays editable after the beta — your work doesn't disappear.",
      }),
    };
  }

  if (kind === "3d") {
    return {
      subject: "Your Milestone beta ends in 3 days",
      heading: "3 days left",
      html: shell({
        heading: "3 days left",
        body: `
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;margin-top:0;">
            Hi <strong>${firstName}</strong>,
          </p>
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
            Your Milestone beta wraps up on <strong>${expiryDate}</strong>. If you'd like to keep generating content and publishing microsites without a break, the easiest path is to start a subscription before then.
          </p>
          <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
            We'd love to keep working with you. If you have any questions about plans or pricing, just hit reply.
          </p>`,
        ctaLabel: "Continue with a subscription →",
        ctaHref: subscribeUrl,
        footerNote: "Microsites you've already published stay editable either way.",
      }),
    };
  }

  // expiry
  return {
    subject: "Your Milestone beta has ended",
    heading: "Your beta has ended",
    html: shell({
      heading: "Your beta has ended",
      body: `
        <p style="font-size:15px;color:#e0e0e0;line-height:1.7;margin-top:0;">
          Hi <strong>${firstName}</strong>,
        </p>
        <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
          Your Milestone beta access ended today. Thanks for being part of it — your feedback shaped a lot of what works on the platform now.
        </p>
        <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
          Anything you've already published stays editable — your existing microsites don't go anywhere. To keep generating new content and publishing new microsites, the easiest path is a subscription. If you'd like to talk through which plan fits, just hit reply.
        </p>`,
      ctaLabel: "See subscription plans →",
      ctaHref: subscribeUrl,
      footerNote: null,
    }),
  };
}

function buildMessage(agent, kind) {
  const { subject, html } = buildBody({ kind, agent });
  return {
    from: defaultFrom(),
    to: agent.email,
    bcc: BUSINESS_EMAIL,
    replyTo: BUSINESS_EMAIL,
    subject,
    html,
  };
}

// Public for tests.
export async function processBetaReminders({ supabase, transporter, now = Date.now() }) {
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, email, full_name, is_beta, beta_expires_at, beta_notified_14d, beta_notified_3d, beta_notified_expiry")
    .eq("is_beta", true)
    .not("beta_expires_at", "is", null);
  if (error) throw new Error(`load beta agents failed: ${error.message}`);

  const results = { scanned: agents.length, sent: 0, skipped: 0, failed: 0, items: [] };

  for (const agent of agents) {
    const due = pickReminder(agent, now);
    if (!due) { results.skipped++; results.items.push({ id: agent.id, kind: null, status: "not_due" }); continue; }
    if (!agent.email) { results.skipped++; results.items.push({ id: agent.id, kind: due.kind, status: "no_email" }); continue; }

    try {
      const message = buildMessage(agent, due.kind);
      await transporter.sendMail(message);

      const update = {};
      for (const flag of due.flagsToSet) update[flag] = true;
      const { error: updErr } = await supabase.from("agents").update(update).eq("id", agent.id);
      if (updErr) {
        // Email went out but flag write failed — log and surface; a retry
        // tomorrow would re-send. This is a "loud failure" worth seeing.
        console.error("beta-reminders: sent but failed to record flag", agent.id, updErr);
        results.failed++;
        results.items.push({ id: agent.id, kind: due.kind, status: "sent_but_flag_failed", error: updErr.message });
        continue;
      }
      results.sent++;
      results.items.push({ id: agent.id, kind: due.kind, status: "sent" });
    } catch (err) {
      // Per-agent failure does NOT stop the batch. Flags stay false so the
      // next run retries.
      console.error("beta-reminders: send failed for", agent.id, err?.message || err);
      results.failed++;
      results.items.push({ id: agent.id, kind: due.kind, status: "send_failed", error: err?.message || String(err) });
    }
  }

  return results;
}

async function handler(req, res, depsOverride) {
  // Vercel Cron sends either Authorization: Bearer <CRON_SECRET> OR the
  // x-vercel-cron header. Accept both, but ALWAYS require one.
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const provided = req.headers?.authorization || req.headers?.Authorization;
  const isVercelCron = req.headers?.["x-vercel-cron"] !== undefined;
  if (!isVercelCron && (!expected || provided !== expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const supabase = depsOverride?.supabase || defaultSupabase();
    const transporter = depsOverride?.transporter || (await createTransporter());
    const result = await processBetaReminders({
      supabase,
      transporter,
      now: depsOverride?.now ?? Date.now(),
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: "internal error", detail: err?.message });
  }
}

export default withSentry(handler);
