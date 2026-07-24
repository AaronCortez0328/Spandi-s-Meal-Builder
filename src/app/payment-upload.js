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
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-text">
          <h2>Link unavailable</h2>
          <p>${esc(message)}</p>
        </div>
      </div>
    </div>
  `;
}

function renderSuccess(container) {
  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>Proof of Payment Received!</h2>
          <p>Spandi's team will verify your payment and confirm shortly.</p>
        </div>
      </div>
    </div>
  `;
}

function renderPaymentInfo(paymentInfo, contactName) {
  if (!paymentInfo) {
    return `
      <div class="contact-booking-note">
        Please send your down payment via <strong>GCash</strong> or <strong>Bank Transfer</strong> using the details Spandi's team sent you, then upload your receipt below.
      </div>
    `;
  }

  const { gcash_number, gcash_name, bank_name, bank_account_name, bank_account_number, qrUrl } = paymentInfo;

  const gcashRow = gcash_number ? `
    <div class="pay-method">
      <span class="pay-method__label">GCash</span>
      <span class="pay-method__value">
        <strong>${esc(gcash_number)}</strong>
        ${gcash_name ? `<small>${esc(gcash_name)}</small>` : ""}
      </span>
    </div>
  ` : "";

  const bankRow = bank_account_number ? `
    <div class="pay-method">
      <span class="pay-method__label">Bank Transfer</span>
      <span class="pay-method__value">
        <strong>${esc(bank_name)} — ${esc(bank_account_number)}</strong>
        ${bank_account_name ? `<small>${esc(bank_account_name)}</small>` : ""}
      </span>
    </div>
  ` : "";

  const referenceRow = contactName ? `
    <div class="pay-method">
      <span class="pay-method__label">Reference</span>
      <span class="pay-method__value">
        <strong>${esc(contactName)}</strong>
        <small>Please note this name when you send payment</small>
      </span>
    </div>
  ` : "";

  return `
    <div class="pay-info">
      <div class="pay-info__head">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        Where to send your down payment
      </div>
      <div class="pay-info__body">
        ${gcashRow}
        ${bankRow}
        ${referenceRow}
        ${qrUrl ? `
          <a href="${esc(qrUrl)}" target="_blank" rel="noopener noreferrer">
            <img class="pay-qr" src="${esc(qrUrl)}" alt="Payment QR code — tap to view full size" />
          </a>
        ` : ""}
      </div>
    </div>
  `;
}

function renderForm(container, token, orderSummary, paymentInfo) {
  // "Dishes" gets its own section below (multi-line text), not a table row.
  const { Dishes: dishes, ...summaryFields } = orderSummary ?? {};

  const rows = Object.entries(summaryFields)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([label, value]) => `
      <div class="success-summary__row">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join("");

  const dishesSection = dishes ? `
    <div class="pop-dishes">
      <p class="booking-caption">Your Dishes</p>
      <div class="pop-dishes__body">${esc(dishes)}</div>
    </div>
  ` : "";

  container.innerHTML = `
    <div class="pop-card">
      <div class="panel-header">
        <div>
          <p class="section-kicker">Spandi's Food + Catering</p>
          <h2>Upload Proof of Payment</h2>
        </div>
      </div>

      <p class="contact-intro">Please review your booking details below, then upload a screenshot or photo of your payment receipt.</p>

      <p class="booking-caption">Your Booking</p>
      <div class="success-summary">${rows}</div>

      ${dishesSection}

      ${renderPaymentInfo(paymentInfo, summaryFields.Name)}

      <form id="pop-form" novalidate>
        <div class="form-field">
          <label class="form-field__label" for="pop-file">
            Proof of Payment <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <label class="pop-upload-well" for="pop-file" id="pop-upload-well">
            <svg id="pop-upload-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span id="pop-upload-text">Tap to choose a screenshot or photo</span>
          </label>
          <input type="file" id="pop-file" name="file" class="visually-hidden" accept="image/*,.pdf" required />
        </div>
      </form>

      <div class="step-nav">
        <div class="step-nav__cta">
          <button class="primary-button" type="button" id="pop-submit">Submit Proof of Payment</button>
          <p class="status-text" id="pop-status" role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `;

  const fileInput  = container.querySelector("#pop-file");
  const submitBtn  = container.querySelector("#pop-submit");
  const statusEl   = container.querySelector("#pop-status");
  const uploadWell = container.querySelector("#pop-upload-well");
  const uploadText = container.querySelector("#pop-upload-text");
  const uploadIcon = container.querySelector("#pop-upload-icon");

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadWell.classList.add("has-file");
    uploadText.textContent = file.name;
    uploadIcon.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
  });

  // XHR (not fetch) specifically so we get real upload.onprogress byte
  // counts for a genuine percentage, not a simulated/timed animation.
  function submitProof(payload) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/submit-payment-proof");
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        statusEl.textContent = `Uploading… ${pct}%`;
      };

      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON response */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error ?? `Upload failed (HTTP ${xhr.status})`));
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(JSON.stringify(payload));
    });
  }

  submitBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.textContent = "Please choose a file first.";
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Uploading… 0%";

    try {
      const fileBase64 = await readFileAsBase64(file);
      await submitProof({ token, fileName: file.name, fileType: file.type, fileBase64 });
      renderSuccess(container);
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      submitBtn.disabled = false;
    }
  });
}

function renderLoadingSkeleton(container) {
  container.innerHTML = `
    <div class="pop-card">
      <div class="skeleton-hero-lines" style="align-items: flex-start;">
        <div class="skeleton-block skeleton-kicker"></div>
        <div class="skeleton-block skeleton-heading"></div>
        <div class="skeleton-block skeleton-subtext"></div>
      </div>
      <div class="pop-skeleton-rows">
        ${Array.from({ length: 5 }, () => `<div class="skeleton-block pop-skeleton-row"></div>`).join("")}
      </div>
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
    renderForm(container, token, data.orderSummary, data.paymentInfo);
  } catch {
    renderError(container, "Couldn't reach the server. Please check your connection and try again.");
  }
}
