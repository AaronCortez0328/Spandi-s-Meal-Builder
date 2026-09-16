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

/** "2026-09-30" as "30 September". Plain, and never a countdown. */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return "";
  const months = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
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

  const known    = money.balance !== null;
  const settled  = known && money.balance === 0;
  const started  = known && money.paid > 0;

  // Derived from the figures rather than read from GoHighLevel's own
  // payment_status, so the badge can never contradict the numbers beneath
  // it. That field is typed by hand and drifts; a chip reading "Fully Paid"
  // above a balance of PHP 32,125 is worse than no chip at all. The typed
  // value is used only when there is nothing to work out.
  const chip = known
    ? (settled ? "Paid in full" : started ? "Partly paid" : "Unpaid")
    : (status || null);

  const rows = [["Order total", peso(money.total)]];
  if (known) rows.push(["Total paid", peso(money.paid)]);

  return `
    <div class="os-pay${settled ? " is-settled" : ""}">
      <div class="os-pay__top">
        <p class="booking-caption os-pay__cap">Payment</p>
        ${chip ? `<span class="os-pay__chip">${esc(chip)}</span>` : ""}
      </div>
      ${rows.map(([k, v]) => `
        <div class="os-pay__row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>
      `).join("")}
      ${known ? `
        <div class="os-pay__total">
          <span>${settled ? "Balance" : "Balance due"}</span>
          <strong>${esc(peso(money.balance))}</strong>
        </div>` : `
        <div class="os-pay__row os-pay__row--note">
          <span>Total paid</span><strong>Not recorded yet</strong>
        </div>`}
      ${settled ? `
        <p class="os-pay__done">Nothing more to send &mdash; we have your payment in full.</p>
      ` : `
        ${!started && money.reserve ? `
          <p class="os-pay__note">Pay in full, or reserve with 50% &mdash;
            <strong>${esc(peso(money.reserve))}</strong></p>` : ""}
      `}
    </div>
  `;
}

/**
 * The things a customer can DO with this booking, above the things they can
 * read about it.
 *
 * Pay now used to live inside the payment panel, next to the figure it
 * refers to, which is the better argument on its own. It sits here instead
 * because the second action cannot: "Change this order" belongs to the whole
 * booking rather than to its money, and burying it under a dark payment
 * block is how a feature gets built and never found.
 *
 * The figures stay directly beneath, so nothing is far from what it means.
 *
 * Change and Add are not built. They wait on the shape of
 * order_change_requests being agreed with the dashboard team — both halves
 * write to that table, so guessing it means rebuilding. When they arrive they
 * join this row and nothing else moves.
 */
function actionsHtml(data) {
  const settled = data.money && data.money.balance === 0;
  const out = [];

  if (data.payUrl && !settled) {
    out.push(`<a class="os-action os-action--go" href="${esc(data.payUrl)}"
       target="_blank" rel="noopener noreferrer">Pay now</a>`);
  }

  // Nothing offered while a request is already waiting. A second one gives
  // an admin two answers to the same question, and the database refuses it
  // anyway — better not to offer than to offer and then explain.
  const waiting = data.request?.status === "pending";

  if (!waiting && data.canChange && (data.sizes ?? []).length > 1) {
    out.push(`<button type="button" class="os-action os-action--quiet" id="os-change">Change this order</button>`);
  }
  if (!waiting && data.canAdd && (data.addable ?? []).length > 0) {
    out.push(`<button type="button" class="os-action os-action--quiet" id="os-add">Add to this order</button>`);
  }

  if (out.length === 0) return "";
  return `<div class="os-actions">${out.join("")}</div>`;
}

/**
 * The sizes this booking could move to.
 *
 * Every option shows what it costs, because the whole question a customer is
 * asking is "what would that come to". The one they are on is shown too, and
 * marked, so the change is a comparison rather than a leap.
 *
 * No price is sent back with the choice — only the id. The dashboard prices
 * from the catalogue when they apply it, because a figure proposed by a
 * browser is exactly what server-side validation exists to refuse.
 */
