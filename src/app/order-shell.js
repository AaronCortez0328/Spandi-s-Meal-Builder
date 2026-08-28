import { stepperHtml, STEP_REVIEW, STEP_DETAILS } from "./stepper.js";
/**
 * The order, shared across every service.
 *
 * Until now each builder kept its own basket, so an order was whatever one
 * service could express. Someone wanting combo trays *and* packed meals had
 * to place two orders and answer "you already have an order with us" in the
 * middle of buying — a question meant for "is this a second event?", not for
 * "I am still shopping".
 *
 * One list lives here. Builders add to it and read it; none of them owns it.
 *
 * ── Where the cart button lives ────────────────────────────────────────────
 * Not here. This app runs inside an iframe as tall as its content, which
 * never scrolls, so nothing it draws can be pinned to a viewport or follow
 * the customer between pages. The site's navbar has neither limit and is on
 * every page, so that is where the button is — see docs/ghl-navbar.html.
 *
 * This file's part is to say what is in the order, over the same channel the
 * page already uses to resize the frame. Nothing here depends on the page
 * acting on it: postMessage to a parent that is not listening does nothing.
 */
import {
  cartTotal, itemCount, servicesInCart, makeLine, lineTotal, selectedVariantId,
  dishesSelectedText,
} from "../domain/cart.js";
import { renderCartInto } from "./order-cart.js";
import {
  buildContactPanel, validateAndRead, attachInlineValidation, attachFormPickers,
  clearFilledErrors, buildInquiryText, fulfilmentTimeLabel,
} from "./contact-form.js";
import { submitInquiry } from "./submit-inquiry.js";
import { renderInquirySent } from "./inquiry-sent.js";
import { applyRushFee, RUSH_FEE, formatPeso } from "../domain/pricing.js";
import { wayOutHtml } from "./copy.js";

const KEY = "spandis:draft:order";

/** @type {import("../domain/cart.js").CartLine[]} */
let lines = [];
const listeners = new Set();

/**
 * sessionStorage, or null where it cannot be used.
 *
 * Same reasoning as draft.js: the cart is tied to a contact form holding a
 * name, a phone number and a home address, and localStorage would leave that
 * on a shared machine long after the person has gone. Safari in private mode
 * and some embedded webviews expose the API and then throw on write, so the
 * only reliable check is to write.
 */
function storage() {
  try {
    const s = window.sessionStorage;
    s.setItem(`${KEY}__probe`, "1");
    s.removeItem(`${KEY}__probe`);
    return s;
  } catch {
    return null;
  }
}

function persist() {
  const s = storage();
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(lines)); } catch { /* quota, private mode */ }
}

/** Restores the order saved for this tab. Call once, before the first render. */
export function restoreOrder() {
  const s = storage();
  if (!s) return lines;
  try {
    const raw = s.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    // Rebuilt through makeLine so a stored object missing a field added
    // later cannot render as a blank row.
    lines = Array.isArray(saved) ? saved.map(makeLine) : [];
  } catch {
    lines = [];
  }
  return lines;
}

export function getOrderLines() {
  return lines;
}

export function setOrderLines(next) {
  lines = Array.isArray(next) ? next : [];
  persist();
  for (const fn of listeners) fn(lines);
  return lines;
}

export function clearOrder() {
  return setOrderLines([]);
}

/**
 * Turns a builder's `state.cart` into a live window onto the shared order.
 *
 * Every builder already reads and writes `state.cart` in a dozen places.
 * Rewriting each of those to call getOrderLines/setOrderLines is a large
 * diff over code that is otherwise correct, and the one time I tried it a
 * regex ate a comment. A property with a getter and a setter leaves every
 * call site exactly as it was and still routes through here.
 *
 * Not enumerable, deliberately: draft.js persists a builder's state with
 * JSON.stringify, and an enumerable `cart` would be written into the
 * builder's own draft as well as the order's. Restoring would then have two
 * sources of truth for the same basket, and the loser would be whichever
 * happened to load second.
 *
 * @param {object} state  the builder's live state object
 */
export function shareOrderAs(state) {
  Object.defineProperty(state, "cart", {
    get: () => lines,
    set: (next) => { setOrderLines(next); },
    enumerable: false,
    configurable: true,
  });
  return state;
}

