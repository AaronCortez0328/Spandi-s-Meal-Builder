import { createApp } from "./app/app.js";
import { mountPaymentUpload } from "./app/payment-upload.js";
import { initIframeResize } from "./app/iframe-resize.js";
import { initParentView } from "./app/parent-view.js";
import { initListboxKeys } from "./app/listbox-keys.js";
import { revealPhotosAsTheyLoad } from "./app/ui-fx.js";

// Keep the GHL parent iframe sized to our content on every page,
// including the standalone payment page.
initIframeResize();

// The other direction: the parent tells us which slice of that content the
// customer can actually see, so anything that has to be ON SCREEN -- the
// terms dialog -- can be sized and placed against the phone rather than
// against the full height of the builder.
initParentView();

// Make the custom dropdowns operable by keyboard (arrow keys, Enter, Esc).
initListboxKeys();

// Photographs stay transparent until their bytes land. Registered before
// anything renders, so no image can finish loading before someone is
// listening for it.
revealPhotosAsTheyLoad();

const params = new URLSearchParams(location.search);
const paymentToken = params.get("pay");

if (paymentToken) {
  document.getElementById("loading-state")?.setAttribute("hidden", "");
  const main = document.getElementById("main-content");
  mountPaymentUpload(main, paymentToken);
} else {
  // ?service=<key> opens that builder directly, so the cards on the GHL site
  // can link to a service rather than dropping everyone on the chooser.
  //
  // The parameter has to be forwarded into this iframe by the embed on the
  // parent page — a query string on the GHL URL does not reach us on its own.
  // Anything unknown or currently switched off resolves back to the chooser;
  // see resolveInitialService() in app.js.
  createApp().mount(params.get("service"));
}
