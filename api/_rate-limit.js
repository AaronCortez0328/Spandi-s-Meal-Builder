import { supabaseAdmin } from "./_supabase-admin.js";

// A real customer submits an inquiry once, maybe twice, ever. These are set
// generously enough that a family sharing an office connection never notices
// and tight enough that a script is useless.
const PER_HOUR = 5;
const PER_DAY  = 20;

/**
 * The caller's IP behind Vercel's proxy.
 *
 * x-forwarded-for is a chain — "client, proxy1, proxy2" — and the leftmost
 * entry is the original client. It is client-supplied and therefore
 * spoofable, which is why this is one layer of several rather than the
 * whole defence.
 */
export function callerIp(req) {
  const chain = req.headers["x-forwarded-for"];
  if (typeof chain === "string" && chain.length > 0) return chain.split(",")[0].trim();
  return req.headers["x-real-ip"] ?? "unknown";
}

/**
 * Requests from this origin are ours.
 *
 * A browser sets Origin and cannot be told otherwise by page script, so this
 * stops the form being driven from another site. It does not stop curl,
 * which can send any header it likes — that is what the counter below is
 * for. Skipped entirely when SITE_URL is unset so a misconfigured
 * environment fails open rather than rejecting every real customer.
 */
export function originAllowed(req) {
  const site = process.env.SITE_URL;
  if (!site) return true;

  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // same-origin requests may send neither

  try {
    return new URL(origin).host === new URL(site).host;
  } catch {
    return false;
  }
}

/**
 * Counts recent submissions from one IP.
 *
 * Fails open: if the count query itself errors, the inquiry proceeds. A
 * Supabase blip should not stop a real customer ordering — the cost of
 * letting a rare extra request through is far lower than the cost of
 * refusing a genuine booking.
 *
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function checkRateLimit(ip) {
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo  = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from("inquiry_attempts")
      .select("created_at")
      .eq("ip", ip)
      .gte("created_at", dayAgo);

    if (error) {
      console.warn("Rate limit check failed, allowing through:", error.message);
      return { allowed: true };
    }

    const rows = data ?? [];
    if (rows.length >= PER_DAY) {
      return { allowed: false, reason: `More than ${PER_DAY} inquiries from this connection today.` };
    }
    const lastHour = rows.filter((r) => r.created_at >= hourAgo).length;
    if (lastHour >= PER_HOUR) {
      return { allowed: false, reason: `More than ${PER_HOUR} inquiries from this connection in the last hour.` };
    }
    return { allowed: true };
  } catch (e) {
    console.warn("Rate limit check threw, allowing through:", e.message);
    return { allowed: true };
  }
}

/** Records an accepted submission. Best-effort — never blocks the inquiry. */
export async function recordAttempt(ip) {
  try {
    await supabaseAdmin.from("inquiry_attempts").insert({ ip });
  } catch (e) {
    console.warn("Rate limit record failed (non-fatal):", e.message);
  }
}
