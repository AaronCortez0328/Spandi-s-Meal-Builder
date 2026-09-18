import { renderStepper as drawStepper, STEP_BUILD } from "./stepper.js";
import { getGrazingConfig } from "../data/grazing.js";
import { grazingPhoto, photoHtml } from "./menu-photos.js";
import { setStepDirection, jumpTo } from "./ui-fx.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import { addLine } from "../domain/cart.js";
import { getOrderLines, setOrderLines, requestReview } from "./order-shell.js";
import { grazingBreakdown, grazingLogistics, GRAZING } from "../domain/pricing.js";

function fmt(n) {
  return "PHP " + n.toLocaleString("en-PH");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * What the Table's price is made of, and what is still missing from it.
 *
 * The poster carries "service charge 10%" and "Transpo fee depending on
 * location". Both were rendered here as grey text in an "Add-ons & Notes"
 * list and added to nothing, so a 50-100 Table quoted PHP 35,000 against an
 * invoice of PHP 38,500 plus transport.
 *
 * The service charge is now in the total. Transport is not, and cannot be:
 * catering folded its transport into a flat per-head logistics fee, but
 * grazing quotes it per location and no such rule exists. So the figure is
 * labelled as being before transport rather than offered as the bill.
 *
 * Module scope and exported so it can be tested. Reads no DOM.
 */
export function grazingCostLines(serviceKey, tier) {
  const b = grazingBreakdown(tier ? [tier] : [], tier?.paxRange, serviceKey);
  if (b.total <= 0) return [];

  const out = [`Spread: ${tier.paxRange} pax — ${fmt(b.spread)}`];
  if (b.serviceCharge > 0) {
    out.push(`Service charge (${GRAZING.serviceChargePct}%) — ${fmt(b.serviceCharge)}`);
  }
  if (b.logistics > 0) {
    out.push(`Logistics & setup (transport, sanitation, set up and pull out) — ${fmt(b.logistics)}`);
  }
  return out;
}

/**
 * What one grazing line costs.
 *
 * Its own function so the order line and the panel cannot drift, and so the
 * Table's service charge being dropped from the cart is a test failure
 * rather than a 10% shortfall nobody sees. The server prices this same line
 * by calling grazingTotal with the same service key.
 */
export function grazingLineTotal(serviceKey, tier) {
  return grazingBreakdown(tier ? [tier] : [], tier?.paxRange, serviceKey).total;
}

/** The itemised total for a chosen tier, or nothing for a flat-priced one. */
export function grazingBreakdownHtml(serviceKey, tier) {
  const b = grazingBreakdown(tier ? [tier] : [], tier?.paxRange, serviceKey);
  // The Board has a single flat price and nothing on top, so a breakdown
  // would be one row repeating the figure directly above it.
  if (b.total <= 0 || (b.serviceCharge === 0 && b.logistics === 0)) return "";

  const row = (label, note, value) => `
    <div class="gz-breakdown__row">
      <span class="gz-breakdown__label">${label}${note ? `<small>${note}</small>` : ""}</span>
      <span class="gz-breakdown__value">${fmt(value)}</span>
    </div>`;

  return `
    <p class="gz-breakdown__title">What makes up this total</p>
    ${row(`Spread &middot; ${esc(tier.paxRange)} pax`, "", b.spread)}
    ${b.serviceCharge > 0 ? row(`Service charge (${GRAZING.serviceChargePct}%)`, "", b.serviceCharge) : ""}
    ${b.logistics > 0
      ? row("Logistics &amp; setup",
          "Transport, sanitation, set up and pull out", b.logistics)
      : ""}
    <div class="gz-breakdown__row gz-breakdown__row--total">
      <span class="gz-breakdown__label">Total</span>
      <span class="gz-breakdown__value">${fmt(b.total)}</span>
    </div>
  `;
}

export function createGrazingBuilder(serviceKey) {
  const config = getGrazingConfig(serviceKey);

  const state = { step: 2, selectedTierIdx: null };
  let container = null;

  function mount(el) {
    container = el;
    el.addEventListener("click", handleClick);
    // Keyed by serviceKey: the table and the board are separate builders and
    // must not restore into each other.
    persistState(el, serviceKey, state);
    restoreFromOrder();
    renderStep();
  }

  /**
   * The line this builder already put in the order, if there is one.
   *
   * Adding replaces rather than appends -- a second grazing table for one
   * event is not a real order, a bigger tier is. But it used to do that
   * silently: you built a second board, tapped Continue, and the first one
   * vanished with no notice. The screen now says it is an edit, opens on
   * what you chose last time, and labels the button "Update".
   */
  function existingLine() {
    return getOrderLines().find((l) => l.service === serviceKey) ?? null;
  }

  /** Puts the builder back on the tier already in the order. */
  function restoreFromOrder() {
    if (state.selectedTierIdx !== null) return;
    const line = existingLine();
    if (!line) return;
    const idx = config.tiers.findIndex((t) => t.paxRange === line.payload?.paxRange);
    if (idx >= 0) state.selectedTierIdx = idx;
  }

  function activeTier() {
    return state.selectedTierIdx !== null ? config.tiers[state.selectedTierIdx] : null;
  }

  /**
   * Adds the chosen tier to the order.
   *
   * One spread is one line. The menu is fixed by the tier, so it travels as
   * contents rather than as priced lines, and the quantity is not editable:
   * two grazing tables is not a thing anyone orders — a bigger tier is.
   *
   * Replaces rather than appends. Unlike a tray, coming back and choosing a
   * different tier means changing your mind about the same spread, not
   * ordering a second one.
   */
  function addToOrder() {
    const t = activeTier();
    if (!t) return;
    const without = getOrderLines().filter((l) => l.service !== serviceKey);
    setOrderLines(addLine(without, {
      service: serviceKey,
      serviceLabel: config.name,
      title: `${t.paxRange} pax`,
      subtitle: config.name,
      // Through the shared module, not t.price: the Table's 10% service
      // charge is part of what it costs, and the server prices this line by
      // running the same function. ghl-inquiry.js compares the two exactly.
      unitPrice: grazingLineTotal(serviceKey, t),
      qtyEditable: false,
      contents: [...(config.menu ?? []), ...grazingCostLines(serviceKey, t)],
      payload: { serviceKey, paxRange: t.paxRange },
    }));
  }

  function renderStep() {
    container.querySelectorAll("[data-gz-panel]").forEach((p) => {
      p.hidden = Number(p.dataset.gzPanel) !== state.step;
    });
    updateStepper();
    if (state.step === 2) renderPickPanel();
  }

  // The builder is always the order's second step. Its own internal steps
  // ended when the shared checkout took over, so there is nothing left here
  // for the spine to track.
  function updateStepper() {
    const host = container.querySelector("[data-stepper]");
    drawStepper(host, STEP_BUILD, host?.dataset.stepperLabel);
  }

  function renderPickPanel() {
    const panel = container.querySelector("[data-gz-panel='2']");
    if (!panel) return;

    // Adding replaces the line already in the order, so when there is one
    // this screen is an edit and has to say so. Naming it in the kicker and
    // on the button is the difference between changing your mind and
    // watching your first choice disappear without being told.
    const editing = Boolean(existingLine());

    // The card used to keep saying "Select →" after it had been selected, so
    // the only sign anything had happened was a border colour — easy to miss,
    // and it left people tapping the same card again. It now reports its own
    // state, and aria-pressed says the same thing to a screen reader.
    const tiersHtml = config.tiers.map((t, i) => {
      const picked = state.selectedTierIdx === i;
      return `
      <button type="button" class="gz-tier-card${picked ? " is-active" : ""}"
              data-gz-tier="${i}" aria-pressed="${picked}">
        <div class="gz-tier-card__pax">${esc(t.paxRange)}</div>
        <div class="gz-tier-card__pax-label">pax</div>
        <div class="gz-tier-card__price">${fmt(t.price)}</div>
        ${grazingLogistics(serviceKey) > 0
          ? `<div class="gz-tier-card__note">+${GRAZING.serviceChargePct}% service charge &amp; ${fmt(grazingLogistics(serviceKey))} logistics</div>`
          : ""}
        <div class="gz-tier-card__cta">${picked ? "Selected ✓" : "Select →"}</div>
      </button>
    `;
    }).join("");

    // Chips, not bullets: every one of these is a two-or-three word food
    // name, and sixteen of them as a list was eight rows of mostly gap.
    const menuHtml = config.menu
      .map((item) => `<span class="item-chip">${esc(item)}</span>`)
      .join("");

    const inclusionsHtml = config.inclusions.length ? `
      <div class="gz-detail-card">
        <p class="gz-detail-card__title">Inclusions</p>
        <ul class="gz-items-list gz-items-list--flow">${config.inclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      </div>
    ` : "";

    const addonsHtml = config.addons.length ? `
      <div class="gz-detail-card">
        <p class="gz-detail-card__title">Add-ons &amp; Notes</p>
        <ul class="gz-items-list gz-items-list--muted">${config.addons.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      </div>
    ` : "";

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 4 · ${editing ? "Change your package" : "Choose your package"}</p>
          <h2>${esc(config.name)}</h2>
        </div>
      </div>

      <!-- Photo beside the sizes, not above them: a full-width band showed
           only a fifth of the Grazing Board photograph, which was taken
           upright. -->
      <div class="builder-split">
        <div class="builder-split__photo">
          ${photoHtml(grazingPhoto(serviceKey), config.name, "hero", `Sample ${config.name} setup`)}
        </div>
        <div class="builder-split__main">
          <div class="gz-tier-grid">
            ${tiersHtml}
          </div>

          <!-- Repainted in place by handleClick rather than by re-rendering
               this panel: rebuilding it replaces all three tier cards and
               restarts their entrance animation, so every tap would re-deal
               the list under the finger that just chose from it. -->
          <div class="gz-breakdown" data-gz-breakdown>${grazingBreakdownHtml(serviceKey, activeTier())}</div>

          <!-- Beside the sizes rather than below them. On its own the tier
               row is ~135px against a photo twice that, and what is on the
               table is exactly what a customer wants to read while deciding
               which size to take. -->
          <div class="gz-detail-card gz-detail-card--inline">
            <p class="gz-detail-card__title">${esc(config.menuLabel)}</p>
            <div class="item-chips">${menuHtml}</div>
          </div>
        </div>
      </div>

      ${inclusionsHtml || addonsHtml ? `
        <div class="gz-detail-grid">
          ${inclusionsHtml}
          ${addonsHtml}
        </div>
      ` : ""}

      <!-- The way out. This builder had none at all — no order bar, no
           breadcrumb, nothing: a customer who opened Grazing Table and
           changed their mind could only use the browser's back button, and
           on the GoHighLevel page that leaves the site.

           Beside Continue because that is where they already are. The
           builder is a long scroll of cards, and a control at the top would
           be several screens above somebody who has just read to the end. -->
      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>&larr; All services</button>
        <button class="primary-button" type="button" data-gz-continue${state.selectedTierIdx === null ? " disabled" : ""}>
          ${editing ? "Update your order →" : "Continue to Details →"}
        </button>
      </div>
    `;
  }

  function goStep(n) {
    setStepDirection(state.step, n);
    state.step = n;
    renderStep();
    // Ignored while a popstate is being applied, so going back does not push
    // the entry it just consumed.
    pushNav(serviceKey, n);
    jumpTo(container);
  }

  function handleClick(e) {
    const tierBtn = e.target.closest("[data-gz-tier]");
    if (tierBtn) {
      state.selectedTierIdx = Number(tierBtn.dataset.gzTier);
      // Updated in place rather than by re-rendering the panel. Rebuilding
      // innerHTML replaces all three cards with new elements, which restarts
      // their entrance animation — so every tap would have re-dealt the whole
      // list under the finger that just chose from it. Nothing here changes
      // layout, only which card is marked, so a rebuild was never needed.
      container.querySelectorAll("[data-gz-tier]").forEach((btn) => {
        const picked = Number(btn.dataset.gzTier) === state.selectedTierIdx;
        btn.classList.toggle("is-active", picked);
        btn.setAttribute("aria-pressed", String(picked));
        const cta = btn.querySelector(".gz-tier-card__cta");
        if (cta) cta.textContent = picked ? "Selected ✓" : "Select →";
      });

      // In place, for the same reason. Left out of this handler the
      // breakdown would keep showing the previously chosen tier's figures,
      // or stay empty for the whole session on a first pick.
      const breakdownEl = container.querySelector("[data-gz-breakdown]");
      if (breakdownEl) breakdownEl.innerHTML = grazingBreakdownHtml(serviceKey, activeTier());

      // On a phone the cards fill the screen and "Continue to Details" sits
      // below the fold, so picking a size looked like it did nothing at all.
      // Bringing the next step into view is the visible consequence of the
      // tap — without it there is no reason to believe the choice registered,
      // let alone any clue what to do next.
      const continueBtn = container.querySelector("[data-gz-continue]");
      if (continueBtn) {
        continueBtn.disabled = false;
        // "nearest" on purpose here, unlike a step change: this only nudges
        // the button into view if it is off screen, and does nothing at all
        // if you can already see it. Instant, so it never animates.
        jumpTo(continueBtn, "nearest");
      }
      return;
    }

    if (e.target.closest("[data-gz-continue]")) {
      if (state.selectedTierIdx === null) return;
      addToOrder();
      requestReview();
      return;
    }
  }

  return { mount, setStep: goStep };
}
