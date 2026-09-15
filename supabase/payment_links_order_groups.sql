-- The order as groups, for the Order Status screen.
--
-- ⚠️ RUN THIS BEFORE THE CODE DEPLOYS. api/_payment-link.js writes
-- order_groups on every inquiry; against a table without the column, the
-- insert fails and no booking gets a payment link. The column is additive
-- and nullable, so it is safe to run while the current code is live.
--
-- Run in the Supabase Dashboard -> SQL Editor.
--
-- ── Why a column and not a key inside order_summary ────────────────────────
--
-- order_summary is a DISPLAY contract. src/app/payment-upload.js:327 does
-- Object.entries() over it and renders every key as a labelled row, so a
-- `groups` key there would print a row reading "groups: [object Object]" on
-- the live payment page. buildOrderSummary() says as much in its own header:
-- "Keys become row labels in order."
--
-- A separate column cannot leak onto that page at all, and it leaves
-- order_summary byte-identical in shape for its other readers — including
-- the dashboard, which reads it in api/_lib/paymentBackfill.js.
--
-- ── Why this exists at all ─────────────────────────────────────────────────
--
-- GoHighLevel holds one service_type, one pax_count and one block of dish
-- text for a whole booking. An order spanning several services cannot be read
-- back out of that as groups — see the two DECISION NEEDED notes in
-- src/app/order-shell.js. The structure exists only at submit time, and this
-- is where it is kept.
--
-- Shape: an array of objects, one per cart line —
--   { service, kind, title, subtitle, units, qty, contents[], total, priceNote }
-- No CHECK constraint. The shape is owned by orderGroupsPayload() in
-- src/domain/cart.js and its tests; a constraint here would mean a migration
-- every time a field is added, and the reader tolerates missing keys anyway.

alter table public.payment_links
  add column if not exists order_groups jsonb;

comment on column public.payment_links.order_groups is
  'Per-line order structure for the Order Status screen. Written by api/_payment-link.js. Null for orders placed before this column existed — readers must fall back to the ungrouped view.';


-- ── Verify ─────────────────────────────────────────────────────────────────
-- `if not exists` reports "Success. No rows returned" whether or not it
-- created anything, so check explicitly:
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'payment_links' and column_name = 'order_groups';
--
-- Expect one row: order_groups | jsonb | YES
