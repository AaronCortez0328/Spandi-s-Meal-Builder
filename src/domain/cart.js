/**
 * The order's lines, independent of any one service.
 *
 * Until now each builder kept its own basket and its own idea of what a
 * basket was: Party Trays and Packed Meals held a `cart` array with
 * quantities, Combo Trays held a single id, Grazing and the catering
 * packages held a tier and nothing else. That was workable while an order
 * was one service. It stops being workable the moment a customer wants
 * combo trays *and* packed meals on the same delivery.
 *
 * ── What counts as a line ──────────────────────────────────────────────
 * The five services produce two different things, and conflating them is
 * the mistake worth avoiding up front:
 *
 *   a priced line   Party Trays, Packed Meals — each pick is its own line,
 *                   with its own quantity and its own price
 *
 *   contents        a combo's six tray slots, a grazing table's fixed menu,
 *                   a catering package's chosen dishes — these are not
 *                   lines, they are what a single priced line contains
 *
 * So a combo is ONE line of PHP 10,000 that happens to hold six trays, not
 * six lines. `contents` carries them for display; it never affects price.
 *
 * ── Why nothing merges ────────────────────────────────────────────────
 * Two Party Tray lines for different dishes are different things, and two
 * for the *same* dish are usually a customer who meant it — an order of
 * "2× Baby Back Ribs" added twice is 4, not 2. Merging would also hide what
 * someone picked behind an arithmetic they did not ask for. Lines append,
 * always; the quantity control is how you say "more of this one".
 */

const QTY_MIN = 1;
const QTY_MAX = 99;

/**
 * @typedef {object} CartVariantOption
 * @property {string} id
 * @property {string} label
 * @property {number} price   unit price when this option is chosen
 */

/**
 * @typedef {object} CartVariant
 * @property {string} label               what the control is choosing, e.g. "Tray size"
 * @property {string} selected            id of the chosen option
 * @property {CartVariantOption[]} options
 */

/**
 * @typedef {object} CartLine
 * @property {string} id            unique within the cart
 * @property {string} service       "party-trays", "combo-trays", …
 * @property {string} serviceLabel  what to show the customer, e.g. "Combo Trays"
 * @property {string} title         the thing itself — a dish, a combo, a tier
 * @property {string} subtitle      the qualifier — "Beef · Feast (2kg)", "15 pax"
 * @property {number} unitPrice
 * @property {number} qty
 * @property {boolean} qtyEditable  false where a quantity is meaningless
 * @property {string[]} contents    what is inside, for display only
 * @property {CartVariant|null} variant
 * @property {object} payload       whatever the builder needs back, untouched here
 */

const clampQty = (n) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return QTY_MIN;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, v));
};

let seq = 0;
/** Ids only have to be unique within one cart, and never leave the browser. */
export function nextLineId() {
  seq += 1;
  return `ln-${seq}`;
}

/**
 * Fills in the parts every line needs so a builder can hand over the few
 * that are actually its business.
 *
 * @param {Partial<CartLine>} line
 * @returns {CartLine}
 */
export function makeLine(line) {
  // qtyEditable says whether the CUSTOMER may change the quantity from
  // inside the cart. It does not say the quantity is one. Packed Meals is
  // the case that separates them: a line is "50 packs", priced per piece on
  // a volume tier, and the quantity is chosen before adding precisely
  // because changing it afterwards would have to re-price the tier. Folding
  // the two ideas together turned 50 packs into 1.
  const qtyEditable = line.qtyEditable !== false;
  return {
    id: line.id ?? nextLineId(),
    service: line.service ?? "",
    serviceLabel: line.serviceLabel ?? "",
    title: line.title ?? "",
    subtitle: line.subtitle ?? "",
    unitPrice: Number(line.unitPrice) || 0,
    qty: clampQty(line.qty ?? 1),
    qtyEditable,
    contents: Array.isArray(line.contents) ? line.contents.filter(Boolean) : [],
    variant: line.variant ?? null,
    payload: line.payload ?? {},
  };
}

/** Appends. See the note above on why nothing merges. */
export function addLine(lines, line) {
  return [...lines, makeLine(line)];
}

export function removeLine(lines, id) {
  return lines.filter((l) => l.id !== id);
}