export function sizesHtml(data, hidden = false) {
  const sizes = data.sizes ?? [];
  const current = String(data.paxCount ?? "").trim();

  const rows = sizes.map((s) => {
    const isNow = current && s.paxLabel && current.startsWith(s.paxLabel);
    return `
      <button type="button" class="os-size${isNow ? " is-current" : ""}"
        data-package-id="${esc(s.packageId)}"${isNow ? " disabled" : ""}>
        <span class="os-size__pax">${esc(s.paxLabel ?? "")}</span>
        <span class="os-size__price">${esc(peso(s.price))}</span>
        ${isNow ? `<span class="os-size__now">Your booking</span>` : ""}
      </button>
    `;
  }).join("");

  return `
    <div class="os-change" id="os-change-panel"${hidden ? " hidden" : ""}>
      <p class="booking-caption">Change the size</p>
      <p class="os-change__lead">
        Pick the size you need. We&rsquo;ll confirm it with you before anything changes.
      </p>
      <div class="os-sizes">${rows}</div>
      <p class="os-change__foot">
        Nothing changes until we confirm it.
        ${data.changeClosesOn ? `You can change this until ${esc(longDate(data.changeClosesOn))}.` : ""}
      </p>
      <div class="btn-row"><button type="button" class="os-action os-action--quiet" id="os-change-cancel">Never mind</button></div>
    </div>
  `;
}

/**
 * More of what is already on the order.
 *
 * Their own package's dishes, not the whole menu. A status page is not the
 * builder, and the case this exists for is "we need another tray of the
 * pancit" — always something already there.
 *
 * No prices. Unlike a size change, where swapping to a known row has a known
 * total, an addition is priced by the kitchen against what it costs them to
 * make — so quoting a figure here would be inventing one. The panel says so
 * rather than leaving a customer to assume it is free.
 */
export function addHtml(data, hidden = false) {
  const rows = (data.addable ?? []).map((d, i) => `
    <div class="os-add-row">
      <label class="os-add-row__name" for="os-add-${i}">
        ${esc(d.name)}
        <span class="os-add-row__tray">${esc(d.traySize)}</span>
      </label>
      <input class="os-add-row__qty" id="os-add-${i}" type="number"
        min="0" max="${MAX_ADD_QTY}" step="1" value="0" inputmode="numeric"
        data-dish-id="${esc(d.dishId)}" data-tray-size="${esc(d.traySize)}"
        aria-label="Extra trays of ${esc(d.name)}">
    </div>
  `).join("");

  return `
    <div class="os-change" id="os-add-panel"${hidden ? " hidden" : ""}>
      <p class="booking-caption">Add to this order</p>
      <p class="os-change__lead">
        How many extra trays would you like? We&rsquo;ll confirm the price with
        you before anything changes.
      </p>
      <div class="os-add-rows">${rows}</div>
      <p class="os-change__foot">
        Nothing changes until we confirm it.
        ${data.addClosesOn ? `You can add to this until ${esc(longDate(data.addClosesOn))}.` : ""}
      </p>
      <div class="btn-row">
        <button type="button" class="os-action os-action--go" id="os-add-send">Send request</button>
        <button type="button" class="os-action os-action--quiet" id="os-add-cancel">Never mind</button>
      </div>
    </div>
  `;
}

/**
 * Why a customer cannot change this booking, when they cannot.
 *
 * A missing button raises a question nobody is there to answer, and a greyed
 * one raises it louder. So the row is replaced by a sentence that says what
 * happened and who to talk to.
 *
 * Only shown once there is a reason. An order that can still be changed says
 * nothing about locks at all.
 */
function lockNoteHtml(data) {
  if (data.request?.status === "pending") return "";
  if (data.canChange || data.canAdd) return "";
  if (data.offTimeline) return "";

  return `
    <p class="os-locknote">
      This booking is now too close to the event to change here.
      Message us and we&rsquo;ll see what we can do.
    </p>
  `;
}

