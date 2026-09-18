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

/**
 * That a change ended by running out of time, rather than by being sent or
 * cancelled.
 *
 * A separate key because the session itself is gone by then, and what it
 * guards is the worst thing this flow could do. The builder IS the ordering
 * screen; without the session, the checkout draws a contact form and Send
 * places a booking. A customer whose half hour ran out while they chose
 * dishes would have filled that form with the change banner still on screen
 * above it, and made a second booking believing they were amending the one
 * they had.
 */
const EXPIRY_KEY = "sp_change_expired";

/** Half an hour IDLE — see touchChange. A tab still being used never hits it. */
export const SESSION_MS = 30 * 60 * 1000;

export const KINDS = ["change", "add"];

/**
 * Begins a change. Returns whether it took — a false answer means storage is
 * unavailable and the caller must say so rather than navigate anyway.
 */
export function startChange(session) {
  if (!session || !KINDS.includes(session.kind)) return false;
  try {
    sessionStorage.removeItem(EXPIRY_KEY);
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
    try { sessionStorage.setItem(EXPIRY_KEY, "1"); } catch { /* see endChange */ }
    endChange();
    return null;
  }

  return saved;
}

/**
 * Records that the builder has already emptied the cart and filled it from
 * the booking. Once, not on every load.
 *
 * Without this the cart was cleared every time the builder page loaded while
 * a change was open — which is correct exactly once, on arrival, and
 * destroys ten minutes of work the second time. The page does reload: the
 * GoHighLevel navbar moves between pages rather than within one, so a
 * customer who taps the cart and comes back has reloaded this app.
 *
 * Merged into the saved session rather than written over it, and startedAt
 * is left alone — re-stamping it here would hand out a fresh half hour every
 * time the page loaded, which is an expiry that never expires.
 */
export function markPrepared(now = Date.now()) {
  const session = readChange(now);
  if (!session) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...session, prepared: true }));
    return true;
  } catch {
    return false;
  }
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

/**
 * Whether a change ran out of time in this tab.
 *
 * True only for an expiry — a change that was sent, or cancelled, leaves this
 * alone, because in both of those cases the customer knows what happened and
 * is free to place an ordinary order.
 */
export function changeExpired() {
  try {
    return sessionStorage.getItem(EXPIRY_KEY) === "1";
  } catch {
    return false;
  }
}

/** The customer has been told, and may go back to ordering normally. */
export function clearExpiry() {
  try {
    sessionStorage.removeItem(EXPIRY_KEY);
  } catch {
    // Nothing to do. The tab closing takes it either way.
  }
}

/**
 * Pushes the half hour out, because the customer is still working.
 *
 * SESSION_MS is an IDLE timeout, not a deadline. Choosing dishes for a
 * hundred-pax package takes longer than thirty minutes, and a change that
 * expired under someone mid-build would drop them into ordinary ordering at
 * the worst possible moment. What the timeout is actually for — a tab left
 * open on a shared machine — is unaffected by this: an abandoned tab stops
 * being touched, and expires.
 *
 * Cheap enough to call on every cart change and every screen: one read and
 * one write of a small object in the tab's own storage.
 */
export function touchChange(now = Date.now()) {
  const session = readChange(now);
  if (!session) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...session, startedAt: now }));
    return true;
  } catch {
    return false;
  }
}
