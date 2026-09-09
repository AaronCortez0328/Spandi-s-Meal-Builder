/**
 * Service cards the dashboard created, and the one builder they all share.
 *
 * The seven built-in services are typed into index.html and each has its own
 * builder. These are the opposite: a row in `meal_builder_services` is the
 * whole of adding one, and every one of them opens the same generic enquiry
 * — pax, notes, then the shared contact form and the shared submit path that
 * every other service already uses.
 *
 * ── Why these are absent rather than greyed when switched off ──────────────
 *
 * A built-in card exists in the markup whether the table loads or not, so
 * isServiceActive fails open and a dropped request leaves it orderable. That
 * is right for a card that is already on the page.
 *
 * A custom card exists only because a row said so. Rendering one and then
 * finding the row unreadable would put a card on the chooser with nothing
 * behind it — the customer has already chosen by the time anything could say
 * no. So getCustomServices() returns only rows that are present, custom and
 * explicitly active, and a card that is off is simply not there. See the note
 * on that function in src/data/services.js.
 */

import { getCustomServices } from "../data/services.js";
import { renderStepper as drawStepper, STEP_BUILD } from "./stepper.js";
import { addLine } from "../domain/cart.js";
import { getOrderLines, setOrderLines, requestReview } from "./order-shell.js";
import { persistState } from "./draft.js";
import { customServiceTotal, customServiceQty, formatPeso } from "../domain/pricing.js";

/**
 * How this card asks for a quantity, with the defaults applied.
 *
 * Null means guests throughout, so every row written before these columns
 * existed keeps behaving exactly as it did — the old hardcoded wording is
 * the fallback rather than a special case.
 */
function quantityConfig(row) {
  return {
    required: row?.quantity_required !== false,
    label: String(row?.quantity_label ?? "").trim() || "How many guests?",
    unit: String(row?.quantity_unit ?? "").trim() || "pax",
  };
}

/** Whether the dashboard has given this card a real price to charge. */
function isPriced(row) {
  return row?.pricing_mode === "fixed" || row?.pricing_mode === "per_unit";
}

/**
 * What a custom line shows where its money would go.
 *
 * These services carry a "from" figure for the chooser and nothing to
 * calculate with, so the line is genuinely unpriced rather than free. Read by
 * every render site through `priceNote ?? formatPeso(...)` — see makeLine in
 * src/domain/cart.js.
 */
const PRICE_NOTE = "Quoted separately";

/** Cutlery. One icon for every custom card until the table carries its own. */
const ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;

/** The markup last written to the chooser, so a no-op refresh stays a no-op. */
let lastRenderedHtml = null;

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * A "from" figure for the chooser, or null when there is nothing to show.
 *
 * Rejects zero as well as the unparseable, and rejects null before coercing
 * rather than after: `Number(null)` is 0, not NaN, so a row with no price set
 * would otherwise reach the card as "From PHP 0" — which does not read as
 * "not priced yet", it reads as free. price_from is optional in the table, so
 * this is the ordinary case rather than a corrupt one.
 */
function peso(n) {
  if (n === null || n === undefined || n === "") return null;
  const value = Number(n);
  return Number.isFinite(value) && value > 0
    ? `PHP ${value.toLocaleString("en-PH")}`
    : null;
}

/**
 * One card, built to match the seven exactly.
 *
 * Both badge slots are included even though nothing fills them today: the
 * unavailable badge because updateServiceAvailability() walks every
 * [data-service] in the DOM and would otherwise find nothing to hide on these,
 * and the pick badge because applyServiceBadges() does the same. A card
 * missing them is a card those two functions silently skip — which is how the
 * "Currently Not Available" badge went missing from three built-ins.
 */
export function cardHtml(row) {
  const label = esc(row.label || row.slug);
  const from = peso(row.price_from);

  const facts = [
    from ? `<div><dt>From</dt><dd>${esc(from)}</dd></div>` : "",
    row.facts_label ? `<div><dt>Details</dt><dd>${esc(row.facts_label)}</dd></div>` : "",
  ].join("");

  return `
    <button type="button" class="service-card" data-service="${esc(row.slug)}">
      <div class="service-card__topline">
        <div class="service-card__icon" aria-hidden="true">${ICON}</div>
        <span class="badge badge--soon" data-badge="unavailable" hidden>Currently Not Available</span>
        <span class="badge" data-badge="pick" hidden></span>
      </div>
      <strong>${label}</strong>
      ${row.description ? `<p>${esc(row.description)}</p>` : ""}
      ${facts ? `<dl class="service-card__facts" aria-label="${label} highlights">${facts}</dl>` : ""}
      <div class="service-card__cta" aria-hidden="true">Enquire →</div>
    </button>
  `;
}

