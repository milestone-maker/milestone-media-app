// Shared Gmail OAuth2 transporter, extracted from api/send-media-ready.js
// so multiple endpoints can send mail without duplicating the refresh dance.
//
// Required env vars (same as the existing senders):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Constants below mirror send-media-ready.js exactly. Update there too if
// the from-address or business contact changes.

import nodemailer from "nodemailer";

export const FROM_EMAIL     = "info@milestonemediaphoto.com";
export const BUSINESS_EMAIL = "smiles@milestonemediaphoto.com";
export const BUSINESS_NAME  = "Milestone Media & Photography";

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
  if (!res.ok) throw new Error("Gmail token refresh failed: " + (await res.text()));
  return (await res.json()).access_token;
}

export async function createTransporter() {
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

export function defaultFrom() {
  return `"${BUSINESS_NAME}" <${FROM_EMAIL}>`;
}
