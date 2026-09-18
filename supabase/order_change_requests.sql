-- Change and add requests, waiting for somebody to decide them.
--
-- ⚠️ RUN THIS BEFORE THE CODE DEPLOYS. api/request-change.js inserts here on
-- every request; against a missing table every request fails.
--
-- Run in the Supabase Dashboard -> SQL Editor.
--
-- ── The contract, agreed with the dashboard team 16 September 2026 ─────────
--
-- WE INSERT. THEY READ AND UPDATE. Neither crosses.
--
-- That is the whole point. A request is a row, not a write, so nothing of
-- ours ever touches a GoHighLevel opportunity they might be editing at the
-- same moment. They stay the only thing writing to GoHighLevel, exactly as
-- before this feature existed.
--
-- We write:  opportunity_id, kind, before, after
-- They write: status, decided_by, decided_by_name, decided_at, decided_note
--
-- ── What goes in `after`, and what must not ────────────────────────────────
--
-- Their correction, and it was a design error on our side rather than a
-- missing detail. "100 pax" is not a number anyone can apply: jeanette-50 and
-- jeanette-100 are different catalogue rows at PHP 19,000 and PHP 35,000,
-- with different tray quantities per dish. So a change names the row.
--
-- ⚠️ THE SHAPE BELOW IS OUT OF DATE. See the column comment at the foot of
-- this file, which is the one the database carries and the one kept current.
-- Left here because the reasoning is still right; the payload is not.
--
--   change  { "package_id": "jeanette-100" }              ← superseded
--   add     { "items": [ { "dish_id": "...", ... } ] }    ← superseded
--
-- What arrives now is a whole rebuilt order, for both kinds, because the
-- change flow sends the customer into the meal builder rather than offering
-- a list of sizes.
--
-- NO CUSTOMER-PROPOSED PRICE IN `after`, EVER. That is the rule and it has
-- not moved: cleanAfter is an allowlist with no key that could carry one.
--
-- `after.total` IS a price, and it is OURS — computed by serverTotal() from
-- our own tables at request time, never sent by the browser. It is an
-- estimate for the queue to show, not an amount to charge; the dashboard
-- prices again from the catalogue at approve time, because by then this one
-- may be weeks old.
--
-- ── Why there is no 'expired' status ───────────────────────────────────────
--
-- Because it is computed, not stored. A pending request past its cutoff IS
-- expired — requestWindow() in src/domain/availability.js answers that for
-- the customer asking and for the admin approving, from the event date alone.
-- No job to run, no writer, and no way for the two sides to hold different
-- opinions about the same row.

create table if not exists public.order_change_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  opportunity_id  text not null,
  -- 'change' | 'add'. No CHECK, matching the dashboard's own reasoning for
  -- stage and food_status: the vocabulary is config both sides validate
  -- against, and a constraint means a migration every time one is added.
  kind            text not null,
  before          jsonb not null,
  after           jsonb not null,

  status          text not null default 'pending',
  decided_by      uuid,
  decided_by_name text,
  decided_at      timestamptz,
  decided_note    text
);

-- One open request per booking. The dashboard asked for this and it is the
-- right shape: a customer with two pending requests gives an admin two
-- answers to the same question, and whichever is approved second silently
-- overwrites the first.
--
-- Partial, so decided rows never collide — a booking can be changed, decided,
-- and changed again.
--
-- OUR INSERT WILL ERROR when one is already open. That is the intended
-- signal, not a failure to swallow: api/request-change.js reads the unique
-- violation and tells the customer they already have one waiting.
create unique index if not exists order_change_requests_one_open_idx
  on public.order_change_requests (opportunity_id)
  where status = 'pending';

-- The dashboard's queue reads by status, oldest first.
create index if not exists order_change_requests_status_idx
  on public.order_change_requests (status, created_at);

-- No anon or authenticated grants, deliberately — same posture as
-- payment_links, payment_submissions and order_lookup_attempts. Both sides
-- reach this with the service-role key and nothing else does.
revoke all on public.order_change_requests from anon, authenticated;

comment on table public.order_change_requests is
  'Customer requests to change or add to a booking, awaiting a decision. The meal builder inserts; the dashboard reads and sets status. Nothing here is applied to GoHighLevel until an admin approves it.';

comment on column public.order_change_requests.after is
  'What the customer is asking for: {lineItems, groups, singlePackageId, total}. lineItems is the whole rebuilt order in the shape our pricing understands; groups is the same order as a person reads it; singlePackageId is the catalogue id when the request is one package at quantity one and null otherwise. NO PRICE EVER COMES FROM THE BROWSER - cleanAfter is an allowlist with no key that could carry one. total is OURS, computed server-side at request time, and is an estimate for the queue rather than an amount to charge: price again from the catalogue at approve time.';

comment on column public.order_change_requests.before is
  'The booking as it stood when the customer asked. package_id is what it is for now, recovered from dishes_selected the same way Order Status recovers it - so before.package_id and after.singlePackageId sit side by side and the change is legible from the row alone. package_name is frequently null on live data and must not be relied on. total is a display snapshot of what the customer was looking at.';


-- ── Verify ─────────────────────────────────────────────────────────────────
--   select column_name, data_type from information_schema.columns
--    where table_name = 'order_change_requests' order by ordinal_position;
--
--   select indexname from pg_indexes where tablename = 'order_change_requests';
--
-- Expect the ten columns above, and two indexes besides the primary key.
