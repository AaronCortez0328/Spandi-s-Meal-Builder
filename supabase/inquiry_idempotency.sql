-- Idempotency for /api/ghl-inquiry.
--
-- Until now GoHighLevel refusing a second opportunity per contact was the
-- only thing standing between a double-clicked Send button and two real
-- bookings. That was never the point of the constraint — it was doing the
-- job by accident — and the moment "Allow Duplicate Opportunities" is
-- enabled at the location it stops doing it, silently.
--
-- Hence a key of our own, independent of GoHighLevel, so the owner can flip
-- that setting without a customer's double-tap becoming two orders.
--
-- One row per submission the browser considers a single order. The key is
-- minted when the contact panel is first rendered and stays fixed across
-- retries and across the duplicate-booking question, so all of it is one
-- order however many requests it takes.
--
-- No anon/authenticated grants: only the service-role key touches this,
-- matching inquiry_attempts and the payment tables.

create table if not exists public.inquiry_idempotency (
  key         text        primary key,
  status      text        not null default 'in_flight',  -- in_flight | done
  response    jsonb,                                     -- what we answered
  created_at  timestamptz not null default now()
);

-- Stale in-flight rows are the interesting query: a request that crashed
-- between claiming the key and finishing leaves one behind, and it must not
-- block the customer retrying forever.
create index if not exists inquiry_idempotency_created_idx
  on public.inquiry_idempotency (created_at desc);

alter table public.inquiry_idempotency enable row level security;

revoke all on public.inquiry_idempotency from anon, authenticated;

-- Housekeeping. A key is only meaningful for as long as someone might retry
-- with it; a fortnight is far longer than any real session.
create or replace function public.prune_inquiry_idempotency()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.inquiry_idempotency where created_at < now() - interval '14 days';
$$;