/**
 * A request they have already made.
 *
 * The most important line in it is that NOTHING HAS CHANGED YET. A customer
 * who believes a change is already done stops chasing it, and turns up
 * expecting food for a hundred people.
 */
function requestHtml(request) {
  if (!request || !request.status) return "";

  const what = request.kind === "add"
    ? "more items on this order"
    : "a different size for this order";

  if (request.status === "pending") {
    return `
      <div class="os-req">
        <p class="os-req__head">We have your request</p>
        <p class="os-req__body">
          You asked for ${esc(what)}. We&rsquo;ll confirm it with you shortly.
          <strong>Nothing has changed yet</strong> &mdash; your booking is still
          exactly as shown below until we confirm.
        </p>
      </div>
    `;
  }

  if (request.status === "approved") {
    return `
      <div class="os-req os-req--done">
        <p class="os-req__head">Your change is in</p>
        <p class="os-req__body">The booking below is the updated one.</p>
      </div>
    `;
  }

  if (request.status === "declined") {
    return `
      <div class="os-req os-req--no">
        <p class="os-req__head">We could not make that change</p>
        <p class="os-req__body">
          ${request.note ? esc(request.note) : "Message us and we&rsquo;ll find another way."}
          Your booking is unchanged.
        </p>
      </div>
    `;
  }
  return "";
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
    ${requestHtml(data.request)}
    ${actionsHtml(data)}
    ${lockNoteHtml(data)}
    ${data.canChange && (data.sizes ?? []).length > 1 && data.request?.status !== "pending"
      ? sizesHtml(data, true)
      : ""}
    ${data.canAdd && (data.addable ?? []).length > 0 && data.request?.status !== "pending"
      ? addHtml(data, true)
      : ""}
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

/**
 * The rows a customer actually asked for, in the shape the dashboard agreed.
 *
 * Zeroes are dropped rather than sent. A request listing every dish in the
 * package with six of them at zero is one an admin has to read twice to see
 * what was actually wanted.
 *
 * Exported because this is the part with a rule in it — the panel around it
 * is markup, this decides what leaves the browser.
 */
/** Matches the max on the input, and the server refuses anything above 99. */
export const MAX_ADD_QTY = 20;

export function collectAddItems(inputs) {
  const items = [];
  for (const el of inputs ?? []) {
    const qty = Number(el.value);
    // Number("") is 0, which is the same as not asking — so an emptied box
    // is simply left out rather than refused.
    //
    // The ceiling matters as much as the floor: a number input accepts
    // "1e3", and Number("1e3") is 1000 — a perfectly valid integer and a
    // thousand trays. The server refuses it too, but a request that has to
    // be refused should never have left the browser.
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ADD_QTY) continue;
    items.push({
      dish_id: el.getAttribute("data-dish-id"),
      tray_size: el.getAttribute("data-tray-size"),
      quantity: qty,
    });
  }
  return items;
}

/**
 * Sending the request, and re-drawing the order around the answer.
 *
 * Delegated from the result container rather than bound to each button,
 * because the result is replaced wholesale on every lookup and on every
 * change — handlers bound to the old markup would be pointing at nodes that
 * left the document.
 *
 * Every failure is answered in the panel the customer is looking at. There
 * is no path here that leaves them staring at a button that did nothing.
 */
