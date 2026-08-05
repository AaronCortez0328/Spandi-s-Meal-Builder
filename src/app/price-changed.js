import { setButtonBusy } from "./button-busy.js";

/**
 * "The price has changed" — shown when the server prices the order
 * differently from the figure the customer was quoted.
 *
 * A question, not a refusal, and it gets the same surface as the duplicate
 * booking panel for the same reason. The overwhelmingly likely cause is an
 * admin editing a price while she was choosing; tampering is possible but
 * rare, and telling an honest customer to start over is a poor answer to a
 * problem we caused.
 *
 * Both figures are shown deliberately. Hiding the correct one protects
 * nothing — the price tables are publicly readable, so anyone attempting to
 * tamper could calculate it themselves — while showing it lets a real
 * customer see exactly what changed and by how much.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const peso = (n) => `PHP ${Number(n ?? 0).toLocaleString("en-PH")}`;

const TAG_ICON = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

/**
 * @param {HTMLElement} panel
 * @param {{ submittedTotal: number, correctTotal: number }} change
 * @param {() => void} onAccept  re-submits at the corrected price
 */
export function renderPriceChanged(panel, change, onAccept) {
  const wentUp = Number(change?.correctTotal) > Number(change?.submittedTotal);
  const difference = Math.abs(Number(change?.correctTotal ?? 0) - Number(change?.submittedTotal ?? 0));

  panel.innerHTML = `
    <div class="inquiry-sent existing-booking">
      <div class="inquiry-sent__icon existing-booking__icon">${TAG_ICON}</div>

      <h2 class="inquiry-sent__title">The price has changed</h2>
      <p class="inquiry-sent__lede">
        Our menu prices were updated while you were choosing, so your total
        is ${wentUp ? "a little higher" : "a little lower"} than when you started.
      </p>

      <div class="inquiry-sent__summary">
        <div class="inquiry-sent__row">
          <span>When you started</span><strong>${esc(peso(change?.submittedTotal))}</strong>
        </div>
        <div class="inquiry-sent__row">
          <span>${wentUp ? "Increase" : "Reduction"}</span><strong>${esc(peso(difference))}</strong>
        </div>
        <div class="inquiry-sent__total">
          <span>Your total now</span>
          <strong>${esc(peso(change?.correctTotal))}</strong>
        </div>
      </div>

      <div class="existing-booking__choices">
        <button type="button" class="existing-booking__choice existing-booking__choice--primary" data-price-accept>
          <strong>Continue at ${esc(peso(change?.correctTotal))}</strong>
          <small>Send my inquiry at the updated price</small>
        </button>
        <button type="button" class="existing-booking__choice" data-service-back>
          <strong>Go back</strong>
          <small>Change my order first</small>
        </button>
      </div>

      <p class="form-status" data-price-status role="status" aria-live="polite"></p>
    </div>
  `;

  const accept = panel.querySelector("[data-price-accept]");
  accept?.addEventListener("click", () => {
    panel._restorePrice = setButtonBusy(accept, "Sending…");
    onAccept();
  });
}

/** Re-enables the button and says why, when the retry itself fails. */
export function showPriceChangedError(panel, message) {
  panel._restorePrice?.();
  panel._restorePrice = null;
  const status = panel.querySelector("[data-price-status]");
  if (status) status.textContent = message;
}
