import { createApp } from "./app/app.js";
import { mountPaymentUpload } from "./app/payment-upload.js";

const paymentToken = new URLSearchParams(location.search).get("pay");

if (paymentToken) {
  document.getElementById("loading-state")?.setAttribute("hidden", "");
  const main = document.getElementById("main-content");
  mountPaymentUpload(main, paymentToken);
} else {
  createApp().mount();
}
