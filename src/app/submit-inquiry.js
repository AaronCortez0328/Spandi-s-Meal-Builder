import { pushInquiryToGHL } from "./ghl.js";
import { renderExistingBooking, showBookingChoiceError } from "./existing-booking.js";
import { renderPriceChanged, showPriceChangedError } from "./price-changed.js";
import { clearDrafts } from "./draft.js";

const GENERIC_ERROR =
  "Sorry — that didn’t go through. Please check your connection and try again.";

/**
 * One key per order, generated here rather than per request.
 *
 * Every request this function makes for a single order — the first attempt,
 * and the resubmit carrying the customer's answer to the duplicate question
 * — shares it. That is what lets the server tell "the same order arriving
 * twice" apart from "a second order".
 *
 * crypto.randomUUID is available in every browser this app supports; the
 * fallback exists for insecure contexts, where it is absent.
 */
function newOrderKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * One submit path for all five builders.
 *
 * Exists because the flow now has three outcomes rather than two — created,
 * needs-a-decision, failed — and five copies of that branching is how the
 * builders drifted apart before. Adding a field to four of them and missing
 * the fifth is exactly how base_price disappeared for months.
 *
 * @param {object} o
 * @param {object} o.payload      what pushInquiryToGHL takes
 * @param {HTMLElement} o.panel   where the confirmation or the question renders
 * @param {(result: object) => void} o.onSuccess
 * @param {(message: string) => void} o.onError  shown near the submit button
 */
export async function submitInquiry({ payload, panel, onSuccess: reportSuccess, onError }) {
  const idempotencyKey = newOrderKey();
  const order = { ...payload, idempotencyKey };

  // The saved draft is discarded here rather than in each builder's own
  // success handler. There are four paths to success below — straight
  // through, after a price change, after the duplicate-booking question, and
  // after both — and wrapping once means none of them can forget. A draft
  // left behind would repopulate the next order with the last one's details.
  const onSuccess = (result) => {
    clearDrafts();
    reportSuccess(result);
  };

  let result;
  try {
    result = await pushInquiryToGHL(order);
  } catch (e) {
    console.error("GHL submission failed:", e);
    onError(e.userFacing ? e.message : GENERIC_ERROR);
    return;
  }

  // The menu prices this order differently from the figure she was quoted,
  // almost always because a price changed while she was choosing. Nothing
  // has been written; accepting the corrected total is what commits it.
  //
  // Checked before the duplicate question because the server verifies the
  // price first — reaching this means the booking check has not run yet,
  // and answering it would be answering a question not yet asked.
  if (result.priceChanged && panel) {
    renderPriceChanged(panel, result, async () => {
      try {
        const confirmed = await pushInquiryToGHL({ ...order, priceConfirmed: true });
        if (confirmed.needsChoice) {
          // The corrected price went through and revealed she also has an
          // existing booking. One question at a time.
          renderExistingBooking(panel, confirmed.existing, confirmed.adding, async (intent) => {
            try {
              onSuccess(await pushInquiryToGHL({ ...order, priceConfirmed: true, intent }));
            } catch (e) {
              showBookingChoiceError(panel, e.userFacing ? e.message : GENERIC_ERROR);
            }
          });
          return;
        }
        onSuccess(confirmed);
      } catch (e) {
        console.error("GHL submission failed after price change:", e);
        showPriceChangedError(panel, e.userFacing ? e.message : GENERIC_ERROR);
      }
    });
    return;
  }

  // Not an error — the customer already has a booking and has to say whether
  // this belongs to it. Nothing has been written yet; their answer is what
  // commits it.
  if (result.needsChoice && panel) {
    renderExistingBooking(panel, result.existing, result.adding, async (intent) => {
      try {
        // Same key as the question it is answering — one order, not two.
        const answered = await pushInquiryToGHL({ ...order, intent });
        onSuccess(answered);
      } catch (e) {
        console.error("GHL submission failed after choice:", e);
        // Stays on this panel with the buttons re-enabled rather than
        // dumping them back to the form — their order is still intact here,
        // and "separate booking" can legitimately be refused by GHL while
        // "add" would still work.
        showBookingChoiceError(panel, e.userFacing ? e.message : GENERIC_ERROR);
      }
    });
    return;
  }

  onSuccess(result);
}
