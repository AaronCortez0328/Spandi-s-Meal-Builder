// Shared GHL (LeadConnector) API helpers for serverless functions.
// Holds the GHL Private Integration token server-side — never import from src/.

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_KEY = process.env.GHL_KEY;
export const GHL_LOC = process.env.GHL_LOCATION_ID;

export function ghlHeaders() {
  return {
    "Authorization": `Bearer ${GHL_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };
}

export function ghlFetch(path, body) {
  return fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(body),
  });
}

export async function ghlGet(path) {
  const res = await fetch(`${GHL_BASE}${path}`, { method: "GET", headers: ghlHeaders() });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL GET ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

export async function ghlPost(path, body) {
  const res = await ghlFetch(path, body);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

export async function ghlPut(path, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL PUT ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

// Raw custom-field list cache — persists across warm invocations of this function instance.
let _allFieldsCache = null;

async function fetchAllFields() {
  if (_allFieldsCache) return _allFieldsCache;

  try {
    const res = await fetch(
      `${GHL_BASE}/locations/${GHL_LOC}/customFields`,
      { method: "GET", headers: ghlHeaders() }
    );
    _allFieldsCache = res.ok ? (await res.json()).customFields ?? [] : [];
  } catch {
    _allFieldsCache = [];
  }

  return _allFieldsCache;
}

// { shortKey/fieldKey → id } for a given model ("opportunity" | "contact").
export async function fetchFieldIds(model) {
  const fields = await fetchAllFields();
  const ids = {};
  for (const f of fields) {
    if (f.model !== model || !f.fieldKey) continue;
    const shortKey = f.fieldKey.split(".").pop();
    ids[shortKey]   = f.id;
    ids[f.fieldKey] = f.id;
  }
  return ids;
}

// { id → readable field name } for a given model — used to turn a customFields
// array back into a human-readable summary (e.g. for the payment page).
export async function fetchFieldNamesById(model) {
  const fields = await fetchAllFields();
  const names = {};
  for (const f of fields) {
    if (f.model !== model) continue;
    names[f.id] = f.name ?? f.fieldKey?.split(".").pop() ?? f.id;
  }
  return names;
}
