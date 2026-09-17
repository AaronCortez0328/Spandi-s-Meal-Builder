/**
 * The decisions the three payment_submissions endpoints share.
 *
 * Imports nothing, on purpose. _supabase-admin.js builds its client at module
 * load and throws when the env vars are absent, so anything importing it
 * cannot be unit-tested without real credentials — the same trap
 * api/_rate-limit.js documents, where originAllowed() shipped untested for
 * exactly that reason and rejected every preview deployment. Keeping the
 * logic worth testing in a module with no dependencies is the simpler answer
 * than working around it a second time.
 */

/**
 * A well-formed SHA-256 digest, lowercase hex.
 *
 * Everything that reaches these endpoints as a "hash" is a value the browser
 * supplied, so it is checked rather than trusted: a malformed one is dropped
 * before it can reach a query filter or be written to a column that a later
 * lookup will compare against.
 */
export function isSha256Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Rows from payment_submissions, folded into one entry per submission.
 *
 * Grouped by submitted_at, matching how api/submit-payment-proof.js counts
 * against MAX_SUBMISSIONS: several screenshots chosen in one sitting share a
 * timestamp and are one submission, not one each. Counting them individually
 * would tell a customer she had used three of three after a single upload.
 *
 * Insertion order is preserved, so the caller's ordering survives — the query
 * asks for submitted_at ascending and the customer reads them oldest first.
 *
 * ── On `state` ─────────────────────────────────────────────────────────────
 *
 * Only ever "verified", "rejected" or null. `status` is written by the
 * separate dashboard and we have not confirmed it is maintained; if admins
 * verify payments in GoHighLevel and never touch the column, every row stays
 * 'pending_review' forever. Passing that through would tell a customer her
 * payment is still being checked weeks after it cleared. So anything that is
 * not explicitly reviewed reports null, and the page shows the date alone —
 * true whether a human has looked yet or not.
 *
 * A rejection anywhere in a group wins, because it is the one thing in here
 * she may need to act on. Verified requires every file in the group, so a
 * half-reviewed submission is not announced as settled.
 */
export function groupSubmissions(rows) {
  const groups = new Map();

  for (const row of rows ?? []) {
    if (!row?.submitted_at) continue;
    const key = row.submitted_at;
    const group = groups.get(key) ?? { submittedAt: key, fileCount: 0, statuses: [], amounts: [] };
    group.fileCount += 1;
    group.statuses.push(row.status ?? null);
    // The figure the reviewing admin entered, not what the customer
    // claimed — the dashboard snapshots it on verify. Null until somebody
    // has looked, and on rows reviewed before that column existed.
    if (row.amount_paid !== null && row.amount_paid !== undefined) {
      group.amounts.push(Number(row.amount_paid));
    }
    groups.set(key, group);
  }

  return [...groups.values()].map(({ submittedAt, fileCount, statuses, amounts }) => ({
    submittedAt,
    fileCount,
    state: statuses.includes("rejected")
      ? "rejected"
      : statuses.length > 0 && statuses.every((s) => s === "verified")
        ? "verified"
        : null,
    // One submission can be several files; the reviewer enters one figure
    // per row, so the same amount repeats. Summing would multiply a payment
    // by the number of screenshots attached to it.
    amount: amounts.length > 0 ? Math.max(...amounts) : null,
  }));
}

/**
 * The files a submission is recording, from either accepted request shape.
 *
 * `files: [{ path, hash }]` is what the current browser sends. `storagePaths:
 * [...]` is what the previous one sent, and is still accepted: the browser
 * and the endpoint deploy together but not at the same instant, and a
 * customer part-way through choosing files when a deploy lands is holding the
 * old page. Refusing her submission to tidy up a payload shape would lose a
 * real payment.
 *
 * A hash that is not well-formed becomes null rather than an error. Null is
 * the same position as every row written before the column existed: it simply
 * never matches a duplicate check, so the upload goes through.
 *
 * @returns {Array<{ path: string, hash: string|null }>} empty when neither
 *   shape carries anything usable, which the caller treats as a bad request.
 */
export function submissionItems(body) {
  const { storagePaths, files } = body ?? {};

  if (Array.isArray(files)) {
    return files
      .filter((f) => f && typeof f.path === "string" && f.path.length > 0)
      .map((f) => ({ path: f.path, hash: isSha256Hex(f.hash) ? f.hash : null }));
  }

  if (Array.isArray(storagePaths)) {
    return storagePaths
      .filter((p) => typeof p === "string" && p.length > 0)
      .map((p) => ({ path: p, hash: null }));
  }

  return [];
}

/**
 * How many of a link's three submissions a customer has actually spent.
 *
 * ── Why a rejected receipt does not count ─────────────────────────────────
 *
 * It used to. The counter was the number of distinct submissions on the
 * token, whatever became of them, and the real case that exposed it was
 * this: three uploads, of which one was her own booking-confirmation email
 * sent by mistake, one was the genuine GCash receipt, and one was a
 * screenshot uploaded in error by the office. One actual payment, and the
 * link retired itself.
 *
 * A rejected upload is one somebody has LOOKED AT and confirmed is not a
 * payment. Charging a slot for it charges the customer for being reviewed.
 * The cap exists to stop a link being used indefinitely, not to punish
 * sending the wrong picture.
 *
 * ── Why there is still a ceiling ──────────────────────────────────────────
 *
 * Because "rejected does not count" on its own means an endless supply of
 * attempts to anyone whose uploads keep being rejected, which is exactly the
 * shape the cap was put there to stop. So rejections are free up to a point
 * and then they are not.
 *
 * An unreviewed submission counts. Nobody has decided it is not a payment
 * yet, and assuming in the customer's favour before anyone has looked is how
 * the ceiling stops meaning anything.
 *
 * @param {Array<{submitted_at: string, status: string|null}>} rows
 * @returns {{ spent: number, total: number }}
 *   `spent` counts toward MAX_SUBMISSIONS; `total` counts toward the ceiling.
 */
export function attemptsUsed(rows) {
  const bySubmission = new Map();
  for (const r of rows ?? []) {
    const at = r?.submitted_at;
    if (!at) continue;
    // One sitting is one submission however many files it held. A rejection
    // on any file rejects the submission: the reviewer was looking at the
    // set, and half a rejected receipt is not a payment either.
    const status = String(r?.status ?? "").trim().toLowerCase();
    const prior = bySubmission.get(at);
    bySubmission.set(at, prior === "rejected" ? prior : status);
  }

  let spent = 0;
  for (const status of bySubmission.values()) {
    if (status !== "rejected") spent += 1;
  }
  return { spent, total: bySubmission.size };
}
