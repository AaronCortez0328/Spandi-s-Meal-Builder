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
 * Tiers are "this price at this quantity or more", so the first matching
 * tier when sorted highest-first is the one that applies. Falls back to the
 * smallest tier rather than zero: a quantity below every minimum is a UI
 * problem, and charging nothing for it would be worse than charging the
 * lowest-volume rate.
 *
 * @param {Array<{ price: number, minQty: number }>} tiers  sorted minQty descending
 */
export function packedMealUnitPrice(tiers = [], qty) {
  const q = num(qty);
  for (const tier of tiers) {
    if (q >= num(tier.minQty)) return num(tier.price);
  }
  return num(tiers[tiers.length - 1]?.price);
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
 * Combo party trays are sold at a fixed price for the whole package — the
 * dishes inside are chosen from fixed slots and do not move the figure.
 * Looked up by id so a renamed combo cannot silently reprice.
 *
 * @param {Record<string, number>} priceByPackageId
 */
export function comboTotal(priceByPackageId = {}, packageId) {
  return num(priceByPackageId[packageId]);
}
