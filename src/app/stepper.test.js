import { describe, it, expect } from "vitest";
import {
  stepperHtml, substepsHtml, STEPS, STEP_SELECT, STEP_BUILD, STEP_REVIEW, STEP_DETAILS,
} from "./stepper.js";

const stepsIn = (html) => html.match(/class="stepper__step/g)?.length ?? 0;

describe("the order's step spine", () => {
  it("draws the same four steps on every screen", () => {
    for (const step of [STEP_SELECT, STEP_BUILD, STEP_REVIEW, STEP_DETAILS]) {
      expect(stepsIn(stepperHtml(step))).toBe(4);
    }
  });

  // The bug this replaces: a builder said "Step 2 of 4" and then handed over
  // to a review that said "Step 3 of 3". One list, so the total cannot drift.
  it("names the steps in one order", () => {
    expect(STEPS).toEqual(["Select", "Build", "Review", "Details"]);
  });

  it("marks exactly one step as the one you are on", () => {
    for (const step of [STEP_SELECT, STEP_BUILD, STEP_REVIEW, STEP_DETAILS]) {
      expect(stepperHtml(step).match(/is-active/g)).toHaveLength(1);
    }
  });

  it("ticks off every step behind you and none ahead", () => {
    const html = stepperHtml(STEP_REVIEW);
    expect(html.match(/stepper__step is-completed/g)).toHaveLength(2);
    expect(html).toContain(">Review<");
  });

  // Tapping forward skips the validation Continue runs -- that is how someone
  // reached the dish step with no pax set. A step ahead of the customer is a
  // span, so there is nothing to tap.
  it("gives a button only to steps you can go back to", () => {
    const html = stepperHtml(STEP_BUILD);
    expect(html.match(/<button class="stepper__bubble"/g)).toHaveLength(1);
    expect(html).toContain("data-service-back");
  });

  it("offers no way back from the first step", () => {
    expect(stepperHtml(STEP_SELECT)).not.toContain("<button");
  });

  it("routes the review bubble back to the review, not the chooser", () => {
    expect(stepperHtml(STEP_DETAILS)).toContain("data-go-review");
  });
});

describe("the steps inside Build", () => {
  const NAMES = ["Guests", "Combo", "Dishes"];

  it("shows every sub-step, wherever you are", () => {
    for (let i = 0; i < NAMES.length; i++) {
      const html = substepsHtml(NAMES, i, "data-x");
      for (const name of NAMES) expect(html).toContain(name);
    }
  });

  it("marks one as current", () => {
    expect(substepsHtml(NAMES, 1, "data-x").match(/is-current/g)).toHaveLength(1);
  });

  // The whole point: on the first sub-view nothing is behind you, by the
  // last one everything is. A frozen indicator was the bug being fixed.
  it("grows the trail behind you as you move", () => {
    // "All services" is always behind you, so it is always done — the trail
    // is counted on top of it.
    const done = (i) => (substepsHtml(NAMES, i, "data-x").match(/is-done/g) ?? []).length - 1;
    expect(done(0)).toBe(0);
    expect(done(1)).toBe(1);
    expect(done(2)).toBe(2);
  });

  it("gives a button to finished sub-steps and nothing to the ones ahead", () => {
    const html = substepsHtml(NAMES, 1, "data-x");
    // One sub-step behind, plus the way out of the service entirely.
    expect(html.match(/data-x="\d"/g)).toHaveLength(1);
    expect(html).toContain('data-x="0"');
    expect(html).not.toContain('data-x="2"');
  });

  /**
   * Leaving the service is the rare move and the breadcrumb is where people
   * look to ask "where am I", which is the same question as "how do I get
   * out". It moved here when the order bar took over going back ONE step —
   * that one is the loop of browsing and belongs where the customer already
   * is, at the foot of the list they have just read.
   */
  it("always offers the way out of the service, from every sub-step", () => {
    for (let i = 0; i < NAMES.length; i += 1) {
      const html = substepsHtml(NAMES, i, "data-x");
      expect(html, `sub-step ${i}`).toContain("data-service-back");
      expect(html, `sub-step ${i}`).toContain("All services");
    }
  });

  it("puts the way out first, so the trail reads as a path", () => {
    const html = substepsHtml(NAMES, 2, "data-x");
    expect(html.indexOf("All services")).toBeLessThan(html.indexOf(NAMES[0]));
  });
});

/**
 * The one way back out of a sub-step.
 *
 * It was an 11px underlined word whose hit area was the height of its own
 * text. The chevron was the first attempt at making it findable; a customer
 * then said they could not tell it was a button at all.
 */
describe("the way back to a finished sub-step", () => {
  const html = () => substepsHtml(["Guests", "Combo"], 1, "data-cat-substep");

  it("is a button, not a word", () => {
    expect(html()).toContain("<button");
    expect(html()).toContain("data-cat-substep=\"0\"");
  });

  it("keeps the direction of travel on it", () => {
    expect(html()).toContain("&larr;");
  });

  it("does not offer the step you are standing on as a way back", () => {
    // Guests only. "All services" is a button too and is not a sub-step.
    expect((html().match(/data-cat-substep="\d"/g) ?? []).length).toBe(1);
  });

  it("offers no SUB-STEP to go back to from the first one", () => {
    const first = substepsHtml(["Guests", "Combo"], 0, "data-cat-substep");
    expect(first).not.toContain("data-cat-substep=");
    // But never a dead end: leaving the service is still one tap.
    expect(first).toContain("data-service-back");
  });

  it("marks the current step for a screen reader", () => {
    expect(html()).toContain('aria-current="step"');
  });
});
