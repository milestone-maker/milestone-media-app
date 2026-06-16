-- ============================================================
-- 048: Beta invites — email send status columns
-- ============================================================
-- The admin "Create invite" flow optionally sends the recipient an email
-- with the accept link and the founding-member one-pager attached. The
-- send is deliberately non-blocking on the invite create: a failed send
-- does NOT roll back the invite row — the admin sees a "failed" pill and
-- still has the copy-link fallback.
--
-- Columns are additive and nullable; existing rows (including those
-- created before this migration) read as { not sent } / null detail
-- because email_status defaults to 'not_sent'.
-- ============================================================

alter table public.beta_invites
  add column if not exists email_status text not null default 'not_sent'
    check (email_status in ('not_sent', 'sent', 'failed')),
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text;