function wireActions(slot, getCreds, redraw) {
  slot.addEventListener("click", async (e) => {
    const add     = e.target.closest("#os-add");
    const addSend = e.target.closest("#os-add-send");
    const addStop = e.target.closest("#os-add-cancel");
    const change = e.target.closest("#os-change");
    const cancel = e.target.closest("#os-change-cancel");
    const size   = e.target.closest("[data-package-id]");

    if (change) {
      slot.querySelector("#os-change-panel")?.removeAttribute("hidden");
      slot.querySelector("#os-change-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (cancel) {
      slot.querySelector("#os-change-panel")?.setAttribute("hidden", "");
      return;
    }
    if (add) {
      const panel = slot.querySelector("#os-add-panel");
      panel?.removeAttribute("hidden");
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (addStop) {
      slot.querySelector("#os-add-panel")?.setAttribute("hidden", "");
      return;
    }
    if (addSend) {
      const panel = slot.querySelector("#os-add-panel");
      const items = collectAddItems(panel?.querySelectorAll("[data-dish-id]") ?? []);

      // Asked for here rather than refused by the server, so somebody who
      // opened the panel and changed their mind is told plainly instead of
      // getting a validation error for a request they did not make.
      if (items.length === 0) {
        say(panel, "Choose how many extra trays you would like first.");
        return;
      }
      await send(addSend, panel, { kind: "add", after: { items } });
      return;
    }
    if (!size) return;

    await send(size, slot.querySelector("#os-change-panel"), {
      kind: "change",
      after: { package_id: size.getAttribute("data-package-id") },
    });
  });

  /** One message in one place, so a panel never ends up saying two things. */
  function say(panel, text) {
    if (!panel) return;
    panel.querySelector(".os-miss")?.remove();
    panel.insertAdjacentHTML("beforeend", `<p class="os-miss">${esc(text)}</p>`);
  }

  async function send(button, panel, body) {
    const restore = setButtonBusy(button, "Sending…");
    panel?.querySelector(".os-miss")?.remove();

    try {
      const res = await fetch("/api/request-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getCreds(), ...body }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.ok) {
        // Re-read rather than patching the screen by hand. The server is
        // the only thing that knows the request landed, and a hand-drawn
        // "sent" that disagrees with a reload is worse than a second.
        await redraw();
        return;
      }
      say(panel, data.message ?? "We could not send that. Please try again.");
    } catch {
      say(panel, "Couldn't reach us just now. Please check your connection and try again.");
    } finally {
      restore();
    }
  }
}

export function mountOrderStatus(container) {
  container.innerHTML = formHtml();

  const form = container.querySelector("#os-form");
  const slot = container.querySelector("#os-result");
  const btn  = container.querySelector("#os-submit");
  const card = container.querySelector(".os-card");

  // Kept so a change request can prove who it is exactly as the lookup did.
  // It is the same gate on purpose: this must not be a softer way in than
  // the page that already shows the booking.
  let creds = null;

  /** One path for the first lookup and for every redraw after a change. */
  async function lookup() {
    const identifier = container.querySelector("#os-identifier").value.trim();
    const eventDate  = container.querySelector("#os-date").value;

    if (!identifier || !eventDate) {
      slot.innerHTML = outcomeHtml("incomplete");
      card?.classList.remove("has-result");
      return;
    }

    const restore = setButtonBusy(btn, "Looking…");
    slot.innerHTML = "";

    try {
      const res = await fetch("/api/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, eventDate }),
      });
      const data = await res.json().catch(() => ({}));

      slot.innerHTML = outcomeHtml("result", data);
      creds = data.found ? { identifier, eventDate } : null;
      // Only a found order is two columns wide; a miss is one sentence and
      // looks stranded in a card built for a desktop.
      card?.classList.toggle("has-result", Boolean(data.found));
    } catch {
      // Deliberately different wording from a miss: this one IS worth
      // retrying, and telling someone their booking cannot be found when the
      // network dropped would send them to ring the kitchen for nothing.
      slot.innerHTML = outcomeHtml("unreachable");
      card?.classList.remove("has-result");
    } finally {
      restore();
    }
  }

  // Bound once, to the container that survives every redraw. Binding to the
  // buttons themselves would leave handlers on nodes that have left the
  // document the moment a result is replaced.
  wireActions(slot, () => creds, lookup);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    lookup();
  });
}
