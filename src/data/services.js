import { supabase } from "./supabase-client.js";

/**
 * Which service cards the homepage may offer, read from the dashboard's
 * `meal_builder_services` table.
 *
 * One row per card, keyed by a slug that matches the `data-service` attribute
 * in index.html exactly. Read-only by agreement: the dashboard writes it, we
 * never touch it.
 *
 * ── THE source of truth for card visibility ────────────────────────────────
 *
 * Four of the seven cards used to take their availability from
 * catering_services.active and grazing_services.active, and the other three
 * had no switch at all. Those catalog flags still decide whether a row shows
 * up inside its own builder, which is a different question and unchanged --
 * but they no longer decide whether the card on the homepage is offered.
 * Two sources for one fact is what this removes.
 *
 * ── Fails open, deliberately ───────────────────────────────────────────────
 *
 * Every unknown is treated as available: a failed fetch, a missing row, a
 * null. The alternative disables all seven cards and takes the shop offline
 * over a dropped request, which is a far worse failure than briefly offering
 * something that was just switched off.
 *
 * That makes a silent failure dangerous in a specific way -- everything looks
 * fine -- so this does not do what the catalog loaders do. They catch, log a
 * console.warn, quietly serve hardcoded data, and leave a broken fetch
 * indistinguishable from a working one. Here the failure is a console.error
 * that names the consequence, and getServicesLoadState() reports it for
 * anyone who wants to assert on it.
 *
 * ── available_from / available_until ───────────────────────────────────────
 *
 * Granted and deliberately unread. The columns exist so the schema is settled;
 * scheduling is a later phase. Only `active` is consulted.
 */

/** slug -> row, for the rows currently held. Empty until the first load. */
let services = new Map();

/** "never" until the first attempt, then "ok" or "failed". */
let loadState = "never";

/**
 * Whether the last fetch worked. "never" means no attempt has finished yet,
 * which reads the same as "failed" to a caller -- both mean the answers below
 * are defaults rather than data.
 */
export function getServicesLoadState() {
  return loadState;
}

/**
 * Is this card offered?
 *
 * True unless a row exists and explicitly says otherwise. A slug with no row,
 * a null, or nothing loaded at all all answer true -- see the note on failing
 * open above. Only a literal `false` closes a card.
 */
export function isServiceActive(slug) {
  return services.get(slug)?.active !== false;
}

/**
 * The admin-created cards, in the order the dashboard put them.
 *
 * ── Why this one fails CLOSED, when isServiceActive fails open ─────────────
 *
 * The seven built-ins exist in index.html whether this table loads or not, so
 * failing open there means a dropped request cannot take a live card off the
 * shop — the right direction for markup that is already on the page.
 *
 * A custom card has no markup. It exists only because a row said so, so the
 * two failures are not the same shape at all: an unknown built-in slug means
 * "we could not check", while an unknown custom slug means "there is nothing
 * here". Rendering one and then discovering the row is unreadable would put a
 * card on the chooser with no service behind it — worse than never showing it,
 * because the customer has already chosen by the time anything can say no.
 *
 * So only a row that is present, custom, and explicitly active is returned.
 * Nothing loaded means no custom cards, which is exactly what should happen.
 * isServiceActive is untouched and the seven keep today's behaviour precisely.
 *
 * A failed refresh keeps the previous rows (see loadServices), so a blip
 * during the 30-second poll cannot make a live card flicker out either.
 */
export function getCustomServices() {
  return selectCustomServices([...services.values()]);
}

/**
 * The filter above, as a function of its input rather than of module state.
 *
 * Separated so the rule can be tested directly. It is the one piece of this
 * module where being wrong puts a card on the chooser with nothing behind it,
 * and it is worth more than a comment saying it is careful.
 *
 * Every condition is checked positively — `=== false`, `=== true`, a truthy
 * slug — so a row with the field missing, a null, or a string "false" from
 * some future shape all fall out rather than passing on a loose comparison.
 */
export function selectCustomServices(rows) {
  return (rows ?? [])
    .filter((row) => row?.is_builtin === false && row?.active === true && Boolean(row?.slug))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Fetches the table. Resolves either way.
 *
 * A failure leaves the previous rows in place rather than emptying them, so
 * one dropped request during the 30-second poll cannot briefly reopen a card
 * the dashboard has just closed. The first load is the exception: there is
 * nothing to keep, so everything stays open, which is the intended direction.
 *
 * Never selects *: `updated_by_name` and `created_by_name` are staff names
 * and are deliberately not granted to anon. This is not a style preference —
 * a star select comes back 401 "permission denied for table", so asking for
 * everything gets nothing. Only the columns actually used are named.
 */
export async function loadServices() {
  // Wrapped, not just error-checked. supabase-js reports a refusal -- RLS, a
  // missing table, a bad column -- through `error`, but a network failure
  // rejects instead, and an unhandled rejection here means loadState never
  // moves off "never" and nothing is logged: the exact silent failure this
  // module exists to avoid. Cards would still stay open, which is the right
  // direction, but nobody would know why.
  let data, error;
  try {
    ({ data, error } = await supabase
      .from("meal_builder_services")
      .select(
        "slug, active, label, is_builtin, description, price_from, facts_label, sort_order"
      ));
  } catch (thrown) {
    error = thrown;
  }

  if (error) {
    loadState = "failed";
    console.error(
      "Could not load meal_builder_services — every service card will stay " +
      "enabled until this succeeds:",
      error.message ?? error
    );
    return services;
  }

  loadState = "ok";
  services = new Map((Array.isArray(data) ? data : []).map((row) => [row.slug, row]));
  return services;
}
