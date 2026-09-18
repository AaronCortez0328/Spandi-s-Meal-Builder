import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every builder has a way out of it.
 *
 * Grazing Table and Grazing Board had none. No order bar, no breadcrumb, no
 * back button — a customer who opened one and changed their mind could only
 * reach for the browser's back button, and on the GoHighLevel page that
 * leaves the site entirely. It shipped that way and nobody noticed until the
 * client tried it, because every OTHER builder happened to have one for a
 * different reason: three draw the order bar, one has breadcrumbs, one wrote
 * its own.
 *
 * Five accidents rather than a rule. This is the rule.
 *
 * Read off the source rather than rendered, because these builders need a
 * DOM, live catalogue data and a mounted container to draw anything — and a
 * test that needed all three to assert "there is a way back" is a test
 * nobody would keep working.
 */
const BUILDERS = [
  "grazing-builder.js",
  "catering-builder.js",
  "catering-package-builder.js",
  "party-tray-builder.js",
  "packed-meals-builder.js",
  "custom-service.js",
];

/** Anything that gets a customer out of the builder they are standing in. */
const WAYS_BACK = [
  "data-service-back",   // straight to the chooser
  "renderCartInto",      // the order bar, whose left button is one
  "data-cat-substep",    // back a sub-step, combo trays
  "data-cp-substep",     // back a sub-step, the catering packages
];

const read = (file) =>
  fs.readFileSync(path.join("src", "app", file), "utf8");

describe("no builder is a dead end", () => {
  for (const file of BUILDERS) {
    it(`${file} offers a way back`, () => {
      const src = read(file);
      const found = WAYS_BACK.filter((w) => src.includes(w));
      expect(found, `${file} has no way back at all`).not.toHaveLength(0);
    });
  }

  /**
   * The bar is not enough on its own for the two that do not draw one.
   * Grazing and the catering packages have to carry their own, and this is
   * the assertion that would have caught the original bug.
   */
  for (const file of ["grazing-builder.js", "catering-package-builder.js"]) {
    it(`${file} carries its own, because it draws no order bar`, () => {
      const src = read(file);
      expect(src).not.toContain("renderCartInto");
      expect(src).toMatch(/data-service-back|data-cp-substep/);
    });
  }

  it("puts it beside Continue, where a customer who has scrolled already is", () => {
    // Not at the top: these are long pages of cards and dish lists, and a
    // control up there is several screens above somebody at the end of one.
    for (const file of ["grazing-builder.js", "catering-package-builder.js"]) {
      const src = read(file);
      const nav = src.slice(src.indexOf('class="step-nav'));
      expect(nav, file).toMatch(/data-service-back|data-cp-substep/);
    }
  });
});