/**
 * A builder asking for the review screen.
 *
 * Builders that share the order must not run their own checkout. Theirs
 * builds `lineItems` as though every line belonged to it — a combo passing
 * through Party Trays' checkout arrives with no dishId, the server answers
 * "cannot price" rather than "wrong price", and the total goes through
 * unverified with the wrong service_type on it.
 *
 * Closing that off at each entrance is a losing game: the cart's forward
 * button was one, the stepper bubble is another. So a shared builder simply
 * refuses to render its own step 2 and asks for the review instead, and the
 * app decides how to get there.
 */
let reviewRequested = () => {};
export function onReviewRequested(fn) { reviewRequested = fn; }
export function requestReview() { reviewRequested(); }

/** @returns {() => void} unsubscribe */
export function onOrderChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const orderTotal = () => cartTotal(lines);
export const orderServices = () => servicesInCart(lines);

/**
 * How many things are in the order, counted as lines rather than quantities.
 *
 * Summing quantities across services produces a number that means nothing:
 * one party tray plus twenty-five packed meals is not "26 items" of
 * anything. Within a service the quantity is the right unit, and each
 * service says so in its own words ("Feeds 25 guests", "2 trays"). Across
 * services the only honest count is how many things you have chosen.
 */
export const orderCount = () => lines.length;

/** Quantities summed — meaningful only within one service. */
export const orderQuantity = () => itemCount(lines);

/**
 * Tells the GHL page what is in the order.
 *
 * The page already listens to this app — that is how the iframe grows to fit
 * its content (`spandis-resize`, see BRAND-TOKENS.md). This is one more
 * message on a pipe that is already in production, and it is what the
 * navbar's cart button is drawn from.
 *
 * Sent on every change, including a count of zero, so the navbar can clear
 * a badge as well as raise one.
 */
export const CART_MESSAGE = "spandis-cart";
export const OPEN_CART_MESSAGE = "spandis-open-cart";

export function publishOrderToParent() {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: CART_MESSAGE,
    count: orderCount(),
    total: orderTotal(),
    // Pre-formatted so the page's snippet never has to know about pesos.
    label: formatPeso(orderTotal()),
  }, "*");
}

/**
 * Listens for the customer tapping the floating button on the GHL page.
 *
 * The message shape is checked rather than the origin: the embed lives on
 * the client's own domains, which change (custom domains, previews), and the
 * only thing this can be asked to do is show a screen the customer could
 * reach by tapping the header. Nothing here reads data from the message.
 *
 * @param {() => void} onOpen
 */
export function listenForParentCartTap(onOpen) {
  window.addEventListener("message", (e) => {
    if (e?.data?.type === OPEN_CART_MESSAGE) onOpen();
  });
}

/**
 * The review screen: the whole order, whatever it is made of.
 *
 * Grouped by service rather than listed flat. A mixed order read as one
 * undifferentiated list is hard to check against what you meant to buy, and
 * checking is the entire job of this screen.
 */
/**
 * The journey. Drawn by src/app/stepper.js, the same module the builders
 * use, so the review cannot say one thing while a builder says another --
 * which it did: a builder counted to four and this screen said "3 of 3".
 *
 * Review and Details are separate steps here rather than one "Confirm".
 * They are two screens, every customer walks through both, and a marker
 * that sits still across them freezes at exactly the point where someone
 * is deciding whether to spend the money.
 */

