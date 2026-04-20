// Vercel Serverless Function — Send "media ready" notification to agent
// POST /api/send-media-ready
//   Body: { booking } — full booking object from the front end
//   - Pulls agent name, address, email from booking
//   - Retrieves Stripe hosted_invoice_url if invoice is unpaid
//   - Sends branded email with media portal link + pay invoice button (if unpaid)
//
// Required Vercel environment variables (shared with other API functions):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   STRIPE_SECRET_KEY

import nodemailer from "nodemailer";
import Stripe from "stripe";

const FROM_EMAIL     = "info@milestonemediaphoto.com";
const BUSINESS_EMAIL = "smiles@milestonemediaphoto.com";
const BUSINESS_NAME  = "Milestone Media & Photography";
const APP_URL        = "https://app.milestonemediaphotography.com";

// ── OAuth2 token refresh (shared pattern with send-email.js) ──
async function refreshAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed: " + (await res.text()));
  return (await res.json()).access_token;
}

async function createTransporter() {
  const accessToken = await refreshAccessToken();
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: BUSINESS_EMAIL,
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      accessToken,
    },
  });
}

// ── Retrieve Stripe hosted invoice URL ──
async function getInvoiceUrl(stripeInvoiceId) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
    return invoice.hosted_invoice_url || null;
  } catch (e) {
    console.error("Stripe invoice retrieve error:", e.message);
    return null;
  }
}

// ── Build the media-ready email ──
function buildMediaReadyEmail(b, invoiceUrl) {
  const firstName = (b.clientName || "").split(" ")[0] || "there";
  const isPaid = b.invoicePaid;

  const paymentBlock = (!isPaid && invoiceUrl) ? `
    <div style="background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);border-radius:10px;padding:24px;margin-top:8px;text-align:center;">
      <div style="font-size:12px;color:#e74c3c;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">⚠ Payment Required to Unlock Downloads</div>
      <p style="font-size:13px;color:rgba(255,255,255,0.5);margin:0 0 18px;line-height:1.6;">
        Your media is ready and waiting — complete your invoice payment to unlock full download access.
      </p>
      <a href="${invoiceUrl}" style="display:inline-block;background:rgba(231,76,60,0.2);border:1px solid rgba(231,76,60,0.5);color:#ff6b6b;text-decoration:none;font-weight:600;font-size:13px;padding:12px 28px;border-radius:7px;letter-spacing:0.05em;">Pay Invoice Now →</a>
    </div>` : "";

  const html = `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#ffffff;border-radius:12px;overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);padding:32px;text-align:center;">
      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#0a1628;opacity:0.7;margin-bottom:8px;">${BUSINESS_NAME}</div>
      <h1 style="margin:0;font-size:28px;color:#0a1628;font-weight:700;">Your Media is Ready</h1>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">
      <p style="font-size:15px;color:#e0e0e0;line-height:1.7;margin-top:0;">
        Hi <strong>${firstName}</strong>,<br><br>
        Great news — your shoot is complete and your media has been uploaded and is ready for you to view and download.
      </p>

      <!-- Property card -->
      <div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:20px;margin:24px 0;">
        <div style="font-size:11px;color:#c9a84c;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">Property</div>
        <div style="font-size:18px;color:#ffffff;font-weight:600;">${b.address}${b.city ? ", " + b.city : ""}</div>
      </div>

      <p style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.7;">
        Your photos, videos, and any additional deliverables are available in your client portal.
        Log in below to view and download everything — MLS-ready and delivered at full resolution.
      </p>

      <!-- Primary CTA -->
      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#C9A84C 0%,#e8c97a 100%);color:#0a1628;text-decoration:none;font-weight:700;font-size:15px;padding:16px 40px;border-radius:8px;letter-spacing:0.05em;">View &amp; Download Your Media →</a>
      </div>

      <!-- Pay invoice block (only if unpaid and invoice URL available) -->
      ${paymentBlock}

      <!-- First time login notice -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:18px;margin-top:16px;">
        <div style="font-size:12px;color:#c9a84c;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">First time logging in?</div>
        <p style="font-size:13px;color:rgba(255,255,255,0.5);margin:0;line-height:1.6;">
          Create a free account using <strong style="color:rgba(255,255,255,0.7);">this email address</strong> — your booking will be linked automatically and your media will be waiting for you.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:rgba(255,255,255,0.03);border-top:1px solid rgba(255,255,255,0.07);padding:24px 32px;text-align:center;">
      <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.5);">Questions? We're here to help.</p>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">
        <a href="mailto:${FROM_EMAIL}" style="color:#c9a84c;text-decoration:none;">${FROM_EMAIL}</a>
        &nbsp;·&nbsp;
        <a href="tel:2147443801" style="color:#c9a84c;text-decoration:none;">(214) 744-3801</a>
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,0.2);">${BUSINESS_NAME} — Dallas–Fort Worth Metroplex</p>
    </div>

  </div>`;

  return {
    from:    `"${BUSINESS_NAME}" <${FROM_EMAIL}>`,
    to:      b.clientEmail,
    replyTo: BUSINESS_EMAIL,
    subject: `Your Media is Ready — ${b.address}`,
    html,
  };
}

// ── Handler ──
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { booking } = req.body;
    if (!booking?.clientEmail || !booking?.clientName) {
      return res.status(400).json({ error: "Missing booking data" });
    }

    // Get Stripe invoice URL if invoice is unpaid
    let invoiceUrl = null;
    if (!booking.invoicePaid && booking.stripeInvoiceId) {
      invoiceUrl = await getInvoiceUrl(booking.stripeInvoiceId);
    }

    const transporter = await createTransporter();
    const result = await transporter.sendMail(buildMediaReadyEmail(booking, invoiceUrl));

    return res.status(200).json({ success: true, messageId: result.messageId });
  } catch (err) {
    console.error("Media ready email error:", err);
    return res.status(500).json({ error: "Failed to send email", details: err.message });
  }
}
