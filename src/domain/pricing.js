/**
 * What an order costs. Pure functions, no I/O, no imports.
 *
 * These exist so the browser and the server can arrive at the same number
 * by running the same code. Until now the total was computed in the
 * customer's browser and written to GoHighLevel unchecked — and since
 * `monetaryValue` is the only money figure in the system, every revenue
 * figure in both applications was a number the customer supplied.
 *
 * Each function takes the price data as an argument rather than reaching
 * for it. The browser loads that data with the anon key, the server with
 * the service-role key, and neither has to know how the other does it.
 * That is also what makes these testable against real prices without a
 * database.
 *
 * Every price in this system is an integer number of pesos, and nothing
 * here multiplies by a percentage or rounds. So totals are exact, and a
 * mismatch between the two sides means a bug or tampering rather than
 * drift — which is why the server compares exactly.
 */

/** Guards against a missing price silently becoming NaN and poisoning a sum. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Flat rush-order fee, in pesos. Matches the ₱2,000 precedent found in the
 * migrated booking data for one historical customer — this makes that a
 * standing option instead of a one-off manual add.
 *
 * One flat number across all five services rather than a per-service rate:
 * there is no volume or per-head basis for "rushed" the way there is for
 * the menu itself, so a single figure is the only one that doesn't need a
 * table of its own.
 */
export const RUSH_FEE = 2000;

/**
 * Adds the flat rush fee on top of an already-computed order total, when
 * requested. Kept separate from each service's total function so every
 * service adds it the same way, in exactly one place, instead of five.
 */
export function applyRushFee(total, rush) {
  return num(total) + (rush ? RUSH_FEE : 0);
}

/**
 * One party tray line.
 *
 * Priced per **dish**, not per category. `dish_prices` is keyed by dish id
 * and the dashboard lets an admin set one dish's price independently, but
 * the browser used to collapse that to a single price per category by
 * overwriting it once per dish — so whichever row Supabase returned last
 * won, and every other dish in that category was quietly priced as that
 * one. It worked only because all 71 dishes happen to share their
 * category's price today.
 *
 * @param {Record<string, Record<string, number>>} priceTable  dishId → { family, feast, xxxl }
 * @param {{ dishId: string, traySize: string, qty: number }} line
 */
export function partyTrayLineTotal(priceTable, line) {
  const unit = num(priceTable?.[line?.dishId]?.[line?.traySize]);
  return unit * num(line?.qty);
}

export function partyTrayTotal(priceTable, lines = []) {
  return lines.reduce((sum, line) => sum + partyTrayLineTotal(priceTable, line), 0);
}

/**
 * The per-piece price for a quantity, from a pack type's tiers.
 *
 * Tiers are "this price at this quantity or more", so the one that applies is
 * the highest minQty the quantity reaches.
 *
 * ── Order-independent, deliberately ────────────────────────────────────────
 *
 * This used to take the first match in a list it required to be sorted
 * descending. That precondition was real, unstated in the signature, and
 * satisfied by two separate sorts in two files — src/data/packed-meals.js and
 * api/_price-tables.js — with only one of them explaining why. Four pieces of
 * code had to agree about one rule, and the rule lived in none of them.
 *
 * Asking for the highest qualifying minimum rather than the first one in a
 * list removes the precondition instead of documenting it. Any caller can now
 * pass tiers in any order, and the sorts that remain are for display only.
 * The test that keeps this true shuffles the list and expects the same answer
 * — a comment saying order does not matter is worth nothing next to a test
 * that fails when it starts mattering again.
 *
 * @param {Array<{ price: number, minQty: number }>} tiers  any order
 */
export function packedMealUnitPrice(tiers = [], qty) {
  const list = Array.isArray(tiers) ? tiers : [];
  if (list.length === 0) return 0;

  const q = num(qty);
  let reached = null;   // the highest minQty this quantity qualifies for
  let smallest = null;  // the lowest minQty of all, for the case below

  for (const tier of list) {
    const min = num(tier?.minQty);
    if (smallest === null || min < num(smallest.minQty)) smallest = tier;
    if (q >= min && (reached === null || min > num(reached.minQty))) reached = tier;
  }

  // Below every minimum, the lowest-volume tier — which is the dearest.
  // Stated here rather than falling out of a sort, because it is a decision:
  // an order under the minimum should not get the bulk rate, and charging
  // nothing at all would be worse than charging too much. The form should
  // not have allowed it either way.
  return num((reached ?? smallest)?.price);
}

/**
 * @param {Record<string, Array<{ price: number, minQty: number }>>} tiersByType
 * @param {Array<{ packTypeId: string, qty: number }>} lines
 */
