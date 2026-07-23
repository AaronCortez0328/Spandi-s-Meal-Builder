/**
 * Standalone "upload proof of payment" view.
 * Mounted instead of the full estimator when the URL has a ?pay=<token> param
 * (see src/main.js). Renders a read-only booking summary fetched from the
 * token, static payment instructions, and a file upload.
 */

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",").pop());
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderError(container, message) {
  container.innerHTML = `
    <div class="success-screen">
      <div class="success-text">
        <h2>Link unavailable</h2>
        <p>${esc(message)}</p>
      </div>
    </div>
  `;
}

function renderSuccess(container) {
  container.innerHTML = `
    <div class="success-screen">
      <div class="success-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="success-text">
        <h2>Proof of Payment Received!</h2>
        <p>Spandi's team will verify your payment and confirm shortly.</p>
      </div>
    </div>
  `;
}

function renderForm(container, token, orderSummary) {
  const rows = Object.entries(orderSummary ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([label, value]) => `
      <div class="success-summary__row">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join("");

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-kicker">Spandi's Food + Catering</p>
        <h2>Upload Proof of Payment</h2>
      </div>
    </div>

    <p class="contact-intro">Please review your booking details below, then upload a screenshot or photo of your payment receipt.</p>

    <p class="booking-caption">Your Booking</p>
    <div class="success-summary">${rows}</div>

    <div class="contact-booking-note">
      Please send your down payment via <strong>GCash</strong> or <strong>Bank Transfer</strong> using the details Spandi's team sent you, then upload your receipt below.
    </div>

    <form id="pop-form" novalidate>
      <div class="form-field">
        <label class="form-field__label" for="pop-file">
          Proof of Payment <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input type="file" id="pop-file" name="file" class="form-field__input" accept="image/*,.pdf" required />
      </div>
    </form>

    <div class="step-nav">
      <div class="step-nav__cta">
        <button class="primary-button" type="button" id="pop-submit">Submit Proof of Payment</button>
        <p class="status-text" id="pop-status" role="status" aria-live="polite"></p>
      </div>
    </div>
  `;

  const fileInput = container.querySelector("#pop-file");
  const submitBtn = container.querySelector("#pop-submit");
  const statusEl  = container.querySelector("#pop-status");

  submitBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.textContent = "Please choose a file first.";
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Uploading…";

    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await fetch("/api/submit-payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fileName: file.name, fileType: file.type, fileBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`);

      renderSuccess(container);
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      submitBtn.disabled = false;
    }
  });
}

function renderLoadingSkeleton(container) {
  container.innerHTML = `
    <div class="skeleton-hero-lines" style="align-items: flex-start;">
      <div class="skeleton-block skeleton-kicker"></div>
      <div class="skeleton-block skeleton-heading"></div>
      <div class="skeleton-block skeleton-subtext"></div>
    </div>
    <div class="pop-skeleton-rows">
      ${Array.from({ length: 5 }, () => `<div class="skeleton-block pop-skeleton-row"></div>`).join("")}
    </div>
  `;
}

export async function mountPaymentUpload(container, token) {
  renderLoadingSkeleton(container);

  try {
    const res = await fetch(`/api/payment-link-info?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderError(container, data.error ?? "This link is invalid.");
      return;
    }
    renderForm(container, token, data.orderSummary);
  } catch {
    renderError(container, "Couldn't reach the server. Please check your connection and try again.");
  }
}
