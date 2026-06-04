const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_KEY     = import.meta.env.VITE_GHL_KEY;
const GHL_LOC     = import.meta.env.VITE_GHL_LOCATION_ID;

const PIPELINE_ID = import.meta.env.VITE_PIPELINE_ID;
const STAGE_ID    = import.meta.env.VITE_STAGE_ID;

function ghlHeaders() {
  return {
    "Authorization": `Bearer ${GHL_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };
}

function ghlFetch(path, body) {
  return fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(body),
  });
}

async function ghlPost(path, body) {
  const res = await ghlFetch(path, body);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

async function ghlPut(path, body) {
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

// ── Custom field ID cache ─────────────────────────────────────────────────────
// Fetched once from GHL, then reused for every submission.
// Maps short key (e.g. "service_type") → GHL internal field ID.

let _fieldIdCache = null;

async function fetchOppFieldIds() {
  if (_fieldIdCache) return _fieldIdCache;

  try {
    const res = await fetch(
      `${GHL_BASE}/custom-fields/?locationId=${GHL_LOC}`,
      { method: "GET", headers: ghlHeaders() }
    );

    if (!res.ok) {
      console.warn("GHL custom fields fetch failed — using field keys as fallback");
      _fieldIdCache = {};
      return _fieldIdCache;
    }

    const data = await res.json();
    const fields = data.customFields ?? [];

    _fieldIdCache = {};
    for (const f of fields) {
      if (f.model !== "opportunity") continue;
      // Index by short key ("service_type") AND full key ("opportunity.service_type")
      if (f.fieldKey) {
        const shortKey = f.fieldKey.split(".").pop();
        _fieldIdCache[shortKey]   = f.id;
        _fieldIdCache[f.fieldKey] = f.id;
      }
    }

    console.log("GHL opportunity field IDs loaded:", _fieldIdCache);
  } catch (e) {
    console.warn("GHL custom fields fetch error — using field keys as fallback:", e.message);
    _fieldIdCache = {};
  }

  return _fieldIdCache;
}

/**
 * Pushes an inquiry to GHL:
 *   1. Creates or finds existing contact, writes contact custom fields
 *   2. Creates an opportunity with opportunity custom fields (IDs auto-fetched)
 *   3. Attaches a note with the full order breakdown
 */
export async function pushInquiryToGHL({
  contact,
  opportunityName,
  monetaryValue,
  noteBody,
  contactFields = {},
  opportunityFields = {},
}) {
  // Fetch real opportunity field IDs from GHL (cached after first call)
  const fieldIds = await fetchOppFieldIds();

  // ── 1. Create or find contact ─────────────────────────────────────────────
  let contactId;

  const contactRes = await ghlFetch("/contacts/", {
    locationId: GHL_LOC,
    firstName:  contact.firstName,
    lastName:   contact.lastName,
    email:      contact.email,
    phone:      contact.phone,
    ...(contact.address ? { address1: contact.address } : {}),
  });

  if (contactRes.ok) {
    const data = await contactRes.json();
    contactId = data.contact?.id;
  } else if (contactRes.status === 400) {
    const data = await contactRes.json().catch(() => ({}));
    if (data?.meta?.contactId) {
      contactId = data.meta.contactId;
    } else {
      throw new Error(`GHL /contacts/ → HTTP 400: ${data?.message ?? "unknown error"}`);
    }
  } else {
    const msg = await contactRes.text().catch(() => contactRes.status);
    throw new Error(`GHL /contacts/ → HTTP ${contactRes.status}: ${msg}`);
  }

  if (!contactId) throw new Error("GHL did not return a contact ID");

  // Update contact custom fields separately (create API doesn't accept them)
  if (Object.keys(contactFields).length > 0) {
    try {
      await ghlPut(`/contacts/${contactId}`, { customField: contactFields });
    } catch (e) {
      console.warn("Contact custom field update failed (non-fatal):", e.message);
    }
  }

  // ── 2. Create opportunity with real field IDs ─────────────────────────────
  const oppCustomFields = Object.entries(opportunityFields)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([key, value]) => ({
      id:          fieldIds[key] ?? key,
      field_value: String(value),
    }));

  try {
    await ghlPost("/opportunities/", {
      locationId:      GHL_LOC,
      pipelineId:      PIPELINE_ID,
      pipelineStageId: STAGE_ID,
      contactId,
      name:            opportunityName,
      monetaryValue,
      status:          "open",
      ...(oppCustomFields.length > 0 ? { customFields: oppCustomFields } : {}),
    });
  } catch (e) {
    // GHL blocks duplicate opportunities per contact — not fatal.
    // The note below still records the full inquiry on the contact.
    if (e.message.includes("duplicate")) {
      console.warn("GHL duplicate opportunity skipped (non-fatal):", e.message);
    } else {
      throw e;
    }
  }

  // ── 3. Add note (best-effort) ─────────────────────────────────────────────
  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body: noteBody });
  } catch (e) {
    console.warn("GHL note creation failed (non-fatal):", e.message);
  }
}
