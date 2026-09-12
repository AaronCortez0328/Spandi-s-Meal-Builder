-- Showing a customer what she has already sent, and not taking the same
-- receipt twice.
--
-- Run this in the Supabase Dashboard -> SQL Editor.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- A customer sent her deposit receipt, closed the tab, came back the next day
-- to check it had arrived, and found an empty upload form — the page had no
-- memory of her. So she sent the same receipt again. That is not a mistake on
-- her part: she asked a reasonable question and the page answered it by
-- showing her something that looked like she had never sent anything.
--
-- It cost her one of three allowed submissions. Deposit plus a duplicate is
-- two gone, leaving one for the balance — and if she hesitates once more on
-- that, the link retires and she has to telephone, at exactly the point where
-- the balance decides whether food is released.
--
-- ── What this adds ─────────────────────────────────────────────────────────
--
-- No anon/authenticated grants, matching the rest of the payment tables:
-- everything here is reached through serverless functions on the service-role
-- key, which bypasses grants entirely.

-- An index on the column every read of this table already filters by.
--
-- payment_submissions.token is a foreign key, and Postgres does NOT index
-- foreign keys automatically — a common assumption, and wrong. So the count
-- in api/submit-payment-proof.js has been a sequential scan since the table
-- was created. It is small enough that nobody noticed, and it will not stay
-- small. Adding it here rather than alongside the feature below because it
-- pays for itself on the query that already exists.
create index if not exists payment_submissions_token_idx
  on public.payment_submissions (token);

-- The content fingerprint of the uploaded file — SHA-256, hex, computed in
-- the browser before the bytes are sent anywhere.
--
-- Nullable on purpose, and it stays nullable. Hashing needs crypto.subtle,
-- which is unavailable in an insecure context and can be absent on older
-- browsers; when it cannot be computed the upload proceeds without one. A
-- customer must never be blocked from paying because we could not fingerprint
-- her screenshot — the same fail-open rule as the blocked-date check and the
-- rate limiter. Every row written before this migration is null too, so the
-- duplicate check simply finds nothing for those and lets the upload through.
alter table public.payment_submissions
  add column if not exists file_hash text;

-- The duplicate lookup is always "this token, these hashes", never a hash on
-- its own — one customer resending her own receipt is what this catches, and
-- two unrelated customers who happen to upload an identical file are not each
-- other's business.
create index if not exists payment_submissions_token_hash_idx
  on public.payment_submissions (token, file_hash);


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Both indexes present, and the column nullable with no default:
--
--   select indexname from pg_indexes
--    where tablename = 'payment_submissions';
--
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'payment_submissions' and column_name = 'file_hash';
