/**
 * What the builder needs to know when a customer arrives to change a booking.
 *
 * Order Status and the builder are two different pages on the GoHighLevel
 * site, but the same app on the same origin inside both — so a customer who
 * has just proved who they are on one can be recognised on the other without
 * typing anything again. Asking for the email and the date a second time is
 * the moment somebody gives up.
 *
 * ── Why sessionStorage and not a token ────────────────────────────────────
 *
 * A minted token would mean a table, an endpoint and an expiry to manage, to
 * carry a credential the customer typed on this device thirty seconds ago and
 * which is already sitting in the form behind them. It would be machinery
 * guarding a door that is already open.
 *
 * sessionStorage and not localStorage, for the reason draft.js gives: this
 * holds an email address and a booking, and it should die with the tab rather
 * than wait on a shared laptop for the next person.
 *
 * ── It can fail, and that is handled ──────────────────────────────────────
 *
 * Safari in private mode and some in-app browsers expose storage and then
 * throw on write, so the only reliable check is to try. Every function here
 * answers falsy rather than throwing, and the screens treat that as "changing
 * is unavailable, message us" — which is true, rather than a broken button.
 */

const KEY = "sp_change";

/** Half an hour. Long enough to build an order, short enough to be stale. */
export const SESSION_MS = 30 * 60 * 1000;

export const KINDS = ["change", "add"];

/**
 * Begins a change. Returns whether it took — a false answer means storage is
 * unavailable and the caller must say so rather than navigate anyway.
 */
export function startChange(session) {
  if (!session || !KINDS.includes(session.kind)) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...session, startedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The change in progress, or null.
 *
 * Expiry is checked on READ rather than by a timer, because the tab may have
 * been in a background for an hour and no timer would have run. A stale
 * session is cleared as it is found, so the next read is honest too.
 */
export function readChange(now = Date.now()) {
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }

  if (!saved || !KINDS.includes(saved.kind) || !saved.identifier || !saved.eventDate) {
    return null;
  }

  const startedAt = Number(saved.startedAt);
  // Number(undefined) is NaN, and NaN comparisons are false — so a session
  // with no timestamp would look eternally fresh. Checked explicitly.
  if (!Number.isFinite(startedAt) || now - startedAt > SESSION_MS) {
    endChange();
    return null;
  }

  return saved;
}

export function endChange() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do. A session that cannot be cleared expires on its own,
    // and the tab closing takes it either way.
  }
}

/** True when the builder should be in change mode rather than ordering. */
export function inChangeMode(now = Date.now()) {
  return readChange(now) !== null;
}