/**
 * Draws the custom cards into the chooser, or removes them.
 *
 * Rebuilt wholesale on every call rather than diffed. This runs on the
 * 30-second poll as well as at boot, and a card switched off in the dashboard
 * has to disappear — replacing the lot is both simpler and the only version
 * that cannot leave a stale card behind.
 *
 * The group is hidden while empty so the chooser does not grow an empty
 * "More Services" heading on the six days out of seven when there are none.
 *
 * @returns {string[]} the slugs now on the page, so the caller knows which
 *   ones route to the generic builder.
 */
export function renderCustomServiceCards() {
  const grid = document.getElementById("service-cards-custom");
  const group = document.getElementById("service-group-custom");
  if (!grid || !group) return [];

  const rows = getCustomServices();
  const html = rows.map(cardHtml).join("");

  // Only when something actually changed. This runs on the 30-second refresh,
  // and rewriting innerHTML replaces every button with a new element -- which
  // drops focus to <body>. A customer navigating the chooser by keyboard
  // would lose their place twice a minute, on a page where nothing had
  // changed.
  //
  // Compared against what we last wrote, not against grid.innerHTML: reading
  // that back gives the browser's re-serialisation of the DOM, which need not
  // match the string that produced it -- so the guard would never hold and
  // this would rewrite every time regardless. Nothing else writes to this
  // grid, so the remembered copy cannot go stale.
  if (html !== lastRenderedHtml) {
    grid.innerHTML = html;
    lastRenderedHtml = html;
  }
  group.hidden = rows.length === 0;

  return rows.map((row) => row.slug);
}

/** The row behind a slug, or null once it has been switched off. */
export function getCustomService(slug) {
  return getCustomServices().find((row) => row.slug === slug) ?? null;
}

/**
 * The enquiry every custom service shares.
 *
 * One builder for all of them, told which service it is showing by
 * setService() when a card is tapped. That is the difference between this and
 * the seven: adding a service must not mean adding a builder.
 *
 * It ends by putting a line in the shared order and asking for the review,
 * exactly as the grazing and package builders do, so a custom service reaches
 * GoHighLevel through the same contact form, the same validation and the same
 * submit path as everything else. There is no second submit path to drift.
 */
