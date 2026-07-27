/**
 * Shared contact form for all builders.
 * Renders the Step 3 panel, validates required fields,
 * and assembles the final copy text (order summary + contact info).
 *
 * Every builder imports this one module, so the ids below are a contract:
 * validateAndRead() reads them by id and hands the result straight to
 * pushInquiryToGHL(). Renaming or dropping one silently breaks all five
 * services at once — branch in particular, since the payment page looks
 * up GCash/bank details by branch name.
 */

import { CONFIRM_WINDOW } from "./copy.js";

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
        <h2>Where do we send it?</h2>
      </div>
    </div>

    <p class="contact-intro">
      We&rsquo;ll confirm your booking here. Fields marked
      <span aria-hidden="true">*</span> are required.
    </p>

    <div class="contact-booking-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Please book at least <strong>3 days before your event.</strong> We&rsquo;ll confirm ${CONFIRM_WINDOW}.
    </div>

    <form class="contact-form" id="contact-form-panel" novalidate>

      <div class="form-field">
        <p class="form-group-label" id="branch-label">
          Serving branch <span class="form-field__req" aria-hidden="true">*</span>
        </p>
        <!-- Source of truth for validateAndRead(); the cards only write here. -->
        <input type="hidden" id="cf-branch" name="branch" value="" />
        <div class="branch-cards" id="cf-branch-group" role="radiogroup" aria-labelledby="branch-label">
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-branch-option data-branch-value="Cavite">
            <span class="branch-card__name">Cavite</span>
            <span class="branch-card__meta">Bacoor</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-branch-option data-branch-value="Batangas">
            <span class="branch-card__name">Batangas</span>
            <span class="branch-card__meta">Cuenca</span>
          </button>
          <div class="branch-card branch-card--soon" aria-disabled="true">
            <span class="branch-card__name">3rd branch</span>
            <span class="branch-card__meta">Coming soon</span>
          </div>
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
            Event Time <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <input
            type="time"
            id="cf-time"
            name="eventTime"
            class="form-field__input"
            required
          />
        </div>
      </div>

      <div class="form-field">
        <p class="form-group-label" id="fulfilment-label">How to receive it</p>
        <!-- Defaults to Courier so the address stays required exactly as it
             was before this field existed; Pickup is an explicit opt-out. -->
        <input type="hidden" id="cf-fulfilment" name="fulfilment" value="Courier" />
        <div class="fulfilment-cards" id="cf-fulfilment-group" role="radiogroup" aria-labelledby="fulfilment-label">
          <button type="button" class="branch-card is-selected" role="radio" aria-checked="true"
                  data-fulfilment-option data-fulfilment-value="Courier">
            <span class="branch-card__name">Courier</span>
            <span class="branch-card__meta">You book &middot; pay the rider</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-fulfilment-option data-fulfilment-value="Pickup">
            <span class="branch-card__name">Pickup</span>
            <span class="branch-card__meta">Collect at the branch</span>
          </button>
        </div>
      </div>

      <div class="form-field" id="cf-address-field">
        <label class="form-field__label" for="cf-address">
          Delivery address <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input
          type="text"
          id="cf-address"
          name="address"
          class="form-field__input"
          placeholder="Street, City, Province"
          autocomplete="street-address"
          required
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

    <div class="tc-agree-wrap" id="tc-checkbox-label">
      <label class="tc-agree__check" for="cf-tc-agree">
        <span class="tc-agree__box">
          <input type="checkbox" id="cf-tc-agree" name="tcAgree" />
          <span class="tc-agree__mark" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2 6 5 9 10 3"/></svg>
          </span>
        </span>
      </label>
      <p class="tc-agree__text">
        I have read and agree to Spandi's
        <button type="button" class="tc-link" data-open-tc aria-haspopup="dialog">Terms &amp; Conditions</button>
      </p>
    </div>

    <dialog class="tc-dialog" id="tc-dialog" aria-labelledby="tc-dialog-title">
      <div class="tc-dialog__header">
        <div class="tc-dialog__title-group">
          <div class="tc-dialog__icon-wrap" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          </div>
          <div>
            <h2 id="tc-dialog-title" class="tc-dialog__title">Terms &amp; Conditions</h2>
            <p class="tc-dialog__subtitle">Spandi's Food + Catering</p>
          </div>
        </div>
        <button class="tc-dialog__close" type="button" id="tc-dialog-close" aria-label="Close terms">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="tc-dialog__body">
        <ol class="tc-items">
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">1</span>
            <p class="tc-item__text">Party Tray combos cannot be tweaked or changed.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">2</span>
            <p class="tc-item__text">For budget-based or customised requests, please refer to Feast Trays to build your own combo and we can try to work on your budget. Please be advised that we cannot guarantee the exact request — we will still suggest what will yield the best results to meet your budget and number of pax, and your request is still for approval.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">3</span>
            <p class="tc-item__text">Down payment of 50% is required to confirm booking. This is non-refundable and can be moved twice within the year.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">4</span>
            <p class="tc-item__text">Balance of 50% must be completed 3 days before pickup date. No full payment, no release of food.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">5</span>
            <p class="tc-item__text">We do not deliver. Client must book their preferred courier to pick up party trays and shoulder the cost.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">6</span>
            <p class="tc-item__text">We can only accept orders within nearby areas of Calabarzon. Our commissary is located in Cavite and we sometimes cook in Batangas kitchen for small-volume orders.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">7</span>
            <p class="tc-item__text">We do not guarantee the heat of food due to travel time. Consume within 2–3 hours. For orders not consumed immediately, please refrigerate or reheat trays in the oven before serving. We are not held liable for spoilage after items have been released from the kitchen. All food is freshly cooked and assembled 30 minutes before pickup time.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">8</span>
            <p class="tc-item__text">We are not held liable for tracking, damage, or mishandling by the courier. Rest assured we pack all orders securely and send pictures or videos of food prior to releasing from the kitchen, including a shot of the driver's license and vehicle that picked up the items.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">9</span>
            <p class="tc-item__text">Motorcycle pickup is limited to 4 trays only or 25 packed meals. Anything above that, we strictly recommend a car to transport the orders in an air-conditioned area.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">10</span>
            <p class="tc-item__text">Refrigerated or frozen trays are upon request for deliveries more than 55 km away from the pickup point.</p>
          </li>
          <li class="tc-item">
            <span class="tc-item__num" aria-hidden="true">11</span>
            <p class="tc-item__text">By submitting this inquiry, I agree to receive promotional emails, discounts, and updates from Spandi's Food + Catering.</p>
          </li>
        </ol>
      </div>

      <div class="tc-dialog__footer">
        <button class="primary-button tc-dialog__agree-btn" type="button" id="tc-dialog-agree">
          I Have Read &amp; Agree
        </button>
      </div>
    </dialog>

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
 * Wires a group of selectable cards to a hidden input.
 *
 * The hidden input stays the single source of truth — the cards do
 * nothing but write to it — so validateAndRead() and the GHL payload
 * read exactly what they always did.
 */
