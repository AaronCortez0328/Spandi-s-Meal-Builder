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
 * @param {"hero"|"card"} variant  banner above a set of choices, or thumbnail inside one
 */
export function photoHtml(src, alt, variant = "hero") {
  if (!src) return "";
  return `
    <div class="menu-photo menu-photo--${variant}">
      <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" />
    </div>
  `;
}
