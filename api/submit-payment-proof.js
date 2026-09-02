import { supabaseAdmin } from "./_supabase-admin.js";
import { addContactTags } from "./_ghl-client.js";

// A booking is often paid in more than one instalment — a deposit now, a
// balance later. Three covers deposit, balance and one correction without
// making the link an unlimited target. Enforced here, not just at
// payment-link-info.js, because this is the only place that can actually
// record a submission.
const MAX_SUBMISSIONS = 3;

// What the GHL workflow listens for. Changing it here means changing the
// workflow's trigger to match -- they are one setting split across two
// systems, and a rename in only one of them fails silently: no error, just
// nobody being told a payment arrived.
//
// Namespaced to match what the location already uses. There are tags in
// there called payment:missing-proof, payment:half-paid-detected and
// payment:fully-paid-detected, put on by something outside this repo -- so
// a bare "proof-submitted" would be the one payment tag that did not look
// like the others, and would sort away from them in every GHL tag list.
const PROOF_TAG = "payment:proof-submitted";

/**
 * POST /api/submit-payment-proof
 * Body: { token, storagePaths: [...] }
 *
 * Files are uploaded directly to Supabase Storage by the browser (via
 * signed URLs from api/request-upload-urls.js) before this runs — this
 * endpoint only re-validates the token and records the submission rows.
 *
 * The one thing it does put in GHL is a tag on the contact, which exists
 * solely to give a workflow something to fire on -- until this, a customer
 * could upload a receipt and nothing anywhere told anyone. It deliberately
 * records no payment: the money is not verified at this point, and writing
 * payment_status or amount_paid here would assert something nobody has
 * checked. Verification stays a separate, human step.
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

    // After the rows are safely in, and awaited rather than left to run on
    // after the response -- a serverless function can be frozen the moment
    // it replies, which would drop the notification silently some of the
    // time and be very hard to notice.
    //
    // Never fatal. The receipt is already stored and the customer has done
    // their part; failing their upload because a notification did not go out
    // would lose the thing that matters to keep the thing that does not.
    const tagged = await addContactTags(link.contact_id, [PROOF_TAG]);
    if (!tagged.ok) {
      console.error(`proof uploaded but GHL tag "${PROOF_TAG}" failed for contact ${link.contact_id}: ${tagged.reason}`);
    }

    res.status(200).json({ ok: true, attemptsRemaining });
  } catch (e) {
    console.error("submit-payment-proof failed:", e);
    res.status(502).json({ error: e.message });
  }
}
