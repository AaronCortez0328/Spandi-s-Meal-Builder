-- ============================================================================
--  order_change_requests — correcting two column comments
-- ============================================================================
--
--  Comments only. No column is added, dropped or altered, nothing is locked
--  for more than an instant, and no row is touched. Safe to run on a live
--  table at any time.
--
--  ── Why ────────────────────────────────────────────────────────────────────
--
--  The dashboard team read the `after` comment and found it disagreeing with
--  the code, which is the correct thing to have happened and the wrong thing
--  to have been possible. It said:
--
--    'What the customer is asking for, in catalogue vocabulary: a package_id
--     for a change, package_items rows for an add. Never carries a price.'
--
--  Both halves were wrong by then.
--
--  The SHAPE changed when the change flow moved into the meal builder: a
--  customer no longer picks a package_id from a short list, they rebuild
--  their order, so what arrives is a whole basket for both kinds.
--
--  And `after.total` is a price. The rule it was describing has NOT moved —
--  no price ever comes from the browser, and cleanAfter is an allowlist with
--  no key that could carry one — but the row does now hold a figure, computed
--  server-side from our own tables. Calling that "never a price" would have
--  left the next person to read it trusting the wrong sentence.
--
--  `before` gains a line for the same reason: package_name is null on most
--  live bookings, and before.package_id is what makes the change legible from
--  the row without fetching the opportunity to diff it.
--
--  ── Run ────────────────────────────────────────────────────────────────────
--    Supabase SQL editor, once. Re-running is harmless.
-- ============================================================================

comment on column public.order_change_requests.after is
  'What the customer is asking for: {lineItems, groups, singlePackageId, total}. lineItems is the whole rebuilt order in the shape our pricing understands; groups is the same order as a person reads it; singlePackageId is the catalogue id when the request is one package at quantity one and null otherwise. NO PRICE EVER COMES FROM THE BROWSER - cleanAfter is an allowlist with no key that could carry one. total is OURS, computed server-side at request time, and is an estimate for the queue rather than an amount to charge: price again from the catalogue at approve time.';

comment on column public.order_change_requests.before is
  'The booking as it stood when the customer asked. package_id is what it is for now, recovered from dishes_selected the same way Order Status recovers it - so before.package_id and after.singlePackageId sit side by side and the change is legible from the row alone. package_name is frequently null on live data and must not be relied on. total is a display snapshot of what the customer was looking at.';


-- ── Verify ──────────────────────────────────────────────────────────────────
--   select a.attname, d.description
--     from pg_description d
--     join pg_attribute a
--       on a.attrelid = d.objoid and a.attnum = d.objsubid
--    where d.objoid = 'public.order_change_requests'::regclass
--    order by a.attnum;
