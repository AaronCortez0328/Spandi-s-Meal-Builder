import { pushInquiryToGHL } from "./ghl.js";
import { renderExistingBooking, showBookingChoiceError } from "./existing-booking.js";

const GENERIC_ERROR =
  "Sorry — that didn’t go through. Please check your connection and try again.";

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
export async function submitInquiry({ payload, panel, onSuccess, onError }) {
  let result;
  try {
    result = await pushInquiryToGHL(payload);
  } catch (e) {
    console.error("GHL submission failed:", e);
    onError(e.userFacing ? e.message : GENERIC_ERROR);
    return;
  }

  // Not an error — the customer already has a booking and has to say whether
  // this belongs to it. Nothing has been written yet; their answer is what
  // commits it.
  if (result.needsChoice && panel) {
    renderExistingBooking(panel, result.existing, async (intent) => {
      try {
        const answered = await pushInquiryToGHL({ ...payload, intent });
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
