import { setButtonBusy } from "./button-busy.js";
import { startChange } from "../domain/change-session.js";

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
        ${payUrl ? `
          <a class="primary-button os-pay__go" href="${esc(payUrl)}"
             target="_blank" rel="noopener noreferrer">Pay now</a>` : ""}
      `}
    </div>
  `;
}

/**
 * The things a customer can DO with this booking, above the things they can
 * read about it.
 *
 * ── Pay now is NOT here, and was ──────────────────────────────────────────
 *
 * It sat in this row for one deploy, on the argument that the row would
 * otherwise hold a single button while Change and Add were unbuilt. That
 * reason expired the moment they shipped, and it was never the better
 * argument: a button that moves money belongs beside the figure it is
 * moving, so a customer reads "Balance due PHP 13,500" and finds the way to
 * settle it in the same glance rather than scrolling back up to a row that
 * says nothing about money.
 *
 * So this row is now what its name says — the two things that change the
 * ORDER. Pay now lives in paymentHtml, against the balance.
 */
function actionsHtml(data) {
  const out = [];

  // Nothing offered while a request is already waiting. A second one gives
  // an admin two answers to the same question, and the database refuses it
  // anyway — better not to offer than to offer and then explain.
  const waiting = data.request?.status === "pending";

  if (!waiting && data.canChange) {
    out.push(`<button type="button" class="secondary-button" id="os-change">Change this order</button>`);
  }
  if (!waiting && data.canAdd) {
    out.push(`<button type="button" class="secondary-button" id="os-add">Add to this order</button>`);
  }

  if (out.length === 0) return "";
  return `<div class="os-actions">${out.join("")}</div>`;
}

/**
 * Asked before anything moves, because leaving this page for the builder is
 * the moment a customer needs to know what they are agreeing to.
 *
 * The builder looks exactly like ordering, so somebody who arrives there
 * without being told why will reasonably believe they are placing a second
 * order. This is the sentence that prevents it, and it is repeated in the
 * banner once they are there.
 */
