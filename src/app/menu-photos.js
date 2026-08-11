/**
 * Menu photography — one photo per category, pack type or service.
 *
 * Every path in the app lives here rather than inline in the five builders,
 * so a renamed or replaced file is a one-line change in a single place
 * instead of a hunt through the builders.
 *
 * The keys are not decoration: for packed meals and grazing they are the
 * exact ids Supabase returns, so those lookups cannot drift from the data.
 * Party trays key off the category name (also from Supabase) and the two
 * catering packages are mapped explicitly, since their file names are
 * shorter than their service keys.
 *
 * A key with no photo yields no markup at all — photoHtml() returns an empty
 * string, and the builder renders exactly as it did before any of this
 * existed. That is what lets a new branch, package or category ship without
 * a photo ready and still look deliberate rather than broken.
 *
 * Files live in public/, so Vite serves them from the site root untouched
 * and they are not fingerprinted into the bundle.
 */

const BASE = "/images/menu";

/** Party tray categories, keyed by the category name shown on the tabs. */
const PARTY_TRAYS = {
  Beef:    `${BASE}/party-trays/beef.jpg`,
  Seafood: `${BASE}/party-trays/seafood.jpg`,
  Pork:    `${BASE}/party-trays/pork.jpg`,
  Chicken: `${BASE}/party-trays/chicken.jpg`,
  Pasta:   `${BASE}/party-trays/pasta.jpg`,
  Dessert: `${BASE}/party-trays/dessert.jpg`,
  Rice:    `${BASE}/party-trays/rice.jpg`,
};

/** Packed meals, keyed by packed_meal_types.id. */
const PACKED_MEALS = {
  "snacks":             `${BASE}/packed-meals/snacks.jpg`,
  "salad-noodles":      `${BASE}/packed-meals/salad-noodles.jpg`,
  "rice-meals":         `${BASE}/packed-meals/rice-meals.jpg`,
  "premium-rice-meals": `${BASE}/packed-meals/premium-rice-meals.jpg`,
};

/** Grazing, keyed by grazing_services.id. */
const GRAZING = {
  "grazing-table": `${BASE}/grazing/grazing-table.jpg`,
  "grazing-board": `${BASE}/grazing/grazing-board.jpg`,
};

/** Full-service catering, keyed by catering_services.id. */
const CATERING_PACKAGES = {
  "basic-catering":   `${BASE}/catering-packages/basic.jpg`,
  "classic-catering": `${BASE}/catering-packages/classic.jpg`,
};

/** Combo party trays. One shot for the whole service, not one per combo —
 *  the 30 combos differ dish by dish, and a photo per group would claim a
 *  precision we do not have photos for yet. */
const COMBO_TRAYS_HERO = `${BASE}/combo-trays/hero.jpg`;

/**
 * Where the subject sits, for the frames that crop with object-fit: cover.
 *
 * These are photographs, not artwork cut to a spec: they run from 0.45 to
 * 2.22 in aspect, a fivefold spread. No single frame shape flatters all of
 * them, so the frame stops trying — it takes whatever shape the layout needs
 * and each photo says which part of itself to keep. Centre is the default and
 * suits a photo that fills its frame; the entries below are the ones whose
 * subject sits off-centre and would otherwise be cropped away.
 *
 * Tuning one of these is a two-value edit here, with no new file and no
 * re-export, which is the whole reason the shipped photos are uncropped.
 */
const FOCUS = {
  // Shot upright: ceiling above, floor tiles below. The domes and the
  // skirted line — the part that says "buffet" — sit just under halfway.
  [`${BASE}/catering-packages/basic.jpg`]: "50% 55%",
  // The tray of food fills the left two thirds; the right is a candelabra
  // and a window, which is scenery rather than the thing being sold.
  [`${BASE}/catering-packages/classic.jpg`]: "38% 50%",
  // The top quarter is blank marquee tarpaulin. The food, the roses and the
  // Spandi's sign are all in the lower half.
  [`${BASE}/grazing/grazing-board.jpg`]: "50% 65%",
  // grazing-table.jpg is composed edge to edge — centre keeps the basket,
  // the sign and the ramekins together, so it needs no entry.
};

export function partyTrayPhoto(category)   { return PARTY_TRAYS[category] ?? null; }
export function packedMealPhoto(typeId)    { return PACKED_MEALS[typeId] ?? null; }
export function grazingPhoto(serviceKey)   { return GRAZING[serviceKey] ?? null; }
export function cateringPhoto(serviceKey)  { return CATERING_PACKAGES[serviceKey] ?? null; }
export function comboTraysPhoto()          { return COMBO_TRAYS_HERO; }

function esc(val) {
  return String(val ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The markup for one photo, or "" when there is no photo for that key.
 *
 * @param {string|null} src      a path from one of the lookups above
 * @param {string} alt           what the photo shows, for anyone who cannot see it
 * @param {"hero"|"card"} variant  where it sits: above a set of choices, or
 *   inside one. The variant sets the spacing and the corner radius; the
 *   frame's shape comes from the layout it lands in, and the crop is
 *   resolved per photo by FOCUS above.
 * @param {string|null} caption  what the photo is actually of.
 *
 *   There is one photo per category, not per dish. Sitting beside a named
 *   dish — "Garlic Beef Tips & Mushroom" — an unlabelled photo reads as
 *   that dish, and a customer could order believing they had seen it. The
 *   caption says what it really is, which costs a line and avoids a
 *   complaint on delivery day.
 */
export function photoHtml(src, alt, variant = "hero", caption = null) {
  if (!src) return "";
  const focus = FOCUS[src];
  return `
    <figure class="menu-photo menu-photo--${variant}">
      <img
        src="${esc(src)}"
        alt="${esc(alt)}"
        loading="lazy"
        decoding="async"
        ${focus ? `style="object-position: ${esc(focus)}"` : ""}
      />
      ${caption ? `<figcaption class="menu-photo__caption">${esc(caption)}</figcaption>` : ""}
    </figure>
  `;
}
