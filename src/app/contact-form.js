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
import { RUSH_FEE } from "../domain/pricing.js";

const formatPeso = (n) => `PHP ${Number(n ?? 0).toLocaleString("en-PH")}`;

/**
 * Kitchen release window — when food can leave the kitchen.
 *
 * This governs the delivery/pickup time, NOT the event time. The two are
 * different things: an evening party can take a 3 PM delivery, and for a
 * long time this app could not express that because a single field carried
 * both meanings and the window was clamped onto it.
 *
 * The dropdown's options are generated from these, and both validators
 * check against these, so what the customer can pick and what submit
 * accepts cannot drift apart. api/ghl-inquiry.js re-checks the same
 * window server-side — if this ever changes, change it there too.
 *
 * This was a <input type="time"> with min/max. Browsers do not restrict
 * a time picker the way they restrict a date picker, so every hour of the
 * night stayed selectable and was only refused at submit — offering a
 * choice and then rejecting it. A dropdown of real slots removes the
 * invalid option instead of policing it.
 */
const FULFILMENT_TIME_MIN   = "06:00";
const FULFILMENT_TIME_MAX   = "17:00";
const FULFILMENT_TIME_LABEL = "6 AM – 5 PM";

const TIME_STEP = 30; // minutes between selectable slots, both dropdowns

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Selectable slots between two "HH:MM" bounds, as { value, label } pairs.
 *
 * value stays 24-hour "HH:MM" because that is what GHL's time fields hold
 * and what api/ghl-inquiry.js concatenates into the appointment's start
 * time. The 12-hour label is display only — customers here do not read
 * "17:00" as five in the afternoon.
 */
function timeSlots(min, max) {
  const pad   = (n) => String(n).padStart(2, "0");
  const slots = [];

  for (let t = toMinutes(min); t <= toMinutes(max); t += TIME_STEP) {
    const h24 = Math.floor(t / 60);
    const mins = t % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    slots.push({
      value: `${pad(h24)}:${pad(mins)}`,
      label: `${h12}:${pad(mins)} ${h24 < 12 ? "AM" : "PM"}`,
    });
  }

  return slots;
}

// Shared by validateAndRead and the live-validation pass, so a tampered
// DOM or a future edit to the markup still cannot get an out-of-window
// time past the client.
function isFulfilmentTimeInWindow(value) {
  return value >= FULFILMENT_TIME_MIN && value <= FULFILMENT_TIME_MAX;
}

// The receive-method cards rename this field in place, so the label and
// the success-screen row always say which of the two it is. Keyed by the
// same values the cards write into #cf-fulfilment.
const FULFILMENT_TIME_LABELS = {
  Delivery: "Delivery time",
  Pickup:   "Pickup time",
};

/**
 * Row/field label for a given receive method. Exported because all five
 * builders label their success-screen row with it — one definition, so a
 * future third method cannot say "Delivery time" on one screen and
 * something else on another.
 */
export function fulfilmentTimeLabel(fulfilment) {
  return FULFILMENT_TIME_LABELS[fulfilment] ?? "Delivery / pickup time";
}

/**
 * Pickup addresses, keyed by the same branch names #cf-branch holds.
 * Shown once Pickup + a branch are both selected, so the customer knows
 * exactly where to go without having to ask.
 *
 * Batangas is a placeholder ("Cuenca, Batangas") — the branch itself is
 * real, but this is what was given to us as the address "as of now", not
 * a final street address. Update it here once the real one is confirmed.
 */
const PICKUP_ADDRESSES = {
  Cavite:    "Blk 20 Lot 27/28 Ph 3, Swallow St., Amaris Homes, Molino, Bacoor, Cavite",
  Batangas:  "Cuenca, Batangas",
  Montalban: "San Lorenzo St, Cortijos de San Rafael Subdivision, San Rafael, Rodriguez, Rizal",
};

