import { comboItemWireLine } from "./combo-line.js";

/**
 * One catalogue package, as a line in the order.
 *
 * Two callers need this and they must not build it twice:
 *
 *   the Combo Trays builder, when a customer picks a package
 *   the change flow, when a customer arrives to change the package they
 *   already booked and the cart has to start from it
 *
 * ── Why the line is rebuilt from the catalogue, not from the order ─────────
 *
 * The obvious prefill is to take what the customer already bought — we have
 * it, the order carries the title, the trays and the price. It is the wrong
 * source. That price is what the package cost the day they booked, and the
 * line would arrive in the builder looking editable while carrying a figure
 * nothing on this page computed. A customer would then change one dish and
 * watch a total move relative to a number that is months old.
 *
 * So only the ID survives the round trip. Everything else is read fresh out
 * of the catalogue, which means the prefilled line is the same object the
 * builder would have made if they had picked the package by hand — because
 * it is made by this function either way.
 *
 * A package that has since been withdrawn returns null, and the caller
 * starts the customer from an empty cart rather than from a package nobody
 * can sell. That is the correct failure: "No invalid options" applies to a
 * line the builder puts there as much as to one the customer picks.
 *
 * @param {string} packageId
 * @param {{ packages: Array, itemsFor: Function, dishNameFor: Function }} catalogue
 * @param {number} qty
 * @returns {object|null} a partial cart line, for makeLine/addLine
 */
export function packageCartLine(packageId, catalogue, qty = 1) {
  // A string, not something that coerces to one — the id may have come back
  // from a server response, and a number 42 would find nothing while looking
  // like it might.
  const id = typeof packageId === "string" ? packageId.trim() : "";
  if (!id) return null;

  const pkg = (catalogue?.packages ?? []).find((p) => p?.id === id);
  if (!pkg) return null;

  // selectedName resolves the canonical dish name from the dish table,
  // falling back to the package row's own display name — which is what the
  // package rows carry before anything is priced.
  const items = (catalogue?.itemsFor?.(id) ?? []).map((item) => ({
    ...item,
    selectedName: catalogue?.dishNameFor?.(item.dishId) || item.displayName,
  }));

  return {
    service: "combo-trays",
    serviceLabel: "Combo Trays",
    title: pkg.name,
    subtitle: pkg.paxLabel,
    unitPrice: pkg.price || 0,
    qty,
    // The kitchen's copy, with the per-tray quantity on it. See combo-line.js
    // for why this is not the on-screen label.
    contents: items.map(comboItemWireLine),
    payload: { comboId: pkg.id, paxLabel: pkg.paxLabel },
  };
}
