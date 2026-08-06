/**
 * A button that shows its own progress.
 *
 * The five builders already did this for Send — spinner in the button,
 * label swapped, disabled while in flight. Three other places instead wrote
 * "Saving…", "Uploading…" or "Submitting…" into a status line underneath,
 * which reads as unfinished: the control the customer just pressed gives no
 * sign it heard them, and a sentence appears somewhere else on the page.
 *
 * Same pattern, one definition. The spinner and its reduced-motion variant
 * already exist in main.css as .btn-spinner.
 */

/**
 * Puts a button into its loading state and returns a function that undoes it.
 *
 * The original markup is captured rather than rebuilt, so a button with an
 * icon or nested markup comes back exactly as it was.
 *
 * @param {HTMLElement} btn
 * @param {string} label  what it says while working — "Saving…", "Uploading…"
 * @returns {() => void}  restore
 */
export function setButtonBusy(btn, label) {
  if (!btn) return () => {};

  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;

  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="btn-spinner"></span>${label}`;

  return () => {
    btn.innerHTML = original;
    btn.disabled = wasDisabled;
    btn.removeAttribute("aria-busy");
  };
}
