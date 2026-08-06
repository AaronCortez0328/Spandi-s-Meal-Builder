// Imported lazily, inside the two functions that need it, rather than at the
// top of the file. _supabase-admin.js builds its client at module load and
// throws without env vars, which would make originAllowed() and callerIp() —
// both pure — impossible to test without real credentials. The first version
// of originAllowed() shipped untested for exactly that reason and rejected
// every preview deployment.
async function db() {
  const { supabaseAdmin } = await import("./_supabase-admin.js");
  return supabaseAdmin;
}

// A real customer submits an inquiry once, maybe twice, ever. These are set
// generously enough that a family sharing an office connection never notices
// and tight enough that a script is useless.
//
// Raised from 5/20 after the duplicate-booking panel made an order two
// requests instead of one — ask the question, then act on the answer. At
// five an hour that was two and a half orders, and an office on a shared
// connection reached it before lunch.
const PER_HOUR = 8;
const PER_DAY  = 30;

/**
 * Whether a submission counts against the limit.
 *
 * A request carrying `intent` is the customer answering "add to my booking"
 * or "book separately" — the second half of an order that has already been
 * counted, not a new one. Counting it charged every customer twice.
 *
 * They are still *checked* against the limit. Only the recording is skipped,
 * so a flood of intent-carrying requests is still bounded rather than being
 * a way around the counter.
 */
export function countsAgainstLimit(body) {
  return !body?.intent;
}

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
 * A browser sets Origin on a POST and page script cannot forge it, so this
 * stops the form being driven from another site. It does not stop curl,
 * which sends whatever headers it likes — that is what the counter below is
 * for.
 *
 * Compared against the host actually serving the request, not against
 * SITE_URL. The first version used SITE_URL and rejected every preview
 * deployment, because a preview is served from a different hostname than
 * production — so the check refused the one environment it is meant to be
 * tested in. The serving host is correct everywhere: production, every
 * preview, and localhost, with no env var to keep in sync.
 *
 * ALLOWED_ORIGINS covers anything genuinely cross-origin later.
 */
export function originAllowed(req) {
  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // same-origin requests may send neither

  // This app is embedded in a GoHighLevel page as an iframe, on a domain the
  // client controls and can change. A sandboxed frame reports its origin as
  // the literal string "null", and other privacy tooling strips it to
  // something unparseable — neither is an attack, and refusing them would
  // break a real customer mid-order.
  //
  // Allowing them costs nothing that matters: anything not running in a
  // browser can simply omit the header, which is already permitted above.
  // This check only ever stops one thing — another *site* posting here from
  // a real browser — and that case always carries a valid, parseable origin.
  // The per-IP counter below is the control that actually bites.
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    console.warn("Unparseable origin, allowing through:", origin);
    return true;
  }

  // x-forwarded-host is what the customer actually typed; host is what the
  // platform routed to. Either matching is us.
  const servingHosts = [req.headers["x-forwarded-host"], req.headers.host].filter(Boolean);
  if (servingHosts.includes(originHost)) return true;

  const extra = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).host;
      } catch {
        return s;
      }
    });

  return extra.includes(originHost);
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
    const { data, error } = await (await db())
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
    await (await db()).from("inquiry_attempts").insert({ ip });
  } catch (e) {
    console.warn("Rate limit record failed (non-fatal):", e.message);
  }
}
