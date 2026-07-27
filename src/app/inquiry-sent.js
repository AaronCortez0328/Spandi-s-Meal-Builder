import { CONFIRM_WINDOW, DELIVERY_NOTE } from "./copy.js";

/**
 * The confirmation screen shown after an inquiry is submitted.
 *
 * All five builders previously hand-wrote their own near-identical
 * version of this, which is how they drifted apart — two of them were
 * missing the customer's name and branch entirely. One component means a
 * change to what we promise here happens once, and every service says
 * the same thing.
 *
 * Callers pass already-formatted display values; this module does no
 * pricing or business logic of its own.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const CHECK_ICON = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * What the customer can expect next, in the order it actually happens.
 * Stated plainly so nobody is left wondering whether to chase us.
 */
const NEXT_STEPS = [
  "We confirm availability and finalise your quote",
  "A secure payment link arrives by email",
  "We cook fresh on the day — nothing reheated",
];

/**
 * @param {HTMLElement} panel   container to render into
 * @param {object} data
 * @param {string} data.firstName    customer's first name, for the greeting
 * @param {Array<{label: string, value: string}>} data.rows  booking summary
 * @param {string} data.priceLabel   "Package price" or "Total"
 * @param {string} data.priceValue   already formatted, e.g. "PHP 14,350"
 */
export function renderInquirySent(panel, { firstName, rows, priceLabel, priceValue }) {
  const summaryRows = rows
    .filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== "")
    .map((row) => `
      <div class="inquiry-sent__row">
        <span>${esc(row.label)}</span>
        <strong>${esc(row.value)}</strong>
      </div>
    `).join("");

  const steps = NEXT_STEPS.map((step, i) => `
    <li class="inquiry-sent__step">
      <span class="inquiry-sent__step-num">${i + 1}</span>
      <span>${esc(step)}</span>
    </li>
  `).join("");

  const greeting = firstName
    ? `We&rsquo;ve got it, ${esc(firstName)}.`
    : `We&rsquo;ve got it.`;

  panel.innerHTML = `
    <div class="inquiry-sent">
      <div class="inquiry-sent__icon">${CHECK_ICON}</div>

      <h2 class="inquiry-sent__title">${greeting}</h2>
      <p class="inquiry-sent__lede">
        We&rsquo;ll confirm availability and your final quote
        <strong>${esc(CONFIRM_WINDOW)}</strong>.
      </p>

      <div class="inquiry-sent__summary">
        <p class="inquiry-sent__caption">Booking summary</p>
        ${summaryRows}
        <div class="inquiry-sent__total">
          <span>${esc(priceLabel)}</span>
          <strong>${esc(priceValue)}</strong>
        </div>
        <p class="inquiry-sent__note">${esc(DELIVERY_NOTE)}</p>
      </div>

      <p class="inquiry-sent__caption inquiry-sent__caption--steps">What happens next</p>
      <ol class="inquiry-sent__steps">${steps}</ol>

      <button class="primary-button" type="button" data-service-back>Start a new inquiry</button>
    </div>
  `;
}
