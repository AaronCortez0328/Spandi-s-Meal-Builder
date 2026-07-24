import { supabaseAdmin } from "./_supabase-admin.js";

/**
 * POST /api/submit-payment-proof
 * Body: { token, storagePaths: [...] }
 *
 * Files are uploaded directly to Supabase Storage by the browser (via
 * signed URLs from api/request-upload-urls.js) before this runs — this
 * endpoint only re-validates the token and records the submission rows.
 * Does NOT touch GHL — that only happens once an admin verifies the
 * images (api/relay-proof-to-ghl.js).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, storagePaths } = req.body ?? {};
  if (!token || !Array.isArray(storagePaths) || storagePaths.length === 0) {
    res.status(400).json({ error: "token and a non-empty storagePaths array are required" });
    return;
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from("payment_links")
    .select("contact_id, opportunity_id, used, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (linkError) {
    res.status(502).json({ error: linkError.message });
    return;
  }
  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  if (link.used) {
    res.status(410).json({ error: "This link has already been used." });
    return;
  }
  // expires_at is only set once the customer opens the link via
  // payment-link-info.js — null here means that never happened, which is
  // as invalid as being expired.
  if (!link.expires_at || new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: "This link has expired. Please ask Spandi's for a new one." });
    return;
  }

  try {
    const rows = storagePaths.map((storagePath) => ({
      token,
      contact_id: link.contact_id,
      opportunity_id: link.opportunity_id,
      storage_path: storagePath,
    }));

    const { error: insertError } = await supabaseAdmin.from("payment_submissions").insert(rows);
    if (insertError) throw insertError;

    const { error: usedError } = await supabaseAdmin
      .from("payment_links")
      .update({ used: true })
      .eq("token", token);
    if (usedError) throw usedError;

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("submit-payment-proof failed:", e);
    res.status(502).json({ error: e.message });
  }
}
