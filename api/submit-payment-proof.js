import { supabaseAdmin } from "./_supabase-admin.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * POST /api/submit-payment-proof
 * Body: { token, fileName, fileType, fileBase64 }
 *
 * Re-validates the token server-side (never trust the page's own check),
 * uploads the receipt to Supabase Storage, and records a payment_submissions
 * row for the admin dashboard to review. Does NOT touch GHL — that only
 * happens once an admin verifies the image (api/relay-proof-to-ghl.js).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, fileName, fileType, fileBase64 } = req.body ?? {};
  if (!token || !fileName || !fileBase64) {
    res.status(400).json({ error: "token, fileName, and fileBase64 are required" });
    return;
  }

  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length > MAX_FILE_BYTES) {
    res.status(413).json({ error: "File is too large (max 8 MB)." });
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
  if (new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: "This link has expired. Please ask Spandi's for a new one." });
    return;
  }

  try {
    const storagePath = `${link.contact_id}/${crypto.randomUUID()}-${fileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("proof-of-payments")
      .upload(storagePath, buffer, { contentType: fileType || "application/octet-stream" });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabaseAdmin.from("payment_submissions").insert({
      token,
      contact_id: link.contact_id,
      opportunity_id: link.opportunity_id,
      storage_path: storagePath,
    });
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
