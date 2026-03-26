// Vercel Serverless Function â Google Calendar integration for Milestone Media bookings
// Endpoints:
//   POST /api/calendar  â create a calendar event for a new booking
//   GET  /api/calendar?date=YYYY-MM-DD  â return busy times for a given date
//
// Required Vercel environment variables:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID
//   SUPABASE_SERVICE_ROLE_KEY (optional â for updating booking records)

const SUPABASE_URL = "https://cbpnjuotoxtmefmedpmj.supabase.co";

// ââ helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Token refresh failed: " + txt);
  }
  const data = await res.json();
  return data.access_token;
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

// ââ CORS helper ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// ââ GET: fetch busy slots for a date âââââââââââââââââââââââââââââââââ
async function handleGet(req, res) {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });

  const accessToken = await refreshAccessToken();
  const cid = calendarId();

  const timeMin = `${date}T00:00:00-06:00`;
  const timeMax = `${date}T23:59:59-06:00`;

  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events?` +
      new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
      }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!gcalRes.ok) {
    const txt = await gcalRes.text();
    return res.status(502).json({ error: "Google Calendar API error", details: txt });
  }

  const data = await gcalRes.json();
  const busySlots = (data.items || []).map((ev) => ({
    start: ev.start.dateTime || ev.start.date,
    end: ev.end.dateTime || ev.end.date,
    summary: ev.summary || "(busy)",
  }));

  return res.json({ date, busySlots });
}

// ââ POST: create calendar event ââââââââââââââââââââââââââââââââââââââ
async function handlePost(req, res) {
  const body = req.body;
  if (!body || !body.booking_date || !body.booking_time) {
    return res.status(400).json({ error: "booking_date and booking_time are required" });
  }

  const accessToken = await refreshAccessToken();
  const cid = calendarId();

  // Parse time like "9:00 AM" â 24h
  const timeParts = body.booking_time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!timeParts) return res.status(400).json({ error: "Invalid booking_time format. Expected HH:MM AM/PM" });
  let hour = parseInt(timeParts[1]);
  const min = timeParts[2];
  const ampm = timeParts[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const startHour = String(hour).padStart(2, "0");
  const endHour = String(hour + 2).padStart(2, "0");

  const startDateTime = `${body.booking_date}T${startHour}:${min}:00-06:00`;
  const endDateTime = `${body.booking_date}T${endHour}:${min}:00-06:00`;

  const pkg = body.selected_package ? ` (${body.selected_package})` : "";
  const summary = `Milestone Media â ${body.client_name || "Booking"}${pkg}`;
  const description = [
    `Client: ${body.client_name || "N/A"}`,
    `Email: ${body.client_email || "N/A"}`,
    `Phone: ${body.client_phone || "N/A"}`,
    `Address: ${body.address || "N/A"}, ${body.city || ""} ${body.state || ""} ${body.zip || ""}`,
    `Square Footage: ${(body.sqft_tier || "").replace(/_/g, " ")}`,
    `Mode: ${body.booking_mode || "N/A"}`,
    body.selected_package ? `Package: ${body.selected_package}` : "",
    body.selected_services && body.selected_services.length
      ? `Services: ${body.selected_services.join(", ")}`
      : "",
    body.selected_addons && body.selected_addons.length
      ? `Add-ons: ${body.selected_addons.map((a) => a.id).join(", ")}`
      : "",
    `Total: $${body.subtotal || 0}`,
  ]
    .filter(Boolean)
    .join("\n");

  const event = {
    summary,
    description,
    start: { dateTime: startDateTime, timeZone: "America/Chicago" },
    end: { dateTime: endDateTime, timeZone: "America/Chicago" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
  };

  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!gcalRes.ok) {
    const txt = await gcalRes.text();
    return res.status(502).json({ error: "Failed to create calendar event", details: txt });
  }

  const created = await gcalRes.json();

  // Update the booking record with the calendar event ID (if booking_id provided)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (body.booking_id && serviceKey) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${body.booking_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ google_calendar_event_id: created.id }),
      }
    );
  }

  return res.json({ success: true, eventId: created.id, htmlLink: created.htmlLink });
}

// ââ main handler âââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Calendar API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
