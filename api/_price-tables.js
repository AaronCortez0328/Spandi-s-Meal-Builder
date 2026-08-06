import { supabaseAdmin } from "./_supabase-admin.js";
import {
  partyTrayTotal, packedMealsTotal, grazingTotal,
  cateringPackageTotal, comboTotal,
} from "../src/domain/pricing.js";

/**
 * Prices an order from the menu, rather than believing what the browser
 * said it costs.
 *
 * Reads the same tables the browser reads and runs the same functions from
 * src/domain/pricing.js, so the two sides agree by construction rather than
 * by hoping. Where a value has to be reshaped on the way in — a lowercase
 * tray size, a stripped " pax" suffix — it is done identically to the
 * browser's loader, because a difference of one character here means every
 * order of that kind is refused.
 */

/** Every price is an integer number of pesos; a bad row must not become NaN. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function partyTrayPrices() {
  const { data, error } = await supabaseAdmin.from("dish_prices").select("dish_id, tray_size, price");
  if (error) throw error;

  const table = {};
  for (const row of data ?? []) {
    // Stored capitalised, used lowercase throughout the app. Matches
    // loadPartyTrayData() in src/data/party-trays.js.
    (table[row.dish_id] ??= {})[String(row.tray_size).toLowerCase()] = num(row.price);
  }
  return table;
}

async function packedMealTiers() {
  const { data, error } = await supabaseAdmin
    .from("packed_meal_tiers").select("type_id, price_per_pc, min_qty");
  if (error) throw error;

  const byType = {};
  for (const row of data ?? []) {
    (byType[row.type_id] ??= []).push({ price: num(row.price_per_pc), minQty: num(row.min_qty) });
  }
  // Highest minimum first, so the first tier a quantity reaches is the one
  // that applies — the order packedMealUnitPrice expects.
  for (const list of Object.values(byType)) list.sort((a, b) => b.minQty - a.minQty);
  return byType;
}

async function grazingTiers(serviceKey) {
  const { data, error } = await supabaseAdmin
    .from("grazing_tiers").select("service_id, size_label, price").eq("service_id", serviceKey);
  if (error) throw error;

  // "100–150 pax" in the table, "100–150" in the app. Same strip as
  // loadGrazingData(); a mismatch here would fail to find any tier and
  // price every grazing order at zero.
  return (data ?? []).map((t) => ({
    paxRange: String(t.size_label ?? "").replace(/\s*pax\s*$/i, "").trim(),
    price: num(t.price),
  }));
}

async function cateringRate(serviceKey) {
  const { data, error } = await supabaseAdmin
    .from("catering_services").select("rate_per_head").eq("id", serviceKey).maybeSingle();
  if (error) throw error;
  return num(data?.rate_per_head);
}

async function comboPrice(packageId) {
  const { data, error } = await supabaseAdmin
    .from("packages").select("base_price").eq("id", packageId).maybeSingle();
  if (error) throw error;
  return num(data?.base_price);
}

/**
 * The authoritative total for a submitted order.
 *
 * @returns {Promise<number|null>} null when the order cannot be priced —
 *   an unknown service, or line items the browser did not send. The caller
 *   treats that as "cannot verify" rather than as a mismatch, because
 *   refusing an order we simply failed to understand would turn a bug of
 *   ours into a lost booking.
 */
export async function serverTotal(lineItems) {
  if (!lineItems?.service) return null;

  switch (lineItems.service) {
    case "party-trays": {
      if (!Array.isArray(lineItems.lines) || lineItems.lines.length === 0) return null;
      // A line with no dish id cannot be priced. Happens when the browser
      // fell back to its offline menu, where ids do not exist.
      if (lineItems.lines.some((l) => !l?.dishId)) return null;
      return partyTrayTotal(await partyTrayPrices(), lineItems.lines);
    }

    case "packed-meals": {
      if (!Array.isArray(lineItems.lines) || lineItems.lines.length === 0) return null;
      return packedMealsTotal(await packedMealTiers(), lineItems.lines);
    }

    case "grazing": {
      if (!lineItems.serviceKey || !lineItems.paxRange) return null;
      return grazingTotal(await grazingTiers(lineItems.serviceKey), lineItems.paxRange);
    }

    case "catering-package": {
      if (!lineItems.serviceKey || !lineItems.pax) return null;
      return cateringPackageTotal(await cateringRate(lineItems.serviceKey), lineItems.pax);
    }

    case "combo-trays": {
      if (!lineItems.packageId) return null;
      return comboTotal({ [lineItems.packageId]: await comboPrice(lineItems.packageId) }, lineItems.packageId);
    }

    default:
      console.warn(`Unknown service for pricing: ${lineItems.service}`);
      return null;
  }
}
