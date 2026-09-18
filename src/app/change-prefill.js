import { readChange, markPrepared } from "../domain/change-session.js";
import { packageCartLine } from "../domain/package-line.js";
import { cateringCatalogue } from "../data/catering.js";
import { getOrderLines, setOrderLines, clearOrder } from "./order-shell.js";
import { makeLine } from "../domain/cart.js";

/**
 * Getting the cart into the right state for a customer who arrived to change
 * or add to a booking.
 *
 * ── Change starts full. Add starts empty. ─────────────────────────────────
 *
 * That is the whole rule, and it is the difference between the two flows
 * made physical. Changing an order means editing what you already have, so
 * the cart holds it and the customer takes something out or swaps it. Adding
 * means naming what is new, so the cart holds only the new thing and the
 * booking stays untouched behind it.
 *
 * Get it backwards and a customer adding a tray sends a request that
 * replaces their whole party with one tray.
 *
 * ── Why whatever was in the cart is thrown away ───────────────────────────
 *
 * It belongs to a different, unsent order. Sending it as part of a change
 * would put things the customer never chose into a request about a booking
 * they already have — and the request is filed against that booking, not
 * against a basket.
 *
 * ── Once, not on every load ───────────────────────────────────────────────
 *
 * The clearing used to run on every page load while a change was open. That
 * is right the first time and catastrophic the second: the GoHighLevel
 * navbar moves between PAGES, so a customer who taps the cart button and
 * comes back has reloaded this app, and would have found their work gone.
 * The session remembers that it has been prepared.
 */
export function prepareChangeCart() {
  const session = readChange();
  if (!session) return null;

  // Already done on a previous load of this page. Whatever is in the cart is
  // the customer's own work on this change, and it stays.
  if (session.prepared) return null;

  clearOrder();

  if (session.kind === "change") {
    // Rebuilt from the catalogue by the same function the Combo Trays
    // builder uses, so the prefilled line is editable exactly as a picked
    // one is — see package-line.js on why only the id survives the trip.
    //
    // A package that has been withdrawn, or a booking we could not resolve a
    // package for at all, leaves the cart empty. The customer then builds
    // from scratch, which is worse than starting from their order and much
    // better than starting from a package nobody can sell. The banner
    // already tells them what they are doing.
    const line = packageCartLine(session.packageId, cateringCatalogue());
    if (line) setOrderLines([makeLine(line)]);
  }

  markPrepared();
  return getOrderLines();
}
