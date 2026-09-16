import { readChange, endChange } from "../domain/change-session.js";

/**
 * The strip that says this is not a new order.
 *
 * The single biggest risk in sending a customer to the builder to change
 * something is that the builder looks exactly like ordering — because it IS
 * the ordering screen. Somebody who arrives without being told why will
 * reasonably believe they are placing a second order, and an order placed in
 * that belief is a second booking rather than a change.
 *
 * So it sits above everything, on every screen of the builder, and stays
 * there until they send or cancel. Not a toast, not a one-time message: a
 * customer who spends ten minutes choosing dishes needs it still there at
 * the end.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** "2026-12-19" as "19 December". The day is what they recognise. */
export function bannerDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return "";
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}

export function bannerHtml(session) {
  const changing = session.kind === "change";
  const when = bannerDate(session.eventDate);

  return `
    <div class="sp-change-banner" role="status">
      <div class="sp-change-banner__text">
        <p class="sp-change-banner__head">
          ${changing ? "Changing" : "Adding to"} your${when ? ` ${esc(when)}` : ""} booking
        </p>
        <p class="sp-change-banner__sub">
          ${changing
            ? "Build the order you want. Nothing changes until we confirm it with you."
            : "Choose what to add. Nothing changes until we confirm it with you."}
        </p>
      </div>
      <button type="button" class="sp-change-banner__stop" id="sp-change-stop">Cancel</button>
    </div>
  `;
}

/**
 * Puts the banner above the app, if a change is in progress.
 *
 * Returns whether one is — the caller uses it to decide whether the cart
 * should be emptied first, and whether the checkout should ask for contact
 * details it already has.
 */
export function mountChangeBanner(container, onCancel) {
  const session = readChange();
  if (!session) return null;

  container.insertAdjacentHTML("afterbegin", bannerHtml(session));

  container.querySelector("#sp-change-stop")?.addEventListener("click", () => {
    // Ending the session and clearing the cart together, because a cart left
    // behind from an abandoned change would greet them on their next visit
    // as an order they never placed.
    endChange();
    onCancel?.();
  });

  return session;
}
