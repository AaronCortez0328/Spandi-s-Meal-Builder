-- Switches payment_links expiry from "15 min after creation" to
-- "15 min after the customer first opens the link" — a booking is often
-- confirmed days after the inquiry, so a creation-time timer would make
-- the link dead long before anyone needs it.
--
-- Run this in the Supabase Dashboard -> SQL Editor.

alter table public.payment_links
  add column if not exists first_opened_at timestamptz;

-- expires_at is now set only once first_opened_at is set (by
-- api/payment-link-info.js), not at creation time — drop the not-null
-- constraint so a freshly created, not-yet-opened link is valid.
alter table public.payment_links
  alter column expires_at drop not null;
