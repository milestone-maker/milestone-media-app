// Vercel Serverless Function — Beta invite admin endpoints
// POST /api/beta-invites
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { betaDurationDays?: int (default 90), email?: string }
//   Returns: { invite: { id, token, email, beta_duration_days,
//             invite_expires_at, status, created_at }, link: string }
// GET  /api/beta-invites
//   Headers: Authorization: Bearer <supabase access token>
//   Returns: { invites: [...], activeBetas: [...] }
//
// Both require role='admin' on the calling agent (mirrors api/search-
// console.js and others). The service-role client bypasses RLS; the
// admin gate is enforced explicitly here.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_APP_BASE (optional override; defaults to the prod custom domain)

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as pathResolve, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_APP_BASE } from "./_lib/microsite.js";
import { createTransporter, defaultFrom, BUSINESS_EMAIL, BUSINESS_NAME, FROM_EMAIL } from "./_lib/mailer.js";

// The founding-member one-pager bundled with this function (see
// vercel.json includeFiles). At runtime the file is alongside the
// compiled handler, so resolve relative to import.meta.url. Locally
// (dev/test) the same path resolves to api/_assets/.
const ONE_PAGER_FILENAME = "Milestone-Beta-Invitation.pdf";
const ONE_PAGER_PATH = (() => {
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    return pathJoin(here, "_assets", ONE_PAGER_FILENAME);
  } catch {
    return pathResolve(process.cwd(), "api", "_assets", ONE_PAGER_FILENAME);
  }
})();