export function renderReview(el) {
  if (!el) return;
  const lines = getOrderLines();

  if (!lines.length) {
    el.innerHTML = `
      ${stepperHtml(STEP_REVIEW)}
      <section class="panel order-review">
        <p class="section-kicker">Step 3 of 4 &middot; Your order</p>
        <h2 class="order-review__title">Nothing here yet</h2>
        <p class="empty-state">Pick a service and add something to your order.</p>
        <div class="step-nav">
          <button class="primary-button" type="button" data-service-back>Choose a service</button>
        </div>
      </section>`;
    return;
  }

  const groups = [];
  for (const line of lines) {
    let g = groups.find((x) => x.service === line.service);
    if (!g) { g = { service: line.service, label: line.serviceLabel, lines: [] }; groups.push(g); }
    g.lines.push(line);
  }

  el.innerHTML = `
    ${stepperHtml(STEP_REVIEW)}
    <section class="panel order-review">
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 3 of 4 &middot; Review your order</p>
          <h2 class="order-review__title">Your order</h2>
        </div>
      </div>
      ${groups.map((g) => `
        <div class="order-review__group">
          <p class="order-review__group-label">${g.label}</p>
          <div data-review-group="${g.service}"></div>
        </div>
      `).join("")}
      <div class="order-review__add">
        <button class="text-button" type="button" data-service-back>+ Add another service</button>
      </div>
      <div class="running-total-bar">
        <button class="text-button" type="button" data-service-back>&larr; Keep shopping</button>
        <div class="running-total-bar__info">
          <span class="running-total-bar__label">Order total</span>
          <span class="running-total-bar__amount">${formatPeso(orderTotal())}</span>
          <span class="running-total-bar__serves">${orderCount()} item${orderCount() !== 1 ? "s" : ""} &middot; Delivery quoted separately</span>
        </div>
        <button class="primary-button" type="button" data-go-checkout>Proceed to checkout &rarr;</button>
      </div>
    </section>`;

  // Each service's lines drawn by the same component the builders use, so a
  // line looks identical wherever it is shown.
  for (const g of groups) {
    renderCartInto(el.querySelector(`[data-review-group="${g.service}"]`), g.lines, {
      bare: true,
    });
  }
}

/** Rows for the checkout summary — every line, with its price. */
/** Rows for the checkout summary -- every line, with its price and what is
 * inside it.
 *
 * contents used to be dropped here. The cart offered "Show 6 items" and the
 * checkout, the last screen before the customer commits money, showed less
 * detail than the screen before it -- there was even a block built to
 * display them that no row could ever trigger.
 */
export function orderSummaryRows() {
  return getOrderLines().map((line) => ({
    label: `${line.qty > 1 ? `${line.qty}× ` : ""}${line.title}`,
    value: formatPeso(lineTotal(line)),
    subtitle: line.subtitle ?? "",
    contents: Array.isArray(line.contents) ? line.contents : [],
  }));
}

/**
 * What the server needs to price this order itself, per service.
 *
 * Each service already has a shape the server understands. Rather than
 * inventing a new one for mixed orders, the order is split back into those
 * shapes and the server sums them — so a mixed order is priced by exactly
 * the same code that prices a single-service one.
 */
