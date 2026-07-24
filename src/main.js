import { createApp } from "./app/app.js";
import { mountPaymentUpload } from "./app/payment-upload.js";
import { initIframeResize } from "./app/iframe-resize.js";

// Keep the GHL parent iframe sized to our content on every page,
// including the standalone payment page.
initIframeResize();

const paymentToken = new URLSearchParams(location.search).get("pay");

if (paymentToken) {
  document.getElementById("loading-state")?.setAttribute("hidden", "");
  const main = document.getElementById("main-content");
  mountPaymentUpload(main, paymentToken);
} else {
  createApp().mount();
}