// Cache the PDF bytes across warm invocations of the same Lambda.
let _onePagerCache = null;
function readOnePager() {
  if (_onePagerCache) return _onePagerCache;
  _onePagerCache = readFileSync(ONE_PAGER_PATH); // throws if missing — caller catches
  return _onePagerCache;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

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

function bearerFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function buildLink(token) {
  return `${PUBLIC_APP_BASE}/beta/accept?token=${token}`;
}

// Branded HTML body for the beta invite, mirroring the gold-on-dark look
// of send-media-ready.js so brand-perception stays consistent.
function buildInviteEmail({ to, link, durationDays }) {
  const html = `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);padding:32px;text-align:center;">
      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#0a1628;opacity:0.7;margin-bottom:8px;">${BUSINESS_NAME}</div>
      <h1 style="margin:0;font-size:26px;color:#0a1628;font-weight:700;">You're invited to the beta</h1>
    </div>
    <div style="padding:36px 32px;">
      <p style="font-size:15px;color:#e0e0e0;line-height:1.7;margin-top:0;">
        We're rolling out a new platform that turns every listing into polished, ready-to-post social content — automatically. Before we go public, we're inviting a small group of hand-picked agents to shape it with us.
      </p>
      <p style="font-size:15px;color:#e0e0e0;line-height:1.7;">
        Your beta access lasts <strong>${durationDays} days</strong> from the moment you accept. Full details are in the attached one-pager.
      </p>
      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);color:#0a1628;text-decoration:none;font-weight:700;font-size:15px;padding:16px 40px;border-radius:8px;letter-spacing:0.05em;">Accept your invitation →</a>
      </div>
      <p style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.6;margin-top:24px;word-break:break-all;">
        Or paste this link in your browser:<br>
        <span style="color:rgba(255,255,255,0.6);">${link}</span>
      </p>
    </div>
    <div style="background:rgba(255,255,255,0.03);border-top:1px solid rgba(255,255,255,0.07);padding:24px 32px;text-align:center;">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">
        Questions? Reply to this email or reach us at
        <a href="mailto:${FROM_EMAIL}" style="color:#c9a84c;text-decoration:none;">${FROM_EMAIL}</a>.
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,0.2);">${BUSINESS_NAME} — Dallas–Fort Worth Metroplex</p>
    </div>
  </div>`;

  return {
    from: defaultFrom(),
    to,
    bcc: BUSINESS_EMAIL,
    replyTo: BUSINESS_EMAIL,
    subject: "You're invited to the Milestone beta",
    html,
  };
}

// Send the invite email, ATTACH the one-pager PDF, and return a result
// describing what happened. Pure-promise: never throws — failures resolve
// to { ok:false, error } so the caller can record status without losing
// the invite. The transporter override hook lets tests inject a fake.
async function sendInviteEmail({ to, link, durationDays, transporterOverride }) {
  try {
    const pdf = readOnePager();
    const message = {
      ...buildInviteEmail({ to, link, durationDays }),
      attachments: [{
        filename: ONE_PAGER_FILENAME,
        content: pdf,
        contentType: "application/pdf",
      }],
    };
    const transporter = transporterOverride || (await createTransporter());
    const result = await transporter.sendMail(message);
    return { ok: true, messageId: result?.messageId || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Compute days remaining from a beta_expires_at timestamp. null/past → 0.
function daysRemaining(betaExpiresAt) {
  if (!betaExpiresAt) return null; // null = never expires (the demo convention)
  const ms = new Date(betaExpiresAt).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

export default async function handler(req, res, depsOverride) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = bearerFrom(req);
    if (!token) return res.status(401).json({ error: "missing Authorization header" });

    const supabase = depsOverride?.supabase || defaultSupabase();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "invalid or expired session" });
    }

    const { data: caller, error: callerErr } = await supabase
      .from("agents")
      .select("id, role")
      .eq("id", authData.user.id)
      .single();
    if (callerErr || !caller) {
      return res.status(401).json({ error: "no agent profile for this user" });
    }
    if (caller.role !== "admin") {
      return res.status(403).json({ error: "admin only" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const betaDurationDays = Number.isInteger(body.betaDurationDays)
        ? body.betaDurationDays
        : 90;
      if (betaDurationDays <= 0 || betaDurationDays > 3650) {
        return res.status(400).json({ error: "betaDurationDays must be between 1 and 3650" });
      }
      const email = (typeof body.email === "string" && body.email.trim())
        ? body.email.trim().toLowerCase()
        : null;

      // The admin form requires the email when "Send email" is checked;
      // the server enforces the same when sendEmail is requested so the
      // endpoint can't be tricked into a no-op send.
      const sendEmail = body.sendEmail === true;
      if (sendEmail && !email) {
        return res.status(400).json({ error: "email is required when sendEmail is true" });
      }

      const inviteToken = randomBytes(32).toString("hex");

      const { data: invite, error: insertErr } = await supabase
        .from("beta_invites")
        .insert({
          token: inviteToken,
          email,
          beta_duration_days: betaDurationDays,
          created_by: caller.id,
        })
        .select("id, token, email, beta_duration_days, status, invite_expires_at, created_at, email_status, email_sent_at, email_error")
        .single();
      if (insertErr || !invite) {
        return res.status(500).json({ error: "failed to create invite", detail: insertErr?.message });
      }

      const link = buildLink(invite.token);

      // Non-blocking send. A failure stamps email_status='failed' on the
      // invite row but does NOT delete the row — the admin still has the
      // copy-link fallback and sees the failed pill in the table.
      let emailFields = {
        email_status: invite.email_status,
        email_sent_at: invite.email_sent_at,
        email_error: invite.email_error,
      };
      if (sendEmail) {
        const sendResult = await sendInviteEmail({
          to: email,
          link,
          durationDays: betaDurationDays,
          transporterOverride: depsOverride?.transporter || null,
        });
        const now = new Date().toISOString();
        const update = sendResult.ok
          ? { email_status: "sent",   email_sent_at: now, email_error: null }
          : { email_status: "failed", email_sent_at: null, email_error: sendResult.error };
        const { error: updErr } = await supabase
          .from("beta_invites")
          .update(update)
          .eq("id", invite.id);
        if (updErr) {
          // The send itself succeeded or failed cleanly; we just couldn't
          // record the status. Log and report the underlying send state
          // so the admin's UI still reflects reality on the next refresh.
          console.error("beta-invites: failed to record email status", updErr);
        }
        emailFields = update;
      }

      return res.status(200).json({
        invite: { ...invite, ...emailFields },
        link,
        email: sendEmail ? {
          attempted: true,
          ok: emailFields.email_status === "sent",
          error: emailFields.email_error || null,
        } : { attempted: false },
      });
    }

    // GET — list invites + active betas.
    const { data: invites, error: invitesErr } = await supabase
      .from("beta_invites")
      .select("id, token, email, beta_duration_days, status, invite_expires_at, accepted_by, accepted_at, created_at, email_status, email_sent_at, email_error")
      .order("created_at", { ascending: false });
    if (invitesErr) {
      return res.status(500).json({ error: "failed to list invites", detail: invitesErr.message });
    }

    // Active beta agents: is_beta = true (regardless of expiry; UI surfaces remaining).
    const { data: betaAgents, error: betaErr } = await supabase
      .from("agents")
      .select("id, email, full_name, beta_expires_at")
      .eq("is_beta", true)
      .order("beta_expires_at", { ascending: true, nullsFirst: false });
    if (betaErr) {
      return res.status(500).json({ error: "failed to list active betas", detail: betaErr.message });
    }

    const activeBetas = (betaAgents || []).map((a) => ({
      id: a.id,
      email: a.email,
      full_name: a.full_name,
      beta_expires_at: a.beta_expires_at,
      days_remaining: daysRemaining(a.beta_expires_at),
    }));

    const invitesWithLink = (invites || []).map((i) => ({ ...i, link: buildLink(i.token) }));

    return res.status(200).json({ invites: invitesWithLink, activeBetas });
  } catch (err) {
    return res.status(500).json({ error: "internal error", detail: err?.message });
  }
}
