import { supabaseAdmin } from "./_supabase-admin.js";
import {
  partyTrayTotal, packedMealsTotal, grazingTotal,
  cateringPackageTotal, comboTotal, applyRushFee,
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
  const base = await baseServerTotal(lineItems);
  // null means "cannot price", not "free" — the rush fee only ever applies
  // on top of a real total, so it must not turn a null into a priced order.
  return base === null ? null : applyRushFee(base, lineItems.rush);
}

/** The menu total alone, before the rush fee. See serverTotal(). */
/**
 * Is this slug a service the dashboard created, rather than one of the seven?
 *
 * Read from meal_builder_services with the service-role key, so a row an
 * admin has since switched off still answers true — the question here is
 * "does this legitimately have no price", which stays true whether the card
 * is currently on the chooser or not. A customer who was mid-order when it
 * was switched off must still be able to submit.
 *
 * Throws rather than swallowing. serverTotal's caller already treats a throw
 * as "could not price" and accepts the order unverified, so failing loudly
 * here reaches the same fail-open outcome by the path that logs it.
 */
async function isCustomService(slug) {
  if (!slug) return false;
  const { data, error } = await supabaseAdmin
    .from("meal_builder_services")
    .select("slug")
    .eq("slug", slug)
    .eq("is_builtin", false)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function baseServerTotal(lineItems) {
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
      // An order may now hold several combos with a quantity each — "1×
      // Family Combo 1 and 2× Family Combo 3". `lines` is the current shape;
      // `packageId` is what a single-combo order used to send, and is still
      // accepted so a page loaded before this deploy can still be priced.
      const lines = Array.isArray(lineItems.lines) && lineItems.lines.length
        ? lineItems.lines
        : (lineItems.packageId ? [{ packageId: lineItems.packageId, qty: 1 }] : []);
      if (!lines.length || lines.some((l) => !l?.packageId)) return null;

      let sum = 0;
      for (const line of lines) {
        const price = await comboPrice(line.packageId);
        // An unknown package cannot be priced, and treating it as free would
        // verify a total that is missing a combo.
        if (!price) return null;
        sum += comboTotal({ [line.packageId]: price }, line.packageId) * (Number(line.qty) || 1);
      }
      return sum;
    }

    // An order spanning services. Split back into the per-service shapes and
    // summed, so a mixed order is priced by exactly the code that prices a
    // single-service one — there is no second pricing path to drift.
    case "mixed": {
      if (!Array.isArray(lineItems.groups) || !lineItems.groups.length) return null;
      let sum = 0;
      for (const group of lineItems.groups) {
        // rush is per order, not per group; adding it here would charge it
        // once for every service in the basket.
        const part = await baseServerTotal({ ...group, rush: false });
        if (part === null) return null;
        sum += part;
      }
      return sum;
    }

    default: {
      // An admin-created service. It carries a "from" figure for the chooser
      // and nothing to calculate with, so zero is its real price rather than
      // a stand-in for one we failed to find — the browser sends zero for it
      // too, and the customer is shown "Quoted separately" beside the line.
      //
      // Priced rather than refused because of what "mixed" does with a null:
      // one unpriceable group turns the whole order unverified, so a basket
      // holding party trays and a custom service would lose the check on the
      // trays as well. That is how a stale price gets accepted quietly.
      //
      // Confirmed against the table rather than assumed from the slug not
      // matching a case above: "cannot price this" and "never heard of this"
      // must not collapse into the same answer, or a typo from an old client
      // would be silently priced at zero.
      if (await isCustomService(lineItems.service)) return 0;

      console.warn(`Unknown service for pricing: ${lineItems.service}`);
      return null;
    }
  }
}
