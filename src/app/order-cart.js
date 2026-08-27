/**
 * Draws the order's lines, whatever service they came from.
 *
 * This is the cart that used to live inside party-tray-builder as
 * renderCart(). It was already the right component — an item list with a
 * quantity stepper, a size swap, a remove, and a running total bar — it just
 * could not be reached from any other service. Lifting it out is most of
 * what the shared cart is; the rest is making a line describe itself rather
 * than assuming it is a tray.
 *
 * The markup deliberately keeps the existing class names (`review-item`,
 * `running-total-bar`, `qty-btn`) so the styles that were tuned over several
 * rounds of your screenshots carry over untouched. Only the contents
 * disclosure is new.
 *
 * State lives with the caller. This module renders, and turns a click into a
 * named action; it never holds the order.
 */
import { lineTotal, cartTotal, itemCount, servicesInCart } from "../domain/cart.js";
import { formatPeso } from "../domain/package-rules.js";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Which lines are showing their contents.
 *
 * View state, not order state — it does not belong in the cart itself and
 * must not survive into a payload. A combo holds up to nine trays, and three
 * combos expanded by default would bury everything else in the order, so
 * they start closed.
 */
const expanded = new Set();

export function toggleExpanded(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

export function isExpanded(id) {
  return expanded.has(id);
}

/** Drops view state for lines that no longer exist. */
export function pruneExpanded(lines) {
  const live = new Set((lines ?? []).map((l) => l.id));
  for (const id of [...expanded]) if (!live.has(id)) expanded.delete(id);
}

function variantHtml(line) {
  if (!line.variant?.options?.length) return "";
  return `
    <div class="review-item__size-row" role="group" aria-label="${esc(line.variant.label)}">
      ${line.variant.options.map((o) => `
        <button type="button"
          class="review-size-btn${line.variant.selected === o.id ? " is-active" : ""}"
          data-cart-variant="${esc(line.id)}"
          data-option="${esc(o.id)}"
          aria-pressed="${line.variant.selected === o.id}">
          ${esc(o.label)}
        </button>
      `).join("")}
    </div>`;
}

function contentsHtml(line) {
  if (!line.contents.length) return "";
  const open = expanded.has(line.id);
  const n = line.contents.length;
  return `
    <button type="button" class="cart-contents__toggle"
      data-cart-expand="${esc(line.id)}"
      aria-expanded="${open}"
      aria-controls="contents-${esc(line.id)}">
      <span class="cart-contents__chevron${open ? " is-open" : ""}" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
      ${open ? "Hide" : "Show"} ${n} item${n !== 1 ? "s" : ""}
    </button>
    <ul class="cart-contents__list" id="contents-${esc(line.id)}"${open ? "" : " hidden"}>
      ${line.contents.map((c) => `<li>${esc(c)}</li>`).join("")}
    </ul>`;
}

function qtyHtml(line) {
  // No stepper where the customer may not set the quantity — a grazing tier
  // is one spread, and a Packed Meals line is priced on a volume tier fixed
  // at the moment it was added. Showing a control the order would reject is
  // the thing we agreed never to do.
  //
  // A locked quantity is still shown when there is one worth showing: "50×"
  // is the whole substance of a packed-meals line, and hiding it because the
  // stepper is absent would be worse than showing a control that does not work.
  if (!line.qtyEditable) {
    return `<div class="review-item__controls review-item__controls--fixed">${
      line.qty > 1 ? `<span class="review-item__qty review-item__qty--locked">${line.qty}&times;</span>` : ""
    }</div>`;
  }
  return `
    <div class="review-item__controls">
      <button type="button" class="qty-btn" data-cart-qty="${esc(line.id)}" data-delta="-1"
        aria-label="Fewer ${esc(line.title)}">&minus;</button>
      <span class="review-item__qty">${line.qty}</span>
      <button type="button" class="qty-btn" data-cart-qty="${esc(line.id)}" data-delta="1"
        aria-label="More ${esc(line.title)}">+</button>
    </div>`;
}

/**
 * Names only the adjustments this particular cart actually offers.
 *
 * The fixed copy promised "change quantity, swap a size, or remove" on a
 * Packed Meals cart, where the first two do not exist — its quantity is set
 * before adding and it has no sizes. Telling someone about a control that is
 * not on screen sends them looking for it.
 */
export function adjustHint(lines) {
  const can = [];
  if (lines.some((l) => l.qtyEditable)) can.push("change quantity");
  if (lines.some((l) => l.variant?.options?.length)) can.push("swap a size");
  can.push("remove items");
  const last = can.pop();
  return `Need to adjust? ${can.length ? `${can.join(", ")} or ${last}` : last[0].toUpperCase() + last.slice(1)} below.`;
}

/**
 * @param {object} line
 * @param {boolean} showService  only in a mixed order — naming the service on
 *   every row of a Party Trays-only cart says nothing the customer does not
 *   already know, and pushes the useful half of the subtitle out of sight on
 *   a phone.
 */
function lineHtml(line, showService) {
  const sub = [showService ? line.serviceLabel : "", line.subtitle].filter(Boolean).join(" · ");
  return `
    <li class="review-item cart-line">
      <div class="review-item__info">
        <strong>${esc(line.title)}</strong>
        ${sub ? `<span>${esc(sub)}</span>` : ""}
        ${contentsHtml(line)}
      </div>
      ${variantHtml(line)}
      ${qtyHtml(line)}
      <div class="review-item__price">${formatPeso(lineTotal(line))}</div>
      <button type="button" class="remove-btn" data-cart-remove="${esc(line.id)}"
        aria-label="Remove ${esc(line.title)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </li>`;
}

/**
 * @param {HTMLElement} container
 * @param {import("../domain/cart.js").CartLine[]} lines
 * @param {object} opts
 * @param {string} opts.emptyText     what to say when there is nothing yet
 * @param {string} opts.forwardLabel  the CTA
 * @param {string} opts.forwardAttr   data attribute the caller handles, e.g. `data-go-review`
 * @param {string} [opts.backAttr]    data attribute for the back link
 * @param {string} [opts.backLabel]
 * @param {string} [opts.note]        the small print under the total
 * @param {(lines: object[]) => string} [opts.serves]
 *   How this order describes its own size. "3 items" is right for trays and
 *   meaningless for packed meals, where the number that matters is how many
 *   people it feeds. Defaults to counting items.
 */
export function renderCartInto(container, lines, opts = {}) {
  if (!container) return;
  pruneExpanded(lines);

  const {
    emptyText = "No items yet. Pick a service, choose what you need, then tap Add to Order.",
    forwardLabel = "Review order &rarr;",
    forwardAttr = "data-go-review",
    backAttr = "data-service-back",
    backLabel = "&larr; Services",
    note = "",
    serves = null,
  } = opts;

  const count = itemCount(lines);
  const total = cartTotal(lines);
  const mixed = servicesInCart(lines).length > 1;

  // The review screen groups the order by service and carries its own
  // heading and total, so it asks for the lines alone. Same component either
  // way — a line must look identical wherever it is shown.
  if (opts.bare) {
    container.innerHTML = lines.length
      ? `<ul class="review-list">${lines.map((l) => lineHtml(l, false)).join("")}</ul>`
      : "";
    return;
  }

  if (!lines.length) {
    container.innerHTML = `
      <p class="section-kicker">Your Order</p>
      <p class="empty-state">${esc(emptyText)}</p>
      <div class="running-total-bar">
        <button class="text-button" type="button" ${backAttr}>${backLabel}</button>
        <div class="running-total-bar__info">
          <span class="running-total-bar__label">Running total</span>
          <span class="running-total-bar__amount running-total-bar__amount--empty">&mdash;</span>
          <span class="running-total-bar__serves">Add items to see your estimate</span>
        </div>
        <button class="primary-button" type="button" disabled aria-disabled="true">${forwardLabel}</button>
      </div>`;
    return;
  }

  container.innerHTML = `
    <p class="section-kicker">Your Order &middot; ${lines.length} line${lines.length !== 1 ? "s" : ""}</p>
    <p class="review-hint">${esc(adjustHint(lines))}</p>
    <ul class="review-list">${lines.map((l) => lineHtml(l, mixed)).join("")}</ul>
    <div class="running-total-bar">
      <button class="text-button" type="button" ${backAttr}>${backLabel}</button>
      <div class="running-total-bar__info">
        <span class="running-total-bar__label">Running total</span>
        <span class="running-total-bar__amount">${formatPeso(total)}</span>
        <span class="running-total-bar__serves">${
          esc(typeof serves === "function" ? serves(lines) : `${count} item${count !== 1 ? "s" : ""}`)
        }${note ? ` &middot; ${esc(note)}` : ""}</span>
      </div>
      <button class="primary-button" type="button" ${forwardAttr}>${forwardLabel}</button>
    </div>`;
}

/**
 * Turns a click inside the cart into something the caller can act on, or
 * null if the click was not ours.
 *
 * @returns {{type: "qty"|"remove"|"variant"|"expand", id: string, delta?: number, option?: string}|null}
 */
export function cartAction(event) {
  const t = event?.target;
  if (!t || typeof t.closest !== "function") return null;

  const qty = t.closest("[data-cart-qty]");
  if (qty) return { type: "qty", id: qty.dataset.cartQty, delta: Number(qty.dataset.delta) || 0 };

  const rm = t.closest("[data-cart-remove]");
  if (rm) return { type: "remove", id: rm.dataset.cartRemove };

  const v = t.closest("[data-cart-variant]");
  if (v) return { type: "variant", id: v.dataset.cartVariant, option: v.dataset.option };

  const ex = t.closest("[data-cart-expand]");
  if (ex) return { type: "expand", id: ex.dataset.cartExpand };

  return null;
}
