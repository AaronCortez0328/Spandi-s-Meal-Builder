import { supabaseAdmin } from "./_supabase-admin.js";
import {
  partyTrayTotal, packedMealsTotal, grazingTotal,
  cateringPackageTotal, comboTotal, applyRushFee, customServiceTotal,
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
  // No sort. There used to be one here, matching another in
  // src/data/packed-meals.js, because packedMealUnitPrice took the first
  // match in a list it required to be ordered. It now asks for the highest
  // minimum a quantity reaches, so order carries no meaning — and nothing on
  // this side displays tiers, so sorting them would be work done for a
  // reader that does not exist.
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
 * The pricing row for a service the dashboard created, or null for anything
 * that is not one.
 *
 * Read with the service-role key, and deliberately not filtered on `active`:
 * a card switched off while a customer was mid-order must still price, or
 * her submission is refused for a decision taken after she started. What is
 * being asked here is "how does this cost", not "may it be offered".
 *
 * Throws rather than swallowing. serverTotal's caller already treats a throw
 * as "could not price" and accepts the order unverified with a log line, so
 * failing loudly reaches the same fail-open outcome by the path that records
 * it.
 */
async function customServiceRow(slug) {
  if (!slug) return null;
  const { data, error } = await supabaseAdmin
    .from("meal_builder_services")
    // max_quantity too: customServiceTotal bounds by it, and a server that
    // did not know the card's ceiling would clamp by the backstop instead —
    // pricing a tampered quantity differently from the browser.
    .select("slug, pricing_mode, unit_price, max_quantity")
    .eq("slug", slug)
    .eq("is_builtin", false)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
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
      // serviceKey a second time, and not for the lookup: the Table carries a
      // 10% service charge and the Board does not, so the total depends on
      // which of the two this is. Dropping it here prices every Table order
      // 10% under the browser's figure — and ghl-inquiry.js compares the two
      // exactly.
      return grazingTotal(
        await grazingTiers(lineItems.serviceKey), lineItems.paxRange, lineItems.serviceKey,
      );
    }

    case "catering-package": {
      if (!lineItems.serviceKey || !lineItems.pax) return null;
      // The browser sends which add-ons were ticked, never what they cost.
      // Every amount comes from CATERING in src/domain/pricing.js, which
      // both sides import — so a tampered payload can only change the
      // selection, and the selection is priced here from our own figures.
      return cateringPackageTotal(
        await cateringRate(lineItems.serviceKey), lineItems.pax, lineItems.addons,
      );
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
      // An admin-created service, priced from its own row.
      //
      // customServiceTotal is the same function the browser used to build
      // the cart line, on the same row. That matters more here than
      // anywhere else in this file: ghl-inquiry.js compares the two totals
      // exactly and then writes THIS one to the opportunity as the order's
      // value. Two sides disagreeing gives the customer a recoverable 409;
      // two sides agreeing on a wrong number puts wrong money in the
      // financial reports with nothing to notice. One implementation is the
      // only version of that guarantee.
      //
      // An `enquiry` card still returns 0 rather than null, for the reason
      // the "mixed" case above makes plain: one null group turns a whole
      // basket unverified, so the party trays beside it would lose their
      // price check too.
      //
      // Confirmed against the table rather than assumed from the slug not
      // matching a case above — "cannot price this" and "never heard of
      // this" must not collapse into one answer, or a typo from an old
      // client would be silently priced at nothing.
      const row = await customServiceRow(lineItems.service);
      if (row) return customServiceTotal(row, lineItems.quantity);

      console.warn(`Unknown service for pricing: ${lineItems.service}`);
      return null;
    }
  }
}
