-- Rate limiting for the Order Status lookup.
--
-- ⚠️ RUN THIS BEFORE THE CODE DEPLOYS. api/order-status.js counts against
-- this table on every lookup. The check fails OPEN, so a missing table would
-- not break the page — it would silently remove the only brake on an
-- unauthenticated endpoint, which is worse than an error.
--
-- Run in the Supabase Dashboard -> SQL Editor.
--
-- ── Why not reuse inquiry_attempts ─────────────────────────────────────────
--
-- Because a customer checking on their order would spend the budget that lets
-- them place one. inquiry_attempts holds three columns — id, ip, created_at —
-- with nothing to tell the two apart, so counting both there would mean
-- somebody who looked their booking up eight times could not then order.
--
-- The limits also differ in kind. An inquiry is a real booking and 8/hour is
-- generous. A lookup is cheap for an honest customer and cheap for someone
-- guessing, so what matters here is the FAILED attempt: an email is not a
-- secret and event dates cluster on weekends, which makes the guessing space
-- small enough to walk through by hand. Successes are counted loosely and
-- failures tightly, which is why `found` is recorded.

create table if not exists public.order_lookup_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  -- Whether the lookup produced an order. Failures are what get throttled.
  found      boolean not null default false,
  created_at timestamptz not null default now()
);

-- The only question asked of this table: "what has this address done lately".
create index if not exists order_lookup_attempts_ip_time_idx
  on public.order_lookup_attempts (ip, created_at desc);

-- No anon or authenticated grants, deliberately — same posture as
-- payment_links and payment_submissions in revoke_anon_grants.sql. Only the
-- service role reaches this, through api/order-status.js.
revoke all on public.order_lookup_attempts from anon, authenticated;

comment on table public.order_lookup_attempts is
  'Per-IP throttle for the unauthenticated Order Status lookup. Failed attempts are limited far more tightly than successful ones.';


-- ── Verify ─────────────────────────────────────────────────────────────────
--   select column_name, data_type from information_schema.columns
--    where table_name = 'order_lookup_attempts';
--
-- Expect four rows: id | found | ip | created_at
