import { formatPeso } from "../domain/pricing.js";
import { CHECK_ICON } from "./inquiry-sent.js";
import { wayOutHtml } from "./copy.js";

/**
 * The last screen before a change is sent: what the booking says now, and
 * what the customer is asking it to say instead.
 *
 * This screen replaces the contact form, which has nothing to ask. The
 * customer proved who they are on Order Status minutes ago and the session
 * carries it; the name, number and address are already on the booking. What
 * they have not yet seen is the two orders next to each other, and that is
 * the one thing that stops somebody sending a request they did not mean.
 *
 * ── Two layouts, on purpose ───────────────────────────────────────────────
 *
 * A change is WAS / NOW: the new order stands in place of the old one, so
 * they are shown as alternatives and the difference is signed.
 *
 * An add is YOUR BOOKING / ADDING / NEW TOTAL: nothing is replaced, so the
 * two stack and the difference is simply what is being added.
 *
 * One layout serving both — "here is your order, here is the new one" —
 * would read identically in the case where they mean opposite things, and a
 * customer adding a tray would have no way of telling that they were about
 * to replace a hundred-pax package with it.
 *
 * ── What the money on this screen is, and is not ──────────────────────────
 *
 * It is the figure the builder has been showing all along, next to the
 * figure the booking carries. It is NOT what will be charged: the request
 * travels without prices and is priced from the catalogue when somebody
 * approves it. So every total here is followed by the same sentence, and the
 * sentence is true — we confirm it before anything changes.
 *
 * Nothing here promises money back. A new order worth less than what has
 * already been paid says so and says we will sort it out; whether that is a
 * refund, a credit or neither has not been decided, and a screen is not the
 * place to decide it.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** A money cell, or an em dash where there is no figure to show. */
function cell(total, priceNote) {
  if (priceNote) return esc(priceNote);
  return typeof total === "number" ? esc(formatPeso(total)) : "&mdash;";
}

/**
 * What is inside a line, in front of them.
 *
 * This was a <details>, and the reasoning for it was sound and still wrong:
 * somebody swapping one package for another is comparing what is IN them, so
 * the comparison was put one tap away to keep the screen short. But this is
 * the screen where a customer decides whether to send a change to a caterer,
 * and "10 items" is not something anyone can check. It reads as a label, not
 * a button — several people never opened it — so the decision was being made
 * on two package names and two prices, which is exactly what the disclosure
 * was added to avoid.
 *
 * Open, always. The count stays as a caption because "10 items" against
 * "12 items" is itself a difference worth seeing at a glance, and it keeps
 * the two columns legible when one side is much longer than the other.
 *
 * The cost is honest: a large package makes this screen long. Long and
 * readable beats short and unverifiable when the next tap is irreversible.
 */
function contentsHtml(contents) {
  const items = (contents ?? []).filter(Boolean);
  if (items.length === 0) return "";
  return `
    <div class="chg-review__items">
      <p class="chg-review__items-count">${items.length} item${items.length !== 1 ? "s" : ""}</p>
      <ul>${items.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    </div>`;
}

function rowsHtml(lines, emptyText) {
  const rows = (lines ?? []).filter((l) => l?.title);
  if (rows.length === 0) {
    return `<p class="chg-review__empty">${esc(emptyText)}</p>`;
  }
  return `<ul class="chg-review__lines">${rows.map((l) => `
    <li class="chg-review__line">
      <span class="chg-review__line-name">
        ${esc(l.title)}${l.units ? `<span class="chg-review__units">${esc(l.units)}</span>` : ""}
        ${contentsHtml(l.contents)}
      </span>
      <span class="chg-review__line-value">${cell(l.total, l.priceNote)}</span>
    </li>`).join("")}</ul>`;
}

/**
 * The sentence under the figures. One per case, and none of them states
 * something we do not know.
 */
export function differenceLine(summary) {
  const { kind, difference, direction } = summary ?? {};

  if (kind === "add") {
    return typeof difference === "number" && difference > 0
      ? `${formatPeso(difference)} on top of what you have booked`
      : "We'll confirm what this adds when we come back to you.";
  }

  if (direction === "same") return "The same as your booking is worth now.";
  if (direction === "more") return `${formatPeso(difference)} more than your booking now.`;
  if (direction === "less") return `${formatPeso(Math.abs(difference))} less than your booking now.`;
  // wasTotal unknown — most often a booking with no figure recorded on it.
  return "We'll confirm the difference with you before anything changes.";
}

/**
 * What this means for money already handed over.
 *
 * Returns null when we do not know what has been paid, so the screen drops
 * the line rather than guessing. Telling a customer who reserved weeks ago
 * that they owe the full amount is the worst thing this page could say.
 */
export function paidLine(summary) {
  const { paid, balance, refund, proposed } = summary ?? {};
  if (paid === null || paid === undefined || proposed === null) return null;

  const sofar = `You have paid ${formatPeso(paid)}.`;
  if (typeof refund === "number" && refund > 0) {
    // Deliberately not "we will refund you". See the note at the top.
    return `${sofar} That is more than the new order comes to &mdash; we'll sort the difference out with you.`;
  }
  if (typeof balance === "number" && balance > 0) {
    return `${sofar} That would leave ${formatPeso(balance)} to settle.`;
  }
  return `${sofar} There would be nothing left to settle.`;
}

/**
 * @param {object} opts
 * @param {object} opts.session   the change session, for its kind
 * @param {Array}  opts.was       the booking's lines, from the snapshot
 * @param {Array}  opts.now       the cart's lines
 * @param {object} opts.summary   from changeSummary()
 * @param {string} opts.stepper   the stepper markup for this screen
 */
