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
