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
    const group = groups.get(key) ?? { submittedAt: key, fileCount: 0, statuses: [] };
    group.fileCount += 1;
    group.statuses.push(row.status ?? null);
    groups.set(key, group);
  }

  return [...groups.values()].map(({ submittedAt, fileCount, statuses }) => ({
    submittedAt,
    fileCount,
    state: statuses.includes("rejected")
      ? "rejected"
      : statuses.length > 0 && statuses.every((s) => s === "verified")
        ? "verified"
        : null,
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
