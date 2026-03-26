// Vercel Serverless Function — Create & send a Stripe invoice after booking
// POST /api/create-invoice
//   Body: { booking } with booking details (clientName, clientEmail, services, addons, total, etc.)
//   Creates a Stripe customer (or finds existing), adds line items, and sends the invoice.
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const BUSINESS_NAME = "Milestone Media & Photography";

// ── Helper: build readable line‐item description ──
function buildDescription(booking) {
  const parts = [];
  if (booking.packageName) parts.push(`${booking.packageName} Package`);
  if (booking.services?.length) {
    const svcNames = booking.services.map(s => s.name).filter(Boolean);
    if (svcNames.length) parts.push(svcNames.join(", "));
  }
  if (booking.addons?.length) {
    const addonNames = booking.addons.map(a => a.name).filter(Boolean);
    if (addonNames.length) parts.push("Add-ons: " + addonNames.join(", "));
  }
  if (booking.address) parts.push(`Property: ${booking.address}`);
  if (booking.date && booking.time) parts.push(`Scheduled: ${booking.date} at ${booking.time}`);
  return parts.join(" | ") || "Real Estate Media Services";
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { booking } = req.body;
    if (!booking || !booking.clientEmail || !booking.clientName || !booking.total) {
      return res.status(400).json({ error: "Missing booking data (clientName, clientEmail, total required)" });
    }

    // 1. Find or create Stripe customer
    const existingCustomers = await stripe.customers.list({
      email: booking.clientEmail,
      limit: 1,
    });

    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        name: booking.clientName,
        email: booking.clientEmail,
        phone: booking.clientPhone || undefined,
        metadata: {
          source: "milestone-media-booking",
          address: booking.address || "",
        },
      });
    }

    // 2. Create the invoice
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 7,
      auto_advance: true,
      metadata: {
        booking_address: booking.address || "",
        booking_date: booking.date || "",
        booking_time: booking.time || "",
        package: booking.packageName || "",
        sqft_tier: booking.sqftTier || "",
      },
    });

    // 3. Add line items
    // If there are itemized services, add each one
    const hasItemizedPrices = (booking.services?.some(s => s.price > 0)) || (booking.addons?.some(a => a.price > 0));

    if (hasItemizedPrices) {
      // Add individual services
      for (const svc of (booking.services || [])) {
        if (svc.price > 0) {
          await stripe.invoiceItems.create({
            customer: customer.id,
            invoice: invoice.id,
            description: svc.name,
            amount: Math.round(svc.price * 100), // Stripe uses cents
            currency: "usd",
          });
        }
      }
      // Add add-ons
      for (const addon of (booking.addons || [])) {
        if (addon.price > 0) {
          await stripe.invoiceItems.create({
            customer: customer.id,
            invoice: invoice.id,
            description: addon.name,
            amount: Math.round(addon.price * 100),
            currency: "usd",
          });
        }
      }
      // If it's a package, add the package as the main line item
      if (booking.packageName && !booking.services?.some(s => s.price > 0)) {
        await stripe.invoiceItems.create({
          customer: customer.id,
          invoice: invoice.id,
          description: `${booking.packageName} Package — ${booking.address || "Real Estate Media"}`,
          amount: Math.round(booking.total * 100),
          currency: "usd",
        });
      }
    } else {
      // Single line item with total
      const desc = buildDescription(booking);
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        description: desc,
        amount: Math.round(booking.total * 100),
        currency: "usd",
      });
    }

    // 4. Finalize and send the invoice
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    const sentInvoice = await stripe.invoices.sendInvoice(invoice.id);

    return res.status(200).json({
      success: true,
      invoiceId: sentInvoice.id,
      invoiceUrl: sentInvoice.hosted_invoice_url,
      invoicePdf: sentInvoice.invoice_pdf,
      customerId: customer.id,
      status: sentInvoice.status,
    });
  } catch (err) {
    console.error("Stripe invoice error:", err);
    return res.status(500).json({ error: "Failed to create invoice", details: err.message });
  }
}
