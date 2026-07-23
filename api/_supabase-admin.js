import { createClient } from "@supabase/supabase-js";

// Service-role client for serverless functions only — never import this from src/.
// Bypasses RLS, so payment_links/payment_submissions intentionally have no anon grants.
export const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
