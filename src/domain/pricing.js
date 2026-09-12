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
export function grazingTotal(tiers = [], paxRange, serviceKey) {
  return grazingBreakdown(tiers, paxRange, serviceKey).total;
}

/**
 * Grazing is two products with two different bills.
 *
 * The Board is delivery or pickup: a flat price for a band and nothing on
 * top. The Table arrives with rustic tables, a barrel, two serving staff and
 * three hours of service, and its poster carries "service charge 10%" and
 * "Transpo fee depending on location" — neither of which this file charged
 * for. Same shape as the catering gap: printed under "Add-ons", rendered as
 * grey text, never added to anything.
 */
export const GRAZING = {
  /**
   * Whole-number percentage, applied with a round, for the reason given on
   * CATERING.serviceChargePct: these totals are compared between the browser
   * and the server exactly, and every figure here is a whole peso.
   */
  serviceChargePct: 10,

  /**
   * Which grazing products carry the service charge.
   *
   * Keyed by service rather than assumed, because the Board genuinely does
   * not have one — it is dropped off, with no staff and no setup. Charging
   * it 10% would be inventing a fee the customer was never quoted.
   */
  charged: ["grazing-table"],
};

/**
 * The spread, the service charge, and what they come to.
 *
 * Transport is deliberately absent. Catering folded its transport into a
 * flat per-head logistics fee, so it could be priced; the grazing poster
 * says "depending on location" and no rule for that exists. It is quoted per
 * booking, the way stair hauling is — the order carries the address, and the
 * screen says the figure is before transport rather than pretending it is
 * the final bill.
 *
 * @param {Array<{ paxRange: string, price: number }>} tiers
 * @param {string} [serviceKey] - "grazing-table" | "grazing-board"
 */
export function grazingBreakdown(tiers = [], paxRange, serviceKey) {
  const tier = (Array.isArray(tiers) ? tiers : []).find((t) => t?.paxRange === paxRange);
  const spread = num(tier?.price);

  // A band that no longer exists cannot be priced, and a service charge on
  // nothing is still nothing. Matches grazingTotal's old contract exactly.
  if (spread <= 0) return { spread: 0, serviceCharge: 0, total: 0 };

  const serviceCharge = GRAZING.charged.includes(serviceKey)
    ? Math.round((spread * GRAZING.serviceChargePct) / 100)
    : 0;

  return { spread, serviceCharge, total: spread + serviceCharge };
}

/** Whether this grazing product is quoted for transport separately. */
export function grazingNeedsTransport(serviceKey) {
  return GRAZING.charged.includes(serviceKey);
}

/**
 * Full-service catering: the whole invoice, not just the food.
 *
 * The food line alone was what this returned, and what reached GoHighLevel
 * as the order's value — so every catering booking was recorded roughly 35%
 * short. At 50 pax on the Basic package that is ₱47,500 against a real
 * ₱64,250, and `monetaryValue` is what the dashboard's Sales, Reports,
 * Branch Performance and Owner Financials all sum.
 *
 * The service charge and the logistics fee are printed under "Add ons" on
 * the package poster, which is what made them look optional. They are not:
 * the caterer confirmed the logistics fee is always charged, and that the
 * waiters' wages are paid out of it — which is also why the customer is
 * never asked how many staff to send. Only lechon chopping is a real choice.
 */
export const CATERING = {
  /**
   * Held as a whole-number percentage, and applied with a round, because
   * this module's totals are compared between the browser and the server
   * exactly. `50949 * 0.10` is `5094.900000000001` in IEEE-754, and while
   * both sides running the same code would agree on that, it would be
   * written to the CRM as revenue with float dust on the end. Every figure
   * this file produces is a whole peso.
   */
  serviceChargePct: 10,

  /**
   * Logistics — transport, sanitation, ingress/egress, set up and pull out,
   * the team's own food, ordinary hauling, and the waiters' wages.
   *
   * ₱120 a head with a ₱12,000 floor. Fits every figure the caterer gave:
   * 50 and 100 pax both at 12,000 (the floor), 150 at 18,000, 200 at 24,000.
   * A per-head rate rather than fixed bands because the poster itself prices
   * it as "12,000 / 100pax", and because bands have no answer above 200 pax
   * while this does.
   */
  logisticsPerHead: 120,
  logisticsMin: 12000,

  /** Carving service only. The customer supplies the lechon. */
  lechonChopping: 2500,
};

/** The logistics fee for a head count. See CATERING above. */
export function cateringLogistics(pax) {
  const heads = num(pax);
  if (heads <= 0) return 0;
  return Math.max(CATERING.logisticsMin, heads * CATERING.logisticsPerHead);
}

/**
 * Every line of a catering order, and the total they sum to.
 *
 * Returns the parts as well as the total because the screen shows a
 * breakdown. A UI that added up its own rows while this computed the total
 * separately could drift, and the customer would be looking at a receipt
 * whose lines do not sum to its own bottom figure. One function, both
 * answers, nothing to disagree.
 *
 * Stair hauling is deliberately absent. It is charged per floor *per staff*,
 * and the caterer assigns the staff herself after the booking — so the
 * customer cannot compute it and neither can we. The order records that
 * stairs are involved; the fee is added by hand later.
 *
 * @param {object} [addons] - { lechonChopping?: boolean }
 */
export function cateringBreakdown(pricePerHead, pax, addons = {}) {
  const food = num(pricePerHead) * num(pax);

  // No food, no order. An unknown rate or a missing pax count means we could
  // not price this, and billing 12,000 of logistics for a package we failed
  // to identify would turn a pricing gap into a wrong invoice.
  if (food <= 0) return { food: 0, serviceCharge: 0, logistics: 0, addons: 0, total: 0 };

  const serviceCharge = Math.round((food * CATERING.serviceChargePct) / 100);
  const logistics = cateringLogistics(pax);
  const extras = addons?.lechonChopping ? CATERING.lechonChopping : 0;

  return {
    food,
    serviceCharge,
    logistics,
    addons: extras,
    total: food + serviceCharge + logistics + extras,
  };
}

/** What a catering order costs. See cateringBreakdown() for the parts. */
export function cateringPackageTotal(pricePerHead, pax, addons) {
  return cateringBreakdown(pricePerHead, pax, addons).total;
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
      // The card's own ceiling, so the browser and the server bound the same
      // number. Passing only the quantity would have each side clamp by its
      // own rule, and a tampered or stale value would then be priced twice,
      // differently -- which is the one failure ghl-inquiry.js turns into
      // real money rather than a 409.
      return price * customServiceQty(quantity, row?.max_quantity);
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
export function customServiceQty(quantity, max) {
  const n = Math.round(num(quantity));
  if (n < 1) return 1;
  return Math.min(n, customServiceCeiling(max));
}

/**
 * The ceiling that applies to a card: its own, or the backstop.
 *
 * meal_builder_services.max_quantity is the admin's number — the largest
 * order that kitchen could actually deliver — and null means they set none.
 * Null is checked before coercing because Number(null) is 0, which would
 * bound every order to a single unit.
 *
 * Exported so the input's max attribute and the price can be built from one
 * value. Two numbers that must agree should be one number; the packed-meals
 * clamp was exactly that mistake, and it sold a 120-pack order as 99.
 */
export function customServiceCeiling(max) {
  if (max === null || max === undefined || max === "") return CUSTOM_QTY_MAX;
  const n = Math.floor(Number(max));
  if (!Number.isFinite(n) || n < 1) return CUSTOM_QTY_MAX;
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
