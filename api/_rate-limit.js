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

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
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
