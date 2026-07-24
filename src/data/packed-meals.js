import { supabase } from "./supabase-client.js";

let _packTypes = [];
let _pricingTiers = {};
let _menuItems = {};

export async function loadPackedMealsData() {
  try {
    const [typeRes, tierRes, itemRes] = await Promise.all([
      supabase.from("packed_meal_types").select("*"),
      supabase.from("packed_meal_tiers").select("*"),
      supabase.from("packed_meal_items").select("*"),
    ]);
    if (typeRes.error) throw typeRes.error;
    if (tierRes.error) throw tierRes.error;
    if (itemRes.error) throw itemRes.error;

    const types = [...typeRes.data]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        active: t.active !== false,
      }));

    const tiers = {};
    for (const row of tierRes.data) {
      if (!tiers[row.type_id]) tiers[row.type_id] = [];
      tiers[row.type_id].push({ price: row.price_per_pc, minQty: row.min_qty });
    }
    for (const id of Object.keys(tiers)) {
      tiers[id].sort((a, b) => b.minQty - a.minQty);
    }

    const items = {};
    for (const row of itemRes.data.filter((r) => r.active !== false)) {
      if (!items[row.type_id]) items[row.type_id] = [];
      items[row.type_id].push({ name: row.name, category: row.subcategory || "Other", _sort: row.sort_order ?? 0 });
    }
    for (const id of Object.keys(items)) {
      items[id] = items[id]
        .sort((a, b) => a._sort - b._sort)
        .map(({ name, category }) => ({ name, category }));
    }

    _packTypes = types;
    _pricingTiers = tiers;
    _menuItems = items;
  } catch (err) {
    console.warn("Packed meals data: Supabase unavailable, falling back to empty data.", err);
    _packTypes = [];
    _pricingTiers = {};
    _menuItems = {};
  }
}

export function getPackTypes() { return _packTypes; }
export function getPricingTiers(packTypeId) { return _pricingTiers[packTypeId] ?? []; }
export function getPackMenuItems(packTypeId) { return _menuItems[packTypeId] ?? []; }

export function getPriceForQty(packTypeId, qty) {
  const tiers = _pricingTiers[packTypeId] ?? [];
  for (const tier of tiers) {
    if (qty >= tier.minQty) return tier.price;
  }
  return tiers[tiers.length - 1]?.price ?? 0;
}