export function buildContactPanel({ backAttr, copyAttr, statusId, orderLines, stepLabel = "Step 3 of 3 · Almost done" }) {
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
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-branch-option data-branch-value="Batangas">
            <span class="branch-card__name">Batangas</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-branch-option data-branch-value="Montalban">
            <span class="branch-card__name">Montalban</span>
          </button>
          <!-- Named rather than "4th branch" now that it's a specific,
               known branch on deck — matches how Montalban itself sat here
               before it went live. Not a <button>: nothing to click yet. -->
          <div class="branch-card branch-card--soon" aria-disabled="true">
            <span class="branch-card__name">Pampanga</span>
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
          Email Address
          <span class="form-field__optional">Optional</span>
        </label>
        <input
          type="email"
          id="cf-email"
          name="email"
          class="form-field__input"
          placeholder="you@example.com"
          autocomplete="email"
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

      <div class="form-field">
        <p class="form-group-label" id="social-label">
          Did you contact us through Facebook or Instagram before placing this order?
        </p>
        <!-- Defaults to No — most inquiries arrive straight through the
             site, and an unanswered question would be worse than a wrong
             default here since nothing downstream requires an answer. -->
        <input type="hidden" id="cf-social" name="contactedViaSocial" value="no" />
        <div class="fulfilment-cards" id="cf-social-group" role="radiogroup" aria-labelledby="social-label">
          <button type="button" class="branch-card is-selected" role="radio" aria-checked="true"
                  data-social-option data-social-value="no">
            <span class="branch-card__name">No</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-social-option data-social-value="yes">
            <span class="branch-card__name">Yes</span>
          </button>
        </div>

        <!-- Revealed only on Yes. The profile name is a manual reference
             for an admin matching this order to a Facebook/Instagram
             conversation — GHL's own duplicate matching runs on email and
             phone, never on this field, which is why the note pushes
             toward reusing those rather than toward filling this in. -->
        <div class="form-field" id="cf-social-detail" hidden>
          <p class="contact-form__note">
            Please use the same email address or mobile number you used on
            Facebook or Instagram, so we can connect your order with that
            conversation.
          </p>
          <label class="form-field__label" for="cf-social-name">
            What name or profile name did you use?
            <span class="form-field__optional">Optional</span>
          </label>
          <input
            type="text"
            id="cf-social-name"
            name="socialProfileName"
            class="form-field__input"
            placeholder="e.g. Juan Dela Cruz"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="contact-form__row">
        <div class="form-field">
          <label class="form-field__label" for="cf-date">
            Event Date <span class="form-field__req" aria-hidden="true">*</span>
          </label>
          <!-- No min: any date is selectable, past included. Lifted again
               for the same reason as before — unblocking direct data entry,
               not a change to how the live form behaves for customers. The
               validators already treat a missing min as nothing to check
               against, so this is the whole change. -->
          <input
            type="date"
            id="cf-date"
            name="eventDate"
            class="form-field__input"
            required
          />
        </div>
        <div class="form-field">
          <label class="form-field__label" for="cf-time">
            Event Time
            <span class="form-field__optional">Optional</span>
          </label>
          <!-- Unrestricted on purpose. This is when the customer's event
               starts, not when we release the food — the kitchen window
               lives on #cf-fulfilment-time below. Clamping this one is what
               previously made an evening event impossible to book.

               Unlike the required dropdowns, the empty option stays
               selectable: the field is optional, so someone who picks a
               time and changes their mind needs a way back to "none". It
               says so in words rather than sitting on a silent blank. -->
          <select
            id="cf-time"
            name="eventTime"
            class="form-field__input form-field__select"
          >
            <option value="" selected>No specific time</option>
            ${timeSlots("00:00", "23:30")
              .map((slot) => `<option value="${slot.value}">${slot.label}</option>`)
              .join("")}
          </select>
        </div>
      </div>

      <!-- Sits with the date fields because rush is a timing decision, not
           a menu one — the fee itself is added server-side (see
           applyRushFee() in src/domain/pricing.js), this checkbox only
           states the customer's intent. -->
      <div class="tc-agree-wrap">
        <label class="tc-agree__check" for="cf-rush">
          <span class="tc-agree__box">
            <input type="checkbox" id="cf-rush" name="rushOrder" />
            <span class="tc-agree__mark" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2 6 5 9 10 3"/></svg>
            </span>
          </span>
        </label>
        <p class="tc-agree__text">
          Rush this order <strong>(+${formatPeso(RUSH_FEE)})</strong>
        </p>
      </div>

      <div class="form-field">
        <p class="form-group-label" id="fulfilment-label">How to receive it</p>
        <!-- Defaults to Delivery so the address stays required exactly as it
             was before this field existed; Pickup is an explicit opt-out. -->
        <input type="hidden" id="cf-fulfilment" name="fulfilment" value="Delivery" />
        <div class="fulfilment-cards" id="cf-fulfilment-group" role="radiogroup" aria-labelledby="fulfilment-label">
          <button type="button" class="branch-card is-selected" role="radio" aria-checked="true"
                  data-fulfilment-option data-fulfilment-value="Delivery">
            <span class="branch-card__name">Delivery</span>
            <span class="branch-card__meta">We help you book &middot; you pay the fee</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-fulfilment-option data-fulfilment-value="Pickup">
            <span class="branch-card__name">Pickup</span>
            <span class="branch-card__meta">You collect, or send your own rider</span>
          </button>
        </div>
      </div>

      <!-- Revealed only once Pickup + a branch are both chosen — either
           order. attachFormPickers() keeps this in sync from both card
           groups since either one can be picked second. -->
      <div class="form-field" id="cf-pickup-address" hidden>
        <p class="contact-form__note">
          <strong>Pickup address:</strong> <span id="cf-pickup-address-text"></span>
        </p>
      </div>

      <!-- Sits directly under the cards because the card above decides what
           this field means. attachFormPickers() renames the label in place
           rather than showing two near-identical fields, only one of which
           ever applies. -->
      <div class="form-field">
        <label class="form-field__label" for="cf-fulfilment-time">
          <span id="cf-fulfilment-time-label">${FULFILMENT_TIME_LABELS.Delivery}</span>
          <span class="form-field__req" aria-hidden="true">*</span>
          <!-- Deliberately not aria-hidden: read as part of the label, it
               states the window up front so nobody has to open the list
               to find out when we can serve them. -->
          <span class="form-field__hint">${FULFILMENT_TIME_LABEL}</span>
        </label>
        <select
          id="cf-fulfilment-time"
          name="fulfilmentTime"
          class="form-field__input form-field__select"
          required
        >
          <option value="" disabled selected hidden>Select a time</option>
          ${timeSlots(FULFILMENT_TIME_MIN, FULFILMENT_TIME_MAX)
            .map((slot) => `<option value="${slot.value}">${slot.label}</option>`)
            .join("")}
        </select>
      </div>

      <!-- Honeypot. Hidden from sight and from screen readers, excluded from
           tab order, and given a name a form-filler finds plausible. No
           human can put anything in it; api/ghl-inquiry.js discards any
           submission that arrives with it filled. -->
      <div class="form-field" aria-hidden="true"
           style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">
        <label for="cf-company">Company</label>
        <input type="text" id="cf-company" name="company" tabindex="-1" autocomplete="off" />
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
            <p class="tc-item__text">By submitting this order, I agree to receive promotional emails, discounts, and updates from Spandi's Food + Catering.</p>
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
          Send Order
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
 * Fulfilment: Pickup covers anyone arranging collection themselves —
 * coming to the branch or sending their own rider — so choosing it hides
 * the address field and drops it from validation. Delivery is the one
 * where we book the logistics, and that is the case that needs somewhere
 * to deliver to. Either way the customer pays the fee. The choice also
 * renames the time field below the cards, so it reads as the thing the
 * customer just picked.
 */
export function attachFormPickers(container) {
  // Branch and fulfilment each decide half of "should the pickup address
  // show" — whichever card the customer picks second has to re-check the
  // other one, so both onSelect handlers below call this.
  const updatePickupAddress = () => {
    const fulfilment  = document.getElementById("cf-fulfilment")?.value ?? "Delivery";
    const branch      = document.getElementById("cf-branch")?.value ?? "";
    const address     = PICKUP_ADDRESSES[branch];
    const box         = container.querySelector("#cf-pickup-address");
    const text        = container.querySelector("#cf-pickup-address-text");
    if (text) text.textContent = address ?? "";
    if (box)  box.hidden = !(fulfilment === "Pickup" && address);
  };

  attachCardPicker(container, {
    groupId: "cf-branch-group",
    hiddenId: "cf-branch",
    optionSelector: "[data-branch-option]",
    valueKey: "branchValue",
    onSelect: updatePickupAddress,
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

      const timeLabel = document.getElementById("cf-fulfilment-time-label");
      if (timeLabel) timeLabel.textContent = fulfilmentTimeLabel(value);

      updatePickupAddress();
    },
  });

  attachCardPicker(container, {
    groupId: "cf-social-group",
    hiddenId: "cf-social",
    optionSelector: "[data-social-option]",
    valueKey: "socialValue",
    onSelect: (value) => {
      const detail = container.querySelector("#cf-social-detail");
      if (detail) detail.hidden = value !== "yes";
    },
  });
}

