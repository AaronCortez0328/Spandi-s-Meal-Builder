import { supabaseAdmin } from "./_supabase-admin.js";

/**
 * GET /api/qr-image?path=<storage_path>
 *
 * Streams a QR code image from the private "payment-qr-codes" bucket
 * through our own domain, so customers never see Supabase's raw storage
 * URL (which would otherwise expose the project ref / bucket layout).
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { path } = req.query ?? {};
  if (!path) {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const { data, error } = await supabaseAdmin.storage
    .from("payment-qr-codes")
    .download(path);

  if (error || !data) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  res.setHeader("Content-Type", data.type || "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(buffer);
}
