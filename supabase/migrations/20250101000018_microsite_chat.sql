-- ============================================================
-- 018: Stage 1 — microsite AI chat
-- ============================================================
-- Adds the schema that backs /api/microsite-chat:
--   • microsite_chat_settings   — per-microsite chat config
--   • microsite_chat_conversations — one row per visitor session
--   • microsite_chat_messages   — every user/assistant turn
--   • microsite_comps           — agent-pasted comparable sales
--   • agent_voice_profiles.brokerage_about / brokerage_url
--
-- Design decisions:
--   • gen_random_uuid() everywhere (consistent with recent migrations).
--   • All writes from the endpoint go through the service-role client,
--     so RLS is defense-in-depth, not the primary access control.
--   • Anon SELECT on settings/comps is gated by an EXISTS check against
--     microsites.published; RLS on the parent table does not cascade.
--   • Conversations: NO anon insert/update policy. Service role only.
--     Anon SELECT is allowed but already filtered by service-role-issued
--     visitor_session_id, so it's harmless even if exposed.
--   • Messages: NO anon policies at all. Service role only.
--   • Admin override uses the existing public.is_admin() helper.
--   • billing_period is YYYY-MM in US Central, computed by the endpoint.
-- ============================================================

-- ── 1. microsite_chat_settings ─────────────────────────────────────
create table public.microsite_chat_settings (
  id              uuid primary key default gen_random_uuid(),
  microsite_id    uuid not null unique references public.microsites(id) on delete cascade,
  chat_enabled    boolean not null default true,
  topics_enabled  jsonb not null default
    '{"listing":true,"schools":true,"commute":true,"comps":true,"financing":true}'::jsonb,
  lead_capture_mode text not null default 'name_email_phone_upfront'
    check (lead_capture_mode in (
      'name_email_phone_upfront',
      'name_email_upfront',
      'after_first_message',
      'never'
    )),
  monthly_cap     int not null default 500,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.microsite_chat_settings enable row level security;

create policy "Public can view chat settings for published microsites"
  on public.microsite_chat_settings for select
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_chat_settings.microsite_id
        and m.published = true
    )
  );

create policy "Agents can view own chat settings"
  on public.microsite_chat_settings for select
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_chat_settings.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Agents can insert own chat settings"
  on public.microsite_chat_settings for insert
  with check (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_chat_settings.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Agents can update own chat settings"
  on public.microsite_chat_settings for update
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_chat_settings.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Admins can manage all chat settings"
  on public.microsite_chat_settings for all
  using (public.is_admin());


-- ── 2. microsite_chat_conversations ────────────────────────────────
create table public.microsite_chat_conversations (
  id                 uuid primary key default gen_random_uuid(),
  microsite_id       uuid not null references public.microsites(id) on delete cascade,
  visitor_session_id text not null,
  lead_captured      boolean not null default false,
  lead_name          text,
  lead_email         text,
  lead_phone         text,
  message_count      int not null default 0,
  billing_period     text not null,   -- YYYY-MM in US Central
  visitor_ip_hash    text,
  started_at         timestamptz not null default now(),
  last_message_at    timestamptz not null default now(),
  unique (microsite_id, visitor_session_id)
);

create index idx_microsite_chat_conv_billing
  on public.microsite_chat_conversations (microsite_id, billing_period);

alter table public.microsite_chat_conversations enable row level security;

-- Defense-in-depth: anon may SELECT only rows whose visitor_session_id
-- they already know. The endpoint uses service role anyway, so this is
-- only meaningful if anon-key reads are ever wired up client-side.
create policy "Anon can read own session conversations"
  on public.microsite_chat_conversations for select
  using (
    visitor_session_id = current_setting('request.headers', true)::json->>'x-visitor-session-id'
  );

create policy "Agents can view conversations for own microsites"
  on public.microsite_chat_conversations for select
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_chat_conversations.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Admins can manage all conversations"
  on public.microsite_chat_conversations for all
  using (public.is_admin());


-- ── 3. microsite_chat_messages ─────────────────────────────────────
create table public.microsite_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.microsite_chat_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  tokens_input    int,
  tokens_output   int,
  flagged_topic   text,
  created_at      timestamptz not null default now()
);

create index idx_microsite_chat_messages_conv
  on public.microsite_chat_messages (conversation_id, created_at);

alter table public.microsite_chat_messages enable row level security;

-- No anon policies. Writes are service-role only.
create policy "Agents can view messages for own microsites"
  on public.microsite_chat_messages for select
  using (
    exists (
      select 1
        from public.microsite_chat_conversations c
        join public.microsites m on m.id = c.microsite_id
       where c.id = microsite_chat_messages.conversation_id
         and m.agent_id = auth.uid()
    )
  );

create policy "Admins can manage all messages"
  on public.microsite_chat_messages for all
  using (public.is_admin());


-- ── 4. microsite_comps ─────────────────────────────────────────────
create table public.microsite_comps (
  id              uuid primary key default gen_random_uuid(),
  microsite_id    uuid not null references public.microsites(id) on delete cascade,
  address         text not null,
  sale_price      numeric not null,
  sale_date       date not null,
  sqft            int,
  beds            int,
  baths           numeric,
  distance_miles  numeric,
  notes           text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_microsite_comps_microsite
  on public.microsite_comps (microsite_id, sort_order);

alter table public.microsite_comps enable row level security;

create policy "Public can view comps for published microsites"
  on public.microsite_comps for select
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_comps.microsite_id
        and m.published = true
    )
  );

create policy "Agents can view own comps"
  on public.microsite_comps for select
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_comps.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Agents can insert own comps"
  on public.microsite_comps for insert
  with check (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_comps.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Agents can update own comps"
  on public.microsite_comps for update
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_comps.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Agents can delete own comps"
  on public.microsite_comps for delete
  using (
    exists (
      select 1 from public.microsites m
      where m.id = microsite_comps.microsite_id
        and m.agent_id = auth.uid()
    )
  );

create policy "Admins can manage all comps"
  on public.microsite_comps for all
  using (public.is_admin());


-- ── 5. agent_voice_profiles: brokerage_about / brokerage_url ──────
alter table public.agent_voice_profiles
  add column if not exists brokerage_about text;

alter table public.agent_voice_profiles
  add column if not exists brokerage_url text;
