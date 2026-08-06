import { supabase } from "./supabase-client.js";

export const TRAY_SIZES = [
  { id: "family", label: "Family", desc: "1kg · 4–6 pax" },
  { id: "feast",  label: "Feast",  desc: "2kg · 10–12 pax" },
  { id: "xxxl",   label: "XXXL",   desc: "5kg · 20–25 pax" },
];

const MENU = {
  Beef: {
    prices: { family: 2500, feast: 5000, xxxl: 10500 },
    dishes: [
      "Heirloom Callos",
      "Lengua Con Setas",
      "Beef Tenderloin Salpicao",
      "Beef Tenderloin Stroganoff",
      "Beef Bicol Express Green Curry",
      "Beef Pares Marrow Tendon with Shiitake & Potato Balls",
      "Roast Beef Pink Mash with French Beans",
    ],
  },
  Seafood: {
    prices: { family: 2000, feast: 4000, xxxl: 8000 },
    dishes: [
      "Squid Salpicao",
      "Baked Shrimp",
      "Baked Mussels",
      "Salmon Teriyaki Melt",
      "Baked Salmon",
      "Lemon Fish Fillet",
      "Mango Salsa Sole Fish",
      "Seafood Cajun with Crab",
      "Salted Egg Yolk Shrimp",
      "Calamares",
      "Creamy Seafood Bouillabaisse",
    ],
  },
  Pork: {
    prices: { family: 2300, feast: 4500, xxxl: 9500 },
    dishes: [
      "Lechon Macau with Bokchoy",
      "Lechon Belly Roll",
      "Babyback Ribs",
      "Korean Blueberry Roast Pork Belly",
      "Lechon Belly Kare-Kare",
      "Spare Ribs in Peanut Sauce",
    ],
  },
  Chicken: {
    prices: { family: 2000, feast: 4000, xxxl: 8000 },
    dishes: [
      "Chicken Rosemary",
      "Chicken Cordon Bleu",
      "Chicken Parmigiana",
      "Citrus Chicken Confit",
      "Chicken Alexander",
      "Corgiana (Cordon Bleu x Parmigiana)",
      "Soy Garlic Chicken Wings",
    ],
  },
  Pasta: {
    prices: { family: 2000, feast: 4000, xxxl: 8000 },
    dishes: [
      "Rolled Lasagna",
      "Baked Macaroni",
      "Creamy Truffle Linguine",
      "Pesto Cajun Shrimp Linguine",
      "Smoked Carbonara",
      "Bacon Aglio Olio",
      "Aligue Mac n' Cheese",
      "Puttanesca",
      "Charlie Chan Pasta",
      "Crumble Pasta",
      "Sausage and Mushroom Pasta",
      "Eggplant Parmigiana",
    ],
  },
  Dessert: {
    prices: { family: 1000, feast: 2500, xxxl: 4000 },
    dishes: [
      "Mango Graham",
      "Tiramisu",
      "Mixed Berries Croissant Pudding",
      "Leche Flan",
      "Smore's Fudge Brownies",
      "Burnt Basque Orange Cheese Cake",
    ],
  },
  Rice: {
    prices: { family: 350, feast: 700, xxxl: 1500 },
    dishes: [
      "Blue Ternate Rice",
      "Steamed Rice",
      "Java Garlic Rice",
    ],
  },
};

/**
 * Prices keyed by dish id — { "beef-salpicao": { family, feast, xxxl } }.
 *
 * Kept separate from MENU because MENU holds one price per *category*,
 * which is not what the data says. dish_prices is keyed by dish, and the
 * dashboard's Dishes tab lets an admin set one dish's price on its own. The
 * old loader flattened that by overwriting the category price once per
 * dish, so whichever row arrived last won and every other dish in that
 * category was quietly priced as that one. It worked only because all 71
 * dishes currently share their category's price.
 *
 * MENU's prices remain as the offline fallback for a dish with no row.
 */
const PRICE_BY_DISH = {};

/** Names are what the UI shows; ids are what prices are keyed by. */
const DISH_ID_BY_NAME = {};

export async function loadPartyTrayData() {
  try {
    const [dishRes, priceRes] = await Promise.all([
      supabase.from("dishes").select("*"),
      supabase.from("dish_prices").select("*"),
    ]);
    if (dishRes.error) throw dishRes.error;
    if (priceRes.error) throw priceRes.error;

    const activeDishes = dishRes.data.filter((d) => d.active !== false && MENU[d.category]);
    if (activeDishes.length === 0) {
      throw new Error("Supabase returned no active party tray dishes");
    }

    const priceByDish = {};
    for (const row of priceRes.data) {
      if (!priceByDish[row.dish_id]) priceByDish[row.dish_id] = {};
      // Tray sizes are capitalised in the table and lowercase everywhere in
      // the app, which is why they are normalised here rather than at every
      // read site.
      priceByDish[row.dish_id][String(row.tray_size).toLowerCase()] = parseFloat(row.price);
    }

    const nextMenu = {};
    for (const category of Object.keys(MENU)) {
      nextMenu[category] = { prices: { ...MENU[category].prices }, dishes: [] };
    }

    for (const dish of activeDishes) {
      nextMenu[dish.category].dishes.push(dish.name);
      DISH_ID_BY_NAME[dish.name] = dish.id;
      PRICE_BY_DISH[dish.id] = {
        ...MENU[dish.category].prices,
        ...(priceByDish[dish.id] ?? {}),
      };
    }

    // Categories with zero active dishes keep their hardcoded dish list
    for (const category of Object.keys(nextMenu)) {
      if (nextMenu[category].dishes.length === 0) {
        nextMenu[category].dishes = MENU[category].dishes;
      }
    }

    Object.assign(MENU, nextMenu);
  } catch (e) {
    console.warn("Party tray data: Supabase unavailable, using hardcoded fallback.", e);
  }
}

export function getCategories() {
  return Object.keys(MENU);
}

export function getMenuItems(category) {
  return MENU[category]?.dishes ?? [];
}

/** The id prices are keyed by. Null offline, where only names exist. */
export function getDishId(dishName) {
  return DISH_ID_BY_NAME[dishName] ?? null;
}

/**
 * The whole price table, for the pure pricing functions in
 * src/domain/pricing.js. The server builds the same shape from the same
 * tables, so both sides compute a total the same way.
 */
export function getDishPriceTable() {
  return PRICE_BY_DISH;
}

/**
 * What one tray of this dish costs.
 *
 * Falls back to the category price when the dish is unknown — offline, or
 * a dish with no row in dish_prices — so a missing row shows the category
 * rate rather than zero.
 */
export function getDishPrice(dishName, traySize, category) {
  const id = DISH_ID_BY_NAME[dishName];
  const perDish = id ? PRICE_BY_DISH[id]?.[traySize] : undefined;
  if (perDish != null) return perDish;
  return MENU[category]?.prices[traySize] ?? 0;
}

export function getCategoryPrice(category, traySize) {
  return MENU[category]?.prices[traySize] ?? 0;
}