export function orderLineItems(rush) {
  const groups = [];
  const groupFor = (service, seed) => {
    let g = groups.find((x) => x.service === service);
    if (!g) { g = { service, ...seed }; groups.push(g); }
    return g;
  };

  for (const line of getOrderLines()) {
    switch (line.service) {
      case "party-trays":
        groupFor("party-trays", { lines: [] }).lines
          .push({ dishId: line.payload.dishId, traySize: selectedVariantId(line), qty: line.qty });
        break;
      case "packed-meals":
        groupFor("packed-meals", { lines: [] }).lines
          .push({ packTypeId: line.payload.packTypeId, qty: line.qty });
        break;
      case "combo-trays":
        groupFor("combo-trays", { lines: [] }).lines
          .push({ packageId: line.payload.comboId, qty: line.qty });
        break;
      // Grazing and the catering packages are one line each and are priced
      // from the tier or the head count, not from a list — so they keep the
      // flat shape the server has always understood for them.
      case "grazing-table":
      case "grazing-board":
        groupFor(line.service, {
          serviceKey: line.payload.serviceKey,
          paxRange: line.payload.paxRange,
        });
        break;
      case "basic-catering":
      case "classic-catering":
        groupFor(line.service, {
          serviceKey: line.payload.serviceKey,
          pax: line.payload.pax,
        });
        break;
      default:
        // A service whose shape the server does not know. Sending a group it
        // cannot price makes serverTotal return null for the whole order,
        // which reads as "cannot verify" rather than as a mismatch — the
        // deliberate direction, but worth seeing in the console.
        console.warn(`No server pricing shape for ${line.service}`);
        groupFor(line.service, { lines: [] }).lines?.push({ qty: line.qty });
    }
  }

  // The server keys grazing and catering packages off "grazing" and
  // "catering-package" rather than off the individual service.
  const SERVER_SERVICE = {
    "grazing-table": "grazing", "grazing-board": "grazing",
    "basic-catering": "catering-package", "classic-catering": "catering-package",
  };
  const out = groups.map((g) => ({ ...g, service: SERVER_SERVICE[g.service] ?? g.service }));

  return out.length === 1
    // One service: send exactly what that service always sent, so nothing
    // about a single-service order changes on the way to the server.
    ? { ...out[0], rush }
    : { service: "mixed", groups: out, rush };
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DECISION NEEDED — service_type for an order spanning services
 * ─────────────────────────────────────────────────────────────────────────
 * GoHighLevel holds one value here, and the dashboard reads it for the
 * kitchen board and for revenue-by-service. An order of combo trays AND
 * packed meals has to say something.
 *
 * Until the business decides, this reports the service with the most money
 * in it. That is always a value the field already accepts — inventing
 * "Mixed" would fail outright if the field turns out to be a dropdown — and
 * the full breakdown is in dishes_selected and in the note either way.
 *
 * It is deliberately one function so the answer is a one-line change.
 */
export function orderServiceType() {
  const byService = new Map();
  for (const line of getOrderLines()) {
    byService.set(line.serviceLabel, (byService.get(line.serviceLabel) ?? 0) + lineTotal(line));
  }
  let best = "", most = -1;
  for (const [label, sum] of byService) if (sum > most) { best = label; most = sum; }
  return best;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DECISION NEEDED — pax_count when the units disagree
 * ─────────────────────────────────────────────────────────────────────────
 * "2 trays", "50 pieces" and "15 pax" are all correct and none of them can
 * stand for the others. Joined rather than reduced, so nothing is lost while
 * the business decides what this field should mean.
 */
export function orderPaxCount() {
  const trays = getOrderLines().filter((l) => l.service === "party-trays")
    .reduce((n, l) => n + l.qty, 0);
  const pieces = getOrderLines().filter((l) => l.service === "packed-meals")
    .reduce((n, l) => n + l.qty, 0);
  // Combos carry paxLabel, grazing a paxRange, the catering packages a head
  // count. All three are a "how many people" figure and all three belong here.
  const pax = [...new Set(getOrderLines().map((l) => {
    const pl = l.payload ?? {};
    if (pl.paxLabel) return pl.paxLabel;
    if (pl.paxRange) return `${pl.paxRange} pax`;
    if (pl.pax) return `${pl.pax} pax`;
    return null;
  }).filter(Boolean))];

  const parts = [];
  if (trays)  parts.push(`${trays} tray${trays !== 1 ? "s" : ""}`);
  if (pieces) parts.push(`${pieces} piece${pieces !== 1 ? "s" : ""}`);
  parts.push(...pax);
  return parts.join(", ");
}

/**
 * Checkout — one contact form for the whole order.
 *
 * Every builder used to carry its own copy of this, along with its own
 * payload and its own submit. Five copies of the same branching is how they
 * drifted apart before: a field added to four of them and missed on the
 * fifth is exactly how base_price disappeared for months.
 */
export function renderCheckout(el) {
  if (!el) return;
  // Reachable by emptying the order from the review and then coming forward
  // again, or by the back button. It used to be a sentence with no way out
  // of it — no link, no button, nothing.
  if (!getOrderLines().length) {
    el.innerHTML = `
      ${stepperHtml(STEP_REVIEW)}
      <section class="panel order-review">
        <p class="section-kicker">Step 3 of 4 &middot; Your order</p>
        <h2 class="order-review__title">Nothing to check out</h2>
        <p class="empty-state">Your order is empty. Pick a service and add something to it.</p>
        <div class="step-nav">
          <button class="primary-button" type="button" data-service-back>Choose a service</button>
        </div>
      </section>`;
    return;
  }
  el.innerHTML = stepperHtml(STEP_DETAILS) + buildContactPanel({
    backAttr: "data-go-review",
    copyAttr: "data-order-submit",
    statusId: "order-submit-status",
    summaryRows: orderSummaryRows(),
    orderTotal: orderTotal(),
  });
  attachInlineValidation(el);
  attachFormPickers(el);
}

/** @param {HTMLElement} btn the Send Order button, for its busy state */
export async function submitOrder(btn) {
  const el = document.getElementById("order-checkout");
  const { valid, values } = validateAndRead();
  if (!valid) {
    // Autofill does not fire input events, so a filled field can still be
    // marked invalid — poll briefly and clear the ones that are now fine.
    const t = setInterval(() => {
      clearFilledErrors(el);
      if (!el?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
    }, 150);
    setTimeout(() => clearInterval(t), 5000);
    return;
  }

  const lines = getOrderLines();
  const finalTotal = applyRushFee(orderTotal(), values.rushOrder);
  const statusEl = document.getElementById("order-submit-status");
  const serviceType = orderServiceType();

  const noteBody = buildInquiryText(
    serviceType,
    [
      ...lines.map((l) =>
        `${l.serviceLabel.padEnd(9)}: ${l.qty > 1 ? `${l.qty}× ` : ""}${l.title} — ${formatPeso(lineTotal(l))}`),
      ...(values.rushOrder ? [`Rush fee : +${formatPeso(RUSH_FEE)}`] : []),
      `Total    : ${formatPeso(finalTotal)}`,
    ],
    values,
    // Contents indented under the line they belong to, so a combo's trays
    // are not mistaken for separate orders.
    lines.flatMap((l) => [
      `${l.qty > 1 ? `${l.qty}× ` : ""}${l.title}`,
      ...l.contents.map((c) => `  • ${c}`),
    ])
  );

  const originalBtnHTML = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
  }

  await submitInquiry({
    payload: {
      contact: values,
      lineItems: orderLineItems(values.rushOrder),
      opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · ${serviceType}`,
      monetaryValue: finalTotal,
      noteBody,
      contactFields: { branch: values.branch, event_date: values.eventDate },
      opportunityFields: {
        service_type:    serviceType,
        branch:          values.branch,
        event_date:      values.eventDate,
        event_time:      values.eventTime,
        pax_count:       orderPaxCount(),
        dishes_selected: dishesSelectedText(lines, formatPeso),
        event_notes:     values.note,
        receive_method:  values.fulfilment,
        delivery__pickup_time: values.fulfilmentTime,
        contacted_via_social:  values.contactedViaSocial,
        social_profile_name:   values.socialProfileName,
        rush_order: values.rushOrder ? `Yes (+${formatPeso(RUSH_FEE)})` : "",
      },
    },
    panel: el,
    onSuccess: (result) => {
      try { navigator.clipboard.writeText(noteBody); } catch { /* iframe blocked */ }
      renderInquirySent(el, {
        attached: result?.attached,
        firstName: values.firstName,
        rows: [
          { label: "Order",      value: lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.title}` : l.title)).join(", ") },
          { label: "Event date", value: values.eventDate },
          { label: "Branch",     value: values.branch },
          ...(values.rushOrder ? [{ label: "Rush order", value: `Yes (+${formatPeso(RUSH_FEE)})` }] : []),
          { label: "Receive",    value: values.fulfilment },
          { label: fulfilmentTimeLabel(values.fulfilment), value: values.fulfilmentTime },
          { label: "Name",       value: `${values.firstName} ${values.lastName}` },
        ],
        priceLabel: "Order total",
        priceValue: formatPeso(finalTotal),
      });
      // The order has been placed; keeping it would offer it again on the
      // next visit at prices that may since have moved.
      clearOrder();
    },
    onError: (message) => {
      // The message alone was the whole screen. Someone whose second
      // attempt also fails needs somewhere to go, and this is the moment
      // they are most worth keeping -- they had already decided to buy.
      if (statusEl) {
        // textContent for the message, then the link appended -- the message
        // can carry server text and has no business being parsed as HTML.
        statusEl.textContent = message;
        statusEl.insertAdjacentHTML("beforeend", wayOutHtml("Tried twice?"));
      }
      if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHTML; }
    },
  });
}
