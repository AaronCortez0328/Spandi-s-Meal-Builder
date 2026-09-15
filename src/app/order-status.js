import { setButtonBusy } from "./button-busy.js";

/**
 * Order Status — the page a customer reaches days or weeks after booking,
 * holding nothing.
 *
 * That is the constraint the whole screen is built around. They have closed
 * the tab, the confirmation email is buried, and they are not going to find a
 * link. So the page asks for two things they know by heart and looks the
 * order up: the email or mobile they booked with, and the date of the event.
 *
 * What it deliberately does not show is money. api/_order-lookup.js carries
 * the reasoning — an email is not a secret, so this gate is weaker than the
 * payment link, and the figure a customer owes belongs behind the stronger
 * one. There is a line pointing them at it instead.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const peso = (n) =>
  `PHP\u00A0${Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

/**
 * One group of the order, as its own block.
 *
 * Grouped rather than flattened because an order can hold a grazing board,
 * two party trays and fifty packed meals at once — priced by four different
 * rules and counted in three different units. Each group keeps its own units
 * and its own costing lines, so a customer can see why grazing carries a
 * service charge and party trays do not without anyone explaining it.
 */
export function groupHtml(group) {
  const money = group.priceNote
    ? `<span class="os-group__note">${esc(group.priceNote)}</span>`
    : group.total != null
      ? `<span class="os-group__total">${esc(peso(group.total))}</span>`
      : "";

  const lines = (group.contents ?? []).map((c) => `<li>${esc(c)}</li>`).join("");

  return `
    <div class="os-group">
      <div class="os-group__head">
        ${group.kind ? `<span class="os-group__kind">${esc(group.kind)}</span>` : ""}
        ${group.units ? `<span class="os-group__units">${esc(group.units)}</span>` : ""}
      </div>
      <p class="os-group__title">${esc(group.title)}</p>
      ${group.subtitle ? `<p class="os-group__sub">${esc(group.subtitle)}</p>` : ""}
      ${lines ? `<ul class="os-group__lines">${lines}</ul>` : ""}
      ${money ? `<div class="os-group__money">${money}</div>` : ""}
    </div>
  `;
}

/**
 * The order, however much structure we happen to have.
 *
 * Grouped when the booking was placed after order_groups existed, and a flat
 * description otherwise. The fallback is not an edge case to tidy up later —
 * every booking placed before that column will read this way forever, so it
 * has to be a real rendering rather than an apology.
 */
export function orderHtml(data) {
  if (data.groups) {
    return `<div class="os-groups">${data.groups.map(groupHtml).join("")}</div>`;
  }
  const rows = [
    ["Package", data.packageName],
    ["Guests", data.paxCount],
  ].filter(([, v]) => v);

  return `
    <div class="os-flat">
      ${rows.map(([k, v]) => `
        <div class="os-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>
      `).join("")}
      ${data.dishes ? `
        <div class="os-dishes">
          <p class="booking-caption">Your Dishes</p>
          <div class="os-dishes__body">${esc(data.dishes)}</div>
        </div>` : ""}
    </div>
  `;
}

/**
 * Six steps, all of them, always.
 *
 * A list that grows as the order progresses hides how much is left — someone
 * reading "Cooking" needs to see that Ready and Completed are still to come.
 * No timestamps anywhere: the kitchen's ticks are batched by hand, so a
 * precise time would be confidently wrong. Coarse and honest instead.
 */
