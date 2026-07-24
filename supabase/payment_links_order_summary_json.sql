-- payment_links.order_summary was declared as jsonb, but Postgres's jsonb
-- type does not preserve object key insertion order (it re-sorts keys by
-- length, then alphabetically within the same length, for its binary
-- storage format) — confirmed this is exactly why "Name" (built first in
-- api/ghl-inquiry.js) was rendering after shorter keys like "Pax" on the
-- payment page.
--
-- Plain json stores the exact original text and preserves key order, so
-- switching the column type fixes the display order with no code changes
-- needed — Supabase's client parses both types into a JS object the same
-- way on read.
--
-- Run this in the Supabase Dashboard -> SQL Editor.

alter table public.payment_links
  alter column order_summary type json using order_summary::json;
