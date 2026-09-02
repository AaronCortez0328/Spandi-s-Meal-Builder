/**
 * How one tray inside a combo is written down.
 *
 * There are two presentations and they are deliberately not the same string.
 * Keeping them apart is the point of this module; folding them back together
 * would break one of them.
 *
 *   comboItemLabel()     for a person reading the screen
 *   comboItemWireLine()  for another system reading the order
 *
 * ── Why the wire line is not just the label ────────────────────────────────
 *
 * The " — " in the wire line is a WIRE FORMAT, not typography. It exists
 * because the dashboard's chef-checklist parser (api/_lib/dishes.js, sibling
 * repo) splits each content line on the FIRST " — " and takes the dish name
 * from the right. Change that separator and the chef's list stops naming
 * dishes. The on-screen label has no such constraint and reads better
 * without it.
 *
 * So: serialisation and presentation are separate concerns that legitimately
 * differ. What they must NOT differ on is the quantity, which is the whole
 * reason this file exists.
 *
 * ── The bug this was extracted to kill ─────────────────────────────────────
 *
 * The line sent to GoHighLevel used to be built inline:
 *
 *     contents: items.map((item) => `${item.traySize} — ${item.selectedName}`)
 *
 * with no quantity, while the on-screen formatter thirty lines below had it
 * right. So a combo holding 2 XXXL Blue Ternate Rice reached the kitchen as
 * one tray and the chef made half the rice. 104 of the 280 rows in
 * package_items carry a quantity above one, so this was not a rare combo --
 * it was more than a third of them.
 *
 * Two copies of one rule is what allowed them to drift. There is now one
 * copy of the quantity rule and the separator is the caller's choice.
 *
 * ── The format, exactly ────────────────────────────────────────────────────
 *
 *     {qty}{traySize} — {dishName}
 *
 *   {qty}        "N× " -- digits, U+00D7, space. Present ONLY when N > 1,
 *                and at the very start of the line, nothing before it.
 *   separator    exactly " — " : space, U+2014 em dash, space
 *   {dishName}   always on the right
 *
 *     XXXL — Babyback Ribs
 *     2× XXXL — Blue Ternate Rice
 *
 * Safe against the separator appearing inside a field: none of the 71 dish
 * names contain " — ", and the tray sizes are Family, Feast and XXXL.
 *
 * Not this module's business, and already correct: the "• " header and the
 * four-space indent on content lines, both from dishesSelectedText() in
 * ./cart.js. Its l.qty is how many COMBOS were ordered -- a different
 * number from the per-tray quantity here.
 */

/** The separator the dashboard parses on. Not a styling choice. */
export const WIRE_SEPARATOR = " — ";

/**
 * "N× " when there is more than one of a tray, otherwise nothing.
 *
 * Gated on the number, never on whether anything is editable -- keying a
 * quantity off editability is how a different quantity went missing from
 * the kitchen's copy once already (see dishesSelectedText).
 */
function quantityPrefix(item) {
  const n = Number(item?.quantity);
  return Number.isFinite(n) && n > 1 ? `${n}× ` : "";
}

/**
 * The dish, by the name it was actually ordered under.
 *
 * selectedName first: a combo resolves it from the dish catalogue and a swap
 * rewrites it, so displayName can be the name of a dish the customer
 * replaced. Falling back to displayName covers the raw package rows, which
 * have no selectedName until they are priced.
 */
function dishName(item) {
  return item?.selectedName ?? item?.displayName ?? "";
}

function line(item, separator) {
  return `${quantityPrefix(item)}${item?.traySize ?? ""}${separator}${dishName(item)}`.trim();
}

/**
 * For the screen. Plain spacing, no wire separator.
 *
 *   "XXXL Babyback Ribs"  ·  "2× XXXL Blue Ternate Rice"
 */
export function comboItemLabel(item) {
  return line(item, " ");
}

/**
 * For GoHighLevel, and from there the dashboard's chef checklist.
 *
 *   "XXXL — Babyback Ribs"  ·  "2× XXXL — Blue Ternate Rice"
 *
 * Do not "tidy" this into comboItemLabel. The separator is parsed.
 */
export function comboItemWireLine(item) {
  return line(item, WIRE_SEPARATOR);
}
