/**
 * Learns which slice of the builder the customer can actually see.
 *
 * The embed is a `scrolling="no"` iframe grown to the full height of its
 * content, so inside the frame `100vh` is the height of the WHOLE builder,
 * not the height of the phone. On a 667px iPhone the frame's viewport
 * measured 2563px, which made the terms dialog's `max-height: 85vh` resolve
 * to 2179px: a dialog two and a half times taller than the screen, opening
 * at whatever point the page happened to be scrolled to. Sometimes that put
 * the buttons off the bottom; sometimes it put the whole dialog off-screen,
 * so tapping "Terms & Conditions" appeared to do nothing at all.
 *
 * Nothing inside the frame can work this out on its own -- `innerHeight`,
 * `visualViewport` and `screen` all describe the frame or the device, never
 * the visible band. Only the parent knows, so the parent tells us. It posts
 * `{ type: "spandis-view", height, top }`:
 *
 *   height  the parent's own viewport height -- what the customer can see
 *   top     how far into our content that visible band starts, i.e.
 *           -iframe.getBoundingClientRect().top, clamped at 0
 *
 * which land as CSS custom properties on <html>:
 *
 *   --view-h    usable height   (falls back to 100vh)
 *   --view-top  offset to the top of the visible band (falls back to 0)
 *
 * Fails open in both directions. An older GHL page that never sends the
 * message leaves the fallbacks in place, which is exactly today's
 * behaviour; a standalone visit never starts listening, because there the
 * frame IS the viewport and vh is already right.
 *
 * See docs/ghl-page-embed.html for the parent half.
 */

const MESSAGE_TYPE = "spandis-view";

/** Sane bounds. A bad number should not be able to produce a 0px dialog. */
const MIN_HEIGHT = 240;

let latest = null;
const listeners = new Set();

/** The visible band, or null when the parent has not told us. */
export function parentView() {
  return latest;
}

/**
 * Called whenever the band moves -- which is on every scroll frame while
 * the customer is scrolling. Anything that has to stay on screen (the terms
 * popup) subscribes while it is open and unsubscribes when it closes, so
 * nothing is recalculated for a popup nobody has opened.
 */
export function onParentView(fn) {
  listeners.add(fn);
}

export function offParentView(fn) {
  listeners.delete(fn);
}

function apply({ height, top }) {
  const root = document.documentElement;
  root.style.setProperty("--view-h", `${Math.round(height)}px`);
  root.style.setProperty("--view-top", `${Math.round(top)}px`);
  // A flag for CSS to key off, so the fallbacks stay untouched until a real
  // measurement has arrived rather than being overwritten with a guess.
  root.setAttribute("data-view-synced", "");
}

export function initParentView() {
  if (window.parent === window) return;

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || d.type !== MESSAGE_TYPE) return;

    const height = Number(d.height);
    const top = Number(d.top);
    // Reject rather than clamp a nonsense height: a wrong number here moves
    // the dialog somewhere the customer is not looking, which is the fault
    // this exists to fix. Better to keep the vh fallback.
    if (!Number.isFinite(height) || height < MIN_HEIGHT) return;
    if (!Number.isFinite(top)) return;

    latest = { height, top: Math.max(0, top) };
    apply(latest);
    // One bad subscriber must not stop the others, or a popup stays put
    // while the page scrolls away underneath it.
    for (const fn of listeners) {
      try { fn(latest); } catch { /* keep going */ }
    }
  });

  // Ask, in case the parent loaded first and has already sent its one
  // message. Harmless where nothing is listening.
  try {
    window.parent.postMessage({ type: "spandis-view-request" }, "*");
  } catch {
    /* cross-origin parents can refuse; the periodic parent updates cover it */
  }
}
