/**
 * Reading an order back out of the text GoHighLevel holds.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Order Status used to render the order from `payment_links.order_groups` —
 * a JSON snapshot written once, when the payment link was minted. The
 * dashboard applies approved changes to the OPPORTUNITY and never touches
 * that row, which it should not: it is our table, and a second writer with
 * no version to check against is the thing the whole requests-are-rows
 * design exists to avoid.
 *
 * The result was a page that contradicted itself. Money came live from the
 * opportunity and dishes came frozen from the snapshot, so a customer whose
 * add had been approved saw a new total beside their old order — PHP 54,000
 * against one package worth PHP 35,000. Not stale: visibly wrong, with
 * nowhere to go with it.
 *
 * `dishes_selected` is the field the kitchen works from and the one the
 * dashboard appends to, and it turns out to be structured rather than
 * freeform, because dishesSelectedText() in cart.js writes it:
 *
 *     • Mary Rose Package (100 pax) — PHP 35,000
 *         2× XXXL — Roast Beef Pink Mash with French Beans
 *         XXXL — Blue Rice
 *     • Mary Rose Package (50 pax) — PHP 19,000
 *         XXXL — Chicken Parmigiana
 *
 * So the order can be read back from the same place the money comes from,
 * and the screen cannot disagree with itself again. Verified against a live
 * two-package booking whose parts sum exactly to its monetaryValue.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * It does not guess. Text with no bullet in it parses to nothing, and the
 * caller falls back to showing the raw field — which is what the eleven
 * hundred bookings typed in from the Excel book get today, and is honest for
 * anything hand-written that this was never designed to read.
 *
 * It also carries no `kind`. The snapshot knew which builder each line came
 * from; the text does not, and the service on the opportunity is the whole
 * booking's, not the line's. Labelling a party tray "Combo Trays" because
 * that is what the booking is mostly made of would be worse than labelling
 * nothing.
 */

/** Exactly what dishesSelectedText writes, and what the dashboard appends. */
const BULLET = "•";
const SEPARATOR = " — ";   // space, em dash, space

/**
 * A money figure as formatPeso writes it: "PHP 35,000", with either a normal
 * space or the non-breaking one it actually uses.
 */
function peso(text) {
  const m = /^PHP[\s\u00A0]*([\d,]+(?:\.\d+)?)$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Splits a header on the LAST separator rather than the first.
 *
 * The price is at the end, and a title is free to contain anything — the
 * separator is only guaranteed not to appear in a DISH name, which is a
 * promise combo-line.js makes about the lines beneath, not about this one.
 */
function splitHead(line) {
  const at = line.lastIndexOf(SEPARATOR);
  if (at === -1) return { name: line.trim(), price: "" };
  return {
    name: line.slice(0, at).trim(),
    price: line.slice(at + SEPARATOR.length).trim(),
  };
}

/** "Mary Rose Package (100 pax)" → title and subtitle. */
function splitName(name) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
  if (!m || !m[1].trim()) return { title: name, subtitle: "" };
  return { title: m[1].trim(), subtitle: m[2].trim() };
}

/**
 * The order, as groups a screen can render.
 *
 * Shaped for groupHtml in src/app/order-status.js: title, subtitle, contents,
 * and either a total or a priceNote — never both, because a line the menu
 * cannot price reports no money rather than a zero that reads as free.
 *
 * @param {string} text  dishes_selected from the opportunity
 * @returns {Array<{title,subtitle,contents,total,priceNote}>} empty when
 *   there is nothing bulleted to read, which tells the caller to fall back.
 */
export function groupsFromDishText(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const groups = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith(BULLET)) {
      const { name, price } = splitHead(trimmed.slice(BULLET.length).trim());
      const { title, subtitle } = splitName(name);
      if (!title) continue;

      const total = peso(price);
      groups.push({
        title,
        subtitle,
        contents: [],
        total,
        // Anything in the price position that is not a figure is a note —
        // "From PHP 8,000" on a service the menu cannot price. Kept as
        // written rather than parsed, because it is already a sentence.
        priceNote: total === null && price ? price : null,
      });
      continue;
    }

    // A dish, under whichever bullet it followed. Text before the first
    // bullet belongs to no group and is dropped: it is the freeform shape
    // this does not claim to read.
    if (groups.length > 0) groups[groups.length - 1].contents.push(trimmed);
  }

  return groups;
}

/**
 * Whether the parse is worth showing instead of the raw field.
 *
 * One bullet with nothing under it and no price is not an order — it is a
 * line of prose that happened to start with a dot. Falling back costs the
 * grouped rendering and keeps the truth, which is the right way round.
 */
export function readsAsAnOrder(groups) {
  return (groups ?? []).some(
    (g) => g.contents.length > 0 || g.total !== null || g.priceNote,
  );
}
