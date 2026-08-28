import { describe, it, expect } from "vitest";
import {
  stepperHtml, STEPS, STEP_SELECT, STEP_BUILD, STEP_REVIEW, STEP_DETAILS,
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
