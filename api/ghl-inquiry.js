import {
  GHL_LOC, ghlFetch, ghlPost, ghlPut, fetchFieldIds,
  findContactOpportunities, opportunityFieldValue, updateOpportunity,
  getOpportunity, duplicateExistingId,
} from "./_ghl-client.js";
import { callerIp, originAllowed, checkRateLimit, recordAttempt, countsAgainstLimit } from "./_rate-limit.js";
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey } from "./_idempotency.js";
import { ensurePaymentLink, buildOrderSummary } from "./_payment-link.js";
import { serverTotal } from "./_price-tables.js";

const PIPELINE_ID = process.env.PIPELINE_ID;
const STAGE_ID = process.env.STAGE_ID;

// Branch → GHL Personal calendar. Appointment booking is skipped for any
// other branch value (or if the calendar env vars aren't set).
const CALENDAR_IDS = {
  Cavite:   process.env.GHL_CALENDAR_CAVITE,
  Batangas: process.env.GHL_CALENDAR_BATANGAS,
};

const APPOINTMENT_DURATION_MIN = 30;
const MANILA_OFFSET = "+08:00";

// Kitchen release window — mirrors FULFILMENT_TIME_MIN/MAX in
// src/app/contact-form.js. The form blocks this first, so anything landing
// here outside the window is a tampered or malfunctioning client.
//
// This governs the delivery/pickup time only. The event time is
// deliberately unrestricted — an evening event taking an afternoon
// delivery is normal, and clamping both to one window is what used to make
// that impossible to book.
//
// Strict rather than fail-open on purpose: unlike a capacity check this
// needs no external call, so there is no outage that could make rejecting
// the wrong answer. A booking outside the window would also put a real
// appointment in the branch calendar at an hour nobody is there.
const FULFILMENT_TIME_MIN = "06:00";
const FULFILMENT_TIME_MAX = "17:00";

