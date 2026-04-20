// Vercel Serverless Function — Stripe webhook handler
// POST /api/stripe-webhook
//   Listens for invoice.payment_succeeded from Stripe.
//   When an invoice is paid, finds the matching booking by stripe_invoice_id
//   and sets invoice_paid = true, unlocking media downloads for the agent.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY       — Stripe secret key (already set)
//   STRIPE_WEBHOOK_SECRET   — Signing secret from the Stripe webhook endpoint
//   SUPABASE_URL            — https://cbpnjuotoxtmefmedpmj.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Service role key from Supabase dashboard (bypasses RLS)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Must disable Vercel's body parser so we can verify the raw Stripe signature
export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Read the raw request body as a Buffer (required for Stripe signature verification)
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature header" });

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed: " + err.message });
  }

  // ── Handle invoice paid ──
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
    const invoiceId = invoice.id;

    console.log(`invoice.payment_succeeded — invoice ${invoiceId}`);

    const supabase = getSupabase();

    // Find the booking linked to this Stripe invoice
    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select("id, address")
      .eq("stripe_invoice_id", invoiceId);

    if (fetchError) {
      console.error("Supabase fetch error:", fetchError.message);
      return res.status(500).json({ error: "Database error" });
    }

    if (!bookings || bookings.length === 0) {
      // No booking matched — could be an invoice not created through the app
      console.log(`No booking found for invoice ${invoiceId} — skipping`);
      return res.status(200).json({ received: true, matched: false });
    }

    // Unlock media by marking invoice paid
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ invoice_paid: true })
      .eq("stripe_invoice_id", invoiceId);

    if (updateError) {
      console.error("Supabase update error:", updateError.message);
      return res.status(500).json({ error: "Failed to update booking" });
    }

    console.log(`✅ Media unlocked for booking ${bookings[0].id} (${bookings[0].address})`);
  }

  // Acknowledge all other event types without error
  return res.status(200).json({ received: true });
}
