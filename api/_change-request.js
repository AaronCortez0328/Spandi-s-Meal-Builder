import { requestWindow } from "../src/domain/availability.js";

/**
 * The rules a change or add request has to satisfy before it is worth a row.
 *
 * Kept out of the handler so they can be tested without a database, and
 * because the dashboard mirrors the important half: their Approve button asks
 * the same questions ours does. We can stop a customer ASKING late and
 * nothing on our side can stop an approval LANDING late.
 *
 * ── What `after` may contain, and what it must not ─────────────────────────
 *
 * The dashboard's correction, and it was a design error on our side. "100
 * pax" is not a figure anyone can apply: jeanette-50 and jeanette-100 are
 * different catalogue rows at PHP 19,000 and PHP 35,000, with different tray
 * quantities per dish. Given a number they would be guessing which row.
 *
 * So a change names the row, and an add names dishes in package_items
 * vocabulary — the same words their packageChange module already speaks.
 *
 * NO PRICES, EVER. Their own shared agreement says the total is whatever the
 * browser sent and server-side validation is a prerequisite of it; a
 * customer-proposed amount walks straight into that. They price from the
 * catalogue at approve time.
 */

export const KINDS = ["change", "add"];

/** More than this in one request is a mistake or an attack, not an order. */
const MAX_GROUPS = 12;
const MAX_LINES  = 40;
const MAX_TEXT   = 200;
const MAX_ADDONS = 20;

/**
 * Not 99, which is the cart's own ceiling on "how many trays".
 *
 * Packed meals counts PIECES and its volume tier does not start until 100,
 * and an admin-created service can be priced per kilo. A cap tight enough to
 * be the cart's would refuse ordinary orders here. What this bounds is how
 * much junk can be written into a row somebody has to read — the figure
 * itself is priced from our own tables either way, so an absurd quantity
 * arrives as an absurd and obvious total rather than as a cheap one.
 */
const MAX_QTY = 9999;

function str(v) {
  return String(v ?? "").trim();
}

/**
 * A catalogue id: lower-case letters, digits and hyphens.
 *
 * Deliberately not derived from anything. Sibling ids cannot be computed —
 * `special-50` is "Mary Rose Package, 50 pax", sitting between mary-rose-25
 * and mary-rose-100, so any pattern built from a base and a pax count breaks
 * on it. The screen reads real ids from the catalogue and sends one back;
 * this only checks the shape, and the dashboard confirms it exists when it
 * applies the change.
 */
function looksLikeId(v) {
  // A string, not something that merely coerces to one. Number 42 becomes
  // the id "42", which looks valid and is not — real ids read jeanette-100
  // and fam-c1. Refusing the type is free; guessing at it is not.
  if (typeof v !== "string") return false;
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.trim());
}

/** Free text we are willing to keep, trimmed to something readable. */
function text(v, max = MAX_TEXT) {
  const s = str(v);
  return s ? s.slice(0, max) : null;
}

/**
 * A number a customer could have typed, or null.
 *
 * A number input hands its value back as a string, so "2" has to be allowed
 * — but only a string that reads as a number. Number() is far more generous
 * than that: Number(null) is 0, Number(true) is 1, Number([2]) is 2 and
 * Number("1e3") is a thousand. None of those is a quantity anybody typed,
 * and the last one has slipped past a range check in this codebase before.
 */
function numeric(v, pattern) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return pattern.test(s) ? Number(s) : null;
}

/** A counted quantity. Integers only — you cannot order half a tray. */
function count(v) {
  const n = numeric(v, /^\d{1,5}$/);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_QTY ? n : null;
}

/** A measured quantity — kilos, which are not whole numbers. */
function amount(v) {
  const n = numeric(v, /^\d{1,5}(\.\d{1,3})?$/);
  return n !== null && n > 0 && n <= MAX_QTY ? n : null;
}

