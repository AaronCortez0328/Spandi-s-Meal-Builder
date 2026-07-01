import { supabase } from "./supabase-client.js";

const GRAZING_CONFIG = {
  "grazing-table": {
    name: "Grazing Table",
    active: true,
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
    active: true,
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

    const knownServices = svcRes.data.filter((s) => GRAZING_CONFIG[s.id]);
    if (knownServices.length === 0) {
      throw new Error("Supabase returned no known grazing services");
    }

    const tiersByService = {};
    for (const t of tierRes.data) {
      if (!tiersByService[t.service_id]) tiersByService[t.service_id] = [];
      tiersByService[t.service_id].push(t);
    }
    for (const list of Object.values(tiersByService)) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Fetches ALL services regardless of active state — inactive ones stay in
    // the catalog but get flagged so the UI can show them as unavailable
    // instead of hiding them.
    for (const svc of knownServices) {
      const tiers = (tiersByService[svc.id] ?? []).map((t) => ({
        paxRange: String(t.size_label ?? "").replace(/\s*pax\s*$/i, "").trim(),
        price: t.price,
      }));

      GRAZING_CONFIG[svc.id] = {
        ...GRAZING_CONFIG[svc.id],
        name: svc.name ?? GRAZING_CONFIG[svc.id].name,
        tiers: tiers.length > 0 ? tiers : GRAZING_CONFIG[svc.id].tiers,
        active: svc.active !== false,
      };
    }
  } catch (err) {
    console.warn("Grazing data: Supabase unavailable, using hardcoded fallback.", err);
  }
}

export function getGrazingConfig(serviceKey) {
  return GRAZING_CONFIG[serviceKey];
}
