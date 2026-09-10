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
import { photoHtml } from "./menu-photos.js";
import {
  customServiceTotal, customServiceQty, customServiceCeiling, formatPeso,
} from "../domain/pricing.js";

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

/**
 * The icons a card may ask for, keyed by meal_builder_services.icon.
 *
 * A closed set rather than free-form markup: the value arrives from a text
 * column an admin fills in, and anything unrecognised falls back to cutlery
 * rather than rendering nothing or, worse, whatever was typed. Same
 * stroke-width and viewBox as the seven built-in cards, so a custom card
 * cannot be picked out of the grid by its icon weight.
 *
 * These are the values the dashboard form should offer. Adding one is a line
 * here plus a line in their select.
 */
const ICONS = {
  cutlery: `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>`,
  flame:   `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
  box:     `<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
  leaf:    `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>`,
  cake:    `<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v2"/><path d="M12 8v2"/><path d="M17 8v2"/>`,
  cup:     `<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>`,
};

/** Cutlery for anything unnamed or unrecognised — never nothing. */
function iconHtml(name) {
  const key = String(name ?? "").trim().toLowerCase();
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] ?? ICONS.cutlery}</svg>`;
}

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
 * The money, in the same chip every other builder uses.
 *
 * A price belongs beside the button that commits to it. This was a line of
 * form-field__note under the description — the smallest, greyest style in the
 * system — which is not where anyone looks for a cost, and it sat flush
 * against the quantity label so it read as part of that field.
 *
 * A per-unit card shows its rate until there is a quantity to multiply, then
 * the running total, the way the packed-meals configurator does. An enquiry
 * card says so rather than showing a zero.
 */
export function priceChipHtml(row, typed) {
  const price = peso(row?.unit_price);
  const hasQty = String(typed ?? "").trim() !== "";

  if (row?.pricing_mode === "fixed" && price) {
    return `<div class="price-chip"><span>Total</span><strong>${esc(price)}</strong></div>`;
  }

  if (row?.pricing_mode === "per_unit" && price) {
    const qty = customServiceQty(typed, row?.max_quantity);
    return `
      <div class="price-chip">
        <span id="custom-total-label">${hasQty
          ? `Total (${qty} &times; ${esc(price)})`
          : `Per ${esc(quantityConfig(row).unit)}`}</span>
        <strong id="custom-total" aria-live="polite" aria-atomic="true">${esc(
          hasQty ? formatPeso(customServiceTotal(row, qty)) : price
        )}</strong>
      </div>`;
  }

  return `<div class="price-chip"><span>Price</span><strong>To be quoted</strong></div>`;
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

  // The figure on the card comes from the same column the customer will be
  // charged from.
  //
  // price_from and unit_price are two separate fields on the dashboard form
  // with nothing holding them together, and reading price_from regardless of
  // mode let a card advertise "From PHP 350" and then charge PHP 250 — or,
  // in the direction that matters, advertise 250 and charge 350. Nobody
  // would have meant that, and it still reads as bait and switch.
  //
  // Once a card is priced there is no range to be at the bottom of, so
  // "From" is dropped with it. price_from stays what it was always for: the
  // only price signal an enquiry card has.
  const priced = peso(row.unit_price);
  const priceFact =
    row.pricing_mode === "per_unit" && priced
      ? `<div><dt>Price</dt><dd>${esc(priced)} per ${esc(quantityConfig(row).unit)}</dd></div>`
      : row.pricing_mode === "fixed" && priced
        ? `<div><dt>Price</dt><dd>${esc(priced)}</dd></div>`
        : peso(row.price_from)
          ? `<div><dt>From</dt><dd>${esc(peso(row.price_from))}</dd></div>`
          : "";

  const facts = [
    priceFact,
    row.facts_label ? `<div><dt>Details</dt><dd>${esc(row.facts_label)}</dd></div>` : "",
  ].join("");

  return `
    <button type="button" class="service-card" data-service="${esc(row.slug)}">
      <div class="service-card__topline">
        <div class="service-card__icon" aria-hidden="true">${iconHtml(row.icon)}</div>
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
    const { required, label: quantityLabel } = quantityConfig(row);

    // Sets expectation; the money itself is the chip in the footer. This
    // line used to carry both, in the smallest, greyest style the system
    // has — the cost is the question a customer opens this screen with, and
    // it was rendered as a footnote against the field label.
    const intro =
      row.pricing_mode === "per_unit"
        ? `Tell us how much you need and we&rsquo;ll price it as you go.`
        : row.pricing_mode === "fixed"
          ? `One price, whatever the size of your order.`
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
        <!-- Narrow, with the unit beside it, the way every other builder asks
             for a number. A full-width box for "5" reads as a text field, and
             the unit is the half of the answer the customer cannot see:
             "5" means nothing, "5 kg" means something. -->
        <!-- max reads the same ceiling the price is bounded by, so the field
             cannot accept a number the total will not honour. That was the
             packed-meals defect exactly: max="9999" on the input and a
             different limit in the code. -->
        <div class="pax-input-row">
          <input class="pax-input" type="number" inputmode="numeric" min="1" step="1"
                 max="${customServiceCeiling(row.max_quantity)}"
                 id="custom-pax" name="pax" value="${esc(state.pax)}"
                 placeholder="0" autocomplete="off" />
          <span class="pax-unit">${esc(quantityConfig(row).unit)}</span>
        </div>
        <p class="form-field__error" id="custom-pax-error" role="status" hidden></p>
      </div>
    ` : "";

    const label = esc(row.label || row.slug);

    // The form, without deciding yet whether it sits beside a photo.
    const form = `
      ${row.description ? `<p class="contact-intro">${esc(row.description)}</p>` : ""}
      <p class="form-field__note">${intro}</p>
      ${required ? `<hr class="divider" />` : ""}
      ${quantityField}
      <div class="form-field">
        <label class="form-field__label" for="custom-notes">What are you planning?</label>
        <textarea class="form-field__input" id="custom-notes" name="notes" rows="4"
                  placeholder="Tell us about the occasion, any dishes you have in mind, and anything we should know.">${esc(state.notes)}</textarea>
      </div>
    `;

    // The photo goes beside the form, as it does in the grazing and party
    // tray builders -- but only when there is one. builder-split is a fixed
    // 4fr/8fr grid, so an empty photo column would leave a third of the row
    // blank and look like a failed image rather than a service without one.
    //
    // photoHtml returns "" for a missing source, so this stays inert until
    // meal_builder_services carries an image column. See the note on the
    // select in src/data/services.js before adding it: asking PostgREST for
    // a column that does not exist yet fails the whole query, and every
    // custom card would vanish at once.
    const photo = photoHtml(row.image_url, `${row.label || row.slug}`, "hero", null);
    const body = photo
      ? `<div class="builder-split">
           <div class="builder-split__photo">${photo}</div>
           <div class="builder-split__main">${form}</div>
         </div>`
      : form;

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">${editing ? "Editing your enquiry" : "Spandi&rsquo;s Food + Catering"}</p>
          <h2>${label}</h2>
        </div>
      </div>

      ${body}

      <hr class="divider" />

      <!-- The money sits beside the button that commits to it, in the same
           chip every other builder uses. It was a note under the intro, set
           in the smallest style the system has, which is not where anyone
           looks for a price. -->
      <div class="config-panel__footer">
        ${priceChipHtml(row, state.pax)}
        <button class="primary-button" type="button" data-custom-continue>
          ${editing ? "Update enquiry" : "Continue"}
        </button>
      </div>

      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>&larr; Back to services</button>
      </div>
    `;
  }

  function handleInput(e) {
    if (e.target.id === "custom-pax") { state.pax = e.target.value; updatePriceChip(); }
    if (e.target.id === "custom-notes") state.notes = e.target.value;
  }

  /**
   * Keeps the footer figure in step with the quantity, without re-rendering.
   *
   * A full render would replace the input mid-keystroke and take the caret
   * with it. Only the two nodes that changed are touched, so the customer can
   * watch the total move while they type -- which is the whole reason a
   * per-unit card shows a rate rather than a fixed number.
   */
  function updatePriceChip() {
    const row = state.slug ? getCustomService(state.slug) : null;
    if (!row || row.pricing_mode !== "per_unit") return;

    const price = peso(row.unit_price);
    if (!price) return;

    const typed = String(state.pax ?? "").trim();
    const qty = customServiceQty(state.pax, row.max_quantity);
    const label = container?.querySelector("#custom-total-label");
    const total = container?.querySelector("#custom-total");

    if (label) {
      label.textContent = typed
        ? `Total (${qty} × ${price})`
        : `Per ${quantityConfig(row).unit}`;
    }
    if (total) {
      total.textContent = typed ? formatPeso(customServiceTotal(row, qty)) : price;
    }
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
    const quantity = required ? customServiceQty(state.pax, row.max_quantity) : null;
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