export function timelineHtml(timeline) {
  return `
    <ol class="os-steps">
      ${(timeline ?? []).map((s) => `
        <li class="os-step${s.done ? " is-done" : ""}${s.current ? " is-current" : ""}">
          <span class="os-step__dot" aria-hidden="true"></span>
          <span class="os-step__name">${esc(s.label)}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

/**
 * What is owed, and the way to settle it.
 *
 * A customer reading "Balance due PHP 64,250" with no way to act on it is
 * the worst moment to introduce friction — they are looking at the number
 * and they are willing. Sending them to hunt an email from three weeks ago
 * is how payments do not happen.
 *
 * Pay now opens in a new tab, and that is not a preference. This screen
 * runs inside an iframe on the GoHighLevel page, so a plain link would
 * load the payment page INSIDE the status frame: the navigation above it
 * would still read Order Status, the customer would have no way back, and
 * the frame is sized by a script that does not know it is now showing
 * something else. A new tab leaves their order where they left it, which
 * is what they will want the moment the payment is done.
 *
 * rel="noopener" because the opened page must not be able to reach back
 * through window.opener, and noreferrer so the payment page is not handed
 * the URL they came from.
 *
 * A null balance is drawn as unknown rather than as zero. The figure comes
 * from a field an admin fills in by hand, so an empty one means nobody has
 * recorded it — not that nothing has been paid. Telling a customer who has
 * already reserved that they owe the whole amount is worse than saying so.
 */
function paymentHtml(money, payUrl, status) {
  if (!money) return "";

  const known = money.balance !== null;
  const rows = [
    ["Reserve with 50%", peso(money.reserve)],
    ["Paid so far", known ? peso(money.paid) : "Not recorded yet"],
  ];

  return `
    <div class="os-pay">
      <div class="os-pay__top">
        <p class="booking-caption os-pay__cap">Payment</p>
        ${status ? `<span class="os-pay__chip">${esc(status)}</span>` : ""}
      </div>
      ${rows.map(([k, v]) => `
        <div class="os-pay__row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>
      `).join("")}
      <div class="os-pay__total">
        <span>${known ? "Balance due" : "Order total"}</span>
        <strong>${esc(peso(known ? money.balance : money.total))}</strong>
      </div>
      ${payUrl ? `<a class="os-pay__btn" href="${esc(payUrl)}"
         target="_blank" rel="noopener noreferrer">Pay now</a>` : ""}
    </div>
  `;
}

export function resultHtml(data) {
  if (data.offTimeline) {
    return `
      <div class="os-off">
        <p class="os-off__head">This booking has been ${esc(String(data.offTimeline.label).toLowerCase())}</p>
        <p class="os-off__body">Message us and we will help you sort it out.</p>
      </div>
      ${orderHtml(data)}
    `;
  }

  const where = [data.receiveMethod, data.fulfilmentTime].filter(Boolean).join(" · ");

  return `
    <div class="os-result">
      <div class="os-panel">
        <p class="booking-caption">Progress</p>
        ${timelineHtml(data.timeline)}
      </div>
      <div class="os-panel">
        <p class="booking-caption">Your order</p>
        ${orderHtml(data)}
        ${where ? `<div class="os-row"><span>Collection</span><strong>${esc(where)}</strong></div>` : ""}
      </div>
    </div>
    ${paymentHtml(data.money, data.payUrl, data.paymentStatus)}
    ${data.money ? "" : `
      <p class="os-payhint">
        Your payment details are in the booking email we sent you.
      </p>`}
  `;
}

function formHtml() {
  return `
    <div class="pop-card os-card">
      <div class="panel-header pop-header">
        <div>
          <p class="section-kicker">Spandi&#39;s Food + Catering</p>
          <h2>Order status</h2>
        </div>
      </div>

      <p class="contact-intro">Tell us two things and we&#39;ll show you where your order is.</p>

      <form id="os-form" class="os-form" novalidate>
        <div class="form-field">
          <label class="form-field__label" for="os-identifier">Email or mobile number</label>
          <input class="form-field__input" id="os-identifier" name="identifier"
                 type="text" autocomplete="email" inputmode="email"
                 placeholder="maria@email.com or 0917 123 4567">
          <p class="os-hint">Whichever one you gave us when you booked.</p>
        </div>

        <div class="form-field">
          <label class="form-field__label" for="os-date">Event date</label>
          <input class="form-field__input" id="os-date" name="eventDate" type="date">
          <p class="os-hint">The date of your event — not the day you placed the order.</p>
        </div>

        <button class="primary-button os-submit" id="os-submit" type="submit">Show my order</button>
      </form>

      <div id="os-result" class="os-result-slot" aria-live="polite"></div>

      <p class="os-help">Can&#39;t find it? Message us and we&#39;ll look it up for you.</p>
    </div>
  `;
}

/**
 * What the page says about a lookup, before any of it touches the DOM.
 *
 * Extracted so the three outcomes can be asserted without a browser. The
 * repository deliberately has no DOM environment — see the note in
 * contact-form.test.js — and adding one to check three strings would be a
 * dependency in exchange for very little.
 *
 * The network case is worded differently from a miss on purpose. Telling
 * someone their booking cannot be found when their connection dropped sends
 * them to ring the kitchen about an order that is perfectly fine.
 */
export const NOT_BOTH =
  "Please give us both an email or mobile number and your event date.";
export const UNREACHABLE =
  "Couldn't reach us just now. Please check your connection and try again.";

export function outcomeHtml(kind, data) {
  if (kind === "incomplete")  return `<p class="os-miss">${esc(NOT_BOTH)}</p>`;
  if (kind === "unreachable") return `<p class="os-miss">${esc(UNREACHABLE)}</p>`;
  if (data?.found) return resultHtml(data);
  return `<p class="os-miss">${esc(data?.message ?? "We couldn't find an order with those details.")}</p>`;
}

export function mountOrderStatus(container) {
  container.innerHTML = formHtml();

  const form = container.querySelector("#os-form");
  const slot = container.querySelector("#os-result");
  const btn = container.querySelector("#os-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = container.querySelector("#os-identifier").value.trim();
    const eventDate = container.querySelector("#os-date").value;

    // Asked for here rather than left to the server, so an obvious omission
    // costs nobody a request and does not spend a throttle slot.
    if (!identifier || !eventDate) {
      slot.innerHTML = outcomeHtml("incomplete");
      return;
    }

    const restoreBtn = setButtonBusy(btn, "Looking…");
    slot.innerHTML = "";

    try {
      const res = await fetch("/api/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, eventDate }),
      });
      const data = await res.json().catch(() => ({}));

      slot.innerHTML = outcomeHtml("result", data);
    } catch {
      // Deliberately different wording from a miss: this one IS worth
      // retrying, and telling someone their booking cannot be found when the
      // network dropped would send them to ring the kitchen for nothing.
      slot.innerHTML = outcomeHtml("unreachable");
    } finally {
      restoreBtn();
    }
  });
}
