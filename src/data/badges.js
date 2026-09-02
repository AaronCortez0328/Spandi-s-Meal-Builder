/**
 * Which cards carry a badge, and what it says.
 *
 * One source. Every card asks this and nothing else knows where the answer
 * comes from, so moving it to a Supabase column later is a change to this
 * file and to nothing that renders.
 *
 * ── The labels are three different KINDS of claim ──────────────────────────
 *
 *   Top pick      editorial. We choose it. Nobody can call it false.
 *   Best seller   a factual claim about sales, and only used where the
 *                 numbers carry it.
 *
 * That distinction is the whole reason there are two words rather than one.
 * "Recommended", which both of these replace, said nothing either way -- and
 * for a food business the honest version of the claim is worth more than the
 * vague one.
 *
 * ── Rules that hold whatever gets added here ───────────────────────────────
 *
 * ONE badge per card, ever. Below 860px a service card lays its icon, title
 * and badge into a three-column grid with a single `badge` area, so a second
 * one lands on top of the first. See .service-card in main.css.
 *
 * UNAVAILABLE ALWAYS WINS the slot. A card that cannot be ordered says so
 * and nothing else -- badging something the customer will then be refused is
 * the fault this codebase spent a long time removing everywhere else.
 * updateServiceAvailability() in app.js enforces it.
 *
 * SCARCITY. Badge everything and the badge means nothing. At most one per
 * group on the chooser, one or two per builder.
 */

/**
 * Editorial picks on the service chooser, keyed by data-service.
 *
 * These two are the cards that used to say "Recommended", kept deliberately:
 * they are different groups, so neither crowds the other.
 *
 * Worth knowing, and left as a business decision rather than changed here:
 * by actual sales Party Trays is the biggest service in the pipeline (182
 * bookings against 33 for Combo Trays). The pick sits on combos anyway,
 * which is a legitimate call -- a combo is worth several times an a la carte
 * tray -- but it is a choice about what to push, not a reading of the data.
 */
const SERVICE_BADGES = {
  "catering":         { label: "Top pick", variant: "top-pick" },
  "classic-catering": { label: "Top pick", variant: "top-pick" },
};

/**
 * Sales claims on individual packages, keyed by the Supabase package id.
 *
 * jeanette-50 only. Counted from the pipeline: 77 Jeanette bookings against
 * 41 for Sabrina, the next one down, and 47 of those 77 are the 50 pax --
 * so this exact card, not the name in general. jeanette-100 sold 23 and does
 * not get one, because a badge on both halves the meaning of each.
 */
const PACKAGE_BADGES = {
  "jeanette-50": { label: "Best seller", variant: "seller" },
};

const SOURCES = {
  service: SERVICE_BADGES,
  package: PACKAGE_BADGES,
};

/**
 * The badge for a card, or null.
 *
 * @param {"service"|"package"} kind
 * @param {string} id  data-service value, or the package id
 * @returns {{ label: string, variant: string } | null}
 */
export function badgeFor(kind, id) {
  if (!id) return null;
  return SOURCES[kind]?.[id] ?? null;
}
