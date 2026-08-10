/**
 * Keeps a half-finished order alive across an accidental reload.
 *
 * Nothing in this app was saved anywhere. A customer could pick through 66
 * dishes, fill in eleven fields, fat-finger a refresh, and lose all of it
 * with no warning and no way back. That matters more here than on most
 * sites: the app runs inside an iframe on someone else's page, where a
 * stray reload of the parent takes the builder with it.
 *
 * ── Why sessionStorage and not localStorage ────────────────────────────────
 * The contact form holds a name, a phone number and a home address.
 * localStorage would leave that sitting on disk indefinitely — on a shared
 * desktop, a family laptop, an internet café machine — long after the person
 * has gone. sessionStorage is cleared when the tab closes, which is the
 * shortest lifetime that still survives a refresh.
 *
 * It is also the honest lifetime for the data itself. An order half-built
 * three weeks ago should not come back: prices move, and quietly restoring a
 * stale basket at last month's numbers would be worse than losing it.
 */

const PREFIX = "spandis:draft:";

// Debounce: a card picker can fire several state changes in a row, and there
// is no reason to serialise the cart on each one.
const SAVE_DELAY_MS = 350;

/**
 * sessionStorage, or null where it cannot be used.
 *
 * Safari in private mode, and some embedded webviews, expose the API and
 * then throw on write. Feature-detecting by writing is the only reliable
 * check. Everything below no-ops when this returns null — losing the draft
 * is the status quo, so a storage failure must never break the order.
 */
function storage() {
  try {
    const s = window.sessionStorage;
    const probe = `${PREFIX}__probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function read(key) {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt or half-written JSON. Drop it rather than letting a parse
    // error take down the builder on load.
    return null;
  }
}

function write(key, value) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded, most likely. Not worth surfacing — the customer can
    // still complete the order, they just lose the safety net.
  }
}

/**
 * Everything this module has stored. Called once an order is submitted.
 *
 * Enumerated with the indexed key(i)/length API rather than Object.keys().
 * Browsers do expose storage keys as own properties, but that is incidental
 * — key(i) is the interface Storage actually guarantees. Keys are collected
 * before anything is removed, because removing during the walk shifts every
 * later index and silently skips entries.
 */
export function clearDrafts() {
  const s = storage();
  if (!s) return;
  try {
    const ours = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) ours.push(k);
    }
    ours.forEach((k) => s.removeItem(k));
  } catch { /* nothing useful to do */ }
}

function debounced(fn) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, SAVE_DELAY_MS);
  };
}

/**
 * Restores a builder's state object, then keeps saving it as the customer works.
 *
 * The state object is mutated in place rather than replaced, because each
 * builder closes over that exact reference — handing back a new object would
 * leave every handler pointed at the old one.
 *
 * Saving is driven by interaction events rather than by hooking each
 * mutation. A builder changes its state from a dozen places, and several of
 * them mutate nested values (`state.cart.push(...)`) that a setter or a
 * Proxy would not see. Every one of those changes is downstream of a click
 * or a keystroke in the same container, so watching the container catches
 * all of them with one hook and cannot drift as the builder grows.
 *
 * @param {HTMLElement} container  the builder's root element
 * @param {string} key             stable name for this builder
 * @param {object} state           the builder's live state object
 */
export function persistState(container, key, state) {
  const saved = read(key);
  if (saved && typeof saved === "object") Object.assign(state, saved);

  const save = debounced(() => write(key, state));
  container.addEventListener("click", save);
  container.addEventListener("input", save);
  container.addEventListener("change", save);
}

/**
 * The contact form's fields, by id.
 *
 * Two are deliberately absent:
 *
 *   cf-company   the honeypot. It must arrive empty from a real person, so
 *                restoring anything into it would be actively harmful.
 *   cf-tc-agree  agreeing to terms is a deliberate act. Re-ticking it on
 *                someone's behalf because they once ticked it before a
 *                reload is not consent.
 */
const FORM_FIELDS = [
  "cf-first-name", "cf-last-name", "cf-email", "cf-phone",
  "cf-date", "cf-time", "cf-fulfilment-time", "cf-address",
  "cf-note", "cf-social-name",
];

/**
 * The card-driven fields. Each writes to a hidden input, and the visible
 * cards carry the selection state.
 *
 * Restoring means clicking the matching card rather than writing the hidden
 * value directly: the click is what also marks the card selected, reveals
 * the pickup address, renames the delivery-time label and recalculates the
 * total. Setting the input alone would restore the value while leaving the
 * interface showing something else — worse than not restoring at all.
 */
const CARD_GROUPS = [
  { hidden: "cf-branch",     option: "data-branch-option",     value: "data-branch-value" },
  { hidden: "cf-fulfilment", option: "data-fulfilment-option", value: "data-fulfilment-value" },
  { hidden: "cf-rush",       option: "data-rush-option",       value: "data-rush-value" },
  { hidden: "cf-social",     option: "data-social-option",     value: "data-social-value" },
];

/**
 * Restores the contact form, then keeps saving it as it is filled in.
 *
 * Call after the panel's markup is in the DOM and the pickers are wired —
 * restoring works by clicking cards, so their handlers have to exist first.
 *
 * @param {HTMLElement} container  the panel holding the form
 */
export function persistContactForm(container) {
  const saved = read("contact") ?? {};

  for (const id of FORM_FIELDS) {
    const el = container.querySelector(`#${id}`);
    if (el && typeof saved[id] === "string" && saved[id] !== "") el.value = saved[id];
  }

  for (const group of CARD_GROUPS) {
    const value = saved[group.hidden];
    if (!value) continue;
    const card = container.querySelector(`[${group.option}][${group.value}="${CSS.escape(value)}"]`);
    card?.click();
  }

  const save = debounced(() => {
    const data = {};
    for (const id of FORM_FIELDS) {
      const el = container.querySelector(`#${id}`);
      if (el) data[id] = el.value;
    }
    for (const group of CARD_GROUPS) {
      const el = container.querySelector(`#${group.hidden}`);
      if (el) data[group.hidden] = el.value;
    }
    write("contact", data);
  });

  container.addEventListener("input", save);
  container.addEventListener("change", save);
  container.addEventListener("click", save);
}
