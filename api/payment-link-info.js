import { supabaseAdmin } from "./_supabase-admin.js";

const OPEN_WINDOW_MS = 15 * 60 * 1000;
const SITE_URL = process.env.SITE_URL;

/**
 * GET /api/payment-link-info?token=...
 *
 * Validates a proof-of-payment link and returns the booking summary
 * snapshotted when the link was created. Never trust this alone for the
 * actual upload — api/submit-payment-proof.js re-validates server-side.
 *
 * The 15-minute window starts on first open, not at creation — a booking
 * is often confirmed days after the inquiry, so a creation-time timer
 * would make the link dead long before the customer needs it.
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
    .select("order_summary, first_opened_at, expires_at, used")
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

  if (!data.first_opened_at) {
    // First open — start the 15-minute clock now.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OPEN_WINDOW_MS).toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("payment_links")
      .update({ first_opened_at: now.toISOString(), expires_at: expiresAt })
      .eq("token", token);
    if (updateError) {
      res.status(502).json({ error: updateError.message });
      return;
    }
  } else if (new Date(data.expires_at) < new Date()) {
    res.status(410).json({ error: "This link has expired. Please ask Spandi's for a new one." });
    return;
  }

  // Live lookup — not snapshotted at inquiry time — so admin updates to
  // GCash/bank details or the QR code always show correctly, even for a
  // link that's sat unopened for days.
  let paymentInfo = null;
  const branch = data.order_summary?.Branch;
  if (branch) {
    const { data: branchInfo } = await supabaseAdmin
      .from("branch_payment_info")
      .select("gcash_number, gcash_name, bank_name, bank_account_name, bank_account_number, qr_storage_path")
      .eq("branch", branch)
      .maybeSingle();

    if (branchInfo) {
      const { qr_storage_path, ...rest } = branchInfo;
      // Proxied through our own domain (api/qr-image.js) rather than
      // Supabase's public storage URL, so customers never see the raw
      // Supabase project/bucket layout.
      paymentInfo = {
        ...rest,
        qrUrl: qr_storage_path
          ? `${SITE_URL}/api/qr-image?path=${encodeURIComponent(qr_storage_path)}`
          : null,
      };
    }
  }

  res.status(200).json({ orderSummary: data.order_summary, paymentInfo });
}
