-- Two locks instead of one on the tables holding customer contact details.
--
-- payment_links.order_summary carries a customer's name, phone and address.
-- payment_submissions points at their uploaded proof of payment.
--
-- Both already return no rows to the public key, but they answer with
-- `200 []` rather than `401`. That difference matters: 200-empty means the
-- SELECT privilege IS granted and only a row-level policy is withholding the
-- data. 401 means there is no privilege to begin with. One lock versus two.
--
-- payment_flow_schema.sql already says "No anon/authenticated grants on
-- either table on purpose" — so this is restoring the stated intent, not
-- changing it. The grant most likely came from a default privilege rather
-- than a deliberate decision, which is the sort of thing that goes unnoticed
-- when there is no record of which migrations have run.

-- ── Safe for both roles ────────────────────────────────────────────────────
-- Verified against both codebases before writing this: neither table is read
-- from a browser anywhere.
--   · Meal Builder  — reaches them only through /api with the service-role key
--   · Dashboard     — reads payment_submissions in api/payment-submissions.js,
--                     also service-role. Nothing browser-side touches either.
-- The service-role key bypasses grants entirely, so every real caller is
-- unaffected.

revoke all on public.payment_links       from anon, authenticated;
revoke all on public.payment_submissions from anon, authenticated;

-- Future tables inherit whatever the default is, which is how this happened.
-- Pin it so a new table in this schema does not quietly arrive readable.
alter default privileges in schema public revoke all on tables from anon;


-- ── activity_log: anon only, NOT authenticated ─────────────────────────────
-- The dashboard reads AND writes this from the browser with a signed-in
-- session (src/context/LogContext.jsx — select at :17, insert at :54).
-- Revoking `authenticated` would break its Activity Log page and silence
-- every audit entry it writes.
--
-- Removing `anon` is still worth doing: a logged-out visitor has no reason
-- to reach an audit trail, and the dashboard's own users are `authenticated`,
-- not `anon`.
--
-- Confirmed safe by the dashboard team on 4 August: the only read sits inside
-- ProtectedRoute, LogProvider does not fetch on mount, and every write comes
-- from an authenticated action. They asked explicitly that `authenticated`
-- be left alone — the write path depends on it.

revoke all on public.activity_log from anon;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- After running, both should answer 401 rather than 200 with an empty list:
--
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "$VITE_SUPABASE_URL/rest/v1/payment_links?select=id&limit=1" \
--     -H "apikey: $VITE_SUPABASE_ANON_KEY"
--
-- And the customer payment page must still load — it reads through
-- api/payment-link-info.js on the service-role key, so it should be
-- untouched. Worth opening one link to be sure rather than assuming.
