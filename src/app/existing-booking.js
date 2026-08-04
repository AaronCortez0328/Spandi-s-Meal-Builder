import { CONTACT_NUMBER } from "./copy.js";

/**
 * "You already have an order with us" — shown when a customer submits and
 * a booking is already open under their details.
 *
 * This is a question, not an error, so it gets the same surface as the
 * confirmation screen rather than a line of red text under the button.
 * Whether these items belong to the existing order or are a separate
 * occasion is something only the customer knows, and the previous version
 * decided for them: it merged silently and announced it afterwards, which
 * was wrong for anyone booking two events.
 *
 * Nothing has been written to GoHighLevel when this renders. The choice
 * made here is what commits it.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const peso = (n) => `PHP ${Number(n ?? 0).toLocaleString("en-PH")}`;

// "2026-08-15" → "15 August 2026". Falls back to whatever it was given, so
// an unexpected shape degrades to something readable rather than "Invalid
// Date" or an empty row.
function humanDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const CALENDAR_ICON = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

/**
 * @param {HTMLElement} panel
 * @param {object} existing  from the server's 409 — eventDate, branch,
 *   serviceType, previousTotal, addedTotal, newTotal
 * @param {(intent: "add"|"separate") => void} onChoose
 */
export function renderExistingBooking(panel, existing, onChoose) {
  const when = humanDate(existing?.eventDate);

  const detail = [when, existing?.branch, existing?.serviceType]
    .filter(Boolean)
    .map(esc)
    .join(" &middot; ");

  panel.innerHTML = `
    <div class="inquiry-sent existing-booking">
      <div class="inquiry-sent__icon existing-booking__icon">${CALENDAR_ICON}</div>

      <h2 class="inquiry-sent__title">You already have an order with us</h2>
      <p class="inquiry-sent__lede">
        Is what you&rsquo;ve just chosen part of that booking, or a separate occasion?
      </p>

      <div class="inquiry-sent__summary">
        <p class="inquiry-sent__caption">Your current booking</p>
        ${detail ? `<div class="inquiry-sent__row"><span>Booked</span><strong>${detail}</strong></div>` : ""}
        <div class="inquiry-sent__row">
          <span>Current total</span><strong>${esc(peso(existing?.previousTotal))}</strong>
        </div>
        <div class="inquiry-sent__row">
          <span>This order</span><strong>${esc(peso(existing?.addedTotal))}</strong>
        </div>
      </div>

      <div class="existing-booking__choices">
        <button type="button" class="existing-booking__choice existing-booking__choice--primary" data-booking-choice="add">
          <strong>Add to that booking</strong>
          <small>One delivery &middot; new total ${esc(peso(existing?.newTotal))}</small>
        </button>
        <button type="button" class="existing-booking__choice" data-booking-choice="separate">
          <strong>This is a separate event</strong>
          <small>Keep them as two bookings</small>
        </button>
      </div>

      <p class="inquiry-sent__note existing-booking__help">
        Not sure? ${CONTACT_NUMBER
          ? `Call us on <strong>${esc(CONTACT_NUMBER)}</strong> and we&rsquo;ll sort it out with you.`
          : `Give us a call and we&rsquo;ll sort it out with you.`}
      </p>

      <p class="form-status" data-booking-status role="status" aria-live="polite"></p>
    </div>
  `;

  panel.querySelectorAll("[data-booking-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Both choices go back to the server, so lock the pair — a second
      // click while the first is in flight would ask the same question
      // twice and could produce two bookings.
      panel.querySelectorAll("[data-booking-choice]").forEach((b) => { b.disabled = true; });
      const status = panel.querySelector("[data-booking-status]");
      if (status) status.textContent = "Saving…";
      onChoose(btn.dataset.bookingChoice);
    });
  });
}

/** Re-enables the choices and shows why, when a chosen path fails. */
export function showBookingChoiceError(panel, message) {
  panel.querySelectorAll("[data-booking-choice]").forEach((b) => { b.disabled = false; });
  const status = panel.querySelector("[data-booking-status]");
  if (status) status.textContent = message;
}
