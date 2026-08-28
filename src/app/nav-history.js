/**
 * Makes the phone's back button mean "back a step" instead of "leave".
 *
 * The app moves between a service chooser and several steps inside a builder
 * without ever touching browser history, so every one of those moves was
 * invisible to the back button. Someone halfway through an order on step 3
 * who pressed back — the single most-used control on a phone — left the site
 * entirely and watched the whole thing vanish. (The sessionStorage draft
 * meant it was recoverable, but nothing on screen said so, and by then they
 * had gone.)
 *
 * Each move now pushes an entry, so back walks step 3 → 2 → 1 → chooser and
 * only then off the page.
 *
 * Two things about doing this inside an iframe:
 *
 * The URL never changes. pushState is called with location.href, so an entry
 * is added while the address stays exactly as it is. That matters here more
 * than usual — the parent page builds this frame's src from its own query
 * string, and a URL we altered from the inside would be a second, competing
 * source of truth for which service is open.
 *
 * Entries pushed from a frame join the top-level session history, which is
 * why the phone's hardware back button traverses them at all. It also means
 * we can be handed a popstate belonging to somebody else's entry, so every
 * state we create is stamped and anything unstamped is left alone for the
 * browser to deal with normally.
 */

const STAMP = "spandis-nav";

let current = { service: null, step: null, view: null };
let onRestore = null;

/** True while we are applying a popstate, so restoring does not re-push. */
let restoring = false;

function sameAsCurrent(service, step, view) {
  return current.service === service
    && current.step === step
    && current.view === view;
}

/**
 * @param {(nav: {service: string|null, step: number|null, view: string|null}) => void} restore
 *   Puts the app into the given state. Called only for entries we created,
 *   and never expected to push anything itself.
 */
export function initNavHistory(restore) {
  onRestore = restore;

  // Claim the entry the page loaded on. Without this the first Back lands on
  // an unstamped entry and leaves, so the chooser would never be reachable
  // by going backwards.
  history.replaceState({ [STAMP]: true, ...current }, "", location.href);

  window.addEventListener("popstate", (e) => {
    const s = e.state;
    if (!s || !s[STAMP]) return; // not ours — let the browser navigate

    current = { service: s.service ?? null, step: s.step ?? null, view: s.view ?? null };
    restoring = true;
    try {
      onRestore?.(current);
    } finally {
      restoring = false;
    }
  });
}

/**
 * Records a move. Ignored while restoring, and ignored when it would repeat
 * the entry we are already on — otherwise re-rendering the same step would
 * stack duplicates and back would appear to do nothing for several presses.
 *
 * `view` is a step *within* a builder: the combo builder moves through
 * group size, combo and dishes without its step number changing. Those were
 * invisible here, so Back from "Review your dishes" left the builder
 * entirely rather than returning to the combo grid -- on Android, where
 * Back is the primary control, that lost the whole selection in one press.
 */
export function pushNav(service, step = null, view = null) {
  if (restoring) return;
  if (sameAsCurrent(service, step, view)) return;

  current = { service, step, view };
  history.pushState({ [STAMP]: true, service, step, view }, "", location.href);
}

/** Whether a popstate is currently being applied. */
export function isRestoringNav() {
  return restoring;
}