/**
 * One service's worth of an order, in the shape our own pricing understands.
 *
 * ── An allowlist, not a filter ────────────────────────────────────────────
 *
 * Every field is named here and nothing else survives. That is what makes
 * "the customer never sends a price" structurally true rather than a rule
 * somebody remembers: there is no key on this object that could carry one,
 * so there is nothing to strip and nothing to forget to strip.
 *
 * It also bounds what reaches the row. This is customer JSON on its way into
 * our database and from there into a queue a person reads; unbounded nesting
 * and a megabyte of strings are not an order.
 *
 * Returns null when it cannot be made into something priceable. A request
 * nobody can apply is worse than no request: it sits in the queue looking
 * actionable.
 */
function cleanGroup(src, allowMixed = false) {
  const service = looksLikeId(src?.service) ? src.service.trim() : null;
  if (!service) return null;

  // An order spanning services. The nesting stops here — a group inside a
  // group inside a group is not something the builder can produce.
  if (service === "mixed") {
    if (!allowMixed) return null;
    const rows = Array.isArray(src?.groups) ? src.groups.slice(0, MAX_GROUPS) : [];
    const groups = [];
    for (const row of rows) {
      const clean = cleanGroup(row, false);
      if (!clean) return null;
      groups.push(clean);
    }
    return groups.length > 0 ? { service, groups } : null;
  }

  const out = { service };

  // Party trays, packed meals and combo trays each send a list.
  if (Array.isArray(src?.lines)) {
    const lines = [];
    for (const row of src.lines.slice(0, MAX_LINES)) {
      const line = {};
      for (const key of ["dishId", "packTypeId", "packageId"]) {
        if (looksLikeId(row?.[key])) line[key] = row[key].trim();
      }
      // A line naming nothing cannot be priced, and one with no quantity
      // would be priced as though it were a single tray.
      if (Object.keys(line).length === 0) return null;
      const qty = count(row?.qty);
      if (qty === null) return null;
      line.qty = qty;

      const tray = text(row?.traySize, 20);
      if (tray) line.traySize = tray;
      lines.push(line);
    }
    if (lines.length === 0) return null;
    out.lines = lines;
  }

  // Grazing prices off a tier; the catering packages off a head count.
  // Both are one line and neither sends a list.
  const serviceKey = looksLikeId(src?.serviceKey) ? src.serviceKey.trim() : null;
  if (serviceKey) out.serviceKey = serviceKey;

  // "100–150" — an en dash, so this is text rather than an id.
  const paxRange = text(src?.paxRange, 40);
  if (paxRange) out.paxRange = paxRange;

  const pax = count(src?.pax);
  if (pax !== null) out.pax = pax;

  // An admin-created service can be priced per kilo, so this one is allowed
  // a decimal where every other quantity here is not.
  const quantity = amount(src?.quantity);
  if (quantity !== null) out.quantity = quantity;

  // Which boxes were ticked, never what they cost. The amounts live in
  // src/domain/pricing.js, which both sides import.
  if (src?.addons && typeof src.addons === "object" && !Array.isArray(src.addons)) {
    const addons = {};
    for (const [key, value] of Object.entries(src.addons).slice(0, MAX_ADDONS)) {
      if (/^[a-zA-Z0-9_-]{1,40}$/.test(key)) addons[key] = Boolean(value);
    }
    if (Object.keys(addons).length > 0) out.addons = addons;
  }

  // Nothing but a service name is not an order.
  return Object.keys(out).length > 1 ? out : null;
}

/**
 * The order as a person reads it, for the queue screen.
 *
 * Money is absent by construction here too, and that is not an oversight:
 * the total on the row is the one OUR server computed from OUR tables. A
 * per-line figure sent by the browser sitting beside it would be a second,
 * unverified set of numbers on the same screen, and whoever is approving
 * would have no way of telling which they were reading.
 */
function cleanGroups(src) {
  const rows = Array.isArray(src) ? src.slice(0, MAX_GROUPS) : [];
  const out = [];
  for (const row of rows) {
    const title = text(row?.title);
    if (!title) continue;
    const group = { title };

    if (looksLikeId(row?.service))   group.service = row.service.trim();
    if (looksLikeId(row?.packageId)) group.packageId = row.packageId.trim();

    for (const [key, max] of [["kind", 60], ["subtitle", MAX_TEXT], ["units", 60]]) {
      const value = text(row?.[key], max);
      if (value) group[key] = value;
    }

    const qty = count(row?.qty);
    if (qty !== null) group.qty = qty;

    if (Array.isArray(row?.contents)) {
      const contents = row.contents
        .slice(0, MAX_LINES)
        .map((line) => text(line))
        .filter(Boolean);
      if (contents.length > 0) group.contents = contents;
    }

    out.push(group);
  }
  return out;
}

