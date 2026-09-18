import { supabaseAdmin } from "./_supabase-admin.js";

/**
 * The brake on an unauthenticated lookup.
 *
 * Failures are what matter. An honest customer gets an order back on the
 * first or second try; somebody guessing produces a run of misses, and an
 * email plus a weekend date is a small enough space to walk through by hand
 * if nothing counts the attempts.
 *
 * Successes are counted loosely — a customer refreshing their own order all
 * afternoon is not an attack, and refusing them would be the wrong failure.
 */
export const FAILED_PER_HOUR = 10;
export const FAILED_PER_DAY  = 40;
export const TOTAL_PER_HOUR  = 60;

/**
 * Fails OPEN, like every other external check in this codebase. A Supabase
 * blip must not stop a customer finding out where their food is. The cost of
 * an unthrottled hour is far lower than the cost of a page that refuses
 * everybody the moment the database hiccups.
 */
export async function checkLookupLimit(ip) {
  if (!ip) return { allowed: true };
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo  = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from("order_lookup_attempts")
      .select("created_at, found")
      .eq("ip", ip)
      .gte("created_at", dayAgo);

    if (error) {
      console.warn("Lookup limit check failed, allowing through:", error.message);
      return { allowed: true };
    }

    const rows = data ?? [];
    const lastHour = rows.filter((r) => r.created_at >= hourAgo);
    const failedHour = lastHour.filter((r) => !r.found).length;
    const failedDay  = rows.filter((r) => !r.found).length;

    if (failedDay  >= FAILED_PER_DAY)  return { allowed: false };
    if (failedHour >= FAILED_PER_HOUR) return { allowed: false };
    if (lastHour.length >= TOTAL_PER_HOUR) return { allowed: false };
    return { allowed: true };
  } catch (e) {
    console.warn("Lookup limit check threw, allowing through:", e.message);
    return { allowed: true };
  }
}

/** Best-effort. Never blocks a lookup that has already been decided. */
export async function recordLookup(ip, found) {
  if (!ip) return;
  try {
    await supabaseAdmin.from("order_lookup_attempts").insert({ ip, found: Boolean(found) });
  } catch (e) {
    console.warn("Lookup record failed (non-fatal):", e.message);
  }
}
