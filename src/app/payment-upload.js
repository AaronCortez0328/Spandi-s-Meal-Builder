/**
 * Standalone "upload proof of payment" view.
 * Mounted instead of the full estimator when the URL has a ?pay=<token> param
 * (see src/main.js). Renders a read-only booking summary fetched from the
 * token, static payment instructions, and a file upload.
 */

import { supabase } from "../data/supabase-client.js";
import { setButtonBusy } from "./button-busy.js";

/**
 * Two per submission, and three submissions — the client's rule.
 *
 * Deliberately tight. A receipt is one screenshot, occasionally two when a
 * bank splits the reference and the amount across screens. Five invited a
 * camera roll, and every extra file is another thing somebody has to open
 * and read before a booking can be marked paid.
 *
 * The server holds the same number. This one only saves a customer the
 * round trip.
 */
const MAX_FILES = 2;

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * SHA-256 of a file's bytes as hex, or null when it cannot be computed.
 *
 * Sent with the upload request so the server can recognise a receipt this
 * booking already holds and refuse to spend one of three submissions on it.
 *
 * Null is a perfectly good answer. crypto.subtle exists only in a secure
 * context and is absent on some older browsers, and reading a large file can
 * fail on a phone that is short of memory. In every one of those cases the
 * upload proceeds without a hash — being unable to fingerprint a screenshot
 * must never stop somebody paying us.
 */
async function fileHash(file) {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * A stored timestamp as the customer should read it — "8 September, 2:14 PM".
 *
 * Fixed to Manila rather than the device's own zone, so the time she is shown
 * is the time the kitchen and the dashboard see. A customer travelling, or a
 * phone with its clock set wrong, would otherwise be told her receipt arrived
 * at an hour nobody else recognises.
 */
export function whenReceived(iso) {
  // Type-checked before parsing, not just NaN-checked afterwards. `new
  // Date(null)` is not an invalid date — it is the epoch, so a missing
  // timestamp would sail through and tell a customer her receipt arrived on
  // 1 January 1970.
  if (typeof iso !== "string" || iso === "") return null;

  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
  });
}

/**
 * What we already hold, shown before the upload form.
 *
 * The whole reason this exists: the page used to have no memory. A customer
 * who sent her deposit receipt, closed the tab and came back to check was
 * shown an empty form, so she sent the same receipt again and spent a second
 * of her three submissions on it. This answers the question she returned to
 * ask, in the first thing she reads.
 *
 * Built from the existing summary classes rather than new ones — it is the
 * same kind of object as the booking summary directly below it, and should
 * not look like a different species.
 */
export function renderHistory(submissions) {
  if (!Array.isArray(submissions) || submissions.length === 0) return "";

  const rows = submissions.map((entry) => {
    const when = whenReceived(entry?.submittedAt) ?? "Received";
    // `state` is null unless the dashboard has actually reviewed it — see
    // priorSubmissions() in api/payment-link-info.js. "We're checking it" is
    // true whether a human has looked yet or not, so an unreviewed receipt
    // says something honest rather than nothing.
    const label = entry?.state === "verified"
      ? "Confirmed"
      : entry?.state === "rejected"
        ? "Please send another"
        : "We&rsquo;re checking it";
    // What the reviewer actually recorded, which is the question behind
    // "did you get my payment" — not whether something arrived, but whether
    // the right figure was written down. Absent until somebody has reviewed
    // it, and on rows reviewed before the dashboard kept this column.
    const amount = Number.isFinite(Number(entry?.amount)) && entry?.amount !== null
      ? formatPeso(Number(entry.amount))
      : null;

    return `
      <div class="success-summary__row pop-receipt">
        <span>${esc(when)}</span>
        ${amount ? `<span class="pop-receipt__amount">${esc(amount)}</span>` : ""}
        <strong>${label}</strong>
      </div>
    `;
  }).join("");

  return `
    <p class="booking-caption">Receipts we&rsquo;ve received</p>
    <div class="success-summary">${rows}</div>
  `;
}

