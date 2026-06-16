// Dry-run test for the beta-invite email path. Uses the linked DB but
// injects a fake nodemailer transporter so no real email is sent.
//
// Asserts:
//   1. PDF is on disk where the function expects it.
//   2. sendEmail:true + valid email → DB row gets email_status='sent',
//      and the transporter receives a payload with:
//        - the personalized accept link in the HTML body
//        - the one-pager PDF in attachments[0], byte-identical to disk
//        - the recipient as `to:`
//   3. sendEmail:true + email='' → 400; no invite row created.
//   4. Failed send (transporter throws) → invite row STILL exists with
//      email_status='failed' and email_error populated.
//   5. sendEmail:false → invite created, no send attempted, status='not_sent'.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import handler from "../api/beta-invites.js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function mockRes() {
  const r = {
    _status: 200, _body: null, _headers: {},
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(s, h) { this._status = s; Object.assign(this._headers, h || {}); return this; },
    end() { return this; },
  };
  return r;
}

function depsForAdmin(user, transporter) {
  return {
    supabase: {
      ...supabase,
      auth: {
        ...supabase.auth,
        getUser: async () => ({ data: { user }, error: null }),
      },
      from: supabase.from.bind(supabase),
    },
    transporter,
  };
}

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { console.log(`✓ ${name}`); pass++; }
  else { console.log(`✗ ${name}${extra ? ` — ${extra}` : ""}`); fail++; }
}

async function createAuthUser(email) {
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true, password: randomUUID() });
  if (error) throw new Error(error.message);
  return data.user;
}

async function main() {
  // ── 1. PDF on disk ───────────────────────────────────────────────
  const pdfPath = "api/_assets/Milestone-Beta-Invitation.pdf";
  const pdfBytes = readFileSync(pdfPath);
  ok("PDF exists on disk at api/_assets/", pdfBytes.length > 0);
  ok("PDF starts with %PDF magic", pdfBytes.slice(0, 4).toString() === "%PDF");

  // ── Provision admin agent ────────────────────────────────────────
  const stamp = randomUUID().slice(0, 8);
  const adminEmail = `test-admin-email-${stamp}@example.test`;
  const adminAuth = await createAuthUser(adminEmail);
  const adminUser = { id: adminAuth.id, email: adminEmail };
  const inviteIds = [];

  try {
    await supabase.from("agents").upsert({ id: adminUser.id, email: adminEmail, full_name: "Test Admin", role: "admin" }, { onConflict: "id" });

    // ── 2. Success path ──────────────────────────────────────────────
    const captured = [];
    const okTransporter = {
      sendMail: async (msg) => { captured.push(msg); return { messageId: `test-${captured.length}` }; },
    };
    const recipient = `test-recipient-${stamp}@example.test`;
    {
      const req = {
        method: "POST", headers: { authorization: "Bearer x" },
        body: { betaDurationDays: 90, email: recipient, sendEmail: true },
      };
      const res = mockRes();
      await handler(req, res, depsForAdmin(adminUser, okTransporter));
      ok("create+send → 200", res._status === 200, JSON.stringify(res._body));
      ok("response email.attempted=true, ok=true", res._body?.email?.attempted === true && res._body?.email?.ok === true);
      ok("response invite.email_status='sent'", res._body?.invite?.email_status === "sent");
      if (res._body?.invite?.id) inviteIds.push(res._body.invite.id);

      ok("transporter received exactly 1 message", captured.length === 1);
      const sent = captured[0];
      ok("to: matches recipient", sent.to === recipient);
      ok("from: uses business address", typeof sent.from === "string" && sent.from.includes("info@milestonemediaphoto.com"));
      ok("subject: invite-ish", /invited|beta/i.test(sent.subject || ""));
      const tokenInLink = res._body.invite.token;
      ok("HTML body contains the personalized accept link",
        (sent.html || "").includes(`/beta/accept?token=${tokenInLink}`));
      ok("attachments[0] is the PDF",
        Array.isArray(sent.attachments) && sent.attachments.length === 1 &&
        sent.attachments[0].filename === "Milestone-Beta-Invitation.pdf" &&
        sent.attachments[0].contentType === "application/pdf");
      ok("attachment bytes equal disk bytes",
        Buffer.isBuffer(sent.attachments[0].content) &&
        sent.attachments[0].content.length === pdfBytes.length &&
        sent.attachments[0].content.equals(pdfBytes));

      // Verify DB row reflects sent state
      const { data: row } = await supabase
        .from("beta_invites")
        .select("email_status, email_sent_at, email_error")
        .eq("id", res._body.invite.id)
        .single();
      ok("DB row email_status='sent'", row?.email_status === "sent" && !!row?.email_sent_at && row?.email_error === null);
    }

    // ── 3. sendEmail:true + no email → 400, NO row created ──────────
    {
      const { count: before } = await supabase.from("beta_invites").select("*", { count: "exact", head: true });
      const res = mockRes();
      await handler(
        { method: "POST", headers: { authorization: "Bearer x" }, body: { betaDurationDays: 90, sendEmail: true } },
        res, depsForAdmin(adminUser, okTransporter),
      );
      ok("sendEmail:true + missing email → 400", res._status === 400, JSON.stringify(res._body));
      const { count: after } = await supabase.from("beta_invites").select("*", { count: "exact", head: true });
      ok("no invite row was created on 400", before === after);
    }

    // ── 4. Failed send → invite row STILL exists, status=failed ─────
    const flakeyTransporter = {
      sendMail: async () => { throw new Error("simulated SMTP failure"); },
    };
    {
      const recipient2 = `test-fail-${stamp}@example.test`;
      const res = mockRes();
      await handler(
        { method: "POST", headers: { authorization: "Bearer x" },
          body: { betaDurationDays: 60, email: recipient2, sendEmail: true } },
        res, depsForAdmin(adminUser, flakeyTransporter),
      );
      ok("create+failed-send → 200 (invite still created)", res._status === 200, JSON.stringify(res._body));
      ok("response email.ok=false, error mentions SMTP", res._body?.email?.ok === false && /SMTP/i.test(res._body?.email?.error || ""));
      ok("response invite.email_status='failed'", res._body?.invite?.email_status === "failed");
      if (res._body?.invite?.id) inviteIds.push(res._body.invite.id);

      const { data: row } = await supabase
        .from("beta_invites")
        .select("id, status, email_status, email_error")
        .eq("id", res._body.invite.id)
        .single();
      ok("DB row exists after failed send", !!row);
      ok("DB invite.status still 'pending' (not rolled back)", row?.status === "pending");
      ok("DB email_status='failed' with error recorded", row?.email_status === "failed" && /SMTP/i.test(row?.email_error || ""));
    }

    // ── 5. sendEmail:false → no send, status='not_sent' ─────────────
    {
      const res = mockRes();
      await handler(
        { method: "POST", headers: { authorization: "Bearer x" },
          body: { betaDurationDays: 90, email: null, sendEmail: false } },
        res, depsForAdmin(adminUser, okTransporter),
      );
      ok("sendEmail:false → 200", res._status === 200);
      ok("response email.attempted=false", res._body?.email?.attempted === false);
      ok("invite.email_status='not_sent'", res._body?.invite?.email_status === "not_sent");
      if (res._body?.invite?.id) inviteIds.push(res._body.invite.id);
    }
  } finally {
    if (inviteIds.length) await supabase.from("beta_invites").delete().in("id", inviteIds);
    await supabase.from("agents").delete().eq("id", adminUser.id);
    await supabase.auth.admin.deleteUser(adminUser.id).catch(() => {});
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("test crashed:", err); process.exit(2); });
