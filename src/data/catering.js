import { fetchSheetRows, PRICING_SHEET_URLS } from "./sheet.js";

// ── Dish-level prices: per-dish overrides loaded from sheet, fallback to category ─
let DISH_PRICES = {}; // { "Dish Name": { Family: price, Feast: price, XXXL: price } }

// ── Category fallback prices ──────────────────────────────────────────────────
const CATEGORY_PRICES = {
  Beef:      { Family: 2500, Feast: 5000, XXXL: 10500 },
  Seafood:   { Family: 2000, Feast: 4000, XXXL: 8000 },
  Pork:      { Family: 2300, Feast: 4500, XXXL: 9500 },
  Chicken:   { Family: 2000, Feast: 4000, XXXL: 8000 },
  Pasta:     { Family: 2000, Feast: 4000, XXXL: 8000 },
  Dessert:   { Family: 1000, Feast: 2500, XXXL: 4000 },
  Rice:      { Family: 350,  Feast: 700,  XXXL: 1500 },
  Vegetable: { Family: 800,  Feast: 1500, XXXL: 3000 },
};

// ── All available dishes with correct categories ───────────────────────────────
const DISHES = [
  // Beef
  { id: "garlic-beef-tips",      name: "Garlic Beef Tips & Mushroom",                          category: "Beef" },
  { id: "dry-rub-roast-beef",    name: "Dry Rub Roast Beef",                                   category: "Beef" },
  { id: "heirloom-callos",       name: "Heirloom Callos",                                       category: "Beef" },
  { id: "lengua-con-setas",      name: "Lengua Con Setas",                                      category: "Beef" },
  { id: "beef-salpicao",         name: "Beef Tenderloin Salpicao",                              category: "Beef" },
  { id: "beef-stroganoff",       name: "Beef Tenderloin Stroganoff",                            category: "Beef" },
  { id: "beef-bicol-express",    name: "Beef Bicol Express Green Curry",                        category: "Beef" },
  { id: "beef-pares",            name: "Beef Pares Marrow Tendon with Shiitake & Potato Balls", category: "Beef" },
  { id: "roast-beef-pink-mash",  name: "Roast Beef Pink Mash with French Beans",               category: "Beef" },

  // Seafood
  { id: "squid-salpicao",        name: "Squid Salpicao",                category: "Seafood" },
  { id: "baked-shrimp",          name: "Baked Shrimp",                  category: "Seafood" },
  { id: "baked-mussels",         name: "Baked Mussels",                 category: "Seafood" },
  { id: "salmon-teriyaki",       name: "Salmon Teriyaki Melt",          category: "Seafood" },
  { id: "baked-salmon",          name: "Baked Salmon",                  category: "Seafood" },
  { id: "lemon-fish-fillet",     name: "Lemon Fish Fillet",             category: "Seafood" },
  { id: "mango-salsa-sole",      name: "Mango Salsa Sole Fish",         category: "Seafood" },
  { id: "seafood-cajun-crab",    name: "Seafood Cajun with Crab",       category: "Seafood" },
  { id: "salted-egg-shrimp",     name: "Salted Egg Yolk Shrimp",        category: "Seafood" },
  { id: "calamares",             name: "Calamares",                     category: "Seafood" },
  { id: "seafood-bouillabaisse", name: "Creamy Seafood Bouillabaisse",  category: "Seafood" },
  { id: "cajun-shrimp-mussels",  name: "Cajun Shrimp and Mussels",      category: "Seafood" },

  // Pork
  { id: "lechon-macau",          name: "Lechon Macau with Bokchoy",        category: "Pork" },
  { id: "lechon-belly-roll",     name: "Lechon Belly Roll",                category: "Pork" },
  { id: "babyback-ribs",         name: "Babyback Ribs",                    category: "Pork" },
  { id: "korean-blueberry-pork", name: "Korean Blueberry Roast Pork Belly", category: "Pork" },
  { id: "lechon-belly-kare",     name: "Lechon Belly Kare-Kare",           category: "Pork" },
  { id: "spare-ribs-peanut",     name: "Spare Ribs in Peanut Sauce",       category: "Pork" },
  { id: "lumpiang-shanghai",     name: "Lumpiang Shanghai",                category: "Pork" },
  { id: "grilled-pork-belly",    name: "Grilled Pork Belly",               category: "Pork" },

  // Chicken
  { id: "chicken-rosemary",      name: "Chicken Rosemary",                      category: "Chicken" },
  { id: "chicken-cordon-bleu",   name: "Chicken Cordon Bleu",                   category: "Chicken" },
  { id: "chicken-parmigiana",    name: "Chicken Parmigiana",                    category: "Chicken" },
  { id: "citrus-chicken",        name: "Citrus Chicken Confit",                 category: "Chicken" },
  { id: "chicken-alexander",     name: "Chicken Alexander",                     category: "Chicken" },
  { id: "corgiana",              name: "Corgiana (Cordon Bleu x Parmigiana)",   category: "Chicken" },
  { id: "soy-garlic-wings",      name: "Soy Garlic Chicken Wings",              category: "Chicken" },

  // Pasta
  { id: "rolled-lasagna",        name: "Rolled Lasagna",              category: "Pasta" },
  { id: "baked-macaroni",        name: "Baked Macaroni",              category: "Pasta" },
  { id: "creamy-truffle",        name: "Creamy Truffle Linguine",     category: "Pasta" },
  { id: "pesto-cajun-shrimp",    name: "Pesto Cajun Shrimp Linguine", category: "Pasta" },
  { id: "smoked-carbonara",      name: "Smoked Carbonara",            category: "Pasta" },
  { id: "bacon-aglio-olio",      name: "Bacon Aglio Olio",            category: "Pasta" },
  { id: "aligue-mac",            name: "Aligue Mac n' Cheese",        category: "Pasta" },
  { id: "puttanesca",            name: "Puttanesca",                  category: "Pasta" },
  { id: "charlie-chan",          name: "Charlie Chan Pasta",          category: "Pasta" },
  { id: "crumble-pasta",         name: "Crumble Pasta",               category: "Pasta" },
  { id: "sausage-mushroom-pasta",name: "Sausage and Mushroom Pasta",  category: "Pasta" },
  { id: "eggplant-parmigiana",   name: "Eggplant Parmigiana",         category: "Pasta" },

  // Dessert
  { id: "mango-graham",          name: "Mango Graham",                        category: "Dessert" },
  { id: "tiramisu",              name: "Tiramisu",                            category: "Dessert" },
  { id: "mixed-berries-pudding", name: "Mixed Berries Croissant Pudding",     category: "Dessert" },
  { id: "leche-flan",            name: "Leche Flan",                          category: "Dessert" },
  { id: "smores-brownies",       name: "Smore's Fudge Brownies",              category: "Dessert" },
  { id: "basque-cheesecake",     name: "Burnt Basque Orange Cheese Cake",     category: "Dessert" },

  // Rice
  { id: "blue-ternate-rice",     name: "Blue Ternate Rice",  category: "Rice" },
  { id: "steamed-rice",          name: "Steamed Rice",       category: "Rice" },
  { id: "java-garlic-rice",      name: "Java Garlic Rice",   category: "Rice" },
  { id: "garlic-java-rice",      name: "Garlic Java Rice",   category: "Rice" },
  { id: "java-rice",             name: "Java Rice",          category: "Rice" },
  { id: "blue-rice",             name: "Blue Rice",          category: "Rice" },

  // Vegetable — always fixed (non-swappable) in combo packages
  { id: "baked-vegetables",      name: "Baked Vegetables",   category: "Vegetable" },
  { id: "laing",                 name: "Laing",              category: "Vegetable" },
  { id: "buttered-corn",         name: "Buttered Corn",      category: "Vegetable" },
  { id: "asian-salad",           name: "Asian Salad",        category: "Vegetable" },
];

