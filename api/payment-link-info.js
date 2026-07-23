import { supabaseAdmin } from "./_supabase-admin.js";

/**
 * GET /api/payment-link-info?token=...
 *
 * Validates a proof-of-payment link and returns the booking summary
 * snapshotted when the link was created. Never trust this alone for the
 * actual upload — api/submit-payment-proof.js re-validates server-side.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token } = req.query ?? {};
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("payment_links")
    .select("order_summary, expires_at, used")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    res.status(502).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  if (data.used) {
    res.status(410).json({ error: "This link has already been used." });
    return;
  }
  if (new Date(data.expires_at) < new Date()) {
    res.status(410).json({ error: "This link has expired. Please ask Spandi's for a new one." });
    return;
  }

  res.status(200).json({ orderSummary: data.order_summary });
}
