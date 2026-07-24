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
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Tap to choose a screenshot or photo</span>
          </label>

          <div class="pop-file-card" id="pop-file-card" hidden>
            <div class="pop-file-card__row">
              <label class="pop-file-card__main" for="pop-file">
                <svg class="pop-file-card__icon" id="pop-file-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span class="pop-file-card__info">
                  <span class="pop-file-card__name" id="pop-file-name"></span>
                  <span class="pop-file-card__size" id="pop-file-size"></span>
                </span>
              </label>
              <button type="button" class="pop-file-card__cancel" id="pop-file-cancel" aria-label="Cancel upload" hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="pop-file-card__bar-track" id="pop-file-bar-track" hidden>
              <div class="pop-file-card__bar" id="pop-file-bar"></div>
              <span class="pop-file-card__pct" id="pop-file-pct"></span>
            </div>
            <p class="pop-file-card__error" id="pop-file-error" hidden></p>
            <button type="button" class="text-button pop-file-card__retry" id="pop-file-retry" hidden>Retry upload</button>
          </div>

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

  const fileInput    = container.querySelector("#pop-file");
  const submitBtn    = container.querySelector("#pop-submit");
  const statusEl     = container.querySelector("#pop-status");
  const uploadWell   = container.querySelector("#pop-upload-well");
  const fileCard     = container.querySelector("#pop-file-card");
  const fileIcon     = container.querySelector("#pop-file-icon");
  const fileNameEl   = container.querySelector("#pop-file-name");
  const fileSizeEl   = container.querySelector("#pop-file-size");
  const cancelBtn    = container.querySelector("#pop-file-cancel");
  const barTrack     = container.querySelector("#pop-file-bar-track");
  const bar          = container.querySelector("#pop-file-bar");
  const pctEl        = container.querySelector("#pop-file-pct");
  const errorEl      = container.querySelector("#pop-file-error");
  const retryBtn     = container.querySelector("#pop-file-retry");

  const DOC_ICON = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`;
  const WARN_ICON = `<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`;

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  let currentXhr = null;

  function showReadyState(file) {
    uploadWell.hidden = true;
    fileCard.hidden = false;
    fileCard.classList.remove("is-error");
    fileIcon.innerHTML = DOC_ICON;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatFileSize(file.size);
    cancelBtn.hidden = true;
    barTrack.hidden = true;
    bar.style.width = "0%";
    errorEl.hidden = true;
    retryBtn.hidden = true;
    statusEl.textContent = "";
  }

  function showUploadingState() {
    fileCard.classList.remove("is-error");
    cancelBtn.hidden = false;
    barTrack.hidden = false;
    errorEl.hidden = true;
    retryBtn.hidden = true;
  }

  function updateProgress(pct) {
    bar.style.width = `${pct}%`;
    pctEl.textContent = `${pct}%`;
  }

  function showErrorState(message) {
    fileCard.classList.add("is-error");
    fileIcon.innerHTML = WARN_ICON;
    cancelBtn.hidden = true;
    barTrack.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = message;
    retryBtn.hidden = false;
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    showReadyState(file);
  });

  cancelBtn.addEventListener("click", () => {
    currentXhr?.abort();
  });

  // XHR (not fetch) specifically so we get real upload.onprogress byte
  // counts for a genuine percentage, not a simulated/timed animation —
  // and so an in-flight request can actually be aborted (cancel button).
  function submitProof(payload) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      currentXhr = xhr;
      xhr.open("POST", "/api/submit-payment-proof");
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        updateProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON response */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error ?? `Upload failed (HTTP ${xhr.status})`));
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.onabort = () => reject(new Error("__CANCELLED__"));
      xhr.send(JSON.stringify(payload));
    });
  }

  async function attemptUpload() {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.textContent = "Please choose a file first.";
      return;
    }

    submitBtn.disabled = true;
    showUploadingState();
    updateProgress(0);

    try {
      const fileBase64 = await readFileAsBase64(file);
      await submitProof({ token, fileName: file.name, fileType: file.type, fileBase64 });
      renderSuccess(container);
    } catch (e) {
      currentXhr = null;
      submitBtn.disabled = false;
      if (e.message === "__CANCELLED__") {
        showReadyState(file);
      } else {
        showErrorState(e.message);
      }
    }
  }

  submitBtn.addEventListener("click", attemptUpload);
  retryBtn.addEventListener("click", attemptUpload);
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
