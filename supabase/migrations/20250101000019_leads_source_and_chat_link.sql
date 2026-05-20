-- ============================================================
-- 019: Stage 2 — leads.source + chat_conversation_id
-- ============================================================
-- Lets /api/microsite-chat mirror chat-captured leads into the
-- existing public.leads table so the agent's lead inbox shows
-- contact-form and chat leads side by side.
--
-- Changes:
--   • source text default 'contact_form' (so back-fill is safe)
--   • chat_conversation_id uuid references microsite_chat_conversations
--     on delete set null
--   • unique partial index on chat_conversation_id (prevents the
--     endpoint from inserting a duplicate row if it retries)
--   • listing_id becomes NULLABLE — chat conversations originate from
--     a microsite, which may or may not have a linked listing_id in
--     property_data. Existing rows are unaffected.
-- ============================================================

alter table public.leads
  add column if not exists source text not null default 'contact_form'
    check (source in ('contact_form', 'chat'));

alter table public.leads
  add column if not exists chat_conversation_id uuid
    references public.microsite_chat_conversations(id) on delete set null;

alter table public.leads
  alter column listing_id drop not null;

create unique index if not exists uq_leads_chat_conversation_id
  on public.leads (chat_conversation_id)
  where chat_conversation_id is not null;