/**
 * Swaps one line for a rebuilt version of itself, in place.
 *
 * Editing a packed-meals line means changing its quantity, and its price
 * per piece sits on a volume tier chosen at the moment it was added -- 50
 * pieces and 60 pieces are not the same rate. The cart cannot recompute
 * that on its own, so the line goes back to the builder that knows the
 * tiers and comes back rebuilt.
 *
 * In place, rather than remove-then-append: a customer who edits the first
 * of four items should not find it at the bottom of the list afterwards.
 * The id is kept too, so anything holding a reference to it -- an open
 * disclosure, say -- still points at the same line.
 */
export function replaceLine(lines, id, line) {
  return lines.map((l) => (l.id === id ? makeLine({ ...line, id }) : l));
}

/**
 * A quantity of zero is a removal — the "−" button at 1 should take the line
 * out rather than sit there doing nothing, which is what the old per-builder
 * carts did and what people kept pressing twice.
 */
export function setQty(lines, id, qty) {
  const n = Math.round(Number(qty));
  if (Number.isFinite(n) && n <= 0) return removeLine(lines, id);
  return lines.map((l) => {
    if (l.id !== id || !l.qtyEditable) return l;
    return { ...l, qty: clampQty(qty) };
  });
}

export function stepQty(lines, id, delta) {
  const line = lines.find((l) => l.id === id);
  if (!line) return lines;
  return setQty(lines, id, line.qty + delta);
}

/**
 * Swapping a variant re-prices the line from the option itself, so the cart
 * never has to know how any service prices anything.
 */
export function setVariant(lines, id, optionId) {
  return lines.map((l) => {
    if (l.id !== id || !l.variant) return l;
    const opt = l.variant.options.find((o) => o.id === optionId);
    if (!opt) return l;
    return {
      ...l,
      unitPrice: Number(opt.price) || 0,
      variant: { ...l.variant, selected: opt.id },
    };
  });
}

export const lineTotal = (line) => (Number(line?.unitPrice) || 0) * (Number(line?.qty) || 0);

/** The label of the currently chosen variant option, or "" where there is none. */
export function selectedVariantLabel(line) {
  const v = line?.variant;
  if (!v) return "";
  return v.options.find((o) => o.id === v.selected)?.label ?? "";
}

/** The chosen variant's id — what a builder sends the server as its size. */
export function selectedVariantId(line) {
  return line?.variant?.selected ?? null;
}

export const cartTotal = (lines) => (lines ?? []).reduce((sum, l) => sum + lineTotal(l), 0);

/** How many things, not how many lines — "3 items" counts quantities. */
export const itemCount = (lines) => (lines ?? []).reduce((n, l) => n + (Number(l.qty) || 0), 0);

/** Services present in the order, in the order they were first added. */
export function servicesInCart(lines) {
  const seen = [];
  for (const l of lines ?? []) if (l.service && !seen.includes(l.service)) seen.push(l.service);
  return seen;
}

/**
 * The order lines as GoHighLevel's `dishes_selected` wants them: one bullet
 * per line, with a line's contents indented beneath it.
 *
 * Deliberately the only place this text is built. Five builders each writing
 * their own version is how they drifted apart before.
 */
export function dishesSelectedText(lines, formatMoney) {
  const money = typeof formatMoney === "function" ? formatMoney : (n) => `PHP ${n.toLocaleString()}`;
  return (lines ?? []).map((l) => {
    // Gated on the number itself, never on whether the customer may change
    // it. A packed-meals line is 50 packs and cannot be edited in the cart —
    // keying that off editability dropped the 50 from what the kitchen reads.
    const qty = l.qty > 1 ? `${l.qty}× ` : "";
    // The chosen variant is part of what was ordered, and it is not in the
    // subtitle: the subtitle stays put while the variant can be swapped in
    // the cart, so duplicating it there would go stale on the first swap.
    const sub = [l.subtitle, selectedVariantLabel(l)].filter(Boolean).join(" · ");
    const head = `• ${qty}${l.title}${sub ? ` (${sub})` : ""} — ${money(lineTotal(l))}`;
    const body = l.contents.map((c) => `    ${c}`);
    return [head, ...body].join("\n");
  }).join("\n");
}
