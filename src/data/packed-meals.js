import { supabase } from "./supabase-client.js";
import { packedMealUnitPrice } from "../domain/pricing.js";

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
    // Display order only. The configurator lists the tier rows biggest-first
    // and lets a customer tap one to jump to that quantity, so the order is
    // what they read — it is no longer what makes the price correct.
    // packedMealUnitPrice asks for the highest minimum a quantity reaches
    // rather than the first match in a list, so it does not care how this
    // arrives.
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

/**
 * The per-piece price this browser will quote for a quantity.
 *
 * A wrapper, not a second implementation. It used to be its own copy of the
 * tier walk, which meant the browser, the server and this file all had to
 * agree about one rule independently — and the rule was written down in none
 * of them. api/_price-tables.js prices the same order through
 * packedMealUnitPrice, so anything but delegation here is a disagreement
 * waiting for a tier edit to expose it, and the two sides compare exactly.
 */
export function getPriceForQty(packTypeId, qty) {
  return packedMealUnitPrice(_pricingTiers[packTypeId] ?? [], qty);
}