function attachCardPicker(container, { groupId, hiddenId, optionSelector, valueKey, onSelect }) {
  const group = container.querySelector(`#${groupId}`);
  if (!group) return;

  const hiddenInput = document.getElementById(hiddenId);
  const options = group.querySelectorAll(optionSelector);

  options.forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = opt.dataset[valueKey];
      if (hiddenInput) hiddenInput.value = value;

      options.forEach((o) => {
        const isSelected = o === opt;
        o.classList.toggle("is-selected", isSelected);
        o.setAttribute("aria-checked", String(isSelected));
      });

      group.classList.remove("is-invalid");
      clearFilledErrors(container);
      onSelect?.(value);
    });
  });
}

/**
 * Wires the branch and fulfilment card pickers. Call after inserting the
 * panel HTML.
 *
 * Branch: two live branches never justified a dropdown — it hid both
 * behind a tap with no room to say where each one is. Cards show Cavite
 * and Batangas side by side, plus a non-interactive "coming soon" panel
 * for the third.
 *
 * Fulfilment: choosing Pickup hides the address field and drops it from
 * validation, so we stop demanding a delivery address from someone
 * collecting at the branch themselves.
 */
export function attachFormPickers(container) {
  attachCardPicker(container, {
    groupId: "cf-branch-group",
    hiddenId: "cf-branch",
    optionSelector: "[data-branch-option]",
    valueKey: "branchValue",
  });

  attachCardPicker(container, {
    groupId: "cf-fulfilment-group",
    hiddenId: "cf-fulfilment",
    optionSelector: "[data-fulfilment-option]",
    valueKey: "fulfilmentValue",
    onSelect: (value) => {
      const addressField = container.querySelector("#cf-address-field");
      const addressInput = document.getElementById("cf-address");
      const collecting = value === "Pickup";
      if (addressField) addressField.hidden = collecting;
      if (addressInput && collecting) {
        // Clear any error state left over from when it was required.
        addressInput.classList.remove("is-invalid");
      }
    },
  });
}

/**
 * Reads and validates the contact form.
 * Returns { valid, values } where values contains all field data.
 */
