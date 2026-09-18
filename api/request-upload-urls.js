import { supabaseAdmin } from "./_supabase-admin.js";
import { isSha256Hex } from "./_submissions.js";

/**
 * Two per submission. The client's rule, and this is where it is enforced —
 * the browser's copy in src/app/payment-upload.js only saves a round trip.
 */
const MAX_FILES = 2;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Which of these file hashes this booking has already received.
 *
 * Scoped to the token on purpose. One customer resending her own receipt is
 * what this is for; two unrelated customers who happen to upload a
 * byte-identical file are not each other's business, and a global hash check
 * would refuse the second one for no reason.
 *
 * Only well-formed SHA-256 hex reaches the query — a malformed or hostile
 * value is dropped rather than passed into the filter.
 *
 * Fails open, returning an empty map: a customer must never be stopped from
 * sending proof of payment because a de-duplication lookup broke. Wrapped in
 * try/catch as well as error-checked, because supabase-js reports a refusal
 * through `error` but a network failure rejects instead.
 *
 * @returns {Promise<Map<string, string>>} hash -> when it was first received
 */
async function alreadyReceived(token, hashes) {
  const wanted = [...new Set((hashes ?? []).filter(isSha256Hex))];
  if (wanted.length === 0) return new Map();

  try {
    const { data, error } = await supabaseAdmin
      .from("payment_submissions")
      .select("file_hash, submitted_at")
      .eq("token", token)
      .in("file_hash", wanted);
    if (error) throw error;

    const seen = new Map();
    for (const row of data ?? []) {
      if (row.file_hash && !seen.has(row.file_hash)) seen.set(row.file_hash, row.submitted_at);
    }
    return seen;
  } catch (e) {
    console.warn("Duplicate-receipt check failed, accepting the upload:", e.message ?? e);
    return new Map();
  }
}

/**
 * POST /api/request-upload-urls
 * Body: { token, files: [{ name, type, size, hash? }, ...] } (max 5)
 *
 * Re-validates the token exactly like submit-payment-proof.js does, then
 * hands back a signed upload URL per file so the browser can upload
 * directly to Supabase Storage — file bytes never pass through this
 * (or any) Vercel function, so the 4.5MB body-size limit never applies.
 *
 * `hash` is optional — a SHA-256 of the file's bytes, computed in the
 * browser. When one matches a receipt this booking already holds, no upload
 * URL is issued for it and the entry comes back as `{ duplicate: true }`
 * instead: nothing uploads, nothing is recorded, and the customer's three
 * submissions are not spent on a receipt we already have. It also costs her
 * no mobile data, because the file never leaves the phone.
 *
 * The `uploads` array is always the same length as `files` and in the same
 * order. The browser pairs them by index, so dropping an entry here would
 * silently upload files against the wrong signed URLs.
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
  // `used` means every allowed submission has been made — see
  // submit-payment-proof.js, the endpoint that actually enforces the
  // count. Checked here too so a spent link never hands out an upload URL
  // that submission would refuse anyway.
  if (link.used) {
    res.status(410).json({ error: "You've already submitted the maximum number of payments for this booking. Please contact us if you still owe a balance." });
    return;
  }
  // Reopening the link grants a fresh window (see payment-link-info.js),
  // so this is a prompt to go back, not a dead end.
  if (!link.expires_at || new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: "This session has timed out. Please reopen the link to get a fresh 15 minutes." });
    return;
  }

  try {
    const seen = await alreadyReceived(token, files.map((f) => f?.hash));

    const results = [];
    for (const f of files) {
      // Already have this exact file for this booking. Hand back a marker
      // rather than a URL — same position in the array, so the browser's
      // index pairing still lines up.
      const receivedAt = f?.hash ? seen.get(f.hash) : undefined;
      if (receivedAt) {
        results.push({ name: f.name, duplicate: true, submittedAt: receivedAt });
        continue;
      }

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
