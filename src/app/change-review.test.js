import { describe, it, expect } from "vitest";
import { changeReviewHtml, differenceLine, paidLine , changeSentHtml } from "./change-review.js";
import { changeSummary } from "../domain/change-summary.js";

/**
 * The screen that stops somebody sending a change they did not mean.
 *
 * The thing under test is not the markup — it is that a change and an add
 * cannot be mistaken for each other, and that no figure appears that we do
 * not actually know.
 */
const was = [{ title: "Mary Rose Package", units: "100 pax", total: 35000 }];
const now = [{ title: "2× Family Combo 1", units: "15 pax", total: 20000 }];

const render = (kind, summary, sides = {}) =>
  changeReviewHtml({
    session: { kind },
    was: sides.was ?? was,
    now: sides.now ?? now,
    summary,
  });

describe("the change review screen", () => {
  describe("a change and an add do not read alike", () => {
    const s = (kind) => changeSummary({ kind, wasTotal: 35000, cartTotal: 20000, paid: 17500 });

    it("puts the booking as it stands against the order replacing it", () => {
      const html = render("change", s("change"));
      expect(html).toContain(">Was<");
      expect(html).toContain(">Now<");
      expect(html).not.toContain(">Adding<");
    });

    it("puts an addition alongside the booking, replacing nothing", () => {
      const html = render("add", s("add"));
      expect(html).toContain(">Your booking<");
      expect(html).toContain(">Adding<");
      expect(html).not.toContain(">Was<");
    });

    it("shows a new total only when adding, because only then is there one", () => {
      expect(render("add", s("add"))).toContain("New total");
      expect(render("change", s("change"))).not.toContain("New total");
    });

    it("sends under different words", () => {
      expect(render("change", s("change"))).toContain("Send this change");
      expect(render("add", s("add"))).toContain("Send this addition");
    });
  });

  describe("the difference, in words", () => {
    const diff = (kind, wasTotal, cartTotal) =>
      differenceLine(changeSummary({ kind, wasTotal, cartTotal }));

    it("says more, and by how much", () => {
      expect(diff("change", 20000, 35000)).toMatch(/15,000 more/);
    });

    it("says less, without a minus sign in front of a peso figure", () => {
      const line = diff("change", 35000, 20000);
      expect(line).toMatch(/15,000 less/);
      expect(line).not.toContain("-");
    });

    it("says plainly when nothing has moved", () => {
      expect(diff("change", 35000, 35000)).toMatch(/same/i);
    });

    it("says what an addition costs on top", () => {
      expect(diff("add", 35000, 5000)).toMatch(/5,000 on top/);
    });

    it("promises to confirm rather than inventing a difference it cannot know", () => {
      expect(diff("change", null, 20000)).toMatch(/confirm the difference/i);
    });
  });

  describe("what has been paid", () => {
    const paid = (kind, wasTotal, cartTotal, amount) =>
      paidLine(changeSummary({ kind, wasTotal, cartTotal, paid: amount }));

    /**
     * The worst sentence this page could print. A booking with no
     * amount_paid recorded must not be told it owes the lot.
     */
    it("says nothing at all when we do not know what has been paid", () => {
      expect(paid("change", 35000, 20000, null)).toBeNull();
      expect(render("change", changeSummary({
        kind: "change", wasTotal: 35000, cartTotal: 20000, paid: null,
      }))).not.toMatch(/you have paid/i);
    });

    it("states what is left to settle against the NEW order", () => {
      expect(paid("change", 35000, 20000, 17500)).toMatch(/2,500 to settle/);
    });

    it("says nothing is left when the payment covers it", () => {
      expect(paid("change", 35000, 20000, 20000)).toMatch(/nothing left to settle/i);
    });

    /**
     * Refund, credit or neither is the business's decision and it has not
     * been made. The screen must not make it for them.
     */
    it("does not promise a refund when the new order costs less than was paid", () => {
      const line = paid("change", 35000, 10000, 17500);
      expect(line).toMatch(/sort the difference out/i);
      expect(line).not.toMatch(/refund/i);
    });
  });

  describe("standing promises", () => {
    const s = changeSummary({ kind: "change", wasTotal: 35000, cartTotal: 20000, paid: 17500 });

    it("repeats that nothing changes until we confirm it", () => {
      expect(render("change", s)).toMatch(/nothing on your booking changes until we confirm/i);
    });

    it("keeps a way back to the builder", () => {
      expect(render("change", s)).toContain("data-go-review");
    });

    it("carries the status line the submit writes into", () => {
      const html = render("change", s);
    expect(html).toContain('id="order-submit-status"');
    // status-text, not form-status: the latter has no rule behind it
    // anywhere, so a failed send would have rendered at browser defaults on
    // the one screen where a customer most needs to read it.
    expect(html).toContain('class="status-text"');
    });
  });

  describe("missing halves", () => {
    const s = changeSummary({ kind: "change", wasTotal: null, cartTotal: 20000 });

    it("says the booking is still there when it cannot list it", () => {
      const html = changeReviewHtml({
        session: { kind: "add" }, was: [], now, summary: s,
      });
      expect(html).toMatch(/still there/i);
    });

    it("draws an em dash where a line has no price, never PHP 0", () => {
      const html = render("change", s, { now: [{ title: "Bespoke platter", total: null }] });
      expect(html).toContain("&mdash;");
      expect(html).not.toContain("PHP 0");
    });

    it("keeps a price note instead of a figure, where a line has one", () => {
      const html = render("change", s, {
        now: [{ title: "Bespoke platter", total: 0, priceNote: "From PHP 8,000" }],
      });
      expect(html).toContain("From PHP 8,000");
    });
  });

  it("escapes a title rather than rendering it", () => {
    const html = render("change", changeSummary({ kind: "change", wasTotal: 1, cartTotal: 1 }), {
      now: [{ title: "<img src=x onerror=alert(1)>", total: 100 }],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  /**
   * The one mark on the screen that cannot be read two ways.
   *
   * Everything else here — two lists, two labels, a figure — can be skimmed
   * into meaning something it does not. An arrow between them says the
   * second REPLACES the first; a plus says it joins it. That is the whole
   * difference between amending an order and losing one.
   */
  describe("the mark between the two sides", () => {
    const s = (kind) => changeSummary({ kind, wasTotal: 35000, cartTotal: 20000 });

    it("points down when the new order replaces the booking", () => {
      const html = render("change", s("change"));
      expect(html).toContain("&darr;");
      expect(html).not.toMatch(/chg-review__op[^>]*>\s*\+/);
    });

    it("adds when the new order joins the booking", () => {
      const html = render("add", s("add"));
      expect(html).toMatch(/chg-review__op[^>]*>\s*\+/);
      expect(html).not.toContain("&darr;");
    });

    it("is hidden from screen readers, which have the labels instead", () => {
      // "WAS / NOW" and "Your booking / Adding" already carry the meaning
      // in words. An arrow read aloud is noise.
      expect(render("change", s("change"))).toMatch(/chg-review__op"[^>]*aria-hidden/);
    });
  });
});

/**
 * The screen after a change has been sent.
 *
 * Two faults, both mine, both invisible to a test that only checked the
 * words were present.
 */
describe("the confirmation after sending", () => {
  const html = (kind = "change") => changeSentHtml(kind);

  /**
   * It reused .chg-review__diff, which is cream because it lives on the
   * charcoal money block. On this white card that rendered cream on white —
   * the one line a customer most needs after asking to change their party,
   * invisible.
   */
  it("does not borrow the dark block's text colours", () => {
    expect(html()).not.toContain("chg-review__diff");
    expect(html()).not.toContain("chg-review__promise");
    expect(html()).toContain("chg-sent__lead");
  });

  it("still says the thing that matters most", () => {
    expect(html()).toMatch(/nothing on your booking has changed yet/i);
  });

  /**
   * submitAsChange used to post spandis-go-status on success, and the site
   * acts on it at once — so this panel was drawn and navigated away from in
   * the same breath. Somebody who saw a flash has nowhere to ask what
   * happened.
   */
  it("carries its own way onward, so nothing has to navigate for it", () => {
    expect(html()).toContain("data-change-done");
  });

  it("words itself for whichever was sent", () => {
    expect(html("change")).toMatch(/we have your change/i);
    expect(html("add")).toMatch(/we have your addition/i);
  });
});