export function validateAndRead() {
  // Someone collecting at the branch has no delivery address to give, so
  // it is only required when a courier is bringing the order to them.
  const fulfilment = document.getElementById("cf-fulfilment")?.value ?? "Courier";
  const needsAddress = fulfilment !== "Pickup";

  const fields = [
    { id: "cf-first-name", type: "text"  },
    { id: "cf-last-name",  type: "text"  },
    { id: "cf-email",      type: "email" },
    { id: "cf-phone",      type: "text"  },
    { id: "cf-date",       type: "date"  },
    { id: "cf-time",       type: "text"  },
    ...(needsAddress ? [{ id: "cf-address", type: "text" }] : []),
  ];

  let valid        = true;
  let firstInvalid = null;

  // Validate branch — the cards write to the hidden input, which stays
  // the value we actually read and submit.
  const branchInput = document.getElementById("cf-branch");
  const branchGroup = document.getElementById("cf-branch-group");
  const branchOk    = (branchInput?.value ?? "").trim().length > 0;
  if (!branchOk) {
    branchGroup?.classList.add("is-invalid");
    // Focus the first card so the error lands somewhere focusable.
    if (!firstInvalid) firstInvalid = branchGroup?.querySelector("[data-branch-option]");
    valid = false;
  } else {
    branchGroup?.classList.remove("is-invalid");
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

  // Validate T&C checkbox
  const tcCheckbox = document.getElementById("cf-tc-agree");
  const tcLabel    = document.getElementById("tc-checkbox-label");
  if (tcCheckbox && !tcCheckbox.checked) {
    tcLabel?.classList.add("is-invalid");
    if (!firstInvalid) firstInvalid = tcCheckbox;
    valid = false;
  } else {
    tcLabel?.classList.remove("is-invalid");
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return { valid: false, values: null };
  }

  return {
    valid: true,
    values: {
      branch:     document.getElementById("cf-branch")?.value             ?? "",
      fulfilment: document.getElementById("cf-fulfilment")?.value         ?? "",
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
    // T&C checkbox
    if (e.target.id === "cf-tc-agree") {
      const label = document.getElementById("tc-checkbox-label");
      if (e.target.checked) label?.classList.remove("is-invalid");
      return;
    }

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

  // Wire up the TC modal dialog
  const tcDialog  = container.querySelector("#tc-dialog");
  if (tcDialog) {
    const openBtn  = container.querySelector("[data-open-tc]");
    const closeBtn = container.querySelector("#tc-dialog-close");
    const agreeBtn = container.querySelector("#tc-dialog-agree");

    openBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tcDialog.showModal();
    });

    closeBtn?.addEventListener("click", () => tcDialog.close());

    agreeBtn?.addEventListener("click", () => {
      const cb    = document.getElementById("cf-tc-agree");
      const label = document.getElementById("tc-checkbox-label");
      if (cb) cb.checked = true;
      label?.classList.remove("is-invalid");
      tcDialog.close();
    });

    // Close on backdrop click
    tcDialog.addEventListener("click", (e) => {
      if (e.target === tcDialog) tcDialog.close();
    });
  }
}

/**
 * Builds the full plain-text inquiry string to copy to clipboard.
 *
 * The single note builder for every service. Catering, Party Trays and
 * Packed Meals each used to assemble their own near-identical version,
 * which is why adding "Receive" reached only two of the five — the same
 * drift the confirmation screens had. Service-specific content comes in
 * as orderLines and dishLines; everything else is shared.
 */
export function buildInquiryText(serviceName, orderLines, contactValues, dishLines = []) {
  const { branch, firstName, lastName, email, phone, eventDate, eventTime, address, note, fulfilment } = contactValues;
  const dateStr = eventDate
    ? eventTime ? `${eventDate} at ${eventTime}` : eventDate
    : null;

  return [
    `${serviceName} Inquiry`,
    `Branch: ${branch}`,
    "",
    "── ORDER DETAILS ──────────────────────────",
    ...orderLines,
    ...(dishLines.length
      ? ["", "── DISHES ──────────────────────────────────", ...dishLines]
      : []),
    "",
    "── CUSTOMER DETAILS ────────────────────────",
    `Name     : ${firstName} ${lastName}`,
    `Email    : ${email}`,
    `Phone    : ${phone}`,
    ...(dateStr ? [`Date     : ${dateStr}`] : []),
    ...(fulfilment ? [`Receive  : ${fulfilment}`] : []),
    // Only printed when there is one — a Pickup customer has no delivery
    // address, so an empty row would just read as missing data.
    ...(address ? [`Address  : ${address}`] : []),
    ...(note ? ["", "── EVENT NOTES ─────────────────────────────", note] : []),
    "",
    "────────────────────────────────────────────",
    "Submitted via Spandis Meal Builder",
  ].join("\n");
}
