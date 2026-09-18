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
 * Puts a step change at the top of the screen, without travelling there.
 *
 * Every step used to animate its way up with behavior: "smooth". On a phone
 * that means two thousand pixels of somebody else's content flying past
 * before the thing you asked for arrives, which is a well-known way to make
 * a person feel sick — and the further down the page they were, the longer
 * the ride. The panel's own fade already reports that the screen changed, so
 * the journey was carrying no information; only the arrival matters.
 *
 * "instant", not "auto". `auto` defers to the CSS scroll-behavior, which is
 * `smooth` on <html> — so the obvious spelling would have changed nothing at
 * all.
 *
 * Repositioning cannot simply be dropped, however much nicer that sounds. The
 * new step's panel begins at the top of the builder, and by the time somebody
 * has scrolled down to reach the button that advances them, that top is above
 * the viewport — so leaving the page where it is drops them into the middle
 * of a screen they have not seen the start of.
 *
 * What can be removed is ever *seeing* it happen, and that is a matter of
 * ordering. Call this in the same synchronous block as the render, after it:
 * the browser paints once, and that one frame already carries both the new
 * position and the new panel at the first frame of its fade, which is fully
 * transparent. Put an await, a setTimeout or a requestAnimationFrame between
 * the two and it becomes a jolt, because now a frame gets painted in between
 * showing the old position with content still in it.
 */
export function jumpTo(el, block = "start") {
  if (!el) return;
  el.scrollIntoView({ behavior: "instant", block });
  askParentToScroll(el, block);
}

/**
 * The same jump, asked of the page that can actually perform it.
 *
 * ── Why scrollIntoView above is not enough ────────────────────────────────
 *
 * Embedded, it does nothing at all. The frame is `scrolling="no"` and grown
 * to the full height of its content, so it has no scroll box of its own —
 * there is nothing inside here to move. The thing that scrolls is the
 * GoHighLevel page around us, and that is cross-origin, so the browser will
 * not let code in here touch it.
 *
 * So the line above works in dev, where the frame IS the viewport, and is
 * silently inert in production. That is why it was never caught: every
 * builder called it, all five appeared correct locally, and on a phone a
 * customer who scrolled down to tap "25 pax" landed halfway down the combo
 * screen they had never seen the top of. Customers reported the builder as
 * hard to use; this is a large part of what they meant.
 *
 * ── What is sent ──────────────────────────────────────────────────────────
 *
 * An offset from the top of OUR document, not a viewport coordinate. The
 * parent knows where the frame sits on its own page and what its navbar
 * covers; it needs only the distance down the builder, and it adds the rest.
 * Sending a viewport figure would make the same mistake spandis-view was
 * written to fix.
 *
 * `block` travels with it so the parent can honour "center" and "nearest"
 * rather than flattening every jump to the top of the element.
 *
 * Fails silent and open: no parent, a parent that never listens, or a
 * postMessage that throws all leave the page exactly where it was — which is
 * today's behaviour, so nothing can be made worse by this.
 */
function askParentToScroll(el, block) {
  if (typeof window === "undefined" || window.parent === window) return;

  try {
    const rect = el.getBoundingClientRect();
    // scrollY is 0 in the embedded case, because nothing in here scrolls;
    // it is added so the figure stays right when the app runs standalone.
    const top = Math.max(0, Math.round(rect.top + (window.scrollY || 0)));

    window.parent.postMessage({
      type: "spandis-scroll",
      top,
      // Sent so "nearest" can mean "only if it is off screen" on the other
      // side, instead of moving the page for something already in view.
      height: Math.round(rect.height),
      block,
    }, "*");
  } catch {
    /* A parent we cannot reach is the same as no parent. */
  }
}

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

const CONFIRM_MARK = `
  <svg class="btn-confirm__mark" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="btn-confirm__ring" cx="18" cy="18" r="15" />
    <path class="btn-confirm__tick" d="M11 18.5 L16 23.5 L25.5 13" />
  </svg>`;

export function confirmOnButton(btn, message = "Added to your order", ms = 1700) {
  if (!btn || btn.dataset.confirming) return;
  btn.dataset.confirming = "1";

  // Laid over the button rather than swapping its contents. "Add to order"
  // is a good deal wider than a tick, so replacing one with the other would
  // shrink the button in the moment a finger is still on it and shove
  // everything below it upward. An absolutely positioned overlay takes the
  // label's place visually and none of its space, so the button does not
  // move at all — which matters more on a phone than the animation does.
  const mark = document.createElement("span");
  mark.className = "btn-confirm";
  // role=status announces the message when this is inserted. The button's
  // own label stays "Add to order" underneath, which is still what pressing
  // it does, so nothing is taken away from a screen reader.
  mark.setAttribute("role", "status");
  mark.innerHTML = `${CONFIRM_MARK}<span class="visually-hidden">${message}</span>`;
  btn.appendChild(mark);
  btn.classList.add("is-confirmed");

  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove("is-confirmed");
    mark.remove();
    delete btn.dataset.confirming;
  }, ms);
}
