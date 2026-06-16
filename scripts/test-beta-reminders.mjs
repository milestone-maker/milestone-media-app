// Dry-run for the beta-reminders cron. Uses the linked DB but injects a
// fake nodemailer transporter so no real email is sent. Seeds three
// throwaway beta agents:
//   • 14d agent (expires in ~10 days)  → should get the 14-day email
//   • 3d agent  (expires in ~2 days)   → should get the 3-day email
//   • expired agent (expired 2 days ago) → should get the expiry email
// Then re-runs and asserts no second send.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { processBetaReminders, pickReminder } from "../api/beta-reminders.js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
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
  // ── pure pickReminder() unit-style assertions ───────────────────
  const now = Date.UTC(2026, 5, 16, 14, 0, 0); // 2026-06-16 14:00 UTC
  const oneDay = 86400000;
  const mk = (overrides = {}) => ({
    is_beta: true,
    beta_expires_at: new Date(now + 10 * oneDay).toISOString(),
    beta_notified_14d: false, beta_notified_3d: false, beta_notified_expiry: false,
    ...overrides,
  });
  ok("pickReminder: 10d → 14d",
    pickReminder(mk({ beta_expires_at: new Date(now + 10 * oneDay).toISOString() }), now)?.kind === "14d");
  ok("pickReminder: 2d → 3d",
    pickReminder(mk({ beta_expires_at: new Date(now + 2 * oneDay).toISOString() }), now)?.kind === "3d");
  ok("pickReminder: expired → expiry",
    pickReminder(mk({ beta_expires_at: new Date(now - oneDay).toISOString() }), now)?.kind === "expiry");
  ok("pickReminder: 30d → null (not due)",
    pickReminder(mk({ beta_expires_at: new Date(now + 30 * oneDay).toISOString() }), now) === null);
  ok("pickReminder: 2d already notified_3d → null",
    pickReminder(mk({ beta_expires_at: new Date(now + 2 * oneDay).toISOString(), beta_notified_3d: true }), now) === null);
  ok("pickReminder: not is_beta → null",
    pickReminder(mk({ is_beta: false }), now) === null);
  // Window-jump: agent at 2d should also clear 14d flag.
  const jump = pickReminder(mk({ beta_expires_at: new Date(now + 2 * oneDay).toISOString() }), now);
  ok("pickReminder: 3d jump also sets 14d flag",
    jump?.flagsToSet?.includes("beta_notified_3d") && jump?.flagsToSet?.includes("beta_notified_14d"));
  const expFlags = pickReminder(mk({ beta_expires_at: new Date(now - oneDay).toISOString() }), now);
  ok("pickReminder: expiry sets all three flags",
    expFlags?.flagsToSet?.length === 3 &&
    expFlags.flagsToSet.includes("beta_notified_expiry") &&
    expFlags.flagsToSet.includes("beta_notified_3d") &&
    expFlags.flagsToSet.includes("beta_notified_14d"));

  // ── live three-agent seed ────────────────────────────────────────
  const stamp = randomUUID().slice(0, 8);
  const seeds = [
    { kind: "14d",    email: `test-14d-${stamp}@example.test`,    expiresIn: 10 * oneDay,  expectKind: "14d" },
    { kind: "3d",     email: `test-3d-${stamp}@example.test`,     expiresIn: 2 * oneDay,   expectKind: "3d" },
    { kind: "expiry", email: `test-expired-${stamp}@example.test`, expiresIn: -2 * oneDay, expectKind: "expiry" },
    { kind: "30d",    email: `test-safe-${stamp}@example.test`,   expiresIn: 30 * oneDay,  expectKind: null }, // control — never due this run
  ];
  const created = [];
  try {
    for (const s of seeds) {
      const u = await createAuthUser(s.email);
      const expiresAt = new Date(Date.now() + s.expiresIn).toISOString();
      await supabase.from("agents").upsert({
        id: u.id, email: s.email, full_name: `Test ${s.kind}`, role: "agent",
        is_beta: true, beta_expires_at: expiresAt,
        beta_notified_14d: false, beta_notified_3d: false, beta_notified_expiry: false,
      }, { onConflict: "id" });
      created.push({ id: u.id, ...s });
    }

    const captured = [];
    const transporter = { sendMail: async (msg) => { captured.push(msg); return { messageId: `t-${captured.length}` }; } };

    // ── First run ────────────────────────────────────────────────
    const r1 = await processBetaReminders({ supabase, transporter });
    ok("run-1 scanned all 4 beta agents (or more)", r1.scanned >= 4);
    ok("run-1 sent exactly 3 (one per due agent)", r1.sent === 3, JSON.stringify(r1));
    ok("run-1 no failures", r1.failed === 0);

    // The control (30d) should NOT have a captured email.
    const recipients = new Set(captured.map((m) => m.to));
    ok("14d agent received an email", recipients.has(`test-14d-${stamp}@example.test`));
    ok("3d agent received an email",  recipients.has(`test-3d-${stamp}@example.test`));
    ok("expired agent received an email", recipients.has(`test-expired-${stamp}@example.test`));
    ok("30d (control) did NOT receive an email", !recipients.has(`test-safe-${stamp}@example.test`));

    // Subject lines map to the right kind.
    const byEmail = Object.fromEntries(captured.map((m) => [m.to, m]));
    ok("14d subject mentions ~two weeks",
      /two weeks/i.test(byEmail[`test-14d-${stamp}@example.test`]?.subject || ""));
    ok("3d subject mentions 3 days",
      /3 days/i.test(byEmail[`test-3d-${stamp}@example.test`]?.subject || ""));
    ok("expiry subject reads as ended",
      /ended/i.test(byEmail[`test-expired-${stamp}@example.test`]?.subject || ""));

    // DB flags match expectations.
    for (const c of created) {
      const { data: row } = await supabase
        .from("agents")
        .select("beta_notified_14d, beta_notified_3d, beta_notified_expiry")
        .eq("id", c.id).single();
      if (c.expectKind === "14d") {
        ok(`${c.kind} flags: only 14d=true`,
          row.beta_notified_14d === true && row.beta_notified_3d === false && row.beta_notified_expiry === false);
      } else if (c.expectKind === "3d") {
        ok(`${c.kind} flags: 14d=true AND 3d=true (window-jump), expiry=false`,
          row.beta_notified_14d === true && row.beta_notified_3d === true && row.beta_notified_expiry === false);
      } else if (c.expectKind === "expiry") {
        ok(`${c.kind} flags: all three true`,
          row.beta_notified_14d === true && row.beta_notified_3d === true && row.beta_notified_expiry === true);
      } else {
        ok(`${c.kind} flags: all false (not due)`,
          row.beta_notified_14d === false && row.beta_notified_3d === false && row.beta_notified_expiry === false);
      }
    }

    // ── Second run — nothing sends ──────────────────────────────
    const beforeCount = captured.length;
    const r2 = await processBetaReminders({ supabase, transporter });
    ok("run-2 sent 0 (no re-sends)", r2.sent === 0, JSON.stringify(r2));
    ok("run-2 transporter not invoked again", captured.length === beforeCount);

    // ── Per-agent failure does not stop the batch ───────────────
    // Reset flags on the 14d test agent so it would be due, then have the
    // transporter throw ONLY for that agent. The other due agent (a fresh
    // 3d that we re-seed) should still go through.
    const failTarget = created.find((c) => c.kind === "14d");
    await supabase.from("agents").update({ beta_notified_14d: false }).eq("id", failTarget.id);
    // Re-create a fresh-3d agent so there's a separate "good" send to verify.
    const goodEmail = `test-good3d-${stamp}@example.test`;
    const goodAuth = await createAuthUser(goodEmail);
    created.push({ id: goodAuth.id, kind: "good3d", email: goodEmail, expectKind: "3d" });
    await supabase.from("agents").upsert({
      id: goodAuth.id, email: goodEmail, full_name: "Test Good3d", role: "agent",
      is_beta: true, beta_expires_at: new Date(Date.now() + 2 * oneDay).toISOString(),
      beta_notified_14d: false, beta_notified_3d: false, beta_notified_expiry: false,
    }, { onConflict: "id" });

    const flaky = {
      sendMail: async (msg) => {
        if (msg.to === failTarget.email) throw new Error("simulated SMTP failure");
        captured.push(msg);
        return { messageId: `flaky-${captured.length}` };
      },
    };
    const r3 = await processBetaReminders({ supabase, transporter: flaky });
    ok("run-3 saw at least one failure", r3.failed >= 1);
    ok("run-3 still sent the healthy agent", recipients.has(goodEmail) || captured.some((m) => m.to === goodEmail));

    const { data: failRow } = await supabase
      .from("agents").select("beta_notified_14d").eq("id", failTarget.id).single();
    ok("failed agent's flag stayed false (so next run will retry)", failRow.beta_notified_14d === false);
  } finally {
    for (const c of created) {
      await supabase.from("agents").delete().eq("id", c.id);
      await supabase.auth.admin.deleteUser(c.id).catch(() => {});
    }
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("test crashed:", err); process.exit(2); });
