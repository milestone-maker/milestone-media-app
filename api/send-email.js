// Vercel Serverless Function — Send booking confirmation emails via Gmail SMTP
// POST /api/send-email
//   Body: { booking } with booking details
//   Sends two emails:
//     1. Notification to business owner (smiles@milestonemediaphoto.com)
//     2. Confirmation to the client
//
// Required Vercel environment variables:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   (reuses same OAuth2 creds as calendar.js)

import nodemailer from "nodemailer";

const BUSINESS_EMAIL = "smiles@milestonemediaphoto.com";
const BUSINESS_NAME = "Milestone Media & Photography";

// ── OAuth2 token refresh ──
async function refreshAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed: " + (await res.text()));
  const data = await res.json();
  return data.access_token;
}

// ── Create transporter ──
async function createTransporter() {
  const accessToken = await refreshAccessToken();
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: BUSINESS_EMAIL,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      accessToken,
    },
  });
}

// ── Format currency ──
function fmtPrice(n) {
  return "$" + Number(n).toLocaleString("en-US");
}

// ── Build owner notification email ──
function buildOwnerEmail(b) {
  const services = (b.services || []).map(s => `<li>${s.name} — ${fmtPrice(s.price)}</li>`).join("");
  const addons = (b.addons || []).map(a => `<li>${a.name} — ${fmtPrice(a.price)}</li>`).join("");

  const html = `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);padding:24px 32px;">
      <h1 style="margin:0;font-size:22px;color:#0a1628;font-weight:700;">New Booking Received</h1>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#e0e0e0;">
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;width:140px;">Client</td><td style="padding:8px 0;">${b.clientName}</td></tr>
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Email</td><td style="padding:8px 0;"><a href="mailto:${b.clientEmail}" style="color:#C9A84C;">${b.clientEmail}</a></td></tr>
        ${b.clientPhone ? `<tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Phone</td><td style="padding:8px 0;"><a href="tel:${b.clientPhone}" style="color:#C9A84C;">${b.clientPhone}</a></td></tr>` : ""}
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Property</td><td style="padding:8px 0;">${b.address}</td></tr>
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Size</td><td style="padding:8px 0;">${b.sqftTier || "N/A"}</td></tr>
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Access</td><td style="padding:8px 0;">${b.accessMethod || "N/A"}</td></tr>
        <tr><td style="padding:8px 0;color:#C9A84C;font-weight:600;">Date &amp; Time</td><td style="padding:8px 0;">${b.date} at ${b.time}</td></tr>
      </table>

      ${b.packageName ? `<div style="margin-top:20px;padding:16px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.25);border-radius:8px;">
        <div style="font-size:12px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Package</div>
        <div style="font-size:16px;color:#fff;font-weight:600;">${b.packageName}</div>
      </div>` : ""}

      ${services ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Services</div>
        <ul style="margin:0;padding-left:20px;color:#e0e0e0;">${services}</ul>
      </div>` : ""}

      ${addons ? `<div style="margin-top:16px;">
        <div style="font-size:12px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Add-ons</div>
        <ul style="margin:0;padding-left:20px;color:#e0e0e0;">${addons}</ul>
      </div>` : ""}

      <div style="margin-top:24px;padding-top:20px;border-top:2px solid rgba(201,168,76,0.3);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:18px;color:#fff;font-weight:600;">Total</span>
        <span style="font-size:26px;color:#C9A84C;font-weight:700;">${fmtPrice(b.total)}</span>
      </div>
    </div>
  </div>`;

  return {
    from: `"${BUSINESS_NAME}" <${BUSINESS_EMAIL}>`,
    to: BUSINESS_EMAIL,
    subject: `New Booking — ${b.clientName} — ${b.address}`,
    html,
  };
}

// ── Build client confirmation email ──
function buildClientEmail(b) {
  const services = (b.services || []).map(s => `<li style="padding:4px 0;">${s.name} — ${fmtPrice(s.price)}</li>`).join("");
  const addons = (b.addons || []).map(a => `<li style="padding:4px 0;">${a.name} — ${fmtPrice(a.price)}</li>`).join("");

  const html = `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);padding:28px 32px;text-align:center;">
      <h1 style="margin:0 0 4px;font-size:24px;color:#0a1628;font-weight:700;">Booking Confirmed</h1>
      <p style="margin:0;font-size:14px;color:#0a1628;opacity:0.7;">Milestone Media & Photography</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#e0e0e0;line-height:1.6;margin-top:0;">
        Hi ${b.clientName.split(" ")[0]},<br><br>
        Thank you for booking with Milestone Media & Photography! Here are your booking details:
      </p>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#e0e0e0;">
          <tr><td style="padding:6px 0;color:#C9A84C;font-weight:600;width:120px;">Property</td><td style="padding:6px 0;">${b.address}</td></tr>
          <tr><td style="padding:6px 0;color:#C9A84C;font-weight:600;">Date</td><td style="padding:6px 0;">${b.date}</td></tr>
          <tr><td style="padding:6px 0;color:#C9A84C;font-weight:600;">Time</td><td style="padding:6px 0;">${b.time}</td></tr>
        </table>
      </div>

      ${b.packageName ? `<div style="margin-bottom:16px;padding:14px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:8px;">
        <span style="font-size:12px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;">Package: </span>
        <span style="font-size:15px;color:#fff;font-weight:600;">${b.packageName}</span>
      </div>` : ""}

      ${services ? `<div style="margin-bottom:12px;">
        <div style="font-size:11px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Services</div>
        <ul style="margin:0;padding-left:20px;color:#e0e0e0;font-size:13px;">${services}</ul>
      </div>` : ""}

      ${addons ? `<div style="margin-bottom:12px;">
        <div style="font-size:11px;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Add-ons</div>
        <ul style="margin:0;padding-left:20px;color:#e0e0e0;font-size:13px;">${addons}</ul>
      </div>` : ""}

      <div style="margin-top:20px;padding-top:16px;border-top:2px solid rgba(201,168,76,0.3);text-align:right;">
        <span style="font-size:14px;color:rgba(255,255,255,0.5);">Total: </span>
        <span style="font-size:22px;color:#C9A84C;font-weight:700;">${fmtPrice(b.total)}</span>
      </div>

      <div style="margin-top:28px;padding:20px;background:rgba(201,168,76,0.06);border-radius:10px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;color:#e0e0e0;line-height:1.5;">
          <strong style="color:#C9A84C;">What's next?</strong><br>
          We'll arrive at the property on your scheduled date and time. Please ensure access is available.
        </p>
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.4);">
          Questions? Reply to this email or call us anytime.
        </p>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.03);padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);">Milestone Media & Photography — DFW</p>
    </div>
  </div>`;

  return {
    from: `"${BUSINESS_NAME}" <${BUSINESS_EMAIL}>`,
    to: b.clientEmail,
    replyTo: BUSINESS_EMAIL,
    subject: `Booking Confirmed — ${b.date} at ${b.time} — Milestone Media`,
    html,
  };
}

// ── Handler ──
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { booking } = req.body;
    if (!booking || !booking.clientEmail || !booking.clientName) {
      return res.status(400).json({ error: "Missing booking data" });
    }

    const transporter = await createTransporter();

    // Send both emails concurrently
    const [ownerResult, clientResult] = await Promise.all([
      transporter.sendMail(buildOwnerEmail(booking)),
      transporter.sendMail(buildClientEmail(booking)),
    ]);

    return res.status(200).json({
      success: true,
      ownerMessageId: ownerResult.messageId,
      clientMessageId: clientResult.messageId,
    });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ error: "Failed to send emails", details: err.message });
  }
};
