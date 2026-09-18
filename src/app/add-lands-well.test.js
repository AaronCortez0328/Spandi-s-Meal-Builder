import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Adding to the order must not throw the customer up the page.
 *
 * ── What went wrong ───────────────────────────────────────────────────────
 *
 * Nothing scrolled. Combo Trays is the only builder that changes view when
 * something is added: the tall customize screen is replaced by the shorter
 * combo grid, the frame shrinks to fit, the page around it gets shorter, and
 * the browser is left holding a scroll position past the end of the
 * document. It clamps, and the customer — who had just reached down to tap
 * "Add to order" — is somewhere near the top wondering what happened.
 *
 * The content under them disappeared and they fell. Holding the old position
 * is no answer, because there is nothing at the old position any more. The
 * answer is to land somewhere that earns the move: the order itself, which
 * is what just changed.
 *
 * ── Why this reads the source ─────────────────────────────────────────────
 *
 * Same reason as way-back.test.js: this builder needs a DOM, live catalogue
 * data and a mounted container before it will draw anything, and a test that
 * needed all three to assert "it lands on the order" is a test nobody would
 * keep working. What matters is that the call is there and that it is the
 * cart it names — both of which the source can answer.
 */
const FILE = "catering-builder.js";

const source = fs.readFileSync(
  path.join(process.cwd(), "src", "app", FILE),
  "utf8",
);

/** addToCart, from its opening line to the closing brace of the function. */
function addToCartBody() {
  const start = source.indexOf("function addToCart()");
  expect(start, "addToCart has been renamed — this test needs updating")
    .toBeGreaterThan(-1);

  // The next top-level function declaration ends it. Every function in this
  // file is declared at the same indentation, so this is stable.
  const after = source.indexOf("\n  function ", start + 1);
  return source.slice(start, after === -1 ? source.length : after);
}

describe("adding a combo to the order", () => {
  it("lands the customer on their order", () => {
    const body = addToCartBody();
    expect(body).toMatch(/jumpTo\(/);
    expect(body).toContain("cat-cart-section");
  });

  /**
   * "nearest", not "start". A customer who can already see their order must
   * not be moved at all — a jump that fires when nothing needed to move is
   * the same complaint from the other direction.
   */
  it("only moves the page when the order is off screen", () => {
    // [\s\S]*? rather than [^)]* — the argument is itself a call, so the
    // first ")" belongs to getElementById, not to jumpTo.
    expect(addToCartBody()).toMatch(/jumpTo\([\s\S]*?["']nearest["']\s*\)/);
  });

  /**
   * The scroll has to come after the view change and the cart render, or it
   * measures an element that is about to move.
   */
  it("moves after the new view and the new cart are in place", () => {
    const body = addToCartBody();
    const view = body.indexOf("goView(");
    const cart = body.indexOf("renderCart()");
    const jump = body.indexOf("jumpTo(");

    expect(view).toBeGreaterThan(-1);
    expect(cart).toBeGreaterThan(-1);
    expect(jump).toBeGreaterThan(cart);
    expect(jump).toBeGreaterThan(view);
  });

  /**
   * jumpTo is what tells the parent page to scroll — see ui-fx.js. Reaching
   * for scrollIntoView directly here would be inert in production, which is
   * the whole bug this pair of changes exists to fix.
   */
  it("goes through jumpTo, not straight to scrollIntoView", () => {
    expect(addToCartBody()).not.toContain("scrollIntoView");
  });
});