export function packedMealsTotal(tiersByType = {}, lines = []) {
  return lines.reduce((sum, line) => {
    const tiers = tiersByType[line?.packTypeId] ?? [];
    return sum + packedMealUnitPrice(tiers, line?.qty) * num(line?.qty);
  }, 0);
}

/**
 * Grazing is a flat price for a pax band — nothing is multiplied.
 *
 * Matched on the band label rather than an index, because a tier added or
 * reordered in the dashboard would silently shift every index and reprice
 * existing selections.
 *
 * @param {Array<{ paxRange: string, price: number }>} tiers
 */
export function grazingTotal(tiers = [], paxRange) {
  const tier = tiers.find((t) => t?.paxRange === paxRange);
  return num(tier?.price);
}

/** Full-service catering: a rate per head, times heads. */
export function cateringPackageTotal(pricePerHead, pax) {
  return num(pricePerHead) * num(pax);
}

/**
 * The largest quantity a custom service will price.
 *
 * Exported so both sides clamp through the same constant. A number the
 * customer typed reaches this multiplication, and without a ceiling
 * "999999999 kg" produces an order value that would then be written to
 * GoHighLevel as real revenue — the browser and the server would agree on
 * it, so nothing would ask a question.
 *
 * Deliberately not the cart's QTY_MAX of 99. That figure bounds "how many
 * trays", which is the right question for a tray and the wrong one for
 * kilos: 150 kg clamped to 99 is a number both sides would still agree on,
 * and a silently short order is exactly the failure this whole change
 * exists to close. The dashboard team have been asked for a per-card
 * max_quantity; until that exists this is the backstop, and it is set far
 * above any real order rather than at a plausible-looking limit.
 */
export const CUSTOM_QTY_MAX = 100000;

/**
 * An admin-created service, priced from its own row.
 *
 * The single place this multiplication happens. The browser calls it to
 * build the cart line and the server calls it to verify — the same function
 * on the same row, because ghl-inquiry.js compares the two exactly and then
 * writes the server's figure to the opportunity as the order's value. Two
 * implementations agreeing is luck; one implementation is the guarantee.
 *
 * Modes, as the dashboard writes them:
 *
 *   enquiry   0 — no price yet, the team quotes it. Zero rather than null
 *             on purpose: null poisons a whole mixed basket in
 *             baseServerTotal and would take the price check off the party
 *             trays sitting beside it.
 *   fixed     A flat total. The quantity is still asked for and still
 *             recorded, but it does not multiply — "3 tasting kits,
 *             PHP 1,500 for the lot" is a thing an admin may legitimately
 *             mean.
 *   per_unit  unit_price x quantity.
 *
 * An unrecognised mode prices as 0, matching `enquiry`. The database
 * constrains the column to the three, so reaching this means the schema
 * moved ahead of this file — and quoting by hand is a better failure than
 * inventing a number.
 *
 * @param {{pricing_mode?: string, unit_price?: number|string}} row
 * @param {number|string} quantity  what the customer typed
 */
export function customServiceTotal(row, quantity) {
  const price = num(row?.unit_price);

  switch (row?.pricing_mode) {
    case "fixed":
      return price;
    case "per_unit":
      return price * customServiceQty(quantity);
    default:
      return 0;
  }
}

/**
 * The quantity as it will actually be priced.
 *
 * Exported because the cart line has to be built from the same number the
 * total was computed from — a line reading "150 kg" beside a total for 100
 * of them is worse than either being wrong on its own.
 *
 * Whole numbers only, and never below one: `Number("")` is 0 and
 * `Number(null)` is 0, so an empty field would otherwise price a per-unit
 * service at nothing at all.
 */
export function customServiceQty(quantity) {
  const n = Math.round(num(quantity));
  if (n < 1) return 1;
  return Math.min(n, CUSTOM_QTY_MAX);
}

/**
 * Combo party trays are sold at a fixed price for the whole package — the
 * dishes inside are chosen from fixed slots and do not move the figure.
 * Looked up by id so a renamed combo cannot silently reprice.
 *
 * @param {Record<string, number>} priceByPackageId
 */
export function comboTotal(priceByPackageId = {}, packageId) {
  return num(priceByPackageId[packageId]);
}

/**
 * A peso figure as a customer reads it.
 *
 * Lives here rather than in the DOM layer because both the cart and the
 * order shell format the same numbers, and two copies of a currency rule
 * is how "PHP 1,250" and "PHP1250" end up on the same screen.
 *
 * Zero renders as an em dash, not "PHP 0". A line with no price yet is
 * waiting on a choice, and a peso sign in front of nothing reads as a
 * quoted price of nothing.
 */
export function formatPeso(amount) {
  if (!amount) return "-";
  return `PHP ${Number(amount).toLocaleString("en-PH")}`;
}
