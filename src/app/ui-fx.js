/**
 * Tiny shared UI effects.
 */

/**
 * Sets an element's text and, when the value actually changed, retriggers
 * a soft pulse animation (see .price-pulse in main.css). Used on running
 * totals so a price change reads as a calm, deliberate update rather than
 * a silent text swap.
 */
export function setPriceText(el, text) {
  if (!el) return;
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove("price-pulse");
  void el.offsetWidth; // restart the animation
  el.classList.add("price-pulse");
}

/**
 * Answers "did that work?" on the control that was just pressed.
 *
 * Both cart builders already flashed the order list when an item landed in
 * it, which is the right signal on a desktop where the list is beside the
 * picker. On a phone the list is far below the fold, so the only
 * confirmation an order ever got happened off-screen and was gone in 350ms.
 * Customers could not tell whether the tap had registered, and the safe
 * thing to do when you cannot tell is press again.
 *
 * Saying it on the button puts the answer where the eye already is — on the
 * thing the finger just hit. The cart flash stays; the two are complementary
 * rather than alternatives.
 *
 * Re-entrant taps are ignored rather than queued, so a double tap cannot
 * restore stale label text over a later confirmation. The element is
 * re-checked before restoring because a render could have replaced it while
 * the timer was pending.
 */
export function confirmOnButton(btn, message = "Added ✓", ms = 1600) {
  if (!btn || btn.dataset.confirming) return;
  const original = btn.innerHTML;
  btn.dataset.confirming = "1";
  btn.classList.add("is-confirmed");
  btn.innerHTML = message;
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.innerHTML = original;
    btn.classList.remove("is-confirmed");
    delete btn.dataset.confirming;
  }, ms);
}
