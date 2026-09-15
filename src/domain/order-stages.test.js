import { describe, it, expect } from "vitest";
import { orderStep, orderTimeline, STEPS, OFF_TIMELINE } from "./order-stages.js";

/**
 * These are the feature's business rules, so they are asserted as rules
 * rather than as a table of inputs and outputs. Three of them were agreed
 * with the dashboard team on 15 September and each has a way of being wrong
 * that a customer would act on: collecting food that isn't ready, seeing
 * "unknown" on a real booking, or watching their order go backwards.
 */

const step = (pipelineStage, kitchenStage) =>
  orderStep({ pipelineStage, kitchenStage }).step.id;

describe("the kitchen can never say an order is ready", () => {
  it("does not promote the chef's last tick into Ready", () => {
    // 'confirm' means the checklist is finished, not that food is waiting.
    expect(step("Confirmed", "confirm")).toBe("cooking");
  });

  it("holds at cooking even when every kitchen stage is exhausted", () => {
    for (const k of ["cooking", "confirm"]) {
      expect(step("Confirmed", k)).toBe("cooking");
    }
  });

  it("reaches Ready only when the order pipeline says so", () => {
    expect(step("Ready for Pickup", "confirm")).toBe("ready");
    expect(step("Clear to Delivered", null)).toBe("ready");
  });
});

describe("an order the kitchen has never touched", () => {
  // The commonest case by far: a row appears only when the kitchen first
  // touches an order — 37 rows against 1,592 opportunities.
  it("is never an error, a blank, or an unknown", () => {
    const r = orderStep({ pipelineStage: "Confirmed", kitchenStage: null });
    expect(r.step.id).toBe("confirmed");
    expect(r.offTimeline).toBeNull();
    expect(r.index).toBeGreaterThanOrEqual(0);
  });

  it("reads the same whether the stage is null, undefined or empty", () => {
    for (const k of [null, undefined, "", "   "]) {
      expect(step("Confirmed", k)).toBe("confirmed");
    }
  });

  it("still reports the pipeline's own step, not a fixed one", () => {
    expect(step("Awaiting Confirmation", null)).toBe("received");
    expect(step("Delivered", null)).toBe("completed");
  });

  it("does not advance merely because the order reached the board", () => {
    // 'upcoming-orders' means it arrived, not that anyone started.
    expect(step("Confirmed", "upcoming-orders")).toBe("confirmed");
  });
});

describe("an order is never walked backwards", () => {
  it("keeps the pipeline's answer when the kitchen's ticks lag behind", () => {
    // Ticks are batched by hand, so the board can sit well behind the truth.
    expect(step("Delivered", "cooking")).toBe("completed");
    expect(step("Completed", "white-board")).toBe("completed");
  });

  it("keeps the kitchen's answer when the pipeline has not moved", () => {
    expect(step("Confirmed", "cooking")).toBe("cooking");
  });

  it("takes whichever is further along, whichever system that is", () => {
    expect(step("Ready for Pickup", "white-board")).toBe("ready");
    expect(step("Confirmed", "procured")).toBe("preparing");
  });
});

describe("paying is not a stage of cooking", () => {
  it("treats every payment stage as a confirmed booking", () => {
    for (const p of ["Half Paid", "Fully Paid", "Awaiting Balance"]) {
      expect(step(p, null)).toBe("confirmed");
    }
  });

  it("lets the kitchen carry a paid order further", () => {
    expect(step("Fully Paid", "cooking")).toBe("cooking");
  });
});

describe("states the timeline cannot express", () => {
  it("takes cancelled off the timeline rather than making it a seventh step", () => {
    const r = orderStep({ pipelineStage: "Cancelled", kitchenStage: "cooking" });
    expect(r.offTimeline).toEqual(OFF_TIMELINE.cancelled);
    expect(r.index).toBe(-1);
  });

  it("does the same for rescheduled", () => {
    expect(orderStep({ pipelineStage: "Rescheduled" }).offTimeline).toEqual(OFF_TIMELINE.rescheduled);
  });

  it("marks no step done or current once off the timeline", () => {
    const rows = orderTimeline({ pipelineStage: "Cancelled", kitchenStage: "confirm" });
    expect(rows.some((r) => r.done || r.current)).toBe(false);
  });
});

describe("stages we do not recognise", () => {
  it("claims the least it can rather than nothing at all", () => {
    expect(step("Some Stage Added Next Year", null)).toBe("received");
  });

  it("still lets the kitchen carry the order forward", () => {
    expect(step("Some Stage Added Next Year", "cooking")).toBe("cooking");
  });

  it("ignores a kitchen stage it does not know", () => {
    expect(step("Confirmed", "plating")).toBe("confirmed");
  });

  it("survives being given nothing whatsoever", () => {
    expect(orderStep().step.id).toBe("received");
    expect(orderStep({}).offTimeline).toBeNull();
  });
});

describe("reading the stage as it is actually written", () => {
  it("does not care about case or surrounding space", () => {
    expect(step("  CONFIRMED  ", "  COOKING  ")).toBe("cooking");
    expect(step("ready for pickup", null)).toBe("ready");
  });
});

describe("the timeline a screen draws", () => {
  const rows = orderTimeline({ pipelineStage: "Confirmed", kitchenStage: "procured" });

  it("always returns all six, so a customer sees what is still to come", () => {
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.id)).toEqual(STEPS.map((s) => s.id));
  });

  it("marks exactly one step as current", () => {
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current).id).toBe("preparing");
  });

  it("marks everything before it done and nothing after", () => {
    expect(rows.filter((r) => r.done).map((r) => r.id)).toEqual(["received", "confirmed"]);
    expect(rows.slice(3).some((r) => r.done || r.current)).toBe(false);
  });
});

describe("the wording is the caterer's, and swapping it moves no logic", () => {
  it("keeps ids and labels separate, so a rename cannot change a mapping", () => {
    for (const s of STEPS) {
      expect(s.id).toMatch(/^[a-z]+$/);
      expect(typeof s.label).toBe("string");
    }
  });
});
