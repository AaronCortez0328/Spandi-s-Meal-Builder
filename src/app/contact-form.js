/**
 * Shared contact form for all builders.
 * Renders the Step 3 panel, validates required fields,
 * and assembles the final copy text (order summary + contact info).
 */

const CHECK_SVG_SM = `<svg class="branch-select__item-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

export function buildContactPanel({ backAttr, copyAttr, statusId, orderLines }) {
  return `
    <div class="panel-header">
      <div>
        <p class="section-kicker">Step 4 of 4 &middot; Almost done</p>
        <h2>Your Details</h2>
      </div>
    </div>

    <p class="contact-intro">
      Fill in your details so Spandi's can follow up with your complete inquiry.
      Fields marked <span aria-hidden="true">*</span> are required.
    </p>

    <form class="contact-form" id="contact-form-panel" novalidate>

      <div class="form-field">
        <label class="form-field__label" id="branch-label">
          Branch <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input type="hidden" id="cf-branch" name="branch" value="" />
        <div class="branch-select" aria-labelledby="branch-label">
          <button
            class="branch-select__trigger"
            type="button"
            id="cf-branch-btn"
            data-branch-trigger
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span class="branch-select__label branch-select__label--placeholder" data-branch-value-label>Select a branch…</span>
            <svg class="branch-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <ul class="branch-select__menu" role="listbox" aria-label="Branch" hidden>
            <li class="branch-select__item" role="option" aria-selected="false" data-branch-option data-branch-value="Cavite">
              <span class="branch-select__item-dot"></span>
              <span class="branch-select__item-name">Cavite</span>
            </li>
            <li class="branch-select__item" role="option" aria-selected="false" data-branch-option data-branch-value="Batangas">
              <span class="branch-select__item-dot"></span>
              <span class="branch-select__item-name">Batangas</span>
            </li>
          </ul>
        </div>
        <span class="form-field__error" id="err-branch" role="alert" hidden>
          Please select a branch.
        </span>
      </div>

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
          Send Inquiry
        </button>
        <p class="status-text" id="${statusId}" role="status" aria-live="polite"></p>
      </div>
    </div>
  `;
}

/**
 * Wires up the custom branch dropdown. Call after inserting the panel HTML.
 */
export function attachBranchDropdown(container) {
  const wrapper     = container.querySelector(".branch-select");
  if (!wrapper) return;

  const trigger     = wrapper.querySelector("[data-branch-trigger]");
  const menu        = wrapper.querySelector(".branch-select__menu");
  const hiddenInput = document.getElementById("cf-branch");
  const valueLabel  = wrapper.querySelector("[data-branch-value-label]");

  function closeMenu() {
    wrapper.classList.remove("is-open");
    if (menu)    menu.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = wrapper.classList.contains("is-open");
    if (isOpen) {
      closeMenu();
    } else {
      menu.hidden = false;
      wrapper.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      function closeOnOutside(ev) {
        if (!wrapper.contains(ev.target)) {
          closeMenu();
          document.removeEventListener("click", closeOnOutside);
        }
      }
      document.addEventListener("click", closeOnOutside);
    }
  });

  wrapper.querySelectorAll("[data-branch-option]").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = opt.dataset.branchValue;

      if (hiddenInput) hiddenInput.value = value;
      if (valueLabel) {
        valueLabel.textContent = value;
        valueLabel.classList.remove("branch-select__label--placeholder");
      }

      wrapper.querySelectorAll("[data-branch-option]").forEach((o) => {
        const isSel = o.dataset.branchValue === value;
        o.classList.toggle("is-selected", isSel);
        o.setAttribute("aria-selected", String(isSel));
        const dot   = o.querySelector(".branch-select__item-dot");
        const check = o.querySelector(".branch-select__item-check");
        if (isSel && dot)   dot.outerHTML   = CHECK_SVG_SM;
        if (!isSel && check) check.outerHTML = `<span class="branch-select__item-dot"></span>`;
      });

      // Clear invalid state on branch + scan all other filled fields
      trigger?.classList.remove("is-invalid");
      document.getElementById("err-branch")?.setAttribute("hidden", "");
      clearFilledErrors(container);

      closeMenu();
    });
  });
}

/**
 * Reads and validates the contact form.
 * Returns { valid, values } where values contains all field data.
 */
export function validateAndRead() {
  const fields = [
    { id: "cf-first-name", errId: "err-first-name", type: "text"  },
    { id: "cf-last-name",  errId: "err-last-name",  type: "text"  },
    { id: "cf-email",      errId: "err-email",       type: "email" },
    { id: "cf-phone",      errId: "err-phone",       type: "text"  },
  ];

  let valid        = true;
  let firstInvalid = null;

  // Validate branch (custom dropdown — reads the hidden input)
  const branchInput = document.getElementById("cf-branch");
  const branchBtn   = document.getElementById("cf-branch-btn");
  const branchErr   = document.getElementById("err-branch");
  const branchOk    = (branchInput?.value ?? "").trim().length > 0;
  if (!branchOk) {
    branchBtn?.classList.add("is-invalid");
    if (branchErr) branchErr.hidden = false;
    if (!firstInvalid) firstInvalid = branchBtn;
    valid = false;
  } else {
    branchBtn?.classList.remove("is-invalid");
    if (branchErr) branchErr.hidden = true;
  }

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
      branch:    document.getElementById("cf-branch")?.value            ?? "",
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
/**
 * Scans the container for any invalid inputs that now have a value and clears them.
 * Call this after autofill or programmatic population to keep error state in sync.
 */
export function clearFilledErrors(container) {
  if (!container) return;
  container.querySelectorAll(".form-field__input.is-invalid").forEach((input) => {
    if (input.value.trim().length > 0) {
      input.classList.remove("is-invalid");
      const errEl = input.closest(".form-field")?.querySelector(".form-field__error");
      if (errEl) errEl.hidden = true;
    }
  });
}

export function attachInlineValidation(container) {
  function clearIfValid(e) {
    const input = e.target.closest(".form-field__input");
    if (!input) return;
    if (input.classList.contains("is-invalid") && input.value.trim().length > 0) {
      input.classList.remove("is-invalid");
      const field = input.closest(".form-field");
      const errEl = field?.querySelector(".form-field__error");
      if (errEl) errEl.hidden = true;
    }
    // Also clear any other autofilled fields in one pass
    clearFilledErrors(container);
  }
  container.addEventListener("input",   clearIfValid);
  container.addEventListener("change",  clearIfValid);
  container.addEventListener("focusin", clearIfValid);
  container.addEventListener("click",   clearIfValid);
}

/**
 * Builds the full plain-text inquiry string to copy to clipboard.
 */
export function buildInquiryText(serviceName, orderSummaryLines, contactValues) {
  const { branch, firstName, lastName, email, phone, address, note } = contactValues;
  const lines = [
    `Spandi's Food + Catering — ${serviceName} Inquiry`,
    "═".repeat(48),
    "",
    "CONTACT DETAILS",
    `Branch  : ${branch}`,
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
