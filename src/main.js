import { createApp } from "./app/app.js";
import { clearOrder } from "./app/order-shell.js";
import { mountPaymentUpload } from "./app/payment-upload.js";
import { mountOrderStatus } from "./app/order-status.js";
import { mountChangeBanner } from "./app/change-banner.js";
import { initIframeResize } from "./app/iframe-resize.js";
import { initParentView } from "./app/parent-view.js";
import { initListboxKeys } from "./app/listbox-keys.js";
import { revealPhotosAsTheyLoad } from "./app/ui-fx.js";

// Keep the GHL parent iframe sized to our content on every page,
// including the standalone payment page.
initIframeResize();

// The other direction: which slice of that content the customer can
// actually see. The terms popup uses it to place itself on the screen
// rather than somewhere in the middle of a 2,500px-tall builder.
initParentView();

// Make the custom dropdowns operable by keyboard (arrow keys, Enter, Esc).
initListboxKeys();

// Photographs stay transparent until their bytes land. Registered before
// anything renders, so no image can finish loading before someone is
// listening for it.
revealPhotosAsTheyLoad();

const params = new URLSearchParams(location.search);
const paymentToken = params.get("pay");

// ?status=1 opens Order Status instead of the builder — the third entrance
// into one app, beside the payment page. Like ?service=, it has to be
// forwarded by the embed on the parent page: a query string on the
// GoHighLevel URL does not reach inside this iframe. So the Order Status
// page carries its own embed with the parameter already in the src, rather
// than trying to pass one through.
//
// Checked before ?pay= would be wrong: a customer holding a payment link is
// there to pay, and nothing should come between them and that. This branch
// only fires when the parameter is present, so the builder is untouched.
if (paymentToken) {
  document.getElementById("loading-state")?.setAttribute("hidden", "");
  const main = document.getElementById("main-content");
  mountPaymentUpload(main, paymentToken);
} else if (params.get("status")) {
  document.getElementById("loading-state")?.setAttribute("hidden", "");
  mountOrderStatus(document.getElementById("main-content"));
} else {
  // ?service=<key> opens that builder directly, so the cards on the GHL site
  // can link to a service rather than dropping everyone on the chooser.
  //
  // The parameter has to be forwarded into this iframe by the embed on the
  // parent page — a query string on the GHL URL does not reach us on its own.
  // Anything unknown or currently switched off resolves back to the chooser;
  // see resolveInitialService() in app.js.
  // A customer who arrived from Order Status to change a booking sees the
  // same builder as everybody else, which is the point and also the danger:
  // without something saying otherwise it reads as placing a second order.
  //
  // Mounted before the app so the strip is above it, and outside the app's
  // own container so nothing the builder re-renders can take it away.
  const main = document.getElementById("main-content");
  mountChangeBanner(main?.parentElement ?? document.body, () => {
    clearOrder();
    window.parent?.postMessage({ type: "spandis-go-status" }, "*");
    location.reload();
  });

  // Emptying the cart and filling it from the booking happens inside mount(),
  // not here — see prepareChangeCart(). It has to run after the catalogue has
  // loaded, and it must run ONCE rather than on every load of this page, or a
  // customer who steps out to the cart and back loses their work.
  createApp().mount(params.get("service"));
}
