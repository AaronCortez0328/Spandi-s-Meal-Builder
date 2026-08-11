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
/**
 * Records whether the customer is moving forward or back, so the panel
 * transition can say so.
 *
 * Stamped on <html> rather than passed into each builder's markup: the five
 * builders own separate panels but share one document, and only one step
 * transition is ever in flight. Call it before assigning the new step —
 * the comparison needs the one being left.
 */
export function setStepDirection(from, to) {
  document.documentElement.dataset.navDir = to < from ? "back" : "fwd";
}

/**
 * Lets each photograph fade in once it has actually arrived.
 *
 * The CSS keeps .menu-photo img at opacity 0 until it carries data-loaded.
 * A pure-CSS entrance cannot do this job: every one of these images is
 * loading="lazy", so the element is in the DOM long before its bytes are,
 * and an animation started at render time would have finished while the
 * frame was still empty — the picture would then appear at full opacity,
 * which is the pop this exists to remove.
 *
 * One listener on the document rather than one per image. `load` does not
 * bubble, hence capture; and because the builders replace whole panels with
 * innerHTML, per-element listeners would have to be reattached on every
 * render, which is exactly the bookkeeping that gets forgotten.
 *
 * `error` marks the image too. A photo that 404s must still resolve to
 * something — without this it would sit at opacity 0 for ever, and a broken
 * image is far better than a mysteriously blank frame with no alt text
 * showing.
 */
export function revealPhotosAsTheyLoad(root = document) {
  const mark = (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.closest(".menu-photo")) {
      img.dataset.loaded = "1";
    }
  };
  root.addEventListener("load", mark, true);
  root.addEventListener("error", mark, true);
}

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