/**
 * What the customer is asking for, cleaned to exactly what the dashboard
 * agreed to read — never more.
 *
 * ── Why both kinds now carry a whole order ────────────────────────────────
 *
 * This used to take a package id for a change and a list of dishes for an
 * add, because the customer picked from a short list on the Order Status
 * page. It does not work that way any more: they are sent to the builder and
 * they build, so what comes back is a basket that may hold combo trays,
 * party trays and packed meals at once.
 *
 * The two kinds are still different, and the difference is what the row
 * MEANS rather than what it holds — `change` replaces the booking, `add`
 * sits on top of it. That is the dashboard's to apply, and applyAddition
 * SUMS, so running a change through it would turn 50 pax into 150.
 *
 * NO PRICES, EVER. Their own shared agreement says the total is whatever the
 * browser sent and server-side validation is a prerequisite of it; a
 * customer-proposed amount walks straight into that. The handler prices this
 * from our own tables and writes that figure alongside.
 */
/**
 * The one shape the dashboard's Change Package button can apply as it
 * stands: a single catalogue package, quantity one.
 *
 * Their question, and it is the right one — `lines` is an array with
 * quantities on it, and their v1 applies one package. Both live requests so
 * far happen to be a single line at qty 1, so they are applicable today, but
 * that is luck rather than a contract.
 *
 * It cannot be made a contract by restricting the request, because the
 * builder genuinely produces baskets: a customer changing an order can put
 * two combos and a party tray in it, and refusing that at Send would be
 * offering a build the system will not accept — the one thing this product
 * does not do to people.
 *
 * So the row says which it is, and says it in a field rather than making
 * anyone infer it from the array. `singlePackageId` is the id when the
 * request is one package at quantity one, and null for everything else.
 * v1 branches on it and routes the rest to a human; nothing has to change
 * here when multi-line support lands.
 *
 * Quantity one specifically: two of the same package is as far outside
 * "apply one package" as two different ones.
 */
export function singlePackageId(lineItems) {
  if (lineItems?.service !== "combo-trays") return null;
  const lines = Array.isArray(lineItems.lines) ? lineItems.lines : [];
  if (lines.length !== 1) return null;
  const [line] = lines;
  return line?.qty === 1 && line?.packageId ? line.packageId : null;
}

export function cleanAfter(kind, after) {
  if (!KINDS.includes(kind)) return null;

  const lineItems = cleanGroup(after?.lineItems, true);
  if (!lineItems) return null;

  // The rush fee is an ordering decision, not a change one, and it is a
  // PRICE. Pinned to false so the pricing path is the same one either way.
  lineItems.rush = false;

  const groups = cleanGroups(after?.groups);
  // A request the queue cannot describe is one nobody can act on.
  if (groups.length === 0) return null;

  // Stated rather than inferred. See singlePackageId above.
  return { lineItems, groups, singlePackageId: singlePackageId(lineItems) };
}

/**
 * The booking as it stood when they asked.
 *
 * Not an audit record — a GUARD. The dashboard compares this against the
 * opportunity at approve time, so a request made on Monday cannot silently
 * overwrite an edit Faithy made herself on Tuesday.
 *
 * Only the fields the request touches, at their request: comparing the whole
 * booking would refuse a valid approval because somebody corrected a phone
 * number in between.
 *
 * `branch` rides along because their queue screens are branch-scoped and it
 * costs us nothing. `total` is a display snapshot only — what the customer
 * was looking at when they asked — and is never authoritative for pricing.
 */
