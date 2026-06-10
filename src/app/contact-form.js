/**
 * Shared contact form for all builders.
 * Renders the Step 3 panel, validates required fields,
 * and assembles the final copy text (order summary + contact info).
 */

const CHECK_SVG_SM = `<svg class="branch-select__item-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

export function buildContactPanel({ backAttr, copyAttr, statusId, orderLines, stepLabel = "Step 3 of 3 · Almost done" }) {
  const minDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split("T")[0];
  })();

  return `
    <div class="panel-header">
      <div>
        <p class="section-kicker">${stepLabel}</p>
        <h2>Your Details</h2>
      </div>
    </div>

    <div class="contact-booking-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Please book at least <strong>3 days before your event.</strong> Spandi's team will confirm within 24 hours.
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
            placeholder="First name"
            autocomplete="given-name"
            required
          />
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
            placeholder="Last name"
            autocomplete="family-name"
            required
          />
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
      </div>

      <div class="contact-form__row">
        <div class="form-field">
          <label class="form-field__label" for="cf-date">
            Event Date <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <input
            type="date"
            id="cf-date"
            name="eventDate"
            class="form-field__input"
            min="${minDate}"
            required
          />
        </div>
        <div class="form-field">
          <label class="form-field__label" for="cf-time">
            Event Time
            <span class="form-field__optional">Optional</span>
          </label>
          <input
            type="time"
            id="cf-time"
            name="eventTime"
            class="form-field__input"
          />
        </div>
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

      // Mark branch as valid, clear invalid state
      trigger?.classList.remove("is-invalid");
      trigger?.classList.add("is-valid");
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
    { id: "cf-first-name", type: "text"  },
    { id: "cf-last-name",  type: "text"  },
    { id: "cf-email",      type: "email" },
    { id: "cf-phone",      type: "text"  },
    { id: "cf-date",       type: "date"  },
  ];

  let valid        = true;
  let firstInvalid = null;

  // Validate branch (custom dropdown — reads the hidden input)
  const branchInput = document.getElementById("cf-branch");
  const branchBtn   = document.getElementById("cf-branch-btn");
  const branchOk    = (branchInput?.value ?? "").trim().length > 0;
  if (!branchOk) {
    branchBtn?.classList.add("is-invalid");
    branchBtn?.classList.remove("is-valid");
    if (!firstInvalid) firstInvalid = branchBtn;
    valid = false;
  } else {
    branchBtn?.classList.remove("is-invalid");
    branchBtn?.classList.add("is-valid");
  }

  for (const { id, type } of fields) {
    const input = document.getElementById(id);
    if (!input) continue;

    const value = input.value.trim();
    let fieldOk = value.length > 0;
    if (type === "email" && fieldOk) {
      fieldOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (type === "date" && fieldOk) {
      const minDate = input.getAttribute("min");
      if (minDate) fieldOk = value >= minDate;
    }

    if (!fieldOk) {
      input.classList.add("is-invalid");
      input.classList.remove("is-valid");
      if (!firstInvalid) firstInvalid = input;
      valid = false;
    } else {
      input.classList.remove("is-invalid");
      input.classList.add("is-valid");
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return { valid: false, values: null };
  }

  return {
    valid: true,
    values: {
      branch:     document.getElementById("cf-branch")?.value             ?? "",
      firstName:  document.getElementById("cf-first-name")?.value.trim() ?? "",
      lastName:   document.getElementById("cf-last-name")?.value.trim()  ?? "",
      email:      document.getElementById("cf-email")?.value.trim()      ?? "",
      phone:      document.getElementById("cf-phone")?.value.trim()      ?? "",
      eventDate:  document.getElementById("cf-date")?.value              ?? "",
      eventTime:  document.getElementById("cf-time")?.value              ?? "",
      address:    document.getElementById("cf-address")?.value.trim()    ?? "",
      note:       document.getElementById("cf-note")?.value.trim()       ?? "",
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
      input.classList.add("is-valid");
    }
  });
}

export function attachInlineValidation(container) {
  function isInputValid(input) {
    const value = input.value.trim();
    if (!value) return false;
    if (input.type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (input.type === "date") {
      const min = input.getAttribute("min");
      return !min || value >= min;
    }
    return true;
  }

  function updateState(e) {
    const input = e.target.closest(".form-field__input");
    if (!input) return;

    if (isInputValid(input)) {
      input.classList.remove("is-invalid");
      input.classList.add("is-valid");
    } else {
      input.classList.remove("is-valid");
    }

    clearFilledErrors(container);
  }

  container.addEventListener("input",   updateState);
  container.addEventListener("change",  updateState);
  container.addEventListener("focusin", updateState);
}

/**
 * Builds the full plain-text inquiry string to copy to clipboard.
 */
export function buildInquiryText(serviceName, orderSummaryLines, contactValues) {
  const { branch, firstName, lastName, email, phone, eventDate, eventTime, address, note } = contactValues;
  const dateStr = eventDate
    ? eventTime ? `${eventDate} at ${eventTime}` : eventDate
    : null;
  const lines = [
    `Spandi's Food + Catering — ${serviceName} Inquiry`,
    "═".repeat(48),
    "",
    "CONTACT DETAILS",
    `Branch  : ${branch}`,
    `Name    : ${firstName} ${lastName}`,
    `Email   : ${email}`,
    `Phone   : ${phone}`,
    dateStr   ? `Date    : ${dateStr}` : null,
    address   ? `Address : ${address}` : null,
    note      ? `\nNote    : ${note}` : null,
    "",
    "─".repeat(48),
    "",
    "ORDER SUMMARY",
    ...orderSummaryLines,
  ].filter((l) => l !== null).join("\n");

  return lines;
}
