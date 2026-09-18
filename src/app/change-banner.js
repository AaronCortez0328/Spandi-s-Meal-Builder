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
    <div class="sp-change-banner" id="sp-change-banner" role="status">
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
 * The same way out, at the foot of the page.
 *
 * ── Why a second strip and not a sticky one ───────────────────────────────
 *
 * The obvious fix for "the Cancel button scrolls away" is to pin the banner.
 * It cannot be pinned. This app renders inside an iframe sized to its own
 * content, which therefore never scrolls — the GoHighLevel page around it
 * does. `position: fixed` pins to the iframe's viewport, which is the whole
 * document, so it simply sits where it already was. Same for `sticky`: an
 * element never leaves a scroll container that does not scroll. That is the
 * same constraint that put the cart in the navbar rather than in the app.
 *
 * So the exit is repeated instead of followed. On a phone the head strip is
 * gone after one swipe, and the foot of the page is where somebody who has
 * changed their mind actually ends up — they scroll looking for a way out.
 *
 * Quieter than the head strip on purpose. Two identical black slabs on one
 * screen read as a rendering fault, and the head one is the one that has to
 * say "this is not a new order". This one only has to be findable.
 *
 * Its own id, because removeChangeBanner has to take BOTH away the moment a
 * change ends — a stray "Cancel this change" under "We have your change" is
 * precisely the contradiction the head strip's own comment warns about.
 */
export function bannerFootHtml(session) {
  const changing = session.kind === "change";

  return `
    <div class="sp-change-foot" id="sp-change-foot">
      <p class="sp-change-foot__text">
        ${changing
          ? "Still changing your booking. Nothing is saved until we confirm it."
          : "Still adding to your booking. Nothing is saved until we confirm it."}
      </p>
      <button type="button" class="sp-change-foot__stop" id="sp-change-stop-foot">
        ${changing ? "Cancel this change" : "Cancel this addition"}
      </button>
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

  // The trust bar goes. It sits directly under this strip and is also
  // dark, so the two ran together into one slab — but the real argument is
  // not the collision. "4.9 stars · 500+ events catered" is a sales line,
  // and this customer bought already. Selling to somebody in the middle of
  // amending their own booking is noise at best, and at worst it makes the
  // banner look like more marketing rather than the one thing on the page
  // they need to believe.
  document.querySelector(".trust-bar")?.remove();

  container.insertAdjacentHTML("afterbegin", bannerHtml(session));

  // INSIDE #main-content, not beside it like the head strip.
  //
  // The iframe tells the GoHighLevel page how tall to be, and the measure
  // that wins is the inline one in index.html: #main-content.offsetHeight
  // plus 48, re-broadcast every 250ms. Anything outside that element is not
  // counted, so a foot strip appended to <body> would sit below the height
  // the parent was told about and be cut off — an exit nobody can reach,
  // which is worse than the problem it was added to solve.
  //
  // Safe from re-renders even so: main.js is the only module that touches
  // #main-content, and on the builder path the app fills the panels already
  // inside it rather than replacing its contents.
  const footHost = document.getElementById?.("main-content") ?? container;
  (footHost ?? container).insertAdjacentHTML("beforeend", bannerFootHtml(session));

  const stop = () => {
    // Ending the session and clearing the cart together, because a cart left
    // behind from an abandoned change would greet them on their next visit
    // as an order they never placed.
    endChange();
    onCancel?.();
  };

  // Both exits do exactly the same thing. Two listeners rather than one
  // delegated handler, so neither depends on the other still being in the
  // document — removeChangeBanner takes them away together, but a builder
  // that re-rendered over one must not silently disarm the other.
  container.querySelector("#sp-change-stop")?.addEventListener("click", stop);
  container.querySelector("#sp-change-stop-foot")?.addEventListener("click", stop);

  return session;
}

/**
 * Takes the strip away once the change is over.
 *
 * It lives outside the app's own container so that nothing the builder
 * re-renders can remove it — which is right while a change is in progress
 * and wrong the moment one ends. Without this, "We have your change" is
 * drawn underneath a strip still saying "Changing your 19 December booking"
 * with a Cancel button beside it, and the customer cannot tell which of the
 * two is true.
 */
export function removeChangeBanner() {
  document.getElementById("sp-change-banner")?.remove();
  document.getElementById("sp-change-foot")?.remove();
}