/**
 * Reads and validates the contact form.
 * Returns { valid, values } where values contains all field data.
 */
export function validateAndRead() {
  // Pickup means the customer arranges collection themselves — in person
  // or with their own rider — so there is no address for us to deliver to.
  // It is only required when we are booking the delivery on their behalf.
  const fulfilment = document.getElementById("cf-fulfilment")?.value ?? "Delivery";
  const needsAddress = fulfilment !== "Pickup";

  // cf-time is deliberately absent: the event time is optional now. The
  // delivery/pickup time is the one we schedule against, so that is the
  // one that has to be there.
  const fields = [
    { id: "cf-first-name",      type: "text" },
    { id: "cf-last-name",       type: "text" },
    { id: "cf-email",           type: "email" },
    { id: "cf-phone",           type: "text" },
    { id: "cf-date",            type: "date" },
    { id: "cf-fulfilment-time", type: "time" },
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
    if (type === "email") {
      // Optional — phone is the field that has to be there, and the server
      // accepts either. Blank passes; anything typed still has to look
      // like an address, so a malformed one isn't accepted just because
      // it's no longer required.
      fieldOk = value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (type === "date" && fieldOk) {
      const minDate = input.getAttribute("min");
      if (minDate) fieldOk = value >= minDate;
    }
    // Belt and braces: the dropdown only contains in-window slots, so this
    // should be unreachable. It stays because "the markup makes it
    // impossible" is a claim that quietly stops being true when someone
    // edits the markup.
    if (type === "time" && fieldOk) {
      fieldOk = isFulfilmentTimeInWindow(value);
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
      branch:         document.getElementById("cf-branch")?.value              ?? "",
      fulfilment:     document.getElementById("cf-fulfilment")?.value          ?? "",
      firstName:      document.getElementById("cf-first-name")?.value.trim()   ?? "",
      lastName:       document.getElementById("cf-last-name")?.value.trim()    ?? "",
      email:          document.getElementById("cf-email")?.value.trim()        ?? "",
      phone:          document.getElementById("cf-phone")?.value.trim()        ?? "",
      eventDate:      document.getElementById("cf-date")?.value                ?? "",
      eventTime:      document.getElementById("cf-time")?.value                ?? "",
      // Read as a plain boolean — applyRushFee() in src/domain/pricing.js
      // is what actually adds the fee, on both the browser's own total and
      // the server's verified one. This field only carries the customer's
      // intent from the checkbox to there.
      rushOrder:      document.getElementById("cf-rush")?.checked              ?? false,
      fulfilmentTime: document.getElementById("cf-fulfilment-time")?.value     ?? "",
      address:        document.getElementById("cf-address")?.value.trim()      ?? "",
      note:           document.getElementById("cf-note")?.value.trim()         ?? "",
      // "yes" / "no" — lowercase to match the GHL dropdown's own option
      // values exactly, since that field is case-sensitive. Optional and
      // read regardless of the answer.
      contactedViaSocial: document.getElementById("cf-social")?.value          ?? "no",
      socialProfileName:  document.getElementById("cf-social-name")?.value.trim() ?? "",
      // Honeypot — always empty for a real customer. Read and forwarded so
      // the server can decide, rather than the client silently dropping a
      // submission a bot could then retry differently.
      company:        document.getElementById("cf-company")?.value.trim()      ?? "",
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
    // Optional — checked before the blanket empty-fails-everything rule
    // below, since that rule would otherwise mark a blank, untouched email
    // field as invalid.
    if (input.type === "email") return value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!value) return false;
    if (input.type === "date") {
      const min = input.getAttribute("min");
      return !min || value >= min;
    }
    // Keyed on id, not type: cf-fulfilment-time is a <select>, whose .type
    // reads "select-one". Kept in step with validateAndRead's window check.
    // cf-time is deliberately not here — the event time is unrestricted.
    if (input.id === "cf-fulfilment-time") return isFulfilmentTimeInWindow(value);
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
  const { branch, firstName, lastName, email, phone, eventDate, eventTime,
          fulfilmentTime, address, note, fulfilment } = contactValues;
  const dateStr = eventDate
    ? eventTime ? `${eventDate} at ${eventTime}` : eventDate
    : null;

  return [
    `${serviceName} Order`,
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
    // Now optional, so this can genuinely be blank — dropped rather than
    // printed empty, same as the other optional rows below.
    ...(email ? [`Email    : ${email}`] : []),
    `Phone    : ${phone}`,
    ...(dateStr ? [`Date     : ${dateStr}`] : []),
    ...(fulfilment ? [`Receive  : ${fulfilment}`] : []),
    // The time we actually schedule against, so it is printed even though
    // the event time above may be absent.
    ...(fulfilmentTime ? [`${fulfilment === "Pickup" ? "Pickup  " : "Delivery"} : ${fulfilmentTime}`] : []),
    // Only printed when there is one — a Pickup customer has no delivery
    // address, so an empty row would just read as missing data.
    ...(address ? [`Address  : ${address}`] : []),
    ...(note ? ["", "── EVENT NOTES ─────────────────────────────", note] : []),
    "",
    "────────────────────────────────────────────",
    "Submitted via Spandis Meal Builder",
  ].join("\n");
}
