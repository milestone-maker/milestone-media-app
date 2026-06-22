alter table public.agents
  add column if not exists seen_content_onboarding boolean not null default false;
