// Supabase Edge Function: Stripe Webhook Handler
// Listens for invoice.paid events and unlocks media for the matching booking.
//
// Environment variables required (set in Supabase Dashboard → Edge Functions → Secrets):
//   STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard → Webhooks → Signing secret
//   SUPABASE_URL           — auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Verify the webhook signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Handle invoice.paid event
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceId = invoice.id;

    console.log(`Invoice paid: ${invoiceId}`);

    // Find booking(s) with this stripe_invoice_id and mark as paid
    const { data, error } = await supabase
      .from("bookings")
      .update({ invoice_paid: true })
      .eq("stripe_invoice_id", invoiceId)
      .select("id, client_name, client_email");

    if (error) {
      console.error("Database update error:", error);
      return new Response("Database error", { status: 500 });
    }

    if (data && data.length > 0) {
      console.log(`Unlocked media for ${data.length} booking(s):`, data.map(b => b.client_name));
    } else {
      console.log(`No booking found with stripe_invoice_id: ${invoiceId}`);
    }
  }

  // Also handle checkout.session.completed for Stripe Payment Links
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.invoice as string;

    if (invoiceId) {
      const { data, error } = await supabase
        .from("bookings")
        .update({ invoice_paid: true })
        .eq("stripe_invoice_id", invoiceId)
        .select("id, client_name");

      if (!error && data?.length) {
        console.log(`Checkout completed — unlocked media for: ${data.map(b => b.client_name)}`);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