export function confirmHtml(kind, data, hidden = false) {
  const changing = kind === "change";
  const what = [data.packageName, data.paxCount].filter(Boolean).join(" · ");

  // Three short steps rather than three sentences.
  //
  // What a customer needs from this panel is an answer to "what happens if
  // I press that button" — and the honest answer has three parts, in order.
  // As prose it was a paragraph nobody finishes; numbered, it is read at a
  // glance and by anybody, which is the point. The last step is the one
  // that matters and it is last on purpose: it is what they are still
  // holding onto while they decide.
  const steps = changing
    ? ["You build the order you want.",
       "We check it with you.",
       "Nothing changes until you say yes."]
    : ["You choose what to add.",
       "We check it with you.",
       "Your booking stays exactly as it is until then."];

  return `
    <div class="os-change" id="os-confirm-${esc(kind)}"${hidden ? " hidden" : ""}>
      <p class="booking-caption">${changing ? "Change your booking" : "Add to your booking"}</p>
      <h3 class="os-change__title">Here&rsquo;s what happens next</h3>
      <ol class="os-change__steps">
        ${steps.map((t) => `<li>${t}</li>`).join("")}
      </ol>
      ${what ? `
        <p class="os-change__now">
          <span>Right now</span><strong>${esc(what)}</strong>
        </p>` : ""}
      <div class="btn-row">
        <button type="button" class="primary-button" data-start="${esc(kind)}">
          ${changing ? "Build my new order" : "Choose what to add"}
        </button>
        <button type="button" class="text-button" data-cancel="${esc(kind)}">Never mind</button>
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
    ${data.canChange && data.request?.status !== "pending" ? confirmHtml("change", data, true) : ""}
    ${data.canAdd && data.request?.status !== "pending" ? confirmHtml("add", data, true) : ""}
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

/**
 * The booking, reduced to what the builder needs to show a change against it.
 *
 * Taken here rather than fetched again on the other page, and that is the
 * whole point: this screen has the looked-up order in its hand at the moment
 * the customer presses "Build my new order". A second lookup from the builder
 * would be a second round trip, a second failure mode, and a race against a
 * cart the customer may already be filling.
 *
 * ── What travels, and why it is allowed to ────────────────────────────────
 *
 * Money does. It is already on the screen the customer is looking at, they
 * got here by proving who they are, and it goes into sessionStorage on their
 * own device and dies with the tab. It is never sent anywhere: the request
 * the builder files carries no prices at all, by design — the server prices
 * it. This is a display snapshot so the review screen can say "was 35,000"
 * instead of "was something".
 *
 * Trimmed to three fields per line. The full groups carry every dish in
 * every tray, and there is a storage quota at the other end.
 */
export function bookingSnapshot(data) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  const lines = groups.length > 0
    ? groups.map((g) => ({
        title: g?.qty > 1 ? `${g.qty}× ${g?.title ?? ""}`.trim() : (g?.title ?? ""),
        units: g?.units ?? null,
        total: typeof g?.total === "number" ? g.total : null,
        // What is actually in it. Dropped once for fear of the storage
        // quota, which was the wrong worry — this is one booking's dish
        // list, a few hundred bytes, against a five-megabyte budget. The
        // right worry is the customer: somebody swapping one package for
        // another is comparing what is IN them, and a screen showing two
        // names and two prices is asking them to do that from memory.
        // Capped so a pathological order cannot fill the tab's storage.
        contents: Array.isArray(g?.contents) ? g.contents.slice(0, 40) : [],
      })).filter((l) => l.title)
    // Anything booked before order_groups existed has no lines to list, and
    // that is most of them. One row from the flat fields is honest and still
    // gives the customer something to recognise.
    : [{
        title: data?.packageName ?? "",
        units: data?.paxCount ?? null,
        total: typeof data?.money?.total === "number" ? data.money.total : null,
      }].filter((l) => l.title);

  return {
    packageId: data?.packageId ?? null,
    was: {
      lines,
      total:   data?.money?.total   ?? null,
      paid:    data?.money?.paid    ?? null,
      balance: data?.money?.balance ?? null,
    },
  };
}

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
function wireActions(slot, getCreds, goToBuilder) {
  slot.addEventListener("click", (e) => {
    const open   = e.target.closest("#os-change, #os-add");
    const cancel = e.target.closest("[data-cancel]");
    const start  = e.target.closest("[data-start]");

    if (open) {
      const kind = open.id === "os-add" ? "add" : "change";
      const panel = slot.querySelector(`#os-confirm-${kind}`);
      panel?.removeAttribute("hidden");
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    if (cancel) {
      slot.querySelector(`#os-confirm-${cancel.getAttribute("data-cancel")}`)
        ?.setAttribute("hidden", "");
      return;
    }

    if (!start) return;

    const kind = start.getAttribute("data-start");
    const panel = slot.querySelector(`#os-confirm-${kind}`);
    const creds = getCreds();
    if (!creds) return;

    // Storage can be unavailable — Safari in private mode, some in-app
    // browsers. Saying so beats navigating to a builder that will not know
    // why they are there and will read as a second order.
    const ok = startChange({ ...creds, kind });
    if (!ok) {
      say(panel, "We can't open that in this browser. Message us and we'll make the change for you.");
      return;
    }
    goToBuilder();
  });

  /** One message in one place, so a panel never says two things at once. */
  function say(panel, text) {
    if (!panel) return;
    panel.querySelector(".os-miss")?.remove();
    panel.insertAdjacentHTML("beforeend", `<p class="os-miss">${esc(text)}</p>`);
  }
}

export function mountOrderStatus(container) {
  container.innerHTML = formHtml();

  const form = container.querySelector("#os-form");
  const slot = container.querySelector("#os-result");
  const btn  = container.querySelector("#os-submit");
  const card = container.querySelector(".os-card");

  // Kept so a change can prove who it is exactly as the lookup did. It is the
  // same gate on purpose: this must not be a softer way in than the page that
  // already shows the booking.
  let creds = null;

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
      // The snapshot rides with the credentials because both are needed at
      // exactly the same moment — when startChange writes the session — and
      // both are only ever true of an order that was actually found.
      creds = data.found ? { identifier, eventDate, ...bookingSnapshot(data) } : null;
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
  wireActions(slot, () => creds, () => {
    // The builder is a different page on the GoHighLevel site, and this runs
    // inside an iframe — so the parent does the navigating. It already knows
    // where the builder is in both preview and production, and that knowledge
    // should not be copied in here.
    window.parent?.postMessage({ type: "spandis-go-builder" }, "*");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    lookup();
  });
}