export function buildBefore(fields = {}, monetaryValue = null) {
  const total = Number(monetaryValue);
  return {
    branch: str(fields.branch) || null,
    package_name: str(fields.package_name) || null,
    pax_count: str(fields.pax_count) || null,
    event_date: str(fields.event_date) || null,
    total: Number.isFinite(total) && total > 0 ? total : null,
  };
}

/**
 * May this request be made at all?
 *
 * The window is checked here AND again by the dashboard on approve, from the
 * same function, because the two questions are genuinely different: "may they
 * ask today" and "may this still be applied today". The client found the case
 * that separates them — an event on the 19th, asked in time, approved on the
 * 18th, after the kitchen bought ingredients on the 16th.
 *
 * @returns {{ ok: true, after: object } | { ok: false, reason: string }}
 */
export function validateRequest({ kind, after, eventDate }, now = new Date()) {
  if (!KINDS.includes(kind)) return { ok: false, reason: "unknown-kind" };

  const window = requestWindow(eventDate, kind, now);
  if (!window.allowed) return { ok: false, reason: "closed" };

  const cleaned = cleanAfter(kind, after);
  if (!cleaned) return { ok: false, reason: "unusable" };

  return { ok: true, after: cleaned };
}

/**
 * What a customer is told. One message per reason, and none of them blame
 * them for a rule they were not shown.
 */
export const REASONS = {
  closed:
    "This booking is too close to the event to change online. Message us and " +
    "we will see what we can do.",
  "already-open":
    "You already have a request with us for this booking. We will come back " +
    "to you on that one first.",
  unknown:
    "We could not send that request. Please try again, or message us and we " +
    "will sort it out with you.",
};

export function reasonMessage(reason) {
  return REASONS[reason] ?? REASONS.unknown;
}

/**
 * The catalogue package an order is for, read back out of its dish text.
 *
 * order_groups carries the id, but only on bookings placed since it existed.
 * Every order before that would otherwise be unchangeable forever, which is
 * every order there currently is.
 *
 * dishes_selected turns out to hold what we need, and holds it reliably:
 *
 *   • Mary Rose Package (100 pax) — PHP 35,000
 *   • Jeanette Package (50 pax) — PHP 19,000
 *   • Family Combo 1 (15 pax) — PHP 10,000
 *
 * That line is written by dishesSelectedText() from the cart, so the name and
 * the size are the CATALOGUE'S OWN, not typed by anybody. It is the field
 * package_name should have been: that one holds "Jeanette 100PAX" and
 * "Maryrose Package 100Pax" and is blank on eighteen orders in thirty.
 *
 * Matched on name AND size together, exactly, never fuzzily. Both halves are
 * needed: "Mary Rose Package" alone spans three prices, and a near-match is
 * how somebody's 25-pax booking becomes a 100-pax one.
 *
 * A line that names a single dish rather than a package simply does not
 * match, which is right — there is nothing to change it to.
 *
 * @param {string} dishesText   dishes_selected from the opportunity
 * @param {Array}  packages     [{ id, name, pax_label }]
 */
const NEWLINE = String.fromCharCode(10);

export function packageFromDishText(dishesText, packages) {
  const key = (name, pax) =>
    `${String(name ?? "").trim().toLowerCase()}|${String(pax ?? "").trim().toLowerCase()}`;

  const byKey = new Map();
  for (const p of packages ?? []) {
    if (p?.id && p?.name && p?.pax_label) byKey.set(key(p.name, p.pax_label), p.id);
  }
  if (byKey.size === 0) return null;

  // Every line, not only the first: a basket can hold a party tray before
  // the package, and the package is the line worth finding.
  for (const raw of String(dishesText ?? "").split(NEWLINE)) {
    const line = raw.trim();

    // "• Jeanette Package (50 pax) — PHP 19,000". The bullet is part
    // of the pattern, which is what skips the indented dish lines beneath a
    // package — a separate startsWith check for that guarded nothing, and
    // a break test removing it stayed green. A quantity prefix
    // ("2× ") only ever appears on trays and packs, never on a package.
    const m = /^•\s*(.+?)\s*\(([^)]+)\)\s*—/.exec(line);
    if (!m) continue;

    const id = byKey.get(key(m[1], m[2]));
    if (id) return id;
  }
  return null;
}