function renderError(container, message) {
  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-text">
          <h2>Link unavailable</h2>
          <p>${esc(message)}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * @param {number|null} attemptsRemaining  how many more submissions this
 *   link still allows. Told to her here because it is only relevant right
 *   after she has just used one — not worth a permanent line on the form.
 */
function renderSuccess(container, attemptsRemaining) {
  clearInterval(countdownTimer);

  const followUp = attemptsRemaining > 0
    ? `<p>Still have a balance to pay? You can reopen this same link later — you have ${attemptsRemaining} more submission${attemptsRemaining === 1 ? "" : "s"} available.</p>`
    : `<p>This was the final submission this link allows. If you still owe a balance, please contact us directly.</p>`;

  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>Proof of Payment Received!</h2>
          <p>Spandi's team will verify your payment and confirm shortly.</p>
          ${followUp}
        </div>
      </div>
    </div>
  `;
}

/** Shown when a link has used every submission it allows — not an error. */
/**
 * What a link with no submissions left should say — three states, not two.
 *
 * "Used up" means three receipts have been sent. It does not mean the
 * booking is paid, and it does not mean we KNOW whether it is paid. The
 * difference between those last two is the whole of this bug.
 *
 * The guard was `owes = balance > 0`, with everything else falling into
 * "fully settled on our side". So a customer whose balance we could not read
 * was told she owed nothing — a booking of PHP 35,000 with PHP 17,500 paid,
 * shown the settled screen, because the live read came back empty and an
 * absence was treated as a zero.
 *
 * orderMoney's own rule is "unknown stays unknown", written to stop the
 * opposite mistake: telling somebody who has paid that they owe it all. This
 * is that rule applied in the direction that costs money — never claim a
 * settlement we cannot see.
 *
 * Pure and exported so the three states can be tested without a browser.
 * The version that shipped had a comment describing the right behaviour
 * above code that did not do it, and nothing failed.
 */
export function finishedCopy(money, total) {
  const known   = money && money.balance !== null && money.balance !== undefined;
  const settled = known && money.balance === 0;
  const owes    = known && money.balance > 0;

  if (settled) {
    return {
      heading: "All payments received",
      body: `${total ? `Your booking (${esc(total)}) is` : "This booking is"} ` +
            "fully settled on our side. If you believe this is a mistake, " +
            "please contact us directly.",
    };
  }

  if (owes) {
    return {
      heading: "Receipts received",
      body: "We have every receipt this link can take. There is still " +
            `${esc(formatPeso(money.balance))} outstanding on your booking ` +
            "&mdash; message us and we will sort it out with you.",
    };
  }

  // Unknown. The wording the API already uses when it refuses a fourth
  // upload: true either way, and it points at a person.
  return {
    heading: "Receipts received",
    body: "We have every receipt this link can take. Please contact us if " +
          "you still owe a balance on this booking.",
  };
}

function renderFinished(container, orderSummary, money) {
  clearInterval(countdownTimer);
  const { heading, body } = finishedCopy(money, orderSummary?.Total);

  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>${heading}</h2>
          <p>${body}</p>
        </div>
      </div>
    </div>
  `;
}

function renderPaymentInfo(paymentInfo, contactName) {
  if (!paymentInfo) {
    return `
      <div class="contact-booking-note">
        Please send your down payment via <strong>GCash</strong> or <strong>Bank Transfer</strong> using the details Spandi's team sent you, then upload your receipt below.
      </div>
    `;
  }

  const { gcash_number, gcash_name, bank_name, bank_account_name, bank_account_number, qrUrl } = paymentInfo;

  const gcashRow = gcash_number ? `
    <div class="pay-method">
      <span class="pay-method__label">GCash</span>
      <span class="pay-method__value">
        <strong>${esc(gcash_number)}</strong>
        ${gcash_name ? `<small>${esc(gcash_name)}</small>` : ""}
      </span>
    </div>
  ` : "";

  const bankRow = bank_account_number ? `
    <div class="pay-method">
      <span class="pay-method__label">Bank Transfer</span>
      <span class="pay-method__value">
        <strong>${esc(bank_name)} — ${esc(bank_account_number)}</strong>
        ${bank_account_name ? `<small>${esc(bank_account_name)}</small>` : ""}
      </span>
    </div>
  ` : "";

  const referenceRow = contactName ? `
    <div class="pay-method">
      <span class="pay-method__label">Reference</span>
      <span class="pay-method__value">
        <strong>${esc(contactName)}</strong>
        <small>Please note this name when you send payment</small>
      </span>
    </div>
  ` : "";

  return `
    <div class="pay-info">
      <div class="pay-info__head">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        Where to send your down payment
      </div>
      <div class="pay-info__body">
        ${gcashRow}
        ${bankRow}
        ${referenceRow}
        ${qrUrl ? `
          <a href="${esc(qrUrl)}" target="_blank" rel="noopener noreferrer">
            <img class="pay-qr" src="${esc(qrUrl)}" alt="Payment QR code — tap to view full size" />
          </a>
        ` : ""}
      </div>
    </div>
  `;
}

let countdownTimer = null;

/**
 * Ticks this visit's window down to zero.
 *
 * Seeded from a server-computed seconds value rather than an expiry
 * timestamp, so counting down locally can't be skewed by a wrong device
 * clock. Purely informational — both upload endpoints re-validate
 * expires_at server-side.
 *
 * Reaching zero is no longer the end of the link: reopening the page grants
 * a fresh 15 minutes (payment-link-info.js resets the window on every
 * open), so this offers a reload rather than telling her to ask for a new
 * link, which she no longer needs.
 */
function startCountdown(container, token, secondsRemaining) {
  clearInterval(countdownTimer);

  const el = container.querySelector("#pop-expiry");
  if (!el || typeof secondsRemaining !== "number") return;

  let remaining = Math.max(0, secondsRemaining);

  const tick = () => {
    // The form gets replaced wholesale on success/error; stop rather than
    // writing to a node that's no longer in the document.
    if (!el.isConnected) {
      clearInterval(countdownTimer);
      return;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, "0");
    // "Expires" told customers their payment link was about to die. It is
    // not: api/payment-link-info.js re-grants a full fifteen minutes on
    // every single open, forever, and the booking and the price are never
    // touched. What actually happens is that this form locks and they tap
    // once to carry on — so the words say locking rather than losing.
    //
    // Kept rather than removed, because a page that visibly times out reads
    // as a secure one, and a form left open on a shared phone should not
    // stay live.
    el.textContent = remaining > 0
      ? `Secure session · ${minutes}:${seconds}`
      : "Page locked";
    el.classList.toggle("is-urgent", remaining > 0 && remaining <= 120);
    el.classList.toggle("is-expired", remaining === 0);

    if (remaining === 0) {
      clearInterval(countdownTimer);
      const submit = container.querySelector("#pop-submit");
      if (submit) submit.disabled = true;
      const status = container.querySelector("#pop-status");
      if (status) {
        status.innerHTML = `Locked for your security &mdash; nothing has been lost. <button type="button" class="text-button" id="pop-reopen">Tap to continue</button>.`;
        status.querySelector("#pop-reopen")?.addEventListener("click", () => mountPaymentUpload(container, token));
      }
      return;
    }
    remaining -= 1;
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

/** Parses "PHP 14,350" back to 14350 so we can offer the half-deposit. */
function parsePeso(value) {
  const amount = parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function formatPeso(amount) {
  return `PHP ${Math.round(amount).toLocaleString("en-PH")}`;
}

/**
 * What this customer still owes, said only as precisely as we can prove.
 *
 * This block used to print the ORDER TOTAL under the label "Amount due",
 * always, because the endpoint never fetched amount_paid. So a customer who
 * had paid in full was told she owed all of it — directly beneath a receipts
 * list saying "Confirmed". The page contradicted itself on one screen, and
 * that is the likeliest reason people ask whether their payment arrived.
 *
 * Four states, because there genuinely are four:
 *
 *   balance 0            paid in full, nothing to ask for
 *   balance > 0          that figure is what is due
 *   unknown, receipt in  we have something; do not claim a number
 *   unknown, nothing in  the full total, which is this page's old behaviour
 *
 * Understating is the dangerous direction: a customer who is told she owes
 * nothing does not pay, and finds out at her event. So every uncertainty
 * lands on the full total rather than on a guess — a blank amount_paid, a
 * GoHighLevel outage, an unparseable figure.
 *
 * A live example from the data: one booking reads FULLY PAID with
 * amount_paid empty. Number(null) is 0, so a naive subtraction would bill
 * that customer the whole amount with more confidence than before.
 */
/**
 * Which of the four this is. Exported and pure, so the rule can be tested
 * without a browser and cannot drift from what renders below it.
 *
 * 'settled' is the only state that tells a customer to stop paying, which
 * is why every uncertain input has to land somewhere else.
 */
export function amountDueState(total, money, submissions) {
  if (money && money.balance === 0) return "settled";
  if (money && money.balance !== null) return "due";

  // Unreviewed is not proof. Claiming a payment arrived on a screenshot
  // nobody has looked at is a promise we cannot keep.
  const verified = Array.isArray(submissions)
    && submissions.some((x) => x?.state === "verified");
  if (verified) return "received";

  return total ? "total" : "none";
}

function renderAmountDue(total, money, submissions) {
  const state = amountDueState(total, money, submissions);

  if (state === "settled") {
    return `
      <div class="pop-amount pop-amount--settled">
        <span class="pop-amount__label">Paid in full</span>
        <span class="pop-amount__value">${esc(formatPeso(money.total))}</span>
        <span class="pop-amount__note">Nothing more to send &mdash; we have your payment in full.</span>
      </div>
    `;
  }

  if (state === "due") {
    const part = money.paid > 0
      ? `Received so far &mdash; <strong>${esc(formatPeso(money.paid))}</strong> of ${esc(formatPeso(money.total))}`
      : `Pay in full, or reserve with 50% &mdash; <strong>${esc(formatPeso(money.reserve))}</strong>`;
    return `
      <div class="pop-amount">
        <span class="pop-amount__label">Amount due</span>
        <span class="pop-amount__value">${esc(formatPeso(money.balance))}</span>
        <span class="pop-amount__note">${part}</span>
      </div>
    `;
  }

  // Nobody has recorded a figure, but a receipt has been confirmed. Saying
  // "Amount due <total>" here reads as though it never arrived.
  if (state === "received") {
    return `
      <div class="pop-amount">
        <span class="pop-amount__label">Payment received</span>
        <span class="pop-amount__value">${esc(formatPeso(parsePeso(total) || 0))}</span>
        <span class="pop-amount__note">We&rsquo;re applying it to your booking. Message us if anything looks wrong.</span>
      </div>
    `;
  }

  if (state === "none") return "";
  const amount = parsePeso(total);
  const half = amount
    ? `Pay in full, or reserve with 50% &mdash; <strong>${esc(formatPeso(amount / 2))}</strong>`
    : "";
  return `
    <div class="pop-amount">
      <span class="pop-amount__label">Amount due</span>
      <span class="pop-amount__value">${esc(total)}</span>
      ${half ? `<span class="pop-amount__note">${half}</span>` : ""}
    </div>
  `;
}

function renderForm(container, token, orderSummary, paymentInfo, secondsRemaining, submissions, money) {
  // "Dishes" gets its own section below (multi-line text), not a table row.
  // Name, Email, Phone and Address are destructured out rather than removed
  // from buildOrderSummary, because the stored object is not only a display
  // list — the dashboard reads it. api/_lib/paymentBackfill.js:110 picks
  // customer_name from [contactName, Contact, Name, opportunityName], and on
  // a link minted by the inquiry path only Name is present. Dropping it at
  // the source would quietly blank the customer name on every new payment
  // row in their history, with nothing to say why.
  //
  // They come off the SCREEN because Order Status can now reach this page,
  // and that page is gated on an email and an event date — enough for a
  // booking, not enough to be handed somebody's home address. The customer
  // already knows all four; none of them helps anyone decide whether an
  // amount is right.
  const {
    Dishes: dishes,
    Name: _name, Email: _email, Phone: _phone, Address: _address,
    ...summaryFields
  } = orderSummary ?? {};

  // Someone arriving with receipts already on file is not being asked to do
  // the same thing again — she is either checking, or paying a balance. The
  // page says so, because a form headed "Upload Proof of Payment" reads as
  // something still outstanding and is what prompted a customer to send her
  // deposit receipt twice.
  const hasHistory = Array.isArray(submissions) && submissions.length > 0;

  // Display names only. The KEYS are storage: order_summary is read by the
  // dashboard, and paymentBackfill.js:117 picks the order value out of
  // `Total`. Renaming it in buildOrderSummary would blank order_total on
  // every new payment row in their history — the same trap as Name above.
  // So the label is mapped here and the stored object is untouched.
  const LABELS = { Total: "Order total" };

  const rows = Object.entries(summaryFields)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([label, value]) => `
      <div class="success-summary__row">
        <span>${esc(LABELS[label] ?? label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join("");

  const dishesSection = dishes ? `
    <div class="pop-dishes">
      <p class="booking-caption">Your Dishes</p>
      <div class="pop-dishes__body">${esc(dishes)}</div>
    </div>
  ` : "";

  container.innerHTML = `
    <div class="pop-card">
      <div class="panel-header pop-header">
        <div>
          <p class="section-kicker">Spandi's Food + Catering</p>
          <h2>${hasHistory ? "Send Another Receipt" : "Upload Proof of Payment"}</h2>
        </div>
        <span class="pop-expiry" id="pop-expiry" role="timer" aria-live="off"></span>
      </div>

      <p class="contact-intro">${hasHistory
        ? "We have your receipts below. If you&rsquo;re paying the balance, send another when you&rsquo;re ready &mdash; there&rsquo;s nothing else you need to do right now."
        : "Please review your booking details below, then upload a screenshot or photo of your payment receipt."}</p>

      ${renderHistory(submissions)}

      ${renderAmountDue(summaryFields.Total, money, submissions)}

      <p class="booking-caption">Your Booking</p>
      <div class="success-summary">${rows}</div>

      ${dishesSection}

      ${renderPaymentInfo(paymentInfo, summaryFields.Name)}

      <form id="pop-form" novalidate>
        <div class="form-field">
          <label class="form-field__label" for="pop-file">
            ${hasHistory
              ? "Another receipt"
              : `Proof of Payment <span class="form-field__req" aria-hidden="true">*</span>`}
          </label>

          <label class="pop-upload-well" for="pop-file" id="pop-upload-well">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span id="pop-upload-well-text">Tap to add your receipt &mdash; up to ${MAX_FILES}</span>
          </label>

          <div class="pop-file-list" id="pop-file-list"></div>

          <input type="file" id="pop-file" name="file" class="visually-hidden" accept="image/*,.pdf" multiple />
        </div>
      </form>

      <div class="step-nav">
        <div class="step-nav__cta">
          <button class="primary-button" type="button" id="pop-submit">Submit Proof of Payment</button>
          <p class="status-text" id="pop-status" role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `;

  const fileInput      = container.querySelector("#pop-file");
  const submitBtn      = container.querySelector("#pop-submit");
  const statusEl       = container.querySelector("#pop-status");
  const uploadWell     = container.querySelector("#pop-upload-well");
  const uploadWellText = container.querySelector("#pop-upload-well-text");
  const fileListEl     = container.querySelector("#pop-file-list");

  startCountdown(container, token, secondsRemaining);

  const DOC_ICON = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`;
  const WARN_ICON = `<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`;
  const CHECK_ICON = `<polyline points="20 6 9 17 4 12"/>`;

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Each entry:
  //   { id, file, status, error, path, note, hash }
  //
  //   status  'pending' | 'uploading' | 'done' | 'error' | 'duplicate'
  //   note    why a 'duplicate' is settled — when we first received it
  //   hash    SHA-256 of the bytes, or null when it could not be computed;
  //           undefined until it has been attempted
  let entries = [];

  function renderFileCard(entry) {
    // A duplicate is a settled, successful state rather than a failure — we
    // already hold that receipt. It gets the same tick as an upload that
    // landed, and its note takes the place of the file size, which is the one
    // thing nobody needs to know about a file that is not being sent.
    const settled = entry.status === "done" || entry.status === "duplicate";
    const icon = entry.status === "error" ? WARN_ICON : settled ? CHECK_ICON : DOC_ICON;
    const canRemove = entry.status !== "uploading";

    return `
      <div class="pop-file-card${entry.status === "error" ? " is-error" : ""}${settled ? " is-done" : ""}" data-id="${entry.id}">
        <div class="pop-file-card__row">
          <div class="pop-file-card__main">
            <svg class="pop-file-card__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
            <span class="pop-file-card__info">
              <span class="pop-file-card__name">${esc(entry.file.name)}</span>
              <span class="pop-file-card__size">${esc(
                entry.status === "duplicate" ? entry.note : formatFileSize(entry.file.size)
              )}</span>
            </span>
          </div>
          ${canRemove ? `
            <button type="button" class="pop-file-card__cancel" data-action="remove" data-id="${entry.id}" aria-label="Remove file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          ` : ""}
        </div>
        ${entry.status === "uploading" ? `
          <div class="pop-file-card__bar-track">
            <div class="pop-file-card__bar pop-file-card__bar--indeterminate"></div>
          </div>
        ` : ""}
        ${entry.status === "error" ? `
          <p class="pop-file-card__error">${esc(entry.error)}</p>
          <button type="button" class="text-button pop-file-card__retry" data-action="retry" data-id="${entry.id}">Retry upload</button>
        ` : ""}
      </div>
    `;
  }

  function renderFileList() {
    fileListEl.innerHTML = entries.map(renderFileCard).join("");
    uploadWell.hidden = entries.length >= MAX_FILES;
    uploadWellText.textContent = entries.length > 0
      ? `Add another (${entries.length}/${MAX_FILES})`
      : `Tap to add your receipt &mdash; up to ${MAX_FILES}`;
  }

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // allow re-selecting so change fires again for more files

    for (const file of picked) {
      if (entries.length >= MAX_FILES) {
        statusEl.textContent = `Two files per submission. Remove one to add another.`;
        break;
      }
      const isDuplicate = entries.some((e) => e.file.name === file.name && e.file.size === file.size);
      if (isDuplicate) continue;
      entries.push({ id: crypto.randomUUID(), file, status: "pending", error: null, path: null, note: null });
    }
    renderFileList();
  });

  fileListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === "remove") {
      entries = entries.filter((entry) => entry.id !== id);
      renderFileList();
    } else if (btn.dataset.action === "retry") {
      const entry = entries.find((en) => en.id === id);
      if (entry) {
        entry.status = "pending";
        entry.error = null;
        renderFileList();
        attemptUpload();
      }
    }
  });

  async function uploadEntry(entry, signed) {
    // The server returns one entry per file in the same order, so this should
    // never be missing — but the pairing below is by index, and a mismatch
    // would otherwise upload a file against `undefined`.
    if (!signed) {
      entry.status = "error";
      entry.error = "Couldn't prepare this file. Please remove it and try again.";
      renderFileList();
      return;
    }

    // We already hold this exact receipt for this booking. Nothing to upload
    // and nothing to record: she has done nothing wrong, and spending one of
    // her three submissions on a file we already have is the whole thing this
    // exists to prevent. The bytes never leave her phone either.
    if (signed.duplicate) {
      entry.status = "duplicate";
      const when = whenReceived(signed.submittedAt);
      entry.note = when ? `Already sent ${when}` : "Already sent";
      renderFileList();
      return;
    }

    entry.status = "uploading";
    renderFileList();
    try {
      const { error } = await supabase.storage
        .from("proof-of-payments")
        .uploadToSignedUrl(signed.path, signed.token, entry.file);
      if (error) throw error;
      entry.status = "done";
      entry.path = signed.path;
    } catch (err) {
      entry.status = "error";
      entry.error = err.message || "Upload failed. Please try again.";
    }
    renderFileList();
  }

  async function attemptUpload() {
    if (entries.length === 0) {
      statusEl.textContent = "Please choose at least one file.";
      return;
    }

    // 'duplicate' is settled, like 'done' — re-offering a receipt we already
    // hold would only have it refused again.
    const pending = entries.filter(
      (entry) => entry.status !== "done" && entry.status !== "duplicate"
    );
    if (pending.length > 0) {
      // The button carries the state. A status line underneath said
      // "Uploading…" while the button itself sat there looking untouched,
      // which reads as nothing having happened.
      let restore = setButtonBusy(submitBtn, "Uploading…");
      statusEl.textContent = "";

      try {
        // One at a time, not in parallel: hashing reads the whole file into
        // memory, and five 10 MB files at once is 50 MB on a phone that may
        // not have it to spare. Kept on the entry once attempted, so a retry
        // does not read every file again.
        for (const entry of pending) {
          if (entry.hash === undefined) entry.hash = await fileHash(entry.file);
        }

        const res = await fetch("/api/request-upload-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            files: pending.map((entry) => ({
              name: entry.file.name,
              type: entry.file.type,
              size: entry.file.size,
              // Dropped from the JSON when null. A missing hash means "could
              // not be computed", and the server treats that as "cannot
              // check" and issues a URL — the fail-open path.
              hash: entry.hash ?? undefined,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Couldn't prepare upload (HTTP ${res.status})`);

        // Paired by index: the server returns one entry per file, in the
        // order they were sent. Optional so a malformed response reaches
        // uploadEntry's guard and names the file that failed, rather than
        // throwing on the subscript and blaming the whole batch.
        await Promise.all(pending.map((entry, i) => uploadEntry(entry, data.uploads?.[i])));
      } catch (err) {
        restore();
        statusEl.textContent = err.message || "Couldn't prepare upload. Please try again.";
        return;
      }

      if (entries.some((entry) => entry.status === "error")) {
        restore();
        statusEl.textContent = "Some files failed to upload. Retry or remove them, then submit again.";
        return;
      }

      // Uploads finished; the label changes rather than the button flicking
      // back to idle between two steps of one action.
      restore();
    }

    // Only files that actually reached storage are submitted. A duplicate has
    // nothing to record — the receipt is already on this booking — and its
    // path is null, which would have the server refuse the whole batch.
    const uploaded = entries.filter((entry) => entry.status === "done" && entry.path);

    if (uploaded.length === 0) {
      // Everything she chose, we already hold. That is an answer rather than
      // an error: the thing she came to do is already done. The second
      // sentence is there because an admin does occasionally ask for a
      // receipt to be sent again, and that is the one case where the
      // duplicate check is in her way and she needs a person.
      statusEl.textContent = entries.some((entry) => entry.status === "duplicate")
        ? "We already have these receipts, so there's nothing more to send. Please contact us if you were asked to resend one."
        : "Please choose at least one file.";
      return;
    }

    const restoreSubmit = setButtonBusy(submitBtn, "Submitting…");
    statusEl.textContent = "";

    try {
      const res = await fetch("/api/submit-payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          files: uploaded.map((entry) => ({ path: entry.path, hash: entry.hash ?? undefined })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Submission failed (HTTP ${res.status})`);
      renderSuccess(container, data.attemptsRemaining);
    } catch (err) {
      restoreSubmit();
      statusEl.textContent = err.message || "Submission failed. Please try again.";
    }
  }

  submitBtn.addEventListener("click", attemptUpload);
}

function renderLoadingSkeleton(container) {
  container.innerHTML = `
    <div class="pop-card">
      <div class="skeleton-hero-lines" style="align-items: flex-start;">
        <div class="skeleton-block skeleton-kicker"></div>
        <div class="skeleton-block skeleton-heading"></div>
        <div class="skeleton-block skeleton-subtext"></div>
      </div>
      <div class="pop-skeleton-rows">
        ${Array.from({ length: 5 }, () => `<div class="skeleton-block pop-skeleton-row"></div>`).join("")}
      </div>
    </div>
  `;
}

export async function mountPaymentUpload(container, token) {
  renderLoadingSkeleton(container);

  try {
    const res = await fetch(`/api/payment-link-info?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderError(container, data.error ?? "This link is invalid.");
      return;
    }
    if (data.finished) {
      renderFinished(container, data.orderSummary, data.money);
      return;
    }
    renderForm(
      container, token, data.orderSummary, data.paymentInfo,
      data.secondsRemaining, data.submissions, data.money
    );
  } catch {
    renderError(container, "Couldn't reach the server. Please check your connection and try again.");
  }
}
