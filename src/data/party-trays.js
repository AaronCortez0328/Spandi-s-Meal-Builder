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

export async function loadPartyTrayData() {}

export function getCategories() {
  return Object.keys(MENU);
}

export function getMenuItems(category) {
  return MENU[category]?.dishes ?? [];
}

export function getCategoryPrice(category, traySize) {
  return MENU[category]?.prices[traySize] ?? 0;
}
