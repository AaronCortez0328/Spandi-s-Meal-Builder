import { supabaseAdmin } from "./_supabase-admin.js";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/request-upload-urls
 * Body: { token, files: [{ name, type, size }, ...] } (max 5)
 *
 * Re-validates the token exactly like submit-payment-proof.js does, then
 * hands back a signed upload URL per file so the browser can upload
 * directly to Supabase Storage — file bytes never pass through this
 * (or any) Vercel function, so the 4.5MB body-size limit never applies.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, files } = req.body ?? {};
  if (!token || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: "token and a non-empty files array are required" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `You can upload up to ${MAX_FILES} files at a time.` });
    return;
  }
  for (const f of files) {
    if (!f?.name) {
      res.status(400).json({ error: "Each file needs a name." });
      return;
    }
    // A missing size is a rejection, not a pass. The previous check only ran
    // when size was a number, so omitting the field from the request body
    // skipped the limit entirely.
    if (typeof f.size !== "number" || Number.isNaN(f.size)) {
      res.status(400).json({ error: `${f.name} is missing a file size.` });
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: `${f.name} is too large (max 10 MB).` });
      return;
    }
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
  if (!link.expires_at || new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: "This link has expired. Please ask Spandi's for a new one." });
    return;
  }

  try {
    const results = [];
    for (const f of files) {
      // The customer's filename is kept only as a readable suffix, stripped
      // of anything that could steer the path — it is concatenated into a
      // storage key that this handler writes with the service-role key.
      const safeName = String(f.name)
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/\.{2,}/g, ".")
        .slice(-80);
      const storagePath = `${link.contact_id}/${crypto.randomUUID()}-${safeName}`;
      const { data, error } = await supabaseAdmin.storage
        .from("proof-of-payments")
        .createSignedUploadUrl(storagePath);
      if (error) throw error;

      results.push({
        name: f.name,
        path: storagePath,
        token: data.token,
      });
    }

    res.status(200).json({ uploads: results });
  } catch (e) {
    console.error("request-upload-urls failed:", e);
    res.status(502).json({ error: e.message });
  }
}
