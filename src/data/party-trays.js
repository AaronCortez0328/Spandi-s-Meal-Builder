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
      priceByDish[row.dish_id][row.tray_size] = parseFloat(row.price);
    }

    const nextMenu = {};
    for (const category of Object.keys(MENU)) {
      nextMenu[category] = { prices: { ...MENU[category].prices }, dishes: [] };
    }

    for (const dish of activeDishes) {
      nextMenu[dish.category].dishes.push(dish.name);
      const prices = priceByDish[dish.id];
      if (prices?.Family) nextMenu[dish.category].prices.family = prices.Family;
      if (prices?.Feast)  nextMenu[dish.category].prices.feast  = prices.Feast;
      if (prices?.XXXL)   nextMenu[dish.category].prices.xxxl   = prices.XXXL;
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

export function getCategoryPrice(category, traySize) {
  return MENU[category]?.prices[traySize] ?? 0;
}
