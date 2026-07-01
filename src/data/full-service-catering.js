import { supabase } from "./supabase-client.js";

const PACKAGE_CONFIG = {
  "basic-catering": {
    name: "Basic Catering Package",
    pricePerHead: 950,
    minPax: 50,
    paxStep: 10,
    courses: [
      "1 Chicken Dish", "1 Fish Dish", "1 Beef Dish",
      "1 Type of Soup", "1 Veggie Dish or Salad",
      "1 Pasta Dish", "Rice", "Dessert", "Drinks",
    ],
    inclusions: [
      "8-10 Seater Round Tables with White Cover",
      "Monoblock Chairs with White Cover",
      "1 Way per 100pax Skirted Buffet Set Up",
      "Waiters in Uniform",
      "Spoon, Fork, Teaspoon, Table Knife",
      "Dinner Plates, Saucer and Soup Bowl",
      "6 Rectangular Chaffing Dish",
      "1 Soup Tureen",
      "6 Swan Lights",
      "Drink Station",
      "Stainless Pitchers",
      "Highball Glasses and Goblets",
      "Color Theme Table Napkins",
      "Color Theme Table Topping",
      "Color Theme Chair Ribbons",
      "Basic Floral Centerpiece",
      "3-4hrs of Service",
    ],
    addons: [
      "Lechon Chopping 2,500 / 2 Lechons",
      "Service Charge 10%",
      "Transpo, Hauling, Sanitation, Team Food, Set Up and Pull Out 12,000 / 100pax",
    ],
  },
  "classic-catering": {
    name: "Classic Catering Package",
    pricePerHead: 1250,
    minPax: 50,
    paxStep: 10,
    courses: [
      "1 Chicken Dish", "1 Fish Dish", "1 Pork Dish", "1 Beef Dish",
      "1 Type of Soup", "1 Veggie Dish or Salad",
      "1 Pasta Dish", "Rice", "2 Types of Dessert", "Drinks",
    ],
    inclusions: [
      "8-10 Seater Round Tables with White Cover",
      "Monoblock Chairs with White Cover",
      "1 Way per 100pax Skirted Buffet Set Up",
      "Waiters in Uniform",
      "Spoon, Fork, Teaspoon, Table Knife",
      "Dinner Plates, Saucer and Soup Bowl",
      "7 Rectangular Chaffing Dish",
      "1 Soup Tureen",
      "7 Swan Lights",
      "Drink Station",
      "Stainless Pitchers",
      "Highball Glasses and Goblets",
      "Color Theme Table Napkins",
      "Color Theme Table Topping",
      "Color Theme Chair Ribbons",
      "Basic Floral Centerpiece",
      "3-4hrs of Service",
    ],
    addons: [
      "Lechon Chopping 2,500 / 2 Lechons",
      "Service Charge 10%",
      "Transpo, Hauling, Sanitation, Team Food, Set Up and Pull Out 12,000 / 100pax",
    ],
  },
};

export async function loadFullServiceCateringData() {
  try {
    const { data, error } = await supabase.from("catering_services").select("*");
    if (error) throw error;

    const activeRows = data.filter((r) => r.active !== false && PACKAGE_CONFIG[r.id]);
    if (activeRows.length === 0) {
      throw new Error("Supabase returned no active full-service catering packages");
    }

    for (const row of activeRows) {
      PACKAGE_CONFIG[row.id] = {
        ...PACKAGE_CONFIG[row.id],
        name: row.name ?? PACKAGE_CONFIG[row.id].name,
        pricePerHead: row.rate_per_head ?? PACKAGE_CONFIG[row.id].pricePerHead,
        minPax: row.min_pax ?? PACKAGE_CONFIG[row.id].minPax,
      };
    }
  } catch (err) {
    console.warn("Full-service catering data: Supabase unavailable, using hardcoded fallback.", err);
  }
}

export function getPackageConfig(serviceKey) {
  return PACKAGE_CONFIG[serviceKey];
}