// Formats a UTC instant as its +08:00 (Manila) wall-clock time.
function toManilaISOString(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${MANILA_OFFSET}`
  );
}

/**
 * The payload behind the "you already have an order with us" panel.
 *
 * Both sides are named, because three numbers were not enough to decide
 * with — especially when a customer's two orders are the same service and
 * only the totals differ. She needs to recognise which booking this is and
 * see what she is about to fold into it.
 *
 * Package names rather than full dish lists: some orders run past ten lines
 * and this is a question to answer, not a second confirmation screen. Both
 * values are already to hand — the existing one on the opportunity, the new
 * one in the request — so nothing extra is fetched.
 */
function describeExisting(existing, fieldIds, monetaryValue, opportunityFields = {}) {
  const read = (key) => opportunityFieldValue(existing, fieldIds[key]);
  const previousTotal = Number(existing.monetaryValue ?? 0);
  const addedTotal    = Number(monetaryValue ?? 0);

  return {
    needsChoice: true,
    existing: {
      opportunityId: existing.id,
      eventDate:     read("event_date"),
      branch:        read("branch"),
      serviceType:   read("service_type"),
      receiveMethod: read("receive_method"),
      // Falls back to the service when a booking has no package — ala carte
      // tray orders have none, and an empty row reads as missing data.
      packageName:   read("package_name") || read("service_type"),
      previousTotal,
      addedTotal,
      newTotal:      previousTotal + addedTotal,
    },
    adding: {
      packageName: opportunityFields.package_name || opportunityFields.service_type || null,
      serviceType: opportunityFields.service_type || null,
      paxCount:    opportunityFields.pax_count || null,
      total:       addedTotal,
    },
  };
}

/**
 * Folds a follow-up order into the booking the customer already has.
 *
 * Appends the new dishes, adds the two totals together, and stamps a dated
 * line into the notes so the change is legible on the opportunity itself —
 * an admin looking at the booking sees what was added and when, without
 * having to open the contact record.
 *
 * Summing the totals is arithmetic, not a pricing decision: deposits and
 * discounts live outside this field, and every booking is confirmed by a
 * human before it reaches the kitchen. Leaving the total untouched would be
 * the riskier choice — the kitchen would cook the additions and the invoice
 * would not bill for them.
 */
async function applyAddition({ existing, fieldIds, opportunityFields, monetaryValue, noteBody, contact, contactId }) {
  const opportunityId = existing.id;
  const previousTotal = Number(existing.monetaryValue ?? 0);
  const addedTotal    = Number(monetaryValue ?? 0);
  const newTotal      = previousTotal + addedTotal;

  const stamp = toManilaISOString(new Date()).slice(0, 16).replace("T", " ");
  const addedDishes = opportunityFields.dishes_selected ?? "";

  const prevDishes = opportunityFieldValue(existing, fieldIds.dishes_selected) ?? "";
  const prevNotes  = opportunityFieldValue(existing, fieldIds.event_notes) ?? "";

  // Both orders, with a dated divider so the kitchen can see what arrived
  // later. Reused for the payment page, which must show the whole booking
  // rather than only the items just added.
  const combinedDishes = addedDishes
    ? `${prevDishes}\n\n── ADDED ${stamp} ──\n${addedDishes}`.trim()
    : prevDishes;

  const customFields = [];
  const push = (key, value) => {
    if (fieldIds[key] && value !== null && value !== undefined && String(value).trim() !== "") {
      customFields.push({ id: fieldIds[key], field_value: String(value) });
    }
  };

  push("dishes_selected", combinedDishes);

  push("event_notes", `${prevNotes}${prevNotes ? " · " : ""}ADDITION ${stamp}: +₱${addedTotal.toLocaleString()}`);

  try {
    await updateOpportunity(opportunityId, { monetaryValue: newTotal, customFields });
  } catch (e) {
    // The note below still runs, so the request is never lost even if the
    // opportunity write fails — but this one matters enough to surface.
    console.error("Addition update failed for opportunity", opportunityId, e.message);
  }

  // Full text of the follow-up order, kept as an audit trail alongside the
  // summarised version written into the fields above.
  try {
    await ghlPost(`/contacts/${contactId}/notes`, {
      body: `ADDITION to existing booking (${opportunityId})\n\n${noteBody}`,
    });
  } catch (e) {
    console.warn("Addition note failed (non-fatal):", e.message);
  }

  // The payment link has to move with the booking. This step used to run
  // only when a new opportunity was created, so an addition left the
  // customer holding a link quoting the original amount — and the 50%
  // reserve figure is derived from that same number, so both were wrong.
  //
  // Built from the combined booking, not from the items just added: the
  // customer is paying for the whole order, not the difference.
  await ensurePaymentLink({
    opportunityId,
    contactId,
    fieldIds,
    orderSummary: buildOrderSummary({
      contact,
      fields: {
        ...opportunityFields,
        dishes_selected: combinedDishes,
      },
      monetaryValue: newTotal,
    }),
  });

  return {
    opportunityId,
    eventDate:      opportunityFields.event_date ?? null,
    previousTotal,
    addedTotal,
    newTotal,
  };
}

/**
 * POST /api/ghl-inquiry
 * Body: { contact, opportunityName, monetaryValue, noteBody, contactFields, opportunityFields }
 *
 * Holds the GHL Private Integration token server-side — the browser never sees it.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // `let` because monetaryValue is replaced below with the figure this
  // server calculates. The browser's number never reaches storage.
  let {
    contact,
    opportunityName,
    monetaryValue,
    noteBody,
    contactFields = {},
    opportunityFields = {},
    lineItems = null,
    company,
    // Set when the customer has seen "the price has changed" and accepted
    // the corrected figure. Absent on a first submission, which is what
    // makes the question get asked.
    priceConfirmed,
    // "add" | "separate" — the customer's answer to the 409 below. Absent on
    // a first submission, which is what makes the question get asked.
    intent,
    // Minted by the browser when the contact panel is first rendered, and
    // constant across retries and across the duplicate question, so all of
    // it counts as one order however many requests it takes.
    idempotencyKey,
  } = req.body ?? {};

  // Honeypot. `company` is a hidden field no human ever sees, so anything
  // that fills it is automated. Answered with a plain 200 rather than an
  // error: a bot that learns it was rejected adapts, one that thinks it
  // succeeded does not.
  if (typeof company === "string" && company.trim() !== "") {
    console.warn("Honeypot triggered — inquiry discarded");
    res.status(200).json({ ok: true });
    return;
  }

  // This endpoint writes contacts, opportunities, notes and calendar entries
  // into the live CRM and has no authentication — it cannot have any, since
  // the customer is anonymous. Origin is the cheap filter; the per-IP count
  // is the one that actually holds.
  if (!originAllowed(req)) {
    console.warn("Inquiry rejected — origin not allowed:", req.headers.origin ?? req.headers.referer);
    res.status(403).json({ error: "Requests must come from the booking site." });
    return;
  }

  const ip = callerIp(req);
  const { allowed, reason } = await checkRateLimit(ip);
  if (!allowed) {
    console.warn(`Inquiry rate limited for ${ip}: ${reason}`);
    res.status(429).json({
      error: "We've had several inquiries from your connection recently. Please call us and we'll take your order directly.",
    });
    return;
  }

  // Recorded on attempt, not on success. A submission that fails partway
  // still consumed the work, and counting only successes would let a script
  // retry indefinitely against whatever made it fail.
  //
  // But an order is now two requests — the question, then the answer — and
  // charging both meant a customer used two of their allowance to place one
  // booking. The answer is checked above and simply not recorded here.
  if (countsAgainstLimit(req.body)) await recordAttempt(ip);

  if (!contact?.email && !contact?.phone) {
    res.status(400).json({ error: "contact.email or contact.phone is required" });
    return;
  }

  // Double underscore is not a typo: GHL derived this key from the field's
  // label, "Delivery / Pickup Time". It has to match the location's field
  // exactly or the value is dropped (see the field-ID filter below).
  const fulfilmentTime = opportunityFields.delivery__pickup_time;

  // Only checked when present — an inquiry without a time is still accepted
  // (the appointment step already skips itself), so this rejects bad values
  // rather than newly requiring the field. Zero-padded 24-hour strings
  // compare correctly as strings, which also catches malformed input.
  if (fulfilmentTime && (fulfilmentTime < FULFILMENT_TIME_MIN || fulfilmentTime > FULFILMENT_TIME_MAX)) {
    res.status(400).json({
      error: `Delivery/pickup time must be between ${FULFILMENT_TIME_MIN} and ${FULFILMENT_TIME_MAX}.`,
    });
    return;
  }

  // ── The total is ours to decide, not the customer's ───────────────────
  //
  // monetaryValue arrives from the browser, and it is the only money figure
  // in the system — Sales, Reports, Branch Performance and Owner Financials
  // in the dashboard all sum it. Taking it on trust meant a ₱50,000 order
  // could be submitted as ₱1, and the payment page would have agreed, since
  // it renders that same number.
  //
  // So the menu is priced here, from the same tables and the same functions
  // the browser used, and the customer's figure is only ever a tripwire.
  // What gets written below is always the server's number, even when they
  // match — a bug in the comparison then still cannot let a browser value
  // through.
  const verified = await serverTotal(lineItems).catch((e) => {
    console.error("Price verification failed, accepting the submitted total:", e.message);
    return null;
  });

  // null means we could not price it — an older client that sends no line
  // items, an unpriceable line, or Supabase being unreachable. Refusing a
  // booking because our own check could not run would turn our bug into a
  // lost order, so it proceeds unverified and says so.
  if (verified === null) {
    console.warn("Order accepted without price verification", { service: lineItems?.service ?? "none" });
  } else if (verified !== Number(monetaryValue)) {
    // Exact, no tolerance: every price is an integer number of pesos and
    // nothing multiplies by a percentage or rounds, so there is no
    // legitimate source of a difference.
    //
    // Far more often a price changed in the dashboard mid-session than
    // anyone tampering, so the customer is shown the real figure and
    // offered it rather than being told to start again. Nothing is hidden:
    // the price tables are publicly readable, so a tamperer could have
    // calculated the correct total anyway.
    console.error("Price mismatch", {
      ip, service: lineItems?.service, submitted: Number(monetaryValue), verified,
    });

    if (!priceConfirmed) {
      res.status(409).json({
        priceChanged: true,
        submittedTotal: Number(monetaryValue),
        correctTotal: verified,
      });
      return;
    }
  }

  // From here the server's figure is the order's value. Reassigned rather
  // than compared again further down, so nothing below can reach for the
  // browser's number by accident.
  if (verified !== null) monetaryValue = verified;

  // Claimed here rather than earlier: everything above rejects without
  // writing anything, so there is nothing to make idempotent yet, and
  // claiming before a 400 would burn the key on a request that never
  // reached GoHighLevel.
  const claim = await claimIdempotencyKey(idempotencyKey);

  if (!claim.proceed && claim.replay) {
    // This exact order already completed. Answer identically rather than
    // creating a second booking — a customer who double-tapped Send sees one
    // confirmation, and it is the same one.
    console.warn(`Idempotency key ${idempotencyKey} replayed`);
    res.status(200).json(claim.replay);
    return;
  }

  if (!claim.proceed && claim.inFlight) {
    res.status(409).json({
      error: "We're still saving your order — give it a moment before trying again.",
    });
    return;
  }

  try {
    const fieldIds = await fetchFieldIds("opportunity");

    // fetchFieldIds returns {} both when a location genuinely has no
    // opportunity fields and when the lookup itself failed — fetchAllFields
    // swallows errors and returns an empty list. The filter below drops any
    // key it cannot resolve, so without this guard a transient GHL failure
    // would drop *every* field, create a bare opportunity, and still show
    // the customer a success screen. Failing here instead means they retry
    // and keep their data; the contact create below hasn't run yet, so
    // there is no half-written record left behind either.
    const hasFieldsToWrite = Object.values(opportunityFields).some(
      (v) => v !== null && v !== undefined && String(v).trim() !== ""
    );
    if (hasFieldsToWrite && Object.keys(fieldIds).length === 0) {
      throw new Error(
        "GHL custom field list came back empty — refusing to create an opportunity with every field dropped"
      );
    }

    // ── 1. Create or find contact ─────────────────────────────────────────
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

    // Resolved field IDs, not key names. The key-object form GHL also
    // accepts writes DATE fields and silently ignores dropdowns, so
    // contact.branch — a Cavite|Batangas|Montalban picklist — never once
    // persisted, while contact.event_date beside it always did. The array
    // form is what the booking migration used successfully on 102 records.
    if (Object.keys(contactFields).length > 0) {
      try {
        const contactFieldIds = await fetchFieldIds("contact");
        const payload = Object.entries(contactFields)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
          .filter(([key]) => {
            if (contactFieldIds[key]) return true;
            console.error(`GHL contact field "${key}" does not exist in this location — value dropped.`);
            return false;
          })
          .map(([key, value]) => ({ id: contactFieldIds[key], field_value: String(value) }));

        if (payload.length > 0) {
          await ghlPut(`/contacts/${contactId}`, { customFields: payload });
        }
      } catch (e) {
        console.warn("Contact custom field update failed (non-fatal):", e.message);
      }
    }

    // ── 2. Create opportunity with real field IDs ─────────────────────────
    // Unknown keys are dropped loudly rather than passed through. This used
    // to fall back to sending the key string in place of a field ID, which
    // GHL accepts and then silently ignores — the opportunity is created,
    // the customer sees success, and the value is simply gone with nothing
    // anywhere saying so. base_price had been disappearing that way on
    // every single inquiry. The console.error is the whole point: a field
    // missing from GHL should be findable in the logs, not invisible.
    const oppCustomFields = Object.entries(opportunityFields)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .filter(([key]) => {
        if (fieldIds[key]) return true;
        console.error(
          `GHL opportunity field "${key}" does not exist in this location — value dropped. ` +
          `Create it in GHL (Settings → Custom Fields → Opportunities) to stop losing this data.`
        );
        return false;
      })
      .map(([key, value]) => ({
        id:          fieldIds[key],
        field_value: String(value),
      }));

    // ── 2a. Does this customer already have a booking? ─────────────────────
    // Not an error, and not ours to resolve. Whether these items belong to
    // that order or are a separate event is something only the customer
    // knows, so nothing is written until they say. The first version of this
    // merged silently and told them afterwards, which meant deciding on
    // their behalf and being wrong for anyone booking two occasions.
    //
    // GoHighLevel permits one open opportunity per contact — verified
    // against the live location, and it holds regardless of date, name or
    // content. So a second booking cannot simply be created; the customer
    // has to be told what their options actually are.
    const existing = (await findContactOpportunities(contactId))[0] ?? null;

    if (existing && !intent) {
      // Nothing was written, and the customer is about to resubmit with the
      // same key carrying their answer. Release it or that answer would be
      // refused as a duplicate of the question.
      await releaseIdempotencyKey(idempotencyKey);
      res.status(409).json(describeExisting(existing, fieldIds, monetaryValue, opportunityFields));
      return;
    }

    if (existing && intent === "add") {
      const addedTo = await applyAddition({
        existing, fieldIds, opportunityFields, monetaryValue, noteBody, contact, contactId,
      });
      const attachedResponse = { ok: true, attached: addedTo };
      await completeIdempotencyKey(idempotencyKey, attachedResponse);
      res.status(200).json(attachedResponse);
      return;
    }

    let opportunityId;
    try {
      const oppResult = await ghlPost("/opportunities/", {
        locationId:      GHL_LOC,
        pipelineId:      PIPELINE_ID,
        pipelineStageId: STAGE_ID,
        contactId,
        name:            opportunityName,
        monetaryValue,
        status:          "open",
        ...(oppCustomFields.length > 0 ? { customFields: oppCustomFields } : {}),
      });
      opportunityId = oppResult?.opportunity?.id ?? oppResult?.id;
    } catch (e) {
      // GHL's opportunity search is eventually consistent: for roughly a
      // minute after one is created it does not come back from a lookup. So
      // a customer ordering twice in quick succession gets past step 2a —
      // the search finds nothing — and is refused here instead.
      //
      // The rejection carries meta.existingId, which is authoritative and
      // has no lag. Ask the customer the same question step 2a would have,
      // rather than handing them a 502 for a situation we understand.
      const existingId = duplicateExistingId(e);
      if (existingId && !intent) {
        const found = await getOpportunity(existingId);
        if (found) {
          await releaseIdempotencyKey(idempotencyKey);
          res.status(409).json(describeExisting(found, fieldIds, monetaryValue, opportunityFields));
          return;
        }
      }

      // Refused a separate booking. GHL allows one open opportunity per
      // contact, so this is a location setting rather than anything the
      // customer or this code can work around — say so plainly instead of
      // returning a 502 they can only read as "try again".
      if (existingId && intent === "separate") {
        // Released so the customer can come back and choose "add" instead
        // without being told their own order is a duplicate.
        await releaseIdempotencyKey(idempotencyKey);
        res.status(409).json({
          error:
            "We can only hold one open booking per customer at a time. " +
            "Please call us and we'll set up your second event.",
        });
        return;
      }

      console.error("Opportunity create failed:", e.message);
      throw e;
    }

    // ── 3. Add note (best-effort) ───────────────────────────────────────────
    try {
      await ghlPost(`/contacts/${contactId}/notes`, { body: noteBody });
    } catch (e) {
      console.warn("GHL note creation failed (non-fatal):", e.message);
    }

    // ── 4. Book a tentative calendar appointment (best-effort) ─────────────
    // Booked at the delivery/pickup time — the slot represents when our
    // team is occupied, not when the customer's event starts.
    //
    // Derived from the same values checked at the top of this handler, not
    // from a separate object the client sends alongside them. When those
    // were two different fields, a client could pass the window check with
    // one time and book the calendar with another — which is exactly what
    // that check exists to prevent.
    const apptBranch = contactFields.branch    ?? opportunityFields.branch;
    const apptDate   = contactFields.event_date ?? opportunityFields.event_date;
    const calendarId = CALENDAR_IDS[apptBranch];
    if (calendarId && apptDate && fulfilmentTime) {
      try {
        const startTime = `${apptDate}T${fulfilmentTime}:00${MANILA_OFFSET}`;
        const endTime = toManilaISOString(
          new Date(new Date(startTime).getTime() + APPOINTMENT_DURATION_MIN * 60000)
        );

        await ghlPost("/calendars/events/appointments", {
          calendarId,
          locationId:       GHL_LOC,
          contactId,
          title:            opportunityName,
          startTime,
          endTime,
          appointmentStatus: "new",
          toNotify:          false,
        });
      } catch (e) {
        console.warn("GHL calendar appointment failed (non-fatal):", e.message);
      }
    }

    // ── 5. Mint a proof-of-payment link for this opportunity (best-effort) ──
    // Generated now (not on stage-change) so opportunity.payment_link is
    // already set by the time the team's "Booking Confirmed" email fires —
    // no GHL Workflow/webhook needed to populate it. The 15-minute window
    // doesn't start until the customer actually opens the link (see
    // api/payment-link-info.js), so it staying dormant for days until the
    // booking is confirmed is fine.
    // Diagnostic only — not used by the frontend, just so we can see what
    // happened via the browser's Network tab without needing Vercel logs.
    const paymentLinkDebug = await ensurePaymentLink({
      opportunityId,
      contactId,
      fieldIds,
      orderSummary: buildOrderSummary({
        contact,
        fields: opportunityFields,
        monetaryValue,
      }),
    });

    const created = { ok: true, paymentLinkDebug };
    await completeIdempotencyKey(idempotencyKey, created);
    res.status(200).json(created);
  } catch (e) {
    console.error("GHL inquiry submission failed:", e);
    // Released so a customer whose order genuinely failed can try again
    // immediately, rather than waiting out the in-flight window.
    await releaseIdempotencyKey(idempotencyKey);
    res.status(502).json({ error: e.message });
  }
}
