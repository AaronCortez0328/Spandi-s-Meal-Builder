import { fetchSheetRows, SHEET_URLS } from "./sheet.js";

let _packTypes = [];
let _pricingTiers = {};
let _menuItems = {};

export async function loadPackedMealsData() {
  const rows = await fetchSheetRows(SHEET_URLS.packedMeals);
  const types = [];
  const tiers = {};
  const items = {};

  for (const row of rows) {
    if (row.record_type === "PackType") {
      types.push({
        id: row.sku_id,
        name: row.item_name,
        description: row.item_description,
      });
    } else if (row.record_type === "PricingTier") {
      const pid = row.parent_sku_id;
      if (!tiers[pid]) tiers[pid] = [];
      tiers[pid].push({
        price: parseFloat(row.price),
        minQty: parseInt(row.min_order_qty, 10),
      });
    } else if (row.record_type === "MenuItem") {
      const pid = row.parent_sku_id;
      if (!items[pid]) items[pid] = [];
      items[pid].push({ name: row.item_name, category: row.category });
    }
  }

  // Sort tiers descending by minQty so first match = best applicable price
  for (const id of Object.keys(tiers)) {
    tiers[id].sort((a, b) => b.minQty - a.minQty);
  }

  _packTypes = types;
  _pricingTiers = tiers;
  _menuItems = items;
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
