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

/** Trays a package_items row can ask for. Anything else is refused. */
const TRAY_SIZES = ["Family", "Large", "XL", "XXL", "XXXL"];

/** More than this in one request is a mistake or an attack, not an order. */
const MAX_ITEMS = 20;
const MAX_QTY = 99;

function str(v) {
  return String(v ?? "").trim();
}

/**
 * A catalogue id: lower-case letters, digits and hyphens.
 *
 * Deliberately not derived from anything. Sibling ids cannot be computed —
 * `special-50` is "Mary Rose Package, 50 pax", sitting between mary-rose-25
 * and mary-rose-100, so any `${base}-${pax}` scheme breaks on it. The screen
 * reads real ids from the catalogue and sends one back; this only checks the
 * shape, and the dashboard confirms it exists when it applies the change.
 */
function looksLikeId(v) {
  // A string, not something that merely coerces to one. Number 42 becomes
  // the id "42", which looks valid and is not — real ids read jeanette-100
  // and fam-c1. Refusing the type is free; guessing at it is not.
  if (typeof v !== "string") return false;
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.trim());
}

/**
 * What the customer is asking for, cleaned to exactly what the dashboard
 * agreed to read — never more.
 *
 * Returns null when it cannot be made valid. A request nobody can apply is
 * worse than no request: it sits in the queue looking actionable.
 */
export function cleanAfter(kind, after) {
  const src = after ?? {};

  if (kind === "change") {
    // The RAW value, not a coerced one: str() first would hand looksLikeId a
    // string every time and the type check would never fire.
    const id = src.package_id;
    return looksLikeId(id) ? { package_id: id.trim() } : null;
  }

  if (kind === "add") {
    const rows = Array.isArray(src.items) ? src.items : [];
    if (rows.length === 0 || rows.length > MAX_ITEMS) return null;

    const items = [];
    for (const row of rows) {
      const dishId = row?.dish_id;   // raw, for the same reason as above
      const tray = str(row?.tray_size);
      // A number input hands back a string, so "2" has to be allowed — but
      // only from a number or a string. Number(true) is 1 and Number([2])
      // is 2, and neither is a quantity anybody typed.
      const raw = row?.quantity;
      const qty = (typeof raw === "number" || typeof raw === "string")
        ? Number(raw)
        : NaN;

      if (!looksLikeId(dishId)) return null;
      if (!TRAY_SIZES.includes(tray)) return null;
      // Number(null) is 0 rather than NaN, so this has to check the range
      // and not merely that it parsed.
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;

      items.push({ dish_id: dishId.trim(), tray_size: tray, quantity: qty });
    }
    return { items };
  }

  return null;
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