// ── Sheet dish_id → code dish.id lookup ──────────────────────────────────────
// Sheet stores dish_id as snake_case display name ("garlic_beef_tips_and_mushroom")
// Code uses shortened slugs ("garlic-beef-tips"). Build reverse map once.
const _DISH_ID_LOOKUP = (() => {
  const m = new Map();
  for (const dish of DISHES) {
    const nameKey = dish.name.toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    m.set(nameKey, dish.id);
    m.set(dish.id.replace(/-/g, "_"), dish.id); // also accept code id with underscores
  }
  // Explicit aliases: sheet dish_ids whose names normalize differently than expected
  m.set("spare_ribs_peanut_sauce",        "spare-ribs-peanut");
  m.set("eggplant_parmigiana_pasta",      "eggplant-parmigiana");
  m.set("smores_fudge_brownies",          "smores-brownies");
  m.set("burnt_basque_orange_cheesecake", "basque-cheesecake");
  m.set("beef_pares_marrow_tendon",       "beef-pares");
  return m;
})();

// ── Combo packages ─────────────────────────────────────────────────────────────
let PACKAGES = [
  // ── 15 pax ────────────────────────────────────────────────────────────────
  { id: "fam-c1",    name: "Family Combo 1",      price: 10000, paxLabel: "15 pax", group: "Family Combos" },
  { id: "fam-c2",    name: "Family Combo 2",      price: 10000, paxLabel: "15 pax", group: "Family Combos" },
  { id: "fam-c3",    name: "Family Combo 3",      price: 10000, paxLabel: "15 pax", group: "Family Combos" },
  { id: "feast-c1",  name: "Feast Combo 1",       price: 12000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "feast-c2",  name: "Feast Combo 2",       price: 12000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "feast-c3",  name: "Feast Combo 3",       price: 12000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "feast-c4",  name: "Feast Combo 4",       price: 15000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "feast-c5",  name: "Feast Combo 5",       price: 15000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "feast-c6",  name: "Feast Combo 6",       price: 15000, paxLabel: "15 pax", group: "Feast Combos" },
  { id: "prem-c1",   name: "Premium Combo",       price: 20000, paxLabel: "15 pax", group: "Premium" },

  // ── 25 pax ────────────────────────────────────────────────────────────────
  { id: "feast-c7",  name: "Feast Combo 7",       price: 15000, paxLabel: "25 pax", group: "Feast Combos" },
  { id: "feast-c8",  name: "Feast Combo 8",       price: 15000, paxLabel: "25 pax", group: "Feast Combos" },
  { id: "feast-c9",  name: "Feast Combo 9",       price: 15000, paxLabel: "25 pax", group: "Feast Combos" },
  { id: "xxxl-c1",   name: "XXXL Combo 1",        price: 17000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-c2",   name: "XXXL Combo 2",        price: 17000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-c3",   name: "XXXL Combo 3",        price: 17000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-c4",   name: "XXXL Combo 4",        price: 19000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-c5",   name: "XXXL Combo 5",        price: 19000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-c6",   name: "XXXL Combo 6",        price: 19000, paxLabel: "25 pax", group: "XXXL Combos" },
  { id: "xxxl-prem", name: "XXXL Premium Combo",  price: 27000, paxLabel: "25 pax", group: "Premium" },

  // ── 45 pax ────────────────────────────────────────────────────────────────
  { id: "xxxl-c7",   name: "XXXL Combo 7",        price: 25000, paxLabel: "45 pax", group: "XXXL Combos" },
  { id: "xxxl-c8",   name: "XXXL Combo 8",        price: 25000, paxLabel: "45 pax", group: "XXXL Combos" },
  { id: "xxxl-c9",   name: "XXXL Combo 9",        price: 25000, paxLabel: "45 pax", group: "XXXL Combos" },

  // ── 50–70 pax ─────────────────────────────────────────────────────────────
  { id: "2xxxl-c1",  name: "2 XXXL Combo 1",      price: 30600, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-c2",  name: "2 XXXL Combo 2",      price: 30600, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-c3",  name: "2 XXXL Combo 3",      price: 30600, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-c4",  name: "2 XXXL Combo 4",      price: 42000, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-c5",  name: "2 XXXL Combo 5",      price: 42000, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-c6",  name: "2 XXXL Combo 6",      price: 42000, paxLabel: "50–70 pax", group: "2 XXXL Combos" },
  { id: "2xxxl-prem",name: "2 XXXL Premium Combo", price: 54000, paxLabel: "50–70 pax", group: "2 XXXL Premium" },

  // ── 50 pax special ────────────────────────────────────────────────────────
  { id: "special-50",  name: "Mary Rose Package",          price: 19000, paxLabel: "50 pax",  group: "Special Package" },

  // ── 100 pax special ───────────────────────────────────────────────────────
  { id: "special-100", name: "100 Pax XXXL Trays Package", price: 35000, paxLabel: "100 pax", group: "Special Package" },
];

// ── Package item helper ────────────────────────────────────────────────────────
// Each raw tuple: [dishId, traySize, qty=1, replaceable=true]
// Vegetable category items are always marked non-replaceable.
function buildItems(packageId, tuples) {
  return tuples.map(([dishId, traySize, qty = 1, forceReplaceable], i) => {
    const dish = DISHES.find((d) => d.id === dishId);
    const isVeg = dish?.category === "Vegetable";
    const replaceable = !isVeg && (forceReplaceable !== false);
    return {
      packageId,
      itemOrder: i + 1,
      quantity: qty,
      traySize,
      dishId,
      displayName: dish?.name ?? dishId,
      category: dish?.category ?? "Other",
      replaceable,
    };
  });
}

// ── Package items ──────────────────────────────────────────────────────────────
// Confirmed from printed menu (Family Combos 1–3, Feast Combo 1).
// Remaining packages use representative dishes from the correct categories.

const _RAW = {
  // ── 15 pax · Family (PHP 10,000 each) ────────────────────────────────────
  "fam-c1": [
    ["garlic-beef-tips",      "Family"],
    ["chicken-parmigiana",    "Family"],
    ["lemon-fish-fillet",     "Family"],
    ["baked-vegetables",      "Family"],
    ["mango-graham",          "Family"],
    ["steamed-rice",          "Family", 2],
  ],
  "fam-c2": [
    ["lumpiang-shanghai",     "Family"],
    ["grilled-pork-belly",    "Family"],
    ["chicken-rosemary",      "Family"],
    ["asian-salad",           "Family"],
    ["leche-flan",            "Family"],
    ["steamed-rice",          "Family", 2],
  ],
  "fam-c3": [
    ["korean-blueberry-pork", "Family"],
    ["soy-garlic-wings",      "Family"],
    ["charlie-chan",           "Family"],
    ["buttered-corn",         "Family"],
    ["tiramisu",              "Family"],
    ["steamed-rice",          "Family", 2],
  ],

  // ── 15 pax · Feast (PHP 12,000 each) ─────────────────────────────────────
  "feast-c1": [
    ["korean-blueberry-pork", "Feast"],
    ["lemon-fish-fillet",     "Feast"],
    ["bacon-aglio-olio",      "Feast"],
    ["baked-vegetables",      "Feast"],
    ["mango-graham",          "Feast"],
    ["steamed-rice",          "Feast"],
  ],
  "feast-c2": [
    ["babyback-ribs",         "Feast"],
    ["baked-shrimp",          "Feast"],
    ["smoked-carbonara",      "Feast"],
    ["asian-salad",           "Feast"],
    ["tiramisu",              "Feast"],
    ["steamed-rice",          "Feast"],
  ],
  "feast-c3": [
    ["lechon-belly-roll",     "Feast"],
    ["squid-salpicao",        "Feast"],
    ["rolled-lasagna",        "Feast"],
    ["buttered-corn",         "Feast"],
    ["leche-flan",            "Feast"],
    ["steamed-rice",          "Feast"],
  ],

  // ── 15 pax · Feast (PHP 15,000 each) ─────────────────────────────────────
  "feast-c4": [
    ["garlic-beef-tips",      "Feast"],
    ["chicken-parmigiana",    "Feast"],
    ["pesto-cajun-shrimp",    "Feast"],
    ["baked-vegetables",      "Feast"],
    ["mango-graham",          "Feast"],
    ["steamed-rice",          "Feast"],
  ],
  "feast-c5": [
    ["dry-rub-roast-beef",    "Feast"],
    ["citrus-chicken",        "Feast"],
    ["creamy-truffle",        "Feast"],
    ["asian-salad",           "Feast"],
    ["tiramisu",              "Feast"],
    ["steamed-rice",          "Feast"],
  ],
  "feast-c6": [
    ["roast-beef-pink-mash",  "Feast"],
    ["soy-garlic-wings",      "Feast"],
    ["aligue-mac",            "Feast"],
    ["buttered-corn",         "Feast"],
    ["mixed-berries-pudding", "Feast"],
    ["steamed-rice",          "Feast"],
  ],

  // ── 15 pax · Premium (PHP 20,000) ────────────────────────────────────────
  "prem-c1": [
    ["garlic-beef-tips",      "Feast"],
    ["cajun-shrimp-mussels",  "Feast"],
    ["korean-blueberry-pork", "Feast"],
    ["chicken-cordon-bleu",   "Feast"],
    ["creamy-truffle",        "Feast"],
    ["baked-vegetables",      "Feast"],
    ["mango-graham",          "Feast"],
    ["steamed-rice",          "Feast"],
  ],

  // ── 25 pax · Feast (PHP 15,000 each) ─────────────────────────────────────
  "feast-c7": [
    ["babyback-ribs",         "Feast", 2],
    ["baked-salmon",          "Feast"],
    ["smoked-carbonara",      "Feast"],
    ["baked-vegetables",      "Feast"],
    ["mango-graham",          "Feast"],
    ["steamed-rice",          "Feast", 2],
  ],
  "feast-c8": [
    ["lechon-belly-kare",     "Feast", 2],
    ["salted-egg-shrimp",     "Feast"],
    ["charlie-chan",           "Feast"],
    ["asian-salad",           "Feast"],
    ["tiramisu",              "Feast"],
    ["steamed-rice",          "Feast", 2],
  ],
  "feast-c9": [
    ["lechon-macau",          "Feast", 2],
    ["baked-mussels",         "Feast"],
    ["baked-macaroni",        "Feast"],
    ["buttered-corn",         "Feast"],
    ["leche-flan",            "Feast"],
    ["steamed-rice",          "Feast", 2],
  ],

  // ── 25 pax · XXXL (PHP 17,000 each) ──────────────────────────────────────
  "xxxl-c1": [
    ["korean-blueberry-pork", "XXXL"],
    ["lemon-fish-fillet",     "XXXL"],
    ["charlie-chan",           "XXXL"],
    ["baked-vegetables",      "XXXL"],
    ["mango-graham",          "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],
  "xxxl-c2": [
    ["lechon-belly-roll",     "XXXL"],
    ["baked-shrimp",          "XXXL"],
    ["smoked-carbonara",      "XXXL"],
    ["asian-salad",           "XXXL"],
    ["tiramisu",              "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],
  "xxxl-c3": [
    ["babyback-ribs",         "XXXL"],
    ["squid-salpicao",        "XXXL"],
    ["baked-macaroni",        "XXXL"],
    ["buttered-corn",         "XXXL"],
    ["leche-flan",            "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],

  // ── 25 pax · XXXL (PHP 19,000 each) ──────────────────────────────────────
  "xxxl-c4": [
    ["garlic-beef-tips",      "XXXL"],
    ["chicken-parmigiana",    "XXXL"],
    ["creamy-truffle",        "XXXL"],
    ["baked-vegetables",      "XXXL"],
    ["mango-graham",          "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],
  "xxxl-c5": [
    ["dry-rub-roast-beef",    "XXXL"],
    ["chicken-cordon-bleu",   "XXXL"],
    ["pesto-cajun-shrimp",    "XXXL"],
    ["asian-salad",           "XXXL"],
    ["tiramisu",              "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],
  "xxxl-c6": [
    ["heirloom-callos",       "XXXL"],
    ["citrus-chicken",        "XXXL"],
    ["rolled-lasagna",        "XXXL"],
    ["buttered-corn",         "XXXL"],
    ["mixed-berries-pudding", "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],

  // ── 25 pax · XXXL Premium (PHP 27,000) ───────────────────────────────────
  "xxxl-prem": [
    ["garlic-beef-tips",      "XXXL"],
    ["cajun-shrimp-mussels",  "XXXL"],
    ["korean-blueberry-pork", "XXXL"],
    ["chicken-cordon-bleu",   "XXXL"],
    ["creamy-truffle",        "XXXL"],
    ["baked-vegetables",      "XXXL"],
    ["mango-graham",          "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],

  // ── 45 pax · XXXL (PHP 25,000 each) ──────────────────────────────────────
  "xxxl-c7": [
    ["garlic-beef-tips",      "XXXL"],
    ["chicken-parmigiana",    "XXXL"],
    ["lemon-fish-fillet",     "XXXL"],
    ["creamy-truffle",        "XXXL"],
    ["baked-vegetables",      "XXXL"],
    ["mango-graham",          "XXXL"],
    ["steamed-rice",          "XXXL", 2],
  ],
  "xxxl-c8": [
    ["dry-rub-roast-beef",    "XXXL"],
    ["korean-blueberry-pork", "XXXL"],
    ["baked-salmon",          "XXXL"],
    ["bacon-aglio-olio",      "XXXL"],
    ["asian-salad",           "XXXL"],
    ["tiramisu",              "XXXL"],
    ["steamed-rice",          "XXXL", 2],
  ],
  "xxxl-c9": [
    ["heirloom-callos",       "XXXL"],
    ["lechon-belly-roll",     "XXXL"],
    ["cajun-shrimp-mussels",  "XXXL"],
    ["rolled-lasagna",        "XXXL"],
    ["buttered-corn",         "XXXL"],
    ["leche-flan",            "XXXL"],
    ["steamed-rice",          "XXXL", 2],
  ],

  // ── 50–70 pax · 2 XXXL (PHP 30,600 each) ─────────────────────────────────
  "2xxxl-c1": [
    ["korean-blueberry-pork", "XXXL", 2],
    ["lemon-fish-fillet",     "XXXL", 2],
    ["charlie-chan",           "XXXL", 2],
    ["baked-vegetables",      "XXXL", 2],
    ["mango-graham",          "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],
  "2xxxl-c2": [
    ["lechon-belly-roll",     "XXXL", 2],
    ["baked-shrimp",          "XXXL", 2],
    ["smoked-carbonara",      "XXXL", 2],
    ["asian-salad",           "XXXL", 2],
    ["tiramisu",              "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],
  "2xxxl-c3": [
    ["babyback-ribs",         "XXXL", 2],
    ["squid-salpicao",        "XXXL", 2],
    ["baked-macaroni",        "XXXL", 2],
    ["buttered-corn",         "XXXL", 2],
    ["leche-flan",            "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],

  // ── 50–70 pax · 2 XXXL (PHP 42,000 each) ─────────────────────────────────
  "2xxxl-c4": [
    ["garlic-beef-tips",      "XXXL", 2],
    ["chicken-parmigiana",    "XXXL", 2],
    ["creamy-truffle",        "XXXL", 2],
    ["baked-vegetables",      "XXXL", 2],
    ["mango-graham",          "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],
  "2xxxl-c5": [
    ["dry-rub-roast-beef",    "XXXL", 2],
    ["chicken-cordon-bleu",   "XXXL", 2],
    ["pesto-cajun-shrimp",    "XXXL", 2],
    ["asian-salad",           "XXXL", 2],
    ["tiramisu",              "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],
  "2xxxl-c6": [
    ["heirloom-callos",       "XXXL", 2],
    ["citrus-chicken",        "XXXL", 2],
    ["rolled-lasagna",        "XXXL", 2],
    ["buttered-corn",         "XXXL", 2],
    ["mixed-berries-pudding", "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],

  // ── 50–70 pax · 2 XXXL Premium (PHP 54,000) ──────────────────────────────
  "2xxxl-prem": [
    ["garlic-beef-tips",      "XXXL", 2],
    ["cajun-shrimp-mussels",  "XXXL", 2],
    ["korean-blueberry-pork", "XXXL", 2],
    ["chicken-cordon-bleu",   "XXXL", 2],
    ["creamy-truffle",        "XXXL", 2],
    ["baked-vegetables",      "XXXL", 2],
    ["mango-graham",          "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],

  // ── 50 pax special (PHP 19,000) — 8 XXXL trays ───────────────────────────
  "special-50": [
    ["garlic-beef-tips",      "XXXL"],
    ["cajun-shrimp-mussels",  "XXXL"],
    ["korean-blueberry-pork", "XXXL"],
    ["chicken-parmigiana",    "XXXL"],
    ["charlie-chan",           "XXXL"],
    ["baked-vegetables",      "XXXL"],
    ["mango-graham",          "XXXL"],
    ["steamed-rice",          "XXXL"],
  ],

  // ── 100 pax special (PHP 35,000) — 8 items × 2 XXXL ─────────────────────
  "special-100": [
    ["garlic-beef-tips",      "XXXL", 2],
    ["cajun-shrimp-mussels",  "XXXL", 2],
    ["korean-blueberry-pork", "XXXL", 2],
    ["chicken-parmigiana",    "XXXL", 2],
    ["charlie-chan",           "XXXL", 2],
    ["baked-vegetables",      "XXXL", 2],
    ["mango-graham",          "XXXL", 2],
    ["steamed-rice",          "XXXL", 2],
  ],
};

let PACKAGE_ITEMS = Object.fromEntries(
  Object.entries(_RAW).map(([pid, tuples]) => [pid, buildItems(pid, tuples)])
);

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadCateringData() {
  const [pkgResult, dishPriceResult, pkgItemsResult] = await Promise.allSettled([
    fetchSheetRows(PRICING_SHEET_URLS.packages),
    fetchSheetRows(PRICING_SHEET_URLS.dishPrices),
    fetchSheetRows(PRICING_SHEET_URLS.packageItems),
  ]);

  // ── 1. Package prices — build sheet package_id → code id map as a side effect ──
  const sheetPkgIdToCodeId = new Map();
  if (pkgResult.status === "fulfilled") {
    for (const r of pkgResult.value) {
      const codePkg = PACKAGES.find((p) => p.name === r.package_name);
      if (codePkg && r.package_id) sheetPkgIdToCodeId.set(r.package_id, codePkg.id);
    }
    PACKAGES = PACKAGES.map((pkg) => {
      const sheetRow = pkgResult.value.find((r) => r.package_name === pkg.name);
      const price = sheetRow ? parseFloat(sheetRow.base_price) : NaN;
      return { ...pkg, price: isNaN(price) ? pkg.price : price };
    });
  } else {
    console.warn("Package prices: sheet unavailable, using hardcoded fallback.", pkgResult.reason);
  }

  // ── 2. Per-dish prices ────────────────────────────────────────────────────────
  if (dishPriceResult.status === "fulfilled") {
    DISH_PRICES = {};
    for (const row of dishPriceResult.value) {
      const codeId = _DISH_ID_LOOKUP.get(row.dish_id) ?? row.dish_id?.replaceAll("_", "-");
      const size = row.tray_size;
      const price = parseFloat(row.price);
      if (codeId && size && !isNaN(price) && price > 0) {
        if (!DISH_PRICES[codeId]) DISH_PRICES[codeId] = {};
        DISH_PRICES[codeId][size] = price;
      }
    }
  } else {
    console.warn("Dish prices: sheet unavailable, using category fallback.", dishPriceResult.reason);
  }

  // ── 3. Package items — override hardcoded compositions with live sheet data ──
  if (pkgItemsResult.status === "fulfilled" && pkgItemsResult.value.length > 0) {
    const grouped = {};
    for (const row of pkgItemsResult.value) {
      const codePackageId = sheetPkgIdToCodeId.get(row.package_id);
      if (!codePackageId) continue;

      const codeDishId = _DISH_ID_LOOKUP.get(row.dish_id) ?? row.dish_id?.replaceAll("_", "-");
      const dish = getDishById(codeDishId);
      if (!dish) {
        console.warn(`Package item skipped — dish not found: ${row.dish_id} (resolved: ${codeDishId})`);
        continue;
      }

      if (!grouped[codePackageId]) grouped[codePackageId] = [];
      grouped[codePackageId].push({
        packageId:   codePackageId,
        itemOrder:   parseInt(row.item_order, 10) || 0,
        quantity:    parseInt(row.quantity, 10)   || 1,
        traySize:    row.tray_size,
        dishId:      dish.id,
        displayName: dish.name,
        category:    dish.category,
        replaceable: dish.category !== "Vegetable",
      });
    }
    for (const [pkgId, items] of Object.entries(grouped)) {
      if (items.length > 0) {
        PACKAGE_ITEMS[pkgId] = items.sort((a, b) => a.itemOrder - b.itemOrder);
      }
    }
  } else if (pkgItemsResult.status === "rejected") {
    console.warn("Package items: sheet unavailable, using hardcoded fallback.", pkgItemsResult.reason);
  }

  // Treat packages + dish-prices as critical; package-items has a safe hardcoded fallback
  if (pkgResult.status === "rejected" || dishPriceResult.status === "rejected") {
    throw new Error("One or more critical catering sheets failed to load");
  }
}

export function getCateringPackages() {
  return PACKAGES;
}

export function getInclusions(packageId) {
  return (PACKAGE_ITEMS[packageId] ?? []).map((item) => {
    const qty = item.quantity > 1 ? `${item.quantity}× ` : "";
    return `${qty}${item.traySize} ${item.displayName}`.trim();
  });
}

export function getPackageItems(packageId) {
  return PACKAGE_ITEMS[packageId] ?? [];
}

export function getDishById(dishId) {
  return DISHES.find((d) => d.id === dishId);
}

export function getDishPrice(dishId, traySize) {
  const dish = getDishById(dishId);
  if (!dish) return 0;
  return DISH_PRICES[dishId]?.[traySize]
    ?? CATEGORY_PRICES[dish.category]?.[traySize]
    ?? 0;
}

export function getReplacementDishes(item) {
  if (!item.category || item.category === "Vegetable") return [];
  return DISHES
    .filter((d) => d.category === item.category && d.category !== "Vegetable")
    .filter((d) => getDishPrice(d.id, item.traySize) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
