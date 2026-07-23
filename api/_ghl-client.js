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

// No cross-invocation caching here on purpose — with Fluid Compute reusing
// warm instances aggressively, an in-memory cache can quietly serve a
// stale field list (e.g. missing a field created after the instance's
// first fetch) with nothing visibly wrong. This app's traffic is low
// enough that fetching fresh every call is cheap and removes that whole
// class of bug.
async function fetchAllFields() {
  try {
    // model=all is required — GHL defaults to contact-only fields without
    // it, which silently made every opportunity-model lookup come back
    // empty (confirmed directly against the live API: 13 contact fields
    // with no query param at all vs. the real opportunity fields only
    // showing up with ?model=opportunity or ?model=all).
    const res = await fetch(
      `${GHL_BASE}/locations/${GHL_LOC}/customFields?model=all`,
      { method: "GET", headers: ghlHeaders() }
    );
    return res.ok ? (await res.json()).customFields ?? [] : [];
  } catch {
    return [];
  }
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

// Writes a value straight into an opportunity's custom field — used for
// opportunity.payment_link so nothing depends on a GHL Workflow's "map
// webhook response to field" step. Returns a diagnostic object instead of
// throwing, so callers can surface exactly what happened without it
// breaking whatever else they're doing.
//
// Pass `fieldIds` if the caller already fetched it (e.g. api/ghl-inquiry.js
// fetches it once for the opportunity-create step) — avoids a second,
// independent GHL API call for the same data in the same request.
export async function setOpportunityField(opportunityId, fieldKey, value, fieldIds = null) {
  if (!opportunityId) return { ok: false, reason: "no opportunityId" };
  try {
    const ids = fieldIds ?? await fetchFieldIds("opportunity");
    const fieldId = ids[fieldKey];
    if (!fieldId) {
      return { ok: false, reason: `${fieldKey} field not found`, availableKeys: Object.keys(ids) };
    }
    await ghlPut(`/opportunities/${opportunityId}`, {
      customFields: [{ id: fieldId, field_value: value }],
    });
    return { ok: true, fieldId };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
