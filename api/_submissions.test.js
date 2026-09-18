import { describe, it, expect } from "vitest";
import { isSha256Hex, groupSubmissions, submissionItems } from "./_submissions.js";

describe("isSha256Hex", () => {
  const valid = "a".repeat(64);

  it("accepts 64 lowercase hex characters", () => {
    expect(isSha256Hex(valid)).toBe(true);
    expect(isSha256Hex("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("a".repeat(65))).toBe(false);
    expect(isSha256Hex("")).toBe(false);
  });

  // Uppercase would compare unequal to a stored lowercase digest, so the
  // duplicate check would silently miss. Rejecting is better than storing a
  // hash that can never match.
  it("rejects uppercase hex", () => {
    expect(isSha256Hex("A".repeat(64))).toBe(false);
  });

  it("rejects anything that is not a plain hex string", () => {
    expect(isSha256Hex(null)).toBe(false);
    expect(isSha256Hex(undefined)).toBe(false);
    expect(isSha256Hex(12345)).toBe(false);
    expect(isSha256Hex(["a".repeat(64)])).toBe(false);
    expect(isSha256Hex(`${"a".repeat(63)}'`)).toBe(false);
    expect(isSha256Hex("../../etc/passwd")).toBe(false);
  });
});

describe("groupSubmissions", () => {
  const at = (t) => `2026-09-0${t}T06:14:00.000Z`;

  it("has nothing to say about nothing", () => {
    expect(groupSubmissions([])).toEqual([]);
    expect(groupSubmissions(null)).toEqual([]);
    expect(groupSubmissions(undefined)).toEqual([]);
  });

  // The case that matters most. Five screenshots chosen in one sitting share
  // a timestamp and are ONE submission — counting them individually would
  // tell a customer she had used every allowance after a single upload.
  it("folds files sharing a timestamp into one submission", () => {
    const rows = [
      { submitted_at: at(8), status: "pending_review" },
      { submitted_at: at(8), status: "pending_review" },
      { submitted_at: at(8), status: "pending_review" },
    ];
    const groups = groupSubmissions(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(3);
  });

  it("keeps separate submissions separate, in the order given", () => {
    const groups = groupSubmissions([
      { submitted_at: at(8), status: "pending_review" },
      { submitted_at: at(9), status: "pending_review" },
    ]);
    expect(groups.map((g) => g.submittedAt)).toEqual([at(8), at(9)]);
  });

  it("skips a row with no timestamp rather than grouping it under undefined", () => {
    const groups = groupSubmissions([
      { submitted_at: null, status: "verified" },
      { submitted_at: at(8), status: "verified" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].submittedAt).toBe(at(8));
  });

  describe("state", () => {
    // The default status the dashboard may never move off. Reported as null
    // so the page shows the date alone rather than telling a customer her
    // payment is still being checked weeks after it cleared.
    it("says nothing about an unreviewed receipt", () => {
      expect(groupSubmissions([{ submitted_at: at(8), status: "pending_review" }])[0].state)
        .toBeNull();
      expect(groupSubmissions([{ submitted_at: at(8), status: null }])[0].state)
        .toBeNull();
      expect(groupSubmissions([{ submitted_at: at(8) }])[0].state)
        .toBeNull();
    });

    it("reports verified only when every file in the submission is", () => {
      expect(groupSubmissions([
        { submitted_at: at(8), status: "verified" },
        { submitted_at: at(8), status: "verified" },
      ])[0].state).toBe("verified");

      expect(groupSubmissions([
        { submitted_at: at(8), status: "verified" },
        { submitted_at: at(8), status: "pending_review" },
      ])[0].state).toBeNull();
    });

    // A rejection is the one thing in here she may need to act on, so it
    // wins over anything else in the group.
    it("reports a rejection even when the rest were accepted", () => {
      expect(groupSubmissions([
        { submitted_at: at(8), status: "verified" },
        { submitted_at: at(8), status: "rejected" },
      ])[0].state).toBe("rejected");
    });

    it("does not invent a state from an unrecognised status", () => {
      expect(groupSubmissions([{ submitted_at: at(8), status: "escalated" }])[0].state)
        .toBeNull();
    });
  });
});

describe("submissionItems", () => {
  const hash = "b".repeat(64);

  it("reads the current shape, keeping a well-formed hash", () => {
    expect(submissionItems({ files: [{ path: "c/1.jpg", hash }] }))
      .toEqual([{ path: "c/1.jpg", hash }]);
  });

  // A hash that could never match is stored as null instead, which puts the
  // row in the same position as every row written before the column existed:
  // it simply never trips the duplicate check.
  it("keeps the file but drops a hash it cannot trust", () => {
    expect(submissionItems({ files: [{ path: "c/1.jpg", hash: "nope" }] }))
      .toEqual([{ path: "c/1.jpg", hash: null }]);
    expect(submissionItems({ files: [{ path: "c/1.jpg" }] }))
      .toEqual([{ path: "c/1.jpg", hash: null }]);
  });

  // The browser and this endpoint deploy together but not at the same
  // instant. A customer holding the previous page must still be able to
  // submit — losing a real payment to tidy up a payload shape is the worse
  // trade by a long way.
  it("still accepts the older storagePaths shape", () => {
    expect(submissionItems({ storagePaths: ["c/1.jpg", "c/2.jpg"] }))
      .toEqual([
        { path: "c/1.jpg", hash: null },
        { path: "c/2.jpg", hash: null },
      ]);
  });

  it("prefers files when a request somehow carries both", () => {
    expect(submissionItems({ files: [{ path: "new.jpg", hash }], storagePaths: ["old.jpg"] }))
      .toEqual([{ path: "new.jpg", hash }]);
  });

  it("drops entries with no usable path", () => {
    expect(submissionItems({ files: [{ path: "" }, { path: null }, {}, null, "x"] }))
      .toEqual([]);
    expect(submissionItems({ storagePaths: ["", null, 7] })).toEqual([]);
  });

  it("returns nothing for a body carrying neither shape", () => {
    expect(submissionItems({})).toEqual([]);
    expect(submissionItems(null)).toEqual([]);
    expect(submissionItems(undefined)).toEqual([]);
    expect(submissionItems({ files: "not-an-array" })).toEqual([]);
  });
});

describe("what the reviewer recorded", () => {
  const at = "2026-09-15T01:46:00.000Z";

  it("carries the amount an admin entered when verifying", () => {
    const out = groupSubmissions([{ submitted_at: at, status: "verified", amount_paid: 14745 }]);
    expect(out[0].amount).toBe(14745);
  });

  it("does not multiply a payment by the number of screenshots attached", () => {
    // One submission can be several files, and the reviewer enters one
    // figure per row — so the same amount repeats. Summing would turn a
    // PHP 14,745 payment into PHP 44,235 on a three-file receipt.
    const out = groupSubmissions([
      { submitted_at: at, status: "verified", amount_paid: 14745 },
      { submitted_at: at, status: "verified", amount_paid: 14745 },
      { submitted_at: at, status: "verified", amount_paid: 14745 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(14745);
  });

  it("reports no amount at all rather than zero when nobody has reviewed it", () => {
    // Number(null) is 0. "PHP 0 — we're checking it" would tell a customer
    // we recorded nothing against a receipt she has just sent.
    const out = groupSubmissions([{ submitted_at: at, status: null, amount_paid: null }]);
    expect(out[0].amount).toBeNull();
  });

  it("reports no amount on a row from before the column existed", () => {
    const out = groupSubmissions([{ submitted_at: at, status: "verified" }]);
    expect(out[0].amount).toBeNull();
  });

  it("keeps a genuine zero, which is not the same as unknown", () => {
    const out = groupSubmissions([{ submitted_at: at, status: "verified", amount_paid: 0 }]);
    expect(out[0].amount).toBe(0);
  });
});
