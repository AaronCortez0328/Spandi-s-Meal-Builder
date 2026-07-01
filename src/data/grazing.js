import { supabase } from "./supabase-client.js";

const GRAZING_CONFIG = {
  "grazing-table": {
    name: "Grazing Table",
    tiers: [
      { paxRange: "50–100", price: 35000 },
      { paxRange: "100–150", price: 65000 },
      { paxRange: "150–200", price: 120000 },
    ],
    menuLabel: "What's on the table",
    menu: [
      "Mozzarella Sticks", "Farmer's Slider Buns", "Hungarian Sausage Buns",
      "Tortilla Chips", "Nacho Cheese Dip", "Apple Struddle", "Smore's Brownies",
      "Cinnamon Rolls", "Sweet Purple Grapes", "Slices of Orange", "Slices of Watermelon",
      "Semi Sweet Chocolate", "Marshmallows", "Brewed Coffee", "Blue Lemonade", "Pink Lychee Juice",
    ],
    inclusions: [
      "2 Rustic Naked Table", "1 Rustic Barrel", "1 Coffee Dispenser", "2 Juice Jars",
      "Ceramic Serving Platters", "Decorations", "Disposable plates and cutleries",
      "Disposable Paper cups", "Mugs with Logo", "2 serving staff to refill", "3hrs of service",
    ],
    addons: ["Transpo fee depending on location", "Service charge 10%"],
  },
  "grazing-board": {
    name: "Grazing Board",
    tiers: [
      { paxRange: "15–25", price: 15000 },
      { paxRange: "30–50", price: 29000 },
      { paxRange: "60–100", price: 58000 },
    ],
    menuLabel: "What's on the board",
    menu: [
      "Cheese Burger Sliders", "Tortilla Chips", "Home Made Cheddar Cheese",
      "Home Made Salsa Dip", "Farmer's Ham", "Home Made Boursin Cheese",
      "Slices of Toasted Baguette", "Slices of Oranges", "Slices of Grapefruit",
      "Fresh Strawberries", "Sweet Purple Grapes", "Semi Sweet Chocolates",
    ],
    inclusions: [],
    addons: [],
  },
};

export async function loadGrazingData() {
  try {
    const [svcRes, tierRes] = await Promise.all([
      supabase.from("grazing_services").select("*"),
      supabase.from("grazing_tiers").select("*"),
    ]);
    if (svcRes.error) throw svcRes.error;
    if (tierRes.error) throw tierRes.error;

    const activeServices = svcRes.data.filter((s) => s.active !== false && GRAZING_CONFIG[s.id]);
    if (activeServices.length === 0) {
      throw new Error("Supabase returned no active grazing services");
    }

    const tiersByService = {};
    for (const t of tierRes.data) {
      if (!tiersByService[t.service_id]) tiersByService[t.service_id] = [];
      tiersByService[t.service_id].push(t);
    }
    for (const list of Object.values(tiersByService)) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    for (const svc of activeServices) {
      const tiers = (tiersByService[svc.id] ?? []).map((t) => ({
        paxRange: String(t.size_label ?? "").replace(/\s*pax\s*$/i, "").trim(),
        price: t.price,
      }));
      if (tiers.length === 0) continue; // no live pricing yet — keep hardcoded tiers for this service

      GRAZING_CONFIG[svc.id] = {
        ...GRAZING_CONFIG[svc.id],
        name: svc.name ?? GRAZING_CONFIG[svc.id].name,
        tiers,
      };
    }
  } catch (err) {
    console.warn("Grazing data: Supabase unavailable, using hardcoded fallback.", err);
  }
}

export function getGrazingConfig(serviceKey) {
  return GRAZING_CONFIG[serviceKey];
}
