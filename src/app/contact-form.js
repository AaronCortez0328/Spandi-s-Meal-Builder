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

import { CONFIRM_WINDOW, wayOutHtml } from "./copy.js";
import { RUSH_FEE, applyRushFee } from "../domain/pricing.js";
import {
  blockFor, blockMessage, upcomingBlocks, shortDate, todayInManila, nextOpenDate,
  earliestBookableDate, STANDARD_LEAD_DAYS, RUSH_LEAD_DAYS,
} from "../domain/availability.js";
import { getBlockedDates } from "../data/blocked-dates.js";
import { setPriceText } from "./ui-fx.js";
import { persistContactForm } from "./draft.js";
import {
  parentView, onParentView, offParentView, setParentModalOpen,
} from "./parent-view.js";

const formatPeso = (n) => `PHP ${Number(n ?? 0).toLocaleString("en-PH")}`;

// Dish names come from Supabase and land in this panel's markup, so they get
// escaped on the way in rather than trusted.
const esc = (val) =>
  String(val ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

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

/**
 * Whether a date in the past can be chosen at all.
 *
 * Off everywhere unless the build was given the flag, so a new production
 * domain enforces the lead time without anyone remembering to add it to a
 * list. Vite inlines this at build time: the production bundle contains
 * the literal `false`, which is why the flag cannot be turned on from the
 * browser — the branch it guards is not in the shipped file.
 *
 * Set VITE_ALLOW_PAST_DATES=1 on the Vercel Preview environment, scoped to
 * the backfill branch, for entering historical bookings into live GHL.
 */
const ALLOW_PAST_DATES = import.meta.env.VITE_ALLOW_PAST_DATES === "1";

/**
 * Said under the time dropdown, because "Delivery time" on its own has
 * been read as the start of the event more than once — and an order timed
 * to arrive as the guests do is an order that arrives late. Keyed by the
 * same values the receive-method cards write, so the note swaps with the
 * label above it.
 */
const FULFILMENT_TIME_NOTES = {
  Delivery: "This is when our team arrives with your order, not your event start time. Please allow enough time to set up before your guests are served.",
  Pickup:   "This is when your order will be ready for collection, not your event start time. Please allow enough travel and setup time.",
};

function fulfilmentTimeNote(fulfilment) {
  return FULFILMENT_TIME_NOTES[fulfilment] ?? FULFILMENT_TIME_NOTES.Delivery;
}

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

/**
 * @param {Array<{label: string, value: string}>} summaryRows  what they are
 *   buying, itemised. Shown at the top of this step so the order is in front
 *   of them while they fill it in.
 * @param {number} orderTotal  the menu total in pesos, before any rush fee.
 *   A number, not a formatted string: the rush cards add to it live, so this
 *   side has to be able to do arithmetic on it.
 */
export function buildContactPanel({
  backAttr, copyAttr, statusId, summaryRows = [], orderTotal = 0,
  stepLabel = "Step 4 of 4 · Almost done",
}) {
  // Each line carries what is inside it, collapsed. A combo is one price and
  // six dishes; listing all six flat gave a wall of rows saying "Included"
  // to communicate a single number, and dropping them entirely -- which is
  // what happened after the shared cart landed -- meant the last screen
  // before paying showed less than the screen before it.
  //
  // <details> rather than a scripted toggle: it opens on click and on
  // Enter, announces its own state, and survives this panel being rebuilt
  // without any state to keep in sync.
  const summaryLines = summaryRows.map((row) => `
    <li class="order-summary__line-group">
      <div class="order-summary__line">
        <span class="order-summary__line-name">${esc(row.label)}</span>
        <span class="order-summary__line-value">${esc(row.value)}</span>
      </div>
      ${row.subtitle ? `<p class="order-summary__line-meta">${esc(row.subtitle)}</p>` : ""}
      ${row.contents?.length ? `
        <details class="order-summary__items">
          <summary>${row.contents.length} item${row.contents.length !== 1 ? "s" : ""}</summary>
          <ul>${row.contents.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </details>
      ` : ""}
    </li>
  `).join("");

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

    <!-- Form on the left, order on the right. The summary used to sit as a
         block above everything, which pushed the fields the customer came to
         fill in below the fold, and gave a fixed-price combo a wall of rows
         saying "Included". Beside the form it stays in view while they work
         and costs no vertical space.

         It cannot be sticky: the app runs in an iframe that resizes to its
         own content height, so there is no inner viewport for a sticky
         element to hold against. -->
    <div class="confirm-layout">
    <div class="confirm-layout__main">

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
          Email Address <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <!-- Required as of this change. It was optional, and four customers
             in five left it blank — which meant the confirmation, the
             payment link and the kitchen notification reached about one
             order in five. A booking we cannot send a payment link to
             costs more than the submissions this will lose. -->
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
          <!-- min is set by applyLeadTime() rather than written here,
               because it depends on today in Manila and on whether this is
               a rush order. It had been removed twice for entering old
               bookings directly; that no longer needs the live form
               relaxed, because ALLOW_PAST_DATES lifts it on the backfill
               deployment only. -->
          <input
            type="date"
            id="cf-date"
            name="eventDate"
            class="form-field__input"
            required
            aria-describedby="cf-date-blocked cf-lead-note"
          />
          <!-- Why the floor is what it is, said before they discover it by
               being refused. Hidden on the backfill build, where there is
               no floor to explain. -->
          <p class="form-field__note" id="cf-lead-note"${ALLOW_PAST_DATES ? " hidden" : ""}>
            We need ${STANDARD_LEAD_DAYS} days&rsquo; notice &mdash; or ${RUSH_LEAD_DAYS} with a rush order.
          </p>
          <!-- Why a message and not a greyed-out day: this is a native date
               input, and browsers offer min and max and nothing else. There is
               no way to disable scattered individual dates in one, and blocked
               dates are scattered by nature. A custom calendar could do it, at
               the cost of the native picker — which on a phone is markedly
               better than anything we would build. So the date is checked the
               moment it is chosen, and again when the branch changes, since a
               date that is free at Cavite may be full at Batangas. -->
          <p class="form-field__error" id="cf-date-blocked" role="status" hidden></p>
          <!-- Which days are already closed, said before they pick rather than
               after. This is the compensation for not being able to grey a day
               out in a native picker: most of what a greyed calendar buys you
               is knowing in advance, and this delivers that for a fraction of
               a custom calendar — which would cost the native mobile date
               wheel, and that is better than anything we would build. -->
          <p class="date-unavailable" id="cf-date-unavailable" hidden></p>
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
           a menu one. The fee is added server-side (applyRushFee() in
           src/domain/pricing.js); these cards only state the intent.

           Two cards rather than a checkbox: every other either/or in this
           form — branch, receive method, the Facebook question — is a pair
           of cards, and a checkbox in a tinted bar read as a notice to
           acknowledge rather than a paid option to choose. Standard is
           pre-selected so the default is explicit instead of implied by an
           empty box. -->
      <div class="form-field">
        <p class="form-group-label" id="rush-label">Rush this order?</p>
        <input type="hidden" id="cf-rush" name="rushOrder" value="no" />
        <div class="fulfilment-cards" id="cf-rush-group" role="radiogroup" aria-labelledby="rush-label">
          <button type="button" class="branch-card is-selected" role="radio" aria-checked="true"
                  data-rush-option data-rush-value="no" id="cf-rush-standard">
            <span class="branch-card__name">Standard</span>
            <span class="branch-card__meta">${STANDARD_LEAD_DAYS} days&rsquo; notice</span>
          </button>
          <button type="button" class="branch-card" role="radio" aria-checked="false"
                  data-rush-option data-rush-value="yes">
            <span class="branch-card__name">Rush</span>
            <span class="branch-card__meta">+${formatPeso(RUSH_FEE)} &middot; ${RUSH_LEAD_DAYS} days&rsquo; notice</span>
          </button>
        </div>
        <!-- Filled by applyLeadTime() when the chosen date is inside the
             rush window. Standard is disabled rather than left clickable
             and then refused: the date already decided this, so offering
             the choice would be offering something we would reject. -->
        <p class="form-field__note" id="cf-rush-note" hidden></p>
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
        <p class="form-field__note" id="cf-fulfilment-time-note">${fulfilmentTimeNote("Delivery")}</p>
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
        <button type="button" class="tc-link" data-open-tc
          aria-haspopup="dialog" aria-controls="tc-dialog">Terms &amp; Conditions</button>
      </p>
    </div>

    <!-- A popup, but not a <dialog>.
         ═══════════════════════════════════════════════════════════
         This was <dialog> + showModal(), and inside the embed it could
         not be made to work. The app runs in a scrolling="no" iframe
         grown to its own content height, so there is no inner viewport:
         Chromium and desktop WebKit read 100vh as 2563px and built a
         1579px dialog on an 844px phone, while iOS Safari read it as a
         few hundred pixels and squeezed the terms to one clipped line,
         over a backdrop covering part of the screen, scrolling away
         with the page -- which a position: fixed element cannot do, and
         is the tell that the top layer was never anchored to a viewport
         at all. Feeding it the true screen height from the parent fixed
         both desktop engines and changed nothing on a real iPhone.

         So this is a popup built out of parts that behave the same
         everywhere: two ordinary elements, position: absolute, and a
         top the JS works out in pixels. No top layer, no showModal, no
         ::backdrop, and no CSS-side viewport unit deciding anything.

         Placement, in order of preference (see positionTerms):
           1. centred in the band the parent says is on screen
           2. failing that, pinned to the control that opened it --
              which the customer just pressed, so it is on their screen
              by definition, and needs no viewport knowledge at all

         The body's height is clamped at BOTH ends in CSS, so whatever
         any engine believes about the viewport it can never come out
         as one line, and never taller than a phone. -->
    <div class="tc-modal" id="tc-modal" hidden>
      <div class="tc-modal__scrim" data-close-tc></div>
      <section class="tc-panel" id="tc-dialog" role="dialog" aria-modal="true"
        aria-labelledby="tc-dialog-title">
      <div class="tc-panel__header">
        <div class="tc-panel__title-group">
          <div class="tc-panel__icon-wrap" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          </div>
          <div>
            <h2 id="tc-dialog-title" class="tc-panel__title">Terms &amp; Conditions</h2>
            <p class="tc-panel__subtitle">Spandi's Food + Catering</p>
          </div>
        </div>
        <button class="tc-panel__close" type="button" id="tc-dialog-close" aria-label="Close terms">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="tc-panel__body">
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

        <div class="tc-panel__footer">
          <button class="primary-button tc-panel__agree-btn" type="button" id="tc-dialog-agree">
            I Have Read &amp; Agree
          </button>
        </div>
      </section>
    </div>

    <div class="step-nav">
      <button class="text-button" type="button" ${backAttr}>← Back to Review</button>
      <div class="step-nav__cta">
        <!-- Repeated here, not only in the panel alongside: by the time
             someone reaches this button the summary has scrolled out of
             sight, and this is the moment they commit to the figure. -->
        <p class="cta-total">
          <span>Total</span>
          <strong id="cf-cta-total">${formatPeso(orderTotal)}</strong>
        </p>
        <button class="primary-button" type="button" ${copyAttr}>
          Send Order
        </button>
        <p class="status-text" id="${statusId}" role="status" aria-live="polite"></p>
      </div>
    </div>

    </div><!-- /.confirm-layout__main -->

    <!-- Read like a receipt: what was bought, then anything added, then the
         total last behind a rule. An earlier version led with the price and
         repeated it on the item line below, so a single-item order printed
         the same figure twice and still had no line that looked like a
         total. -->
    <aside class="order-summary" aria-label="Order summary">
      <p class="order-summary__caption">Your order</p>

      <ul class="order-summary__lines">${summaryLines}</ul>

      <div class="order-summary__line order-summary__line--rush" id="cf-rush-line" hidden>
        <span class="order-summary__line-name">Rush fee</span>
        <span class="order-summary__line-value">+${formatPeso(RUSH_FEE)}</span>
      </div>

      <div class="order-summary__total">
        <span>Total</span>
        <strong id="cf-total-amount"
                data-base-total="${Number(orderTotal) || 0}">${formatPeso(orderTotal)}</strong>
      </div>
    </aside>

    </div><!-- /.confirm-layout -->
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
/**
 * The row blocking whatever is currently in the date field, or null.
 *
 * Reads state and changes nothing, so every place that needs to know whether
 * this field is acceptable can ask the same question and get the same answer.
 * That matters more than it sounds: "is this date valid" used to be decided in
 * three places — this check, isInputValid() in attachInlineValidation, and
 * clearFilledErrors() — and only one of them knew blocked dates existed. The
 * other two ran afterwards and put the green tick back, so the field showed a
 * red reason and a valid state at the same time.
 */
export function currentDateBlock() {
  const input = document.getElementById("cf-date");
  if (!input || !input.value) return null;
  const branch = (document.getElementById("cf-branch")?.value ?? "").trim() || null;
  return blockFor(getBlockedDates(), input.value, branch);
}

/**
 * "Our next open date is 30 Aug." -- offered beside a refusal.
 *
 * Empty when nothing in the window is open, or when the suggestion would
 * be the date the customer already picked. The list fails open, so an
 * empty list makes every date bookable and this correctly suggests the day
 * after: that is the agreed behaviour, not a bug to guard against here.
 */
function nextOpenHtml(fromDate, branch) {
  const next = nextOpenDate(getBlockedDates(), fromDate, branch);
  if (!next || next === fromDate) return "";
  return `<span class="date-next-open">Our next open date is
    <button type="button" class="date-next-open__pick" data-pick-date="${next}">${shortDate(next)}</button>.</span>`;
}

/** How many closed dates to name before summarising the rest. */
const UNAVAILABLE_SHOWN = 3;

/**
 * Lists the closed dates ahead, under the field, so a customer can avoid one
 * rather than discover it.
 *
 * Only while no date is chosen. It is advance notice, and once a date is in
 * the field it has nothing left to say: a valid one is reported by the green
 * tick, and a closed one by the red line right above this, which names the
 * same date and the same reason. Left showing, it sat under a correct answer
 * looking like a complaint about it.
 *
 * Deliberately below the field rather than above, even though above would be
 * read sooner. Above, it would vanish at the instant of picking and pull the
 * date field up by its own height — content moving under the finger that just
 * tapped, which is the thing several commits went into removing. Below, only
 * what is beneath it shifts.
 *
 * Re-runs whenever the branch changes, because the list is branch-specific:
 * before a branch is chosen only every-branch closures are certain, and
 * choosing Cavite can reveal several more.
 */
function renderUnavailableDates() {
  const el = document.getElementById("cf-date-unavailable");
  if (!el) return;

  const chosen = (document.getElementById("cf-date")?.value ?? "").trim();
  const branch = (document.getElementById("cf-branch")?.value ?? "").trim() || null;
  const blocks = chosen
    ? []
    : upcomingBlocks(getBlockedDates(), { branch, today: todayInManila() });

  if (blocks.length === 0) {
    el.textContent = "";
    el.hidden = true;
    return;
  }

  const named = blocks.slice(0, UNAVAILABLE_SHOWN).map((b) => {
    const why = b.reason?.trim();
    return why ? `${shortDate(b.blocked_date)} (${why.toLowerCase()})` : shortDate(b.blocked_date);
  });
  const rest = blocks.length - named.length;

  el.textContent = `Unavailable: ${named.join(" · ")}${rest > 0 ? ` · +${rest} more` : ""}`;
  el.hidden = false;
}

/**
 * Puts the lead time on the date field, and keeps the rush cards honest
 * about it.
 *
 * The date decides rush, not the other way round. Letting the cards drive
 * meant a customer could pick Rush, choose a date two days out, switch
 * back to Standard, and hold a date Standard does not allow — valid-looking
 * right up to the moment it was refused. So `min` sits at the rush floor,
 * which is the earliest anything can be booked, and picking a date inside
 * the rush window selects Rush and disables Standard. The option is removed
 * rather than policed, same as the time dropdown above.
 *
 * Does nothing on the backfill build, where old bookings are entered and
 * there is no floor to apply.
 */
export function applyLeadTime() {
  const input = document.getElementById("cf-date");
  if (!input) return;

  const rushInput = document.getElementById("cf-rush");
  const standard  = document.getElementById("cf-rush-standard");
  const note      = document.getElementById("cf-rush-note");

  if (ALLOW_PAST_DATES) {
    input.removeAttribute("min");
    if (standard) standard.disabled = false;
    if (note) note.hidden = true;
    return;
  }

  // The absolute floor, whichever option is chosen. Standard's later floor
  // is enforced by disabling Standard, not by moving this — moving it would
  // silently invalidate a date the customer had already picked.
  input.min = earliestBookableDate(true);

  const chosen        = input.value.trim();
  const standardFloor = earliestBookableDate(false);
  const needsRush     = chosen !== "" && chosen < standardFloor;

  if (standard) standard.disabled = needsRush;

  if (needsRush && rushInput?.value !== "yes") {
    // Click rather than set the value: the card picker owns the selected
    // class, aria-checked and the totals refresh, and reaching past it
    // would leave the cards showing Standard while the order was rush.
    document.querySelector('[data-rush-option][data-rush-value="yes"]')?.click();
  }

  if (note) {
    note.textContent = needsRush
      ? `Events within ${STANDARD_LEAD_DAYS} days need a rush order — ${formatPeso(RUSH_FEE)} has been added.`
      : "";
    note.hidden = !needsRush;
  }
}

export function checkDateAvailability() {
  const input = document.getElementById("cf-date");
  const msgEl = document.getElementById("cf-date-blocked");
  if (!input) return null;

  renderUnavailableDates();
  const block = currentDateBlock();

  if (msgEl) {
    msgEl.textContent = block ? blockMessage(block) : "";
    // A closed date used to be a full stop: it named the problem and left
    // the customer to find a day that works one tap of the picker at a
    // time. The next open date is offered first, and the way to ask about
    // this one after -- a kitchen closure is not always absolute.
    if (block) {
      const branch = (document.getElementById("cf-branch")?.value ?? "").trim() || null;
      msgEl.insertAdjacentHTML("beforeend", nextOpenHtml(input.value, branch));
      msgEl.insertAdjacentHTML("beforeend", wayOutHtml("Set on that date?"));
    }
    msgEl.hidden = !block;
  }
  input.classList.toggle("is-invalid", Boolean(block));
  if (block) input.classList.remove("is-valid");

  return block;
}

/**
 * Shows a blocked-date refusal that came from the server rather than from our
 * own copy of the list.
 *
 * The client's list can be up to thirty seconds old and the page may have been
 * open far longer, so the server can refuse a date this form still believes is
 * free. When that happens the customer needs the message on the field they
 * have to change — not only beside the button they just pressed, which by then
 * is a long way below the date on a phone.
 */
export function showDateBlocked(message) {
  const input = document.getElementById("cf-date");
  const msgEl = document.getElementById("cf-date-blocked");
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.insertAdjacentHTML("beforeend", wayOutHtml("Set on that date?"));
    msgEl.hidden = false;
  }
  if (input) {
    input.classList.add("is-invalid");
    input.classList.remove("is-valid");
    input.focus();
  }
}

export function attachFormPickers(container) {

  // Taking the suggestion. Delegated rather than bound to the button,
  // because the message is rewritten on every date and branch change and a
  // handler on the old node would go with it.
  container.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick-date]");
    if (!pick) return;
    const input = document.getElementById("cf-date");
    if (!input) return;
    input.value = pick.dataset.pickDate;
    // Same path a typed date takes, so the green tick and the error clear
    // together instead of one of them being left behind.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    checkDateAvailability();
    input.focus();
  });
  // Keeps both copies of the total honest — the summary at the top of the
  // step and the one beside Send Order. The base figure rides on the
  // element's own dataset rather than a variable captured here, so this
  // survives the panel being re-rendered with a different order.
  const updateTotals = () => {
    const totalEl  = container.querySelector("#cf-total-amount");
    const ctaEl    = container.querySelector("#cf-cta-total");
    const rushLine = container.querySelector("#cf-rush-line");
    const rush     = (document.getElementById("cf-rush")?.value ?? "no") === "yes";
    const base     = Number(totalEl?.dataset.baseTotal ?? 0);
    const text     = formatPeso(applyRushFee(base, rush));

    // setPriceText pulses only when the value actually changed, so the
    // figure reacts visibly to the rush choice instead of silently swapping.
    setPriceText(totalEl, text);
    setPriceText(ctaEl, text);
    if (rushLine) rushLine.hidden = !rush;
  };

  attachCardPicker(container, {
    groupId: "cf-rush-group",
    hiddenId: "cf-rush",
    optionSelector: "[data-rush-option]",
    valueKey: "rushValue",
    onSelect: updateTotals,
  });

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
    onSelect: () => {
      updatePickupAddress();
      // A date already chosen may be closed at the branch just picked, so the
      // answer has to be recomputed rather than left as it was.
      checkDateAvailability();
    },
  });

  // Lead time first: it may select Rush, and the availability check should
  // run against the date as it ends up, not as it briefly was.
  container.querySelector("#cf-date")?.addEventListener("change", () => {
    applyLeadTime();
    checkDateAvailability();
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

      // The note under the dropdown says the same thing the label does, at
      // length, so it has to follow the label rather than sit on Delivery.
      const timeNote = document.getElementById("cf-fulfilment-time-note");
      if (timeNote) timeNote.textContent = fulfilmentTimeNote(value);

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

  // Last, and deliberately so. Restoring a saved form works by clicking the
  // matching cards, which only does the right thing once the pickers above
  // are listening — otherwise the hidden value would be set while the cards
  // still showed nothing selected. All five builders call this function, so
  // hooking it here covers every service with one call site.
  persistContactForm(container);

  // After the restore, so a form that came back with a date and a branch is
  // judged on what it actually holds. Nothing else runs on first render — the
  // other calls hang off the date changing, the branch changing, the poll and
  // submit — so without this the list of closed days would stay hidden until
  // the customer touched something.
  //
  // applyLeadTime() first for the same reason as the change handler, and
  // because a restored draft may carry a date that has since fallen inside
  // the rush window while the form was closed.
  applyLeadTime();
  checkDateAvailability();
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
      // Required now, and still shape-checked: a blank fails on the
      // length test above, and a malformed one fails here. The server
      // continues to accept email or phone — that is right for an API,
      // and this is the form's rule, not the API's.
      fieldOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (type === "date" && fieldOk) {
      const minDate = input.getAttribute("min");
      if (minDate) fieldOk = value >= minDate;
      // A closed date fails here too, so it cannot be submitted by ignoring
      // the message under the field. The server checks again at write time —
      // this only saves the customer a wasted round trip.
      if (fieldOk && checkDateAvailability()) fieldOk = false;
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
      // A boolean out of a "yes"/"no" hidden input — the rush cards write
      // the string, same as every other card group here. applyRushFee() in
      // src/domain/pricing.js is what actually adds the fee, on both the
      // browser's total and the server's verified one; this only carries
      // the customer's intent that far.
      rushOrder:      document.getElementById("cf-rush")?.value === "yes",
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
    // A blocked date is a filled field, so this would have cleared it and
    // marked it valid — "has something in it" is the right test for a field
    // that was flagged only for being empty, and the wrong one for a date the
    // kitchen has closed.
    if (input.id === "cf-date" && currentDateBlock()) return;
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
      if (min && value < min) return false;
      // This listener is on the container and fires after the one on the
      // field itself, so without this it answered "valid" a moment later and
      // painted the tick back over a date that had just been refused.
      return !currentDateBlock();
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

  // Wire up the terms popup. Opening it is `hidden` plus a top worked out
  // in pixels -- see the markup for why none of this can be left to CSS.
  const tcModal   = container.querySelector("#tc-modal");
  const tcDialog  = container.querySelector("#tc-dialog");
  if (tcModal && tcDialog) {
    const openBtn  = container.querySelector("[data-open-tc]");
    const closeBtn = container.querySelector("#tc-dialog-close");
    const agreeBtn = container.querySelector("#tc-dialog-agree");
    let lastFocused = null;
    // The control the popup was opened FROM. Passed in explicitly rather
    // than read off document.activeElement, which is not the same thing: a
    // tap on a checkbox does not reliably focus it (WebKit does not), and
    // the fallback placement below would then anchor to <body> and put the
    // popup at the top of a 2,500px document, far above the customer.
    let anchorEl = null;

    /**
     * Puts the panel where the customer is looking.
     *
     * The scrim is absolute over the whole document, so both numbers here
     * are document coordinates -- and because the frame never scrolls
     * internally (scrolling="no", height grown to content), document
     * coordinates and the parent's idea of "how far down the builder are
     * we" are the same measurement. That is what makes this arithmetic
     * safe where a viewport unit was not.
     */
    const MARGIN = 12;      // clear space above AND below the panel
    const BODY_MIN = 200;   // the terms stay readable even in a short band
    const BODY_MAX = 420;

    function positionTerms() {
      const view = parentView();
      const body = tcDialog.querySelector(".tc-panel__body");

      // The band the panel must live inside, in document coordinates. The
      // frame never scrolls internally (scrolling="no", height grown to
      // content), so its document coordinates and the parent's "how far
      // down the builder are we" are the same measurement.
      let band = null;
      if (view) {
        band = view;                                    // the parent measured it
      } else if (window.parent === window) {
        // Standalone: the window really IS the viewport, so this is honest.
        band = { top: window.scrollY, height: window.innerHeight };
      }

      // Size the body so the whole panel fits the band, rather than letting
      // a fixed body height decide the panel's height and hoping it fits.
      // Falls back to the CSS clamp when there is no band to fit.
      if (band) {
        const header = tcDialog.querySelector(".tc-panel__header");
        const footer = tcDialog.querySelector(".tc-panel__footer");
        const chrome = (header?.offsetHeight ?? 0) + (footer?.offsetHeight ?? 0);
        const room = band.height - MARGIN * 2 - chrome;
        body.style.maxHeight =
          `${Math.round(Math.min(BODY_MAX, Math.max(BODY_MIN, room)))}px`;
      } else {
        body.style.maxHeight = "";
      }

      // Re-read AFTER sizing the body; the panel's height depends on it.
      const panelH = tcDialog.offsetHeight;
      let top;

      if (band) {
        const lo = band.top + MARGIN;
        const hi = band.top + band.height - panelH - MARGIN;
        // Centred, then held inside BOTH ends. The bottom clamp is the one
        // that was missing: Math.max(MARGIN, ...) alone floors only the top,
        // so a panel taller than the band started 12px in and then overran
        // the bottom without limit -- past the end of the iframe, where the
        // frame's own edge cut it off mid-button.
        //
        // hi < lo means even a body at BODY_MIN cannot fit. Nothing can be
        // done about the height then, so favour the top: the header and the
        // first terms stay on screen and the panel's own body scrolls.
        top = hi >= lo
          ? Math.min(Math.max(band.top + (band.height - panelH) / 2, lo), hi)
          : lo;
      } else {
        // Embedded, but the page has not been updated to send its viewport.
        // Nothing here can discover it, so fall back to the one position we
        // know is on screen: the control they just pressed.
        const anchor = anchorEl?.isConnected ? anchorEl : openBtn;
        const y = anchor ? anchor.getBoundingClientRect().top + window.scrollY : 0;
        top = Math.max(MARGIN, y - panelH / 3);
      }
      tcDialog.style.top = `${Math.round(top)}px`;
    }

    function openTerms(anchor) {
      anchorEl = anchor ?? openBtn;
      lastFocused = document.activeElement;
      tcModal.hidden = false;
      // Position after it is displayed: offsetHeight is 0 while hidden.
      positionTerms();
      const heading = tcDialog.querySelector("#tc-dialog-title");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        // preventScroll: the frame cannot scroll, and asking it to only
        // ever moves something that is not the popup.
        heading.focus({ preventScroll: true });
      }
      // Hold the page still. With the page frozen there is no scrolling to
      // follow, so the panel is placed once and stays exactly there --
      // no per-frame reposition, and none of the vibrating that caused.
      setParentModalOpen(true);
      // Still listen: an address bar hiding, a rotation, or a page that does
      // not honour the freeze all change the band, and the panel should
      // stay inside it. On a frozen page this simply never fires.
      window.addEventListener("resize", positionTerms);
      window.addEventListener("orientationchange", positionTerms);
      onParentView(positionTerms);
    }

    function closeTerms({ refocus = true } = {}) {
      tcModal.hidden = true;
      setParentModalOpen(false);
      window.removeEventListener("resize", positionTerms);
      window.removeEventListener("orientationchange", positionTerms);
      offParentView(positionTerms);
      // Focus goes back where it came from, or it lands on the document and
      // a keyboard customer loses their place in the form.
      if (refocus) (lastFocused ?? openBtn)?.focus({ preventScroll: true });
    }

    openBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (tcModal.hidden) openTerms(openBtn); else closeTerms();
    });

    // Tapping the dimmed area behind the panel closes it, as a popup should.
    tcModal.querySelector("[data-close-tc]")
      ?.addEventListener("click", () => closeTerms());

    // Escape closes, and Tab stays inside while it is open. Both of these
    // came free with <dialog>; neither does now.
    tcModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeTerms(); return; }
      if (e.key !== "Tab") return;
      const focusables = tcDialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    // Ticking the box IS the act of agreeing, so it goes through the terms
    // rather than round them. Pressing an unticked box opens them instead
    // of ticking it; the only thing that ticks it is the button at the end
    // of the terms themselves.
    //
    // Unticking is left alone. Withdrawing agreement needs no ceremony, and
    // making someone reopen the terms to say no would be a trap.
    const tcCheck = container.querySelector("#cf-tc-agree");
    tcCheck?.addEventListener("click", (e) => {
      if (e.target.checked) {
        // The click that would tick it. Cancel, and show what they are
        // agreeing to; the agree button below does the ticking.
        e.preventDefault();
        openTerms(e.currentTarget);
      }
    });

    closeBtn?.addEventListener("click", () => closeTerms());

    agreeBtn?.addEventListener("click", () => {
      const cb    = document.getElementById("cf-tc-agree");
      const label = document.getElementById("tc-checkbox-label");
      if (cb) cb.checked = true;
      label?.classList.remove("is-invalid");
      // Focus the box they just agreed with rather than the link that
      // opened the terms -- that is the thing that changed.
      closeTerms({ refocus: false });
      cb?.focus({ preventScroll: true });
    });

    // (Escape and the focus trap are wired above, on the modal wrapper.)
    tcDialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTerms();
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