export function changeReviewHtml({ session, was, now, summary, stepper = "" }) {
  const adding = session?.kind === "add";
  const diff = differenceLine(summary);
  const paid = paidLine(summary);

  const topLabel = adding ? "Your booking" : "Was";
  const topEmpty = adding
    ? "We could not list what is on your booking, but it is still there."
    : "We could not list what is on your booking.";

  return `
    ${stepper}
    <section class="panel chg-review">
      <p class="section-kicker">${adding ? "Check what you are adding" : "Check your change"}</p>
      <h2 class="chg-review__title">
        ${adding ? "Adding to your booking" : "Your new order"}
      </h2>

      <div class="chg-review__side chg-review__side--was">
        <p class="chg-review__label">${esc(topLabel)}</p>
        ${rowsHtml(was, topEmpty)}
      </div>

      <!-- The one mark that says which of the two this is.
           An arrow means the thing below REPLACES the thing above; a plus
           means it joins it. Everything else on this screen can be read
           two ways by somebody skimming — this cannot, and it is the
           difference between amending an order and losing one. -->
      <p class="chg-review__op" aria-hidden="true">${adding ? "+" : "&darr;"}</p>

      <div class="chg-review__side chg-review__side--now">
        <p class="chg-review__label">${adding ? "Adding" : "Now"}</p>
        ${rowsHtml(now, "Nothing chosen yet.")}
      </div>

      <div class="chg-review__sum">
        ${adding && typeof summary?.proposed === "number" ? `
          <div class="chg-review__total">
            <span>New total</span><strong>${esc(formatPeso(summary.proposed))}</strong>
          </div>` : ""}
        <p class="chg-review__diff">${diff}</p>
        ${paid ? `<p class="chg-review__paid">${paid}</p>` : ""}
      </div>

      <p class="chg-review__promise">
        Nothing on your booking changes until we confirm this with you. We'll
        check the final figure against our menu when we do.
      </p>

      <!-- status-text, not form-status. The latter has no rule behind it
           anywhere in the stylesheet, so "We could not send that" would
           have rendered at browser defaults on the one screen where a
           customer most needs to see it. -->
      <p class="status-text" id="order-submit-status" role="status" aria-live="polite"></p>

      <div class="step-nav">
        <button class="text-button" type="button" data-go-review>&larr; Keep building</button>
        <button class="primary-button" type="button" data-order-submit>
          ${adding ? "Send this addition" : "Send this change"}
        </button>
      </div>
    </section>
  `;
}

/**
 * After it has been sent.
 *
 * ── It waits for them ─────────────────────────────────────────────────────
 *
 * This used to be drawn and then navigated away from in the same breath:
 * submitAsChange posted spandis-go-status on success, the site acted on it,
 * and the confirmation was gone before anybody could finish the first line.
 * A customer who has just asked to change their party and sees a flash needs
 * to be told again, and there is nowhere to ask.
 *
 * So nothing moves on its own. The button below does the navigating, when
 * they are ready.
 *
 * Terminal on purpose: the panel it replaces carried a Send button, and one
 * still sitting there behind a line of status text is one a customer presses
 * again. The second press gets "you already have a request with us", which
 * reads as the first one having failed.
 *
 * It also has to stand on its own. Sending posts a message asking the site to
 * take them back to Order Status, and a page that is not listening simply
 * does not — so this is the last thing some customers see.
 */
/**
 * What actually happens now, in the order it happens.
 *
 * Three, and no more. A customer who has just asked to change a party they
 * have already paid towards wants one question answered — "have I broken
 * anything?" — and a longer list reads as a process with more places to go
 * wrong. Written as things WE do, because every one of them is: there is
 * nothing for her to chase.
 */
const CHANGE_STEPS = [
  "We read your request and check it against our menu",
  "We come back to you to confirm the final figure",
  "Only then does anything on your booking move",
];

/**
 * The confirmation after a change or addition is sent.
 *
 * Rebuilt on .inquiry-sent, the success screen every other path in the app
 * already uses. This one had been hand-written as a bare .panel — a kicker,
 * a heading and two paragraphs, left-aligned, with a lone button under a lot
 * of white space. Next to the rest of the system it read as unfinished, and
 * it was: .panel is a no-op class, so it was rendering at browser defaults
 * inside a card that was not there.
 *
 * The reassurance keeps its own class. .chg-sent__lead exists because this
 * line once borrowed .chg-review__diff, which is cream for the charcoal money
 * block — cream on white, so the single sentence a customer most needs after
 * asking to change their party was invisible. Its own colour, on purpose.
 */
export function changeSentHtml(kind) {
  const adding = kind === "add";
  const steps = CHANGE_STEPS.map((step, i) => `
    <li class="inquiry-sent__step">
      <span class="inquiry-sent__step-num">${i + 1}</span>
      <span>${esc(step)}</span>
    </li>
  `).join("");

  return `
    <section class="inquiry-sent chg-sent">
      <div class="inquiry-sent__icon">${CHECK_ICON}</div>

      <h2 class="inquiry-sent__title">
        ${adding ? "We have your addition" : "We have your change"}
      </h2>

      <p class="chg-sent__lead">Nothing on your booking has changed yet.</p>

      <p class="inquiry-sent__lede">
        Your event, your date and anything you have already paid all stay
        exactly as they are until we have spoken to you.
      </p>

      <p class="inquiry-sent__caption inquiry-sent__caption--steps">What happens next</p>
      <ol class="inquiry-sent__steps">${steps}</ol>

      <button class="primary-button" type="button" data-change-done>
        Back to my order
      </button>
      ${wayOutHtml("Need to tell us something else?")}
    </section>
  `;
}
