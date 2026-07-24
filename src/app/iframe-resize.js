/**
 * Keeps the GHL parent page's iframe sized to our content.
 *
 * The site embeds this app in a `scrolling="no"` iframe (initial height
 * 900px) and listens for `{ type: "spandis-resize", height }` messages to
 * grow/shrink the frame (see BRAND-TOKENS.md for the full embed contract).
 * Without these messages the frame stays at 900px and anything taller is
 * clipped with no way to scroll to it.
 *
 * A ResizeObserver on <body> catches every content change — step
 * navigation, cart updates, skeleton→content swaps, dropdowns opening —
 * with no per-builder wiring. Standalone (non-embedded) visits are a
 * no-op: postMessage to a parent that isn't listening does nothing.
 */

const MESSAGE_TYPE = "spandis-resize";
const DEBOUNCE_MS = 80;

function measure() {
  // scrollHeight of the root element tracks the full document height even
  // when inner elements overflow; body alone can under-report when margins
  // collapse, so take the larger of the two.
  return Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );
}

export function initIframeResize() {
  // Not embedded — nothing to do (also guards SSR-ish edge cases).
  if (window.parent === window) return;

  let lastSent = 0;
  let timer = null;

  function send() {
    const height = measure();
    if (height === lastSent) return;
    lastSent = height;
    // "*" target: the embed lives on the client's GHL domain(s), which can
    // change (custom domains, previews). Height is non-sensitive, and the
    // parent validates the message shape before acting on it.
    window.parent.postMessage({ type: MESSAGE_TYPE, height }, "*");
  }

  function queueSend() {
    clearTimeout(timer);
    timer = setTimeout(send, DEBOUNCE_MS);
  }

  new ResizeObserver(queueSend).observe(document.body);

  // Fonts finishing loading can reflow text without resizing <body>'s box
  // in some layouts; belt-and-braces the common late-shift sources.
  window.addEventListener("load", queueSend);
  document.fonts?.ready?.then(queueSend);

  // Initial measurement right away so the parent can drop its 900px guess.
  queueSend();
}
