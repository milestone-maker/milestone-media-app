-- ============================================================
-- Milestone Media & Photography — Database Schema
-- Phase 1: Foundation & Auth
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. AGENTS (user profiles linked to Supabase Auth)
-- ============================================================
create table public.agents (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  phone       text,
  company     text,
  avatar_url  text,
  role        text not null default 'agent' check (role in ('agent', 'admin')),
  created_at  timestamptz default now()
);

-- ============================================================
-- 2. LISTINGS (properties managed by agents)
-- ============================================================
create table public.listings (
  id           uuid primary key default uuid_generate_v4(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  address      text not null,
  city         text,
  price        text,
  beds         int,
  baths        int,
  sqft         text,
  package      text check (package in ('Essential', 'Signature', 'Zillow Ready', 'Luxury')),
  status       text not null default 'In Production' check (status in ('In Production', 'Delivered', 'Live', 'Archived')),
  hero_img     text,
  rela_site    text,
  description  text,
  features     jsonb default '[]'::jsonb,
  media_types  jsonb default '[]'::jsonb,
  created_at   timestamptz default now()
);

-- ============================================================
-- 3. MEDIA (photos, videos, tours per listing)
-- ============================================================
create table public.media (
  id            uuid primary key default uuid_generate_v4(),
  listing_id    uuid not null references public.listings(id) on delete cascade,
  type          text not null check (type in ('Photos', 'Drone', '3D Tour', 'Film', 'Floor Plan', 'Twilight', 'Microsite')),
  url           text not null,
  thumbnail_url text,
  caption       text,
  sort_order    int default 0,
  created_at    timestamptz default now()
);

-- ============================================================
-- 4. BOOKINGS (session bookings by agents)
-- ============================================================
create table public.bookings (
  id          uuid primary key default uuid_generate_v4(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  listing_id  uuid references public.listings(id) on delete set null,
  address     text not null,
  package     text not null,
  date        date not null,
  time_slot   text,
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'in_progress', 'delivered', 'cancelled')),
  notes       text,
  total_price text,
  created_at  timestamptz default now()
);

-- ============================================================
-- 5. MICROSITES (branded property websites)
-- ============================================================
create table public.microsites (
  id                  uuid primary key default uuid_generate_v4(),
  listing_id          uuid not null references public.listings(id) on delete cascade,
  theme               text not null default 'Obsidian' check (theme in ('Obsidian', 'Ivory', 'Slate', 'Blush')),
  slug                text unique not null,
  published           boolean default false,
  agent_name          text,
  agent_phone         text,
  notif_email_enabled boolean default true,
  notif_email         text,
  notif_sms_enabled   boolean default false,
  notif_sms_phone     text,
  notify_on_new       boolean default true,
  notify_on_offer     boolean default true,
  notify_on_virtual   boolean default true,
  created_at          timestamptz default now()
);

-- ============================================================
-- 6. LEADS (captured from microsites)
-- ============================================================
create table public.leads (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  microsite_id uuid references public.microsites(id) on delete set null,
  name        text not null,
  email       text,
  phone       text,
  message     text,
  tour_type   text check (tour_type in ('in-person', 'virtual', 'offer')),
  status      text not null default 'new' check (status in ('new', 'contacted', 'scheduled', 'closed', 'lost')),
  read        boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- 7. ANALYTICS (daily stats per listing)
-- ============================================================
create table public.analytics (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  date        date not null default current_date,
  views       int default 0,
  shares      int default 0,
  leads_count int default 0,
  unique (listing_id, date)
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Agents can only see their own data
-- ============================================================

-- Enable RLS on all tables
alter table public.agents enable row level security;
alter table public.listings enable row level security;
alter table public.media enable row level security;
alter table public.bookings enable row level security;
alter table public.microsites enable row level security;
alter table public.leads enable row level security;
alter table public.analytics enable row level security;

-- AGENTS: users can read/update their own profile; admins can see all
create policy "Users can view own profile"
  on public.agents for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.agents for update
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.agents for select
  using (public.is_admin());

-- LISTINGS: agents see their own; admins see all
create policy "Agents can view own listings"
  on public.listings for select
  using (agent_id = auth.uid());

create policy "Agents can insert own listings"
  on public.listings for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own listings"
  on public.listings for update
  using (agent_id = auth.uid());

create policy "Agents can delete own listings"
  on public.listings for delete
  using (agent_id = auth.uid());

create policy "Admins can view all listings"
  on public.listings for select
  using (public.is_admin());

create policy "Admins can manage all listings"
  on public.listings for all
  using (public.is_admin());

-- MEDIA: follows listing access
create policy "Agents can view own media"
  on public.media for select
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Agents can manage own media"
  on public.media for all
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Admins can manage all media"
  on public.media for all
  using (public.is_admin());

-- BOOKINGS: agents see their own; admins see all
create policy "Agents can view own bookings"
  on public.bookings for select
  using (agent_id = auth.uid());

create policy "Agents can insert own bookings"
  on public.bookings for insert
  with check (agent_id = auth.uid());

create policy "Agents can update own bookings"
  on public.bookings for update
  using (agent_id = auth.uid());

create policy "Admins can manage all bookings"
  on public.bookings for all
  using (public.is_admin());

-- MICROSITES: follows listing ownership
create policy "Agents can view own microsites"
  on public.microsites for select
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Agents can manage own microsites"
  on public.microsites for all
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Admins can manage all microsites"
  on public.microsites for all
  using (public.is_admin());

-- LEADS: follows listing ownership; also publicly insertable (from microsite visitors)
create policy "Agents can view own leads"
  on public.leads for select
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Agents can update own leads"
  on public.leads for update
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Anyone can submit leads"
  on public.leads for insert
  with check (true);

create policy "Admins can manage all leads"
  on public.leads for all
  using (public.is_admin());

-- ANALYTICS: follows listing ownership; publicly incrementable
create policy "Agents can view own analytics"
  on public.analytics for select
  using (
    listing_id in (
      select id from public.listings where agent_id = auth.uid()
    )
  );

create policy "Admins can view all analytics"
  on public.analytics for all
  using (public.is_admin());

-- ============================================================
-- FUNCTION: Safe admin check (avoids infinite recursion in RLS)
-- ============================================================
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.agents
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- ============================================================
-- FUNCTION: Auto-create agent profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.agents (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger: run on every new auth signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_listings_agent on public.listings(agent_id);
create index idx_media_listing on public.media(listing_id);
create index idx_bookings_agent on public.bookings(agent_id);
create index idx_bookings_date on public.bookings(date);
create index idx_leads_listing on public.leads(listing_id);
create index idx_analytics_listing_date on public.analytics(listing_id, date);
create index idx_microsites_slug on public.microsites(slug);
