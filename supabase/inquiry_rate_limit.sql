-- Rate limiting for /api/ghl-inquiry.
--
-- The endpoint creates contacts, opportunities, notes and calendar entries
-- in the live CRM, and had no authentication, no origin check and no limit
-- of any kind. Anyone who opened the browser's network tab could script it.
--
-- One row per accepted submission. The handler counts recent rows for the
-- caller's IP rather than keeping a counter, because Vercel functions are
-- stateless and a counter would reset on every cold start.
--
-- No anon/authenticated grants: only the service-role key touches this,
-- exactly like the payment tables.

create table if not exists public.inquiry_attempts (
  id          bigserial primary key,
  ip          text        not null,
  created_at  timestamptz not null default now()
);

-- The only query this table serves: "how many from this IP since T".
create index if not exists inquiry_attempts_ip_created_idx
  on public.inquiry_attempts (ip, created_at desc);

alter table public.inquiry_attempts enable row level security;

revoke all on public.inquiry_attempts from anon, authenticated;

-- Housekeeping. Nothing older than a day is ever read, and this table would
-- otherwise grow without bound. Run on a schedule, or call it from the
-- handler occasionally — a few thousand stale rows are harmless either way.
create or replace function public.prune_inquiry_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.inquiry_attempts where created_at < now() - interval '2 days';
$$;
