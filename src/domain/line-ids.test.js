import { describe, it, expect } from "vitest";
import { makeLine, addLine, removeLine } from "./cart.js";

/**
 * Two lines must never share an id.
 *
 * The counter behind nextLineId() lives in the module, so it starts at zero
 * on every page load — while a cart restored from sessionStorage brings its
 * SAVED ids back with it. Add one thing after a reload and the new line is
 * handed "ln-1" again, which the cart already has.
 *
 * Nothing warns. It surfaces later, as the customer reporting that deleting
 * one item deleted two, and that opening one line's dishes opened another's
 * — because removeLine filters by id and the disclosure is keyed by id, and
 * both of them are right to act on every match.
 *
 * It got likelier the day the app started restoring the customer's screen
 * on reload, because resuming mid-order is exactly when somebody adds a
 * second thing.
 */
describe("line ids after a reload", () => {
  it("does not hand a new line an id the cart already holds", () => {
    // What restoreOrder does: rebuild saved lines through makeLine, ids and
    // all. The counter has never been touched in this page load.
    const restored = [
      makeLine({ id: "ln-1", title: "Family Combo 1" }),
      makeLine({ id: "ln-2", title: "Party Tray" }),
    ];
    const withNew = addLine(restored, { title: "Packed Meals" });

    const ids = withNew.map((l) => l.id);
    expect(new Set(ids).size, `duplicate id in ${ids.join(", ")}`).toBe(ids.length);
  });

  it("removes one line, not two", () => {
    const restored = [
      makeLine({ id: "ln-1", title: "Family Combo 1" }),
      makeLine({ id: "ln-2", title: "Party Tray" }),
    ];
    const withNew = addLine(restored, { title: "Packed Meals" });
    const after = removeLine(withNew, withNew[withNew.length - 1].id);

    expect(after).toHaveLength(2);
    expect(after.map((l) => l.title)).toEqual(["Family Combo 1", "Party Tray"]);
  });

  it("keeps counting past ids restored out of order", () => {
    const restored = [makeLine({ id: "ln-9", title: "A" }), makeLine({ id: "ln-3", title: "B" })];
    const withNew = addLine(restored, { title: "C" });
    expect(new Set(withNew.map((l) => l.id)).size).toBe(3);
  });

  it("is not confused by an id that is not ours", () => {
    const lines = addLine([makeLine({ id: "custom-thing", title: "A" })], { title: "B" });
    expect(new Set(lines.map((l) => l.id)).size).toBe(2);
  });

  it("gives a line with a blank id a real one", () => {
    expect(makeLine({ id: "", title: "A" }).id).toBeTruthy();
  });
});
