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

/**
 * Telling the page outside that a change is open, so it can pin a notice.
 *
 * ── Why the page and not us ───────────────────────────────────────────────
 *
 * The strip below is repeated at the head and had been repeated at the foot,
 * because nothing in here can follow a scroll: the frame is sized to its own
 * content and never scrolls, so `fixed` and `sticky` both resolve to "stay
 * where you were put". The page around us is what scrolls, and it can pin.
 *
 * It also outlives us. A customer who taps Gallery mid-change leaves this app
 * entirely; the navbar is on every page and can keep saying so. The cart
 * badge already works exactly this way.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *
 *   out  spandis-change        { active, kind, startedAt }
 *   in   spandis-cancel-change  the customer pressed Cancel out there
 *
 * `active: false` is sent as deliberately as `true`. The page remembers what
 * it was last told, so a change that ended — sent, cancelled, or timed out
 * while the tab sat idle — has to be reported, or the notice outlives the
 * thing it describes. Every mount reports one or the other.
 *
 * startedAt travels so the page can expire its own copy on the same half
 * hour we do, rather than trusting a flag it can never re-check.
 */
function tellPage(active, session) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage({
      type: "spandis-change",
      active: Boolean(active),
      kind: session?.kind ?? null,
      startedAt: Number(session?.startedAt) || null,
    }, "*");
  } catch {
    /* A page we cannot reach keeps today's behaviour: no notice. */
  }
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
 * Puts the banner above the app, if a change is in progress.
 *
 * Returns whether one is — the caller uses it to decide whether the cart
 * should be emptied first, and whether the checkout should ask for contact
 * details it already has.
 */
export function mountChangeBanner(container, onCancel) {
  const session = readChange();

  // Reported even when there is nothing to report. The page remembers what
  // it was last told, so a change that ended while the tab sat idle — or one
  // that expired on the half hour — has to be taken back, or its notice
  // outlives it.
  if (!session) {
    tellPage(false, null);
    return null;
  }

  // The trust bar goes. It sits directly under this strip and is also
  // dark, so the two ran together into one slab — but the real argument is
  // not the collision. "4.9 stars · 500+ events catered" is a sales line,
  // and this customer bought already. Selling to somebody in the middle of
  // amending their own booking is noise at best, and at worst it makes the
  // banner look like more marketing rather than the one thing on the page
  // they need to believe.
  document.querySelector(".trust-bar")?.remove();

  container.insertAdjacentHTML("afterbegin", bannerHtml(session));

  // The page pins its own notice for the rest of the change — see tellPage.
  // This is what replaced the second strip that used to sit at the foot: two
  // Cancel buttons on one screen is worse than one, and the pinned one is
  // reachable from anywhere rather than only at the end of a scroll.
  tellPage(true, session);

  const stop = () => {
    // Ending the session and clearing the cart together, because a cart left
    // behind from an abandoned change would greet them on their next visit
    // as an order they never placed.
    endChange();
    tellPage(false, null);
    onCancel?.();
  };

  container.querySelector("#sp-change-stop")?.addEventListener("click", stop);

  // The same Cancel, pressed out on the page. It has no way to end the
  // session itself — that lives in this origin — so it asks.
  //
  // Shape-checked rather than origin-checked, deliberately: the embed sits on
  // a domain the client controls and can change, and the only thing this can
  // be asked to do is stop a change the customer started. Nothing is read
  // from the message. Same reasoning as listenForParentCartTap.
  if (typeof window !== "undefined") {
    window.addEventListener("message", (e) => {
      if (e?.data?.type === "spandis-cancel-change") stop();
    });
  }

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

  // The page's pinned notice goes with it. This runs on a successful send,
  // so leaving it up would tell a customer she is still changing an order
  // she has just finished changing — and offer to cancel it.
  tellPage(false, null);
}
