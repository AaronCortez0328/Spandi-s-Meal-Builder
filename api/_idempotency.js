// Stops one order becoming two.
//
// A double-tapped Send button, a flaky connection retried, a customer
// pressing back and submitting again — all of these are one intent arriving
// more than once. Today GoHighLevel refuses the second because it allows one
// open opportunity per contact, but that is a side effect rather than a
// guarantee, and it disappears the moment the location enables duplicate
// opportunities.
//
// So the claim is ours and lives in Supabase. It does not depend on
// GoHighLevel's behaviour and survives that setting changing.

// How long a claimed-but-unfinished key blocks a retry. Long enough that a
// slow GoHighLevel round trip is not treated as abandoned, short enough that
// a customer whose request genuinely died is not stuck staring at a form
// that refuses them.
const IN_FLIGHT_TIMEOUT_MS = 60 * 1000;

async function db() {
  const { supabaseAdmin } = await import("./_supabase-admin.js");
  return supabaseAdmin;
}

/**
 * Claims a key for this request.
 *
 * @returns {Promise<{ proceed: true } | { proceed: false, replay: object } | { proceed: false, inFlight: true }>}
 *
 *   proceed        nothing has used this key — carry on and finish it
 *   replay         this key already completed — return that answer again
 *   inFlight       a request holding this key is still running
 *
 * Fails open. If the claim itself errors the order proceeds, because
 * refusing a real customer over a bookkeeping table is worse than the rare
 * duplicate this exists to prevent.
 */
export async function claimIdempotencyKey(key) {
  if (!key) return { proceed: true };

  try {
    const supabase = await db();

    // The insert is the lock. A primary key means two simultaneous requests
    // cannot both succeed here — one gets the row, the other gets a
    // conflict, and there is no window between checking and claiming for the
    // second to slip through.
    const { error } = await supabase
      .from("inquiry_idempotency")
      .insert({ key, status: "in_flight" });

    if (!error) return { proceed: true };

    // 23505 = unique violation. Anything else is a real failure.
    if (error.code !== "23505") {
      console.warn("Idempotency claim failed, allowing through:", error.message);
      return { proceed: true };
    }

    const { data: existing } = await supabase
      .from("inquiry_idempotency")
      .select("status, response, created_at")
      .eq("key", key)
      .maybeSingle();

    if (!existing) return { proceed: true };

    if (existing.status === "done") {
      return { proceed: false, replay: existing.response ?? { ok: true } };
    }

    // Still in flight. Past the timeout we assume the first request died
    // rather than leaving the customer permanently unable to order.
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age > IN_FLIGHT_TIMEOUT_MS) {
      console.warn(`Idempotency key ${key} stale after ${Math.round(age / 1000)}s — allowing retry`);
      return { proceed: true };
    }

    return { proceed: false, inFlight: true };
  } catch (e) {
    console.warn("Idempotency claim threw, allowing through:", e.message);
    return { proceed: true };
  }
}

/**
 * Records what this key answered, so a retry replays it rather than
 * creating a second booking.
 *
 * Only successful outcomes are stored. A failed attempt leaves the key
 * claimed but not done, which the timeout above releases — a customer whose
 * order errored must be able to try again.
 */
export async function completeIdempotencyKey(key, response) {
  if (!key) return;
  try {
    const supabase = await db();
    await supabase
      .from("inquiry_idempotency")
      .update({ status: "done", response })
      .eq("key", key);
  } catch (e) {
    console.warn("Idempotency completion failed (non-fatal):", e.message);
  }
}

/**
 * Releases a key after a failure so the customer can retry immediately
 * rather than waiting out the in-flight timeout.
 */
export async function releaseIdempotencyKey(key) {
  if (!key) return;
  try {
    const supabase = await db();
    await supabase.from("inquiry_idempotency").delete().eq("key", key);
  } catch (e) {
    console.warn("Idempotency release failed (non-fatal):", e.message);
  }
}
