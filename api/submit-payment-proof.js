import { supabaseAdmin } from "./_supabase-admin.js";

// A booking is often paid in more than one instalment — a deposit now, a
// balance later. Three covers deposit, balance and one correction without
// making the link an unlimited target. Enforced here, not just at
// payment-link-info.js, because this is the only place that can actually
// record a submission.
const MAX_SUBMISSIONS = 3;

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
    res.status(410).json({
      error: `You've already submitted the maximum of ${MAX_SUBMISSIONS} payments for this booking. Please contact us if you still owe a balance.`,
    });
    return;
  }
  // expires_at is only set once the customer opens the link via
  // payment-link-info.js — null here means that never happened, which is
  // as invalid as being expired. Reopening the link grants a fresh window,
  // so this is recoverable rather than final.
  if (!link.expires_at || new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: "This session has timed out. Please reopen the link to get a fresh 15 minutes." });
    return;
  }

  try {
    // Grouped by an explicit shared timestamp rather than a dedicated
    // counter column: several files chosen in one sitting are one
    // submission, not one each, and this lets that be told apart from a
    // second visit without a schema change to a table the dashboard also
    // writes to.
    const { data: priorRows, error: priorError } = await supabaseAdmin
      .from("payment_submissions")
      .select("submitted_at")
      .eq("token", token);
    if (priorError) throw priorError;

    const priorAttempts = new Set((priorRows ?? []).map((r) => r.submitted_at)).size;
    if (priorAttempts >= MAX_SUBMISSIONS) {
      res.status(410).json({
        error: `You've already submitted the maximum of ${MAX_SUBMISSIONS} payments for this booking. Please contact us if you still owe a balance.`,
      });
      return;
    }

    const submittedAt = new Date().toISOString();
    const rows = storagePaths.map((storagePath) => ({
      token,
      contact_id: link.contact_id,
      opportunity_id: link.opportunity_id,
      storage_path: storagePath,
      submitted_at: submittedAt,
    }));

    const { error: insertError } = await supabaseAdmin.from("payment_submissions").insert(rows);
    if (insertError) throw insertError;

    const attemptsUsed = priorAttempts + 1;
    const attemptsRemaining = MAX_SUBMISSIONS - attemptsUsed;

    // Only fully retired once she has genuinely used every submission —
    // matches the "finished" state payment-link-info.js checks for.
    if (attemptsRemaining <= 0) {
      const { error: usedError } = await supabaseAdmin
        .from("payment_links")
        .update({ used: true })
        .eq("token", token);
      if (usedError) throw usedError;
    }

    res.status(200).json({ ok: true, attemptsRemaining });
  } catch (e) {
    console.error("submit-payment-proof failed:", e);
    res.status(502).json({ error: e.message });
  }
}
