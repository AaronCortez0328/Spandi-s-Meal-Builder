-- Proof-of-payment flow: tables + storage bucket.
-- Run this in the Supabase Dashboard -> SQL Editor.
--
-- No anon/authenticated grants on either table on purpose — every access
-- goes through serverless functions using the service-role key
-- (SUPABASE_SERVICE_ROLE_KEY, server-side only, see .env.example).
-- The separate admin dashboard reading payment_submissions needs its own
-- service-role (or scoped) key and a way to generate signed URLs for the
-- private storage objects.

create table if not exists public.payment_links (
  token         text primary key,
  contact_id    text not null,
  opportunity_id text,
  order_summary jsonb,
  expires_at    timestamptz not null,
  used          boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.payment_submissions (
  id             uuid primary key default gen_random_uuid(),
  token          text references public.payment_links(token),
  contact_id     text not null,
  opportunity_id text,
  storage_path   text not null,
  status         text not null default 'pending_review', -- pending_review | verified | rejected
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    text
);

-- Private bucket for uploaded receipts — not publicly readable.
insert into storage.buckets (id, name, public)
values ('proof-of-payments', 'proof-of-payments', false)
on conflict (id) do nothing;
