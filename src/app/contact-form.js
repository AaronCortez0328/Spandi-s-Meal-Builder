/**
 * Shared contact form for all builders.
 * Renders the Step 3 panel, validates required fields,
 * and assembles the final copy text (order summary + contact info).
 */

export function buildContactPanel({ backAttr, copyAttr, statusId, orderLines }) {
  return `
    <div class="panel-header">
      <div>
        <p class="section-kicker">Step 3 of 3</p>
        <h2>Your Details</h2>
      </div>
    </div>

    <p class="contact-intro">
      Fill in your details so Spandi's can follow up with your complete inquiry.
      Fields marked <span aria-hidden="true">*</span> are required.
    </p>

    <form class="contact-form" id="contact-form-panel" novalidate>
      <div class="contact-form__row">
        <div class="form-field">
          <label class="form-field__label" for="cf-first-name">
            First Name <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            id="cf-first-name"
            name="firstName"
            class="form-field__input"
            placeholder="First Name"
            autocomplete="given-name"
            required
          />
          <span class="form-field__error" id="err-first-name" role="alert" hidden>
            Please enter your first name.
          </span>
        </div>
        <div class="form-field">
          <label class="form-field__label" for="cf-last-name">
            Last Name <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            id="cf-last-name"
            name="lastName"
            class="form-field__input"
            placeholder="Last Name"
            autocomplete="family-name"
            required
          />
          <span class="form-field__error" id="err-last-name" role="alert" hidden>
            Please enter your last name.
          </span>
        </div>
      </div>

      <div class="form-field">
        <label class="form-field__label" for="cf-email">
          Email Address <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input
          type="email"
          id="cf-email"
          name="email"
          class="form-field__input"
          placeholder="you@example.com"
          autocomplete="email"
          required
        />
        <span class="form-field__error" id="err-email" role="alert" hidden>
          Please enter a valid email address.
        </span>
      </div>

      <div class="form-field">
        <label class="form-field__label" for="cf-phone">
          Phone Number <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input
          type="tel"
          id="cf-phone"
          name="phone"
          class="form-field__input"
          placeholder="+63 900 000 0000"
          autocomplete="tel"
          required
        />
        <span class="form-field__error" id="err-phone" role="alert" hidden>
          Please enter your phone number.
        </span>
      </div>

      <div class="form-field">
        <label class="form-field__label" for="cf-address">
          Address
          <span class="form-field__optional">Optional</span>
        </label>
        <input
          type="text"
          id="cf-address"
          name="address"
          class="form-field__input"
          placeholder="Street, City, Province"
          autocomplete="street-address"
        />
      </div>

      <div class="form-field">
        <label class="form-field__label" for="cf-note">
          Note / Event Details
          <span class="form-field__optional">Optional</span>
        </label>
        <textarea
          id="cf-note"
          name="note"
          class="form-field__input form-field__textarea"
          placeholder="Share your event date, venue, special requests, or anything else Spandi's should know."
          rows="4"
        ></textarea>
      </div>
    </form>

    <div class="step-nav">
      <button class="text-button" type="button" ${backAttr}>← Back to Review</button>
      <div class="step-nav__cta">
        <button class="primary-button" type="button" ${copyAttr}>
          Copy Complete Inquiry
        </button>
        <p class="status-text" id="${statusId}" role="status" aria-live="polite"></p>
      </div>
    </div>
  `;
}

/**
 * Reads and validates the contact form.
 * Returns { valid, values } where values contains all field data.
 */
export function validateAndRead() {
  const fields = [
    { id: "cf-first-name", errId: "err-first-name", type: "text" },
    { id: "cf-last-name",  errId: "err-last-name",  type: "text" },
    { id: "cf-email",      errId: "err-email",       type: "email" },
    { id: "cf-phone",      errId: "err-phone",       type: "text" },
  ];

  let valid = true;
  let firstInvalid = null;

  for (const { id, errId, type } of fields) {
    const input = document.getElementById(id);
    const errEl = document.getElementById(errId);
    if (!input) continue;

    const value = input.value.trim();
    let fieldOk = value.length > 0;
    if (type === "email" && fieldOk) {
      fieldOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    if (!fieldOk) {
      input.classList.add("is-invalid");
      if (errEl) errEl.hidden = false;
      if (!firstInvalid) firstInvalid = input;
      valid = false;
    } else {
      input.classList.remove("is-invalid");
      if (errEl) errEl.hidden = true;
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return { valid: false, values: null };
  }

  return {
    valid: true,
    values: {
      firstName: document.getElementById("cf-first-name")?.value.trim() ?? "",
      lastName:  document.getElementById("cf-last-name")?.value.trim()  ?? "",
      email:     document.getElementById("cf-email")?.value.trim()      ?? "",
      phone:     document.getElementById("cf-phone")?.value.trim()      ?? "",
      address:   document.getElementById("cf-address")?.value.trim()    ?? "",
      note:      document.getElementById("cf-note")?.value.trim()       ?? "",
    },
  };
}

/**
 * Clears invalid state when the user starts correcting a field.
 * Call once on the form container via event delegation.
 */
export function attachInlineValidation(container) {
  container.addEventListener("input", (e) => {
    const input = e.target.closest(".form-field__input");
    if (!input) return;
    if (input.classList.contains("is-invalid") && input.value.trim().length > 0) {
      input.classList.remove("is-invalid");
      const field = input.closest(".form-field");
      const errEl = field?.querySelector(".form-field__error");
      if (errEl) errEl.hidden = true;
    }
  });
}

/**
 * Builds the full plain-text inquiry string to copy to clipboard.
 */
export function buildInquiryText(serviceName, orderSummaryLines, contactValues) {
  const { firstName, lastName, email, phone, address, note } = contactValues;
  const lines = [
    `Spandi's Food + Catering — ${serviceName} Inquiry`,
    "═".repeat(48),
    "",
    "CONTACT DETAILS",
    `Name    : ${firstName} ${lastName}`,
    `Email   : ${email}`,
    `Phone   : ${phone}`,
    address ? `Address : ${address}` : null,
    note    ? `\nNote    : ${note}` : null,
    "",
    "─".repeat(48),
    "",
    "ORDER SUMMARY",
    ...orderSummaryLines,
  ].filter((l) => l !== null).join("\n");

  return lines;
}
