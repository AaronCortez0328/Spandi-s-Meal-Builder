/**
 * Standalone "upload proof of payment" view.
 * Mounted instead of the full estimator when the URL has a ?pay=<token> param
 * (see src/main.js). Renders a read-only booking summary fetched from the
 * token, static payment instructions, and a file upload.
 */

import { supabase } from "../data/supabase-client.js";
import { setButtonBusy } from "./button-busy.js";

const MAX_FILES = 5;

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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

/**
 * @param {number|null} attemptsRemaining  how many more submissions this
 *   link still allows. Told to her here because it is only relevant right
 *   after she has just used one — not worth a permanent line on the form.
 */
function renderSuccess(container, attemptsRemaining) {
  clearInterval(countdownTimer);

  const followUp = attemptsRemaining > 0
    ? `<p>Still have a balance to pay? You can reopen this same link later — you have ${attemptsRemaining} more submission${attemptsRemaining === 1 ? "" : "s"} available.</p>`
    : `<p>This was the final submission this link allows. If you still owe a balance, please contact us directly.</p>`;

  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>Proof of Payment Received!</h2>
          <p>Spandi's team will verify your payment and confirm shortly.</p>
          ${followUp}
        </div>
      </div>
    </div>
  `;
}

/** Shown when a link has used every submission it allows — not an error. */
function renderFinished(container, orderSummary) {
  clearInterval(countdownTimer);
  const total = orderSummary?.Total;
  container.innerHTML = `
    <div class="pop-card">
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>All payments received</h2>
          <p>
            ${total ? `Your booking (${esc(total)}) is` : "This booking is"}
            fully settled on our side. If you believe this is a mistake, please contact us directly.
          </p>
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

let countdownTimer = null;

/**
 * Ticks this visit's window down to zero.
 *
 * Seeded from a server-computed seconds value rather than an expiry
 * timestamp, so counting down locally can't be skewed by a wrong device
 * clock. Purely informational — both upload endpoints re-validate
 * expires_at server-side.
 *
 * Reaching zero is no longer the end of the link: reopening the page grants
 * a fresh 15 minutes (payment-link-info.js resets the window on every
 * open), so this offers a reload rather than telling her to ask for a new
 * link, which she no longer needs.
 */
function startCountdown(container, token, secondsRemaining) {
  clearInterval(countdownTimer);

  const el = container.querySelector("#pop-expiry");
  if (!el || typeof secondsRemaining !== "number") return;

  let remaining = Math.max(0, secondsRemaining);

  const tick = () => {
    // The form gets replaced wholesale on success/error; stop rather than
    // writing to a node that's no longer in the document.
    if (!el.isConnected) {
      clearInterval(countdownTimer);
      return;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, "0");
    el.textContent = remaining > 0 ? `Expires in ${minutes}:${seconds}` : "Session timed out";
    el.classList.toggle("is-urgent", remaining > 0 && remaining <= 120);
    el.classList.toggle("is-expired", remaining === 0);

    if (remaining === 0) {
      clearInterval(countdownTimer);
      const submit = container.querySelector("#pop-submit");
      if (submit) submit.disabled = true;
      const status = container.querySelector("#pop-status");
      if (status) {
        status.innerHTML = `This session timed out. <button type="button" class="text-button" id="pop-reopen">Tap here for another 15 minutes</button>.`;
        status.querySelector("#pop-reopen")?.addEventListener("click", () => mountPaymentUpload(container, token));
      }
      return;
    }
    remaining -= 1;
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

/** Parses "PHP 14,350" back to 14350 so we can offer the half-deposit. */
function parsePeso(value) {
  const amount = parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function formatPeso(amount) {
  return `PHP ${Math.round(amount).toLocaleString("en-PH")}`;
}

/**
 * The customer may settle in full or reserve with half — the team
 * verifies the receipt either way, so this states both amounts rather
 * than demanding one. Falls back to just the total if the figure can't
 * be parsed, which is better than showing a wrong deposit.
 */
function renderAmountDue(total) {
  if (!total) return "";
  const amount = parsePeso(total);
  const half = amount ? `Pay in full, or reserve with 50% &mdash; <strong>${esc(formatPeso(amount / 2))}</strong>` : "";

  return `
    <div class="pop-amount">
      <span class="pop-amount__label">Amount due</span>
      <span class="pop-amount__value">${esc(total)}</span>
      ${half ? `<span class="pop-amount__note">${half}</span>` : ""}
    </div>
  `;
}

function renderForm(container, token, orderSummary, paymentInfo, secondsRemaining) {
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
      <div class="panel-header pop-header">
        <div>
          <p class="section-kicker">Spandi's Food + Catering</p>
          <h2>Upload Proof of Payment</h2>
        </div>
        <span class="pop-expiry" id="pop-expiry" role="timer" aria-live="off"></span>
      </div>

      <p class="contact-intro">Please review your booking details below, then upload a screenshot or photo of your payment receipt.</p>

      ${renderAmountDue(summaryFields.Total)}

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
            <span id="pop-upload-well-text">Tap to choose up to ${MAX_FILES} screenshots or photos</span>
          </label>

          <div class="pop-file-list" id="pop-file-list"></div>

          <input type="file" id="pop-file" name="file" class="visually-hidden" accept="image/*,.pdf" multiple />
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

  const fileInput      = container.querySelector("#pop-file");
  const submitBtn      = container.querySelector("#pop-submit");
  const statusEl       = container.querySelector("#pop-status");
  const uploadWell     = container.querySelector("#pop-upload-well");
  const uploadWellText = container.querySelector("#pop-upload-well-text");
  const fileListEl     = container.querySelector("#pop-file-list");

  startCountdown(container, token, secondsRemaining);

  const DOC_ICON = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`;
  const WARN_ICON = `<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`;
  const CHECK_ICON = `<polyline points="20 6 9 17 4 12"/>`;

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Each entry: { id, file, status: 'pending'|'uploading'|'done'|'error', error, path }
  let entries = [];

  function renderFileCard(entry) {
    const icon = entry.status === "error" ? WARN_ICON : entry.status === "done" ? CHECK_ICON : DOC_ICON;
    const canRemove = entry.status !== "uploading";

    return `
      <div class="pop-file-card${entry.status === "error" ? " is-error" : ""}${entry.status === "done" ? " is-done" : ""}" data-id="${entry.id}">
        <div class="pop-file-card__row">
          <div class="pop-file-card__main">
            <svg class="pop-file-card__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
            <span class="pop-file-card__info">
              <span class="pop-file-card__name">${esc(entry.file.name)}</span>
              <span class="pop-file-card__size">${formatFileSize(entry.file.size)}</span>
            </span>
          </div>
          ${canRemove ? `
            <button type="button" class="pop-file-card__cancel" data-action="remove" data-id="${entry.id}" aria-label="Remove file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          ` : ""}
        </div>
        ${entry.status === "uploading" ? `
          <div class="pop-file-card__bar-track">
            <div class="pop-file-card__bar pop-file-card__bar--indeterminate"></div>
          </div>
        ` : ""}
        ${entry.status === "error" ? `
          <p class="pop-file-card__error">${esc(entry.error)}</p>
          <button type="button" class="text-button pop-file-card__retry" data-action="retry" data-id="${entry.id}">Retry upload</button>
        ` : ""}
      </div>
    `;
  }

  function renderFileList() {
    fileListEl.innerHTML = entries.map(renderFileCard).join("");
    uploadWell.hidden = entries.length >= MAX_FILES;
    uploadWellText.textContent = entries.length > 0
      ? `Add another (${entries.length}/${MAX_FILES})`
      : `Tap to choose up to ${MAX_FILES} screenshots or photos`;
  }

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // allow re-selecting so change fires again for more files

    for (const file of picked) {
      if (entries.length >= MAX_FILES) {
        statusEl.textContent = `You can upload up to ${MAX_FILES} files.`;
        break;
      }
      const isDuplicate = entries.some((e) => e.file.name === file.name && e.file.size === file.size);
      if (isDuplicate) continue;
      entries.push({ id: crypto.randomUUID(), file, status: "pending", error: null, path: null });
    }
    renderFileList();
  });

  fileListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === "remove") {
      entries = entries.filter((entry) => entry.id !== id);
      renderFileList();
    } else if (btn.dataset.action === "retry") {
      const entry = entries.find((en) => en.id === id);
      if (entry) {
        entry.status = "pending";
        entry.error = null;
        renderFileList();
        attemptUpload();
      }
    }
  });

  async function uploadEntry(entry, signed) {
    entry.status = "uploading";
    renderFileList();
    try {
      const { error } = await supabase.storage
        .from("proof-of-payments")
        .uploadToSignedUrl(signed.path, signed.token, entry.file);
      if (error) throw error;
      entry.status = "done";
      entry.path = signed.path;
    } catch (err) {
      entry.status = "error";
      entry.error = err.message || "Upload failed. Please try again.";
    }
    renderFileList();
  }

  async function attemptUpload() {
    if (entries.length === 0) {
      statusEl.textContent = "Please choose at least one file.";
      return;
    }

    const pending = entries.filter((entry) => entry.status !== "done");
    if (pending.length > 0) {
      // The button carries the state. A status line underneath said
      // "Uploading…" while the button itself sat there looking untouched,
      // which reads as nothing having happened.
      let restore = setButtonBusy(submitBtn, "Uploading…");
      statusEl.textContent = "";

      try {
        const res = await fetch("/api/request-upload-urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            files: pending.map((entry) => ({
              name: entry.file.name,
              type: entry.file.type,
              size: entry.file.size,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Couldn't prepare upload (HTTP ${res.status})`);

        await Promise.all(pending.map((entry, i) => uploadEntry(entry, data.uploads[i])));
      } catch (err) {
        restore();
        statusEl.textContent = err.message || "Couldn't prepare upload. Please try again.";
        return;
      }

      if (entries.some((entry) => entry.status === "error")) {
        restore();
        statusEl.textContent = "Some files failed to upload. Retry or remove them, then submit again.";
        return;
      }

      // Uploads finished; the label changes rather than the button flicking
      // back to idle between two steps of one action.
      restore();
    }

    const restoreSubmit = setButtonBusy(submitBtn, "Submitting…");
    statusEl.textContent = "";

    try {
      const res = await fetch("/api/submit-payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, storagePaths: entries.map((entry) => entry.path) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Submission failed (HTTP ${res.status})`);
      renderSuccess(container, data.attemptsRemaining);
    } catch (err) {
      restoreSubmit();
      statusEl.textContent = err.message || "Submission failed. Please try again.";
    }
  }

  submitBtn.addEventListener("click", attemptUpload);
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
    if (data.finished) {
      renderFinished(container, data.orderSummary);
      return;
    }
    renderForm(container, token, data.orderSummary, data.paymentInfo, data.secondsRemaining);
  } catch {
    renderError(container, "Couldn't reach the server. Please check your connection and try again.");
  }
}
