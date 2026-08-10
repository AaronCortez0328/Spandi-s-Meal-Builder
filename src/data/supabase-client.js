import { createClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client — or a stand-in that fails politely when the
 * keys are missing from the build.
 *
 * These are Vite `VITE_`-prefixed variables, so they are baked into the
 * bundle at build time rather than read at runtime. `.env` is gitignored, so
 * a deploy gets them from the host's own environment settings — and on
 * Vercel those are scoped per environment. Ticked for Production but not
 * Preview is a normal mistake to make, and it used to be a fatal one:
 * createClient() throws "supabaseUrl is required." when the URL is
 * undefined, and it throws at module-import time.
 *
 * That import sits underneath every data module, which sit underneath
 * app.js, which sits underneath main.js. So one unticked checkbox took the
 * whole page down before a line of application code ran — and, worse, made
 * unreachable the offline fallbacks this app already has. loadPartyTrayData,
 * loadGrazingData and loadFullServiceCateringData all catch a database
 * failure and fall back to their hardcoded menus. None of them could ever
 * run, because the throw happened before any of them were called.
 *
 * So a missing key now produces a client whose queries resolve the way a
 * failed Supabase query resolves — `{ data: null, error }` — which is
 * exactly what those fallbacks are already written to handle. The builder
 * comes up on its hardcoded menu instead of showing a blank page.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

function unconfiguredClient() {
  const error = {
    name: "SupabaseNotConfigured",
    message:
      "Supabase keys are missing from this build. Check that " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set for this " +
      "environment (on Vercel they are scoped per environment — Production, " +
      "Preview and Development each have their own tick box).",
  };

  // Supabase reports failure by resolving with { data, error } rather than
  // rejecting, and every caller here reads it that way, so the stand-in
  // does the same.
  const settled = Promise.resolve({ data: null, error });

  // The proxy target is a function so the same object can be both called
  // and read from: supabase.from("x").select("*") calls it, while
  // supabase.storage.from("bucket") reads a property off it.
  const chain = new Proxy(function () {}, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return settled.then.bind(settled);
      if (prop === "catch") return settled.catch.bind(settled);
      if (prop === "finally") return settled.finally.bind(settled);
      return chain;
    },
    apply() {
      return chain;
    },
  });

  console.error(`Supabase client not configured. ${error.message}`);
  return chain;
}

export const supabase = url && key ? createClient(url, key) : unconfiguredClient();