export function createCustomBuilder() {
  const state = { slug: null, pax: "", notes: "" };
  let container = null;

  function mount(el) {
    container = el;
    el.addEventListener("click", handleClick);
    el.addEventListener("input", handleInput);
    persistState(el, "custom-service", state);
    render();
  }

  /** Told which service was tapped, before the section is un-hidden. */
  function setService(slug) {
    // Clearing on a genuine change only: selectService re-renders on a back
    // navigation too, and wiping what she typed because she pressed Back
    // would be the drafts problem this app already fixed elsewhere.
    if (state.slug !== slug) {
      state.slug = slug;
      state.pax = "";
      state.notes = "";
    }
    render();
  }

  function existingLine() {
    return getOrderLines().find((l) => l.service === state.slug) ?? null;
  }

  function render() {
    if (!container) return;

    const host = container.querySelector("[data-stepper]");
    drawStepper(host, STEP_BUILD, host?.dataset.stepperLabel);

    const panel = container.querySelector("[data-custom-panel]");
    if (!panel) return;

    const row = state.slug ? getCustomService(state.slug) : null;

    // The row vanished between the card being tapped and this rendering —
    // switched off in the dashboard mid-session, or the refresh that dropped
    // it. Saying so beats an empty form for a service we can no longer name.
    if (!row) {
      panel.innerHTML = `
        <div class="panel-header">
          <div>
            <p class="section-kicker">Spandi&rsquo;s Food + Catering</p>
            <h2>That service is no longer available</h2>
          </div>
        </div>
        <p class="contact-intro">
          It was switched off while you were choosing. Please pick another service &mdash;
          everything else is still open.
        </p>
        <div class="step-nav">
          <button class="text-button" type="button" data-service-back>&larr; Back to services</button>
        </div>
      `;
      return;
    }

    const editing = Boolean(existingLine());
    const from = peso(row.price_from);
    const { required, label: quantityLabel, unit } = quantityConfig(row);

    // What this costs, in the card's own terms. A priced card states its
    // price rather than promising to quote one -- saying "we'll confirm the
    // exact price" over a figure the dashboard has already fixed would be
    // the screen contradicting itself.
    const priceLine =
      row.pricing_mode === "per_unit"
        ? `<strong>${esc(formatPeso(row.unit_price))}</strong> per ${esc(unit)}.`
        : row.pricing_mode === "fixed"
          ? `<strong>${esc(formatPeso(row.unit_price))}</strong> in total, whatever the size of your order.`
          : `${from ? `Starts at <strong>${esc(from)}</strong>. ` : ""}We&rsquo;ll confirm the
             exact price with you &mdash; tell us what you need and our team will quote it.`;

    // quantity_required false means there is genuinely nothing to count --
    // a food tab, a consultation. Asking anyway would have the customer
    // invent a number for us to record.
    const quantityField = required ? `
      <div class="form-field">
        <label class="form-field__label" for="custom-pax">
          ${esc(quantityLabel)} <span class="form-field__req" aria-hidden="true">*</span>
        </label>
        <input class="form-field__input" type="number" inputmode="numeric" min="1" step="1"
               id="custom-pax" name="pax" value="${esc(state.pax)}"
               placeholder="e.g. 50" autocomplete="off" />
        <p class="form-field__error" id="custom-pax-error" role="status" hidden></p>
      </div>
    ` : "";

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">${editing ? "Editing your enquiry" : "Spandi&rsquo;s Food + Catering"}</p>
          <h2>${esc(row.label || row.slug)}</h2>
        </div>
      </div>

      ${row.description ? `<p class="contact-intro">${esc(row.description)}</p>` : ""}

      <p class="form-field__note">${priceLine}</p>

      ${quantityField}

      <div class="form-field">
        <label class="form-field__label" for="custom-notes">What are you planning?</label>
        <textarea class="form-field__input" id="custom-notes" name="notes" rows="4"
                  placeholder="Tell us about the occasion, any dishes you have in mind, and anything we should know.">${esc(state.notes)}</textarea>
      </div>

      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>&larr; Back to services</button>
        <div class="step-nav__cta">
          <button class="primary-button" type="button" data-custom-continue>
            ${editing ? "Update enquiry" : "Continue"}
          </button>
        </div>
      </div>
    `;
  }

  function handleInput(e) {
    if (e.target.id === "custom-pax") state.pax = e.target.value;
    if (e.target.id === "custom-notes") state.notes = e.target.value;
  }

  /**
   * Puts this enquiry in the order and hands over to the shared review.
   *
   * Replaces rather than appends, like grazing: coming back and changing the
   * guest count is changing your mind about one enquiry, not making a second.
   */
  function addToOrder(row) {
    const { required, unit } = quantityConfig(row);

    // Through customServiceQty, not Number(): the figure that names the line
    // must be the figure the price was computed from, or the cart reads
    // "150 kg" beside a total for some other number.
    const quantity = required ? customServiceQty(state.pax) : null;
    const total = customServiceTotal(row, quantity ?? 1);
    const label = row.label || state.slug;

    const without = getOrderLines().filter((l) => l.service !== state.slug);

    setOrderLines(addLine(without, {
      service: state.slug,
      serviceLabel: label,
      title: quantity !== null ? `${quantity} ${unit}` : label,
      subtitle: quantity !== null ? label : "",

      // The whole line total, with the cart's own qty left at 1.
      //
      // The quantity deliberately does NOT travel in qty. makeLine clamps
      // that through QTY_MAX, which is 99 because it bounds "how many
      // trays" -- the right question for a tray and the wrong one for
      // kilos. A 150 kg order silently becoming 99 kg is a number the
      // browser and the server would still agree on, so no 409 is raised
      // and the wrong total is written to the opportunity as revenue. It
      // goes in the payload instead, bounded only by CUSTOM_QTY_MAX.
      unitPrice: total,

      // Only an unpriced card says "Quoted separately". A priced one shows
      // its money like every other line in the basket.
      priceNote: isPriced(row) ? null : PRICE_NOTE,

      qtyEditable: false,
      contents: state.notes.trim() ? [state.notes.trim()] : [],
      payload: {
        slug: state.slug,
        quantity,
        unit,
        // Only a genuine head count reaches pax_count on the opportunity.
        // "5 kg" sitting in a field the team reads as people is worse than
        // leaving it blank.
        ...(quantity !== null && unit === "pax" ? { pax: quantity } : {}),
      },
    }));
  }

  function handleClick(e) {
    if (!e.target.closest("[data-custom-continue]")) return;

    const row = state.slug ? getCustomService(state.slug) : null;
    if (!row) { render(); return; }

    const { required, label: quantityLabel } = quantityConfig(row);

    // Nothing to validate on a card that asks for no number.
    if (required) {
      const paxField = container.querySelector("#custom-pax");
      const paxError = container.querySelector("#custom-pax-error");
      // Rounded, not just validated. step="1" is a hint to the spinner
      // arrows, not a rule -- a typed "50.5" reads back exactly as that, and
      // would reach the kitchen as "50.5 kg" on a document a person cooks
      // from. Under per_unit it would also price against a fraction.
      const pax = Math.round(Number(paxField?.value));

      if (!Number.isFinite(pax) || pax < 1) {
        paxField?.classList.add("is-invalid");
        if (paxError) {
          // Echoes the card's own question rather than assuming guests --
          // "how many guests" under a field headed "How many kilos?" is the
          // form arguing with itself.
          paxError.textContent = `Please answer: ${quantityLabel}`;
          paxError.hidden = false;
        }
        paxField?.focus();
        return;
      }

      paxField?.classList.remove("is-invalid");
      if (paxError) paxError.hidden = true;
      state.pax = String(pax);
    }

    addToOrder(row);
    requestReview();
  }

  return { mount, setService };
}
