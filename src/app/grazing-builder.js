import { renderStepper as drawStepper, STEP_BUILD } from "./stepper.js";
import { getGrazingConfig } from "../data/grazing.js";
import { grazingPhoto, photoHtml } from "./menu-photos.js";
import { setStepDirection, jumpTo } from "./ui-fx.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import { addLine } from "../domain/cart.js";
import { getOrderLines, setOrderLines, requestReview } from "./order-shell.js";

function fmt(n) {
  return "PHP " + n.toLocaleString("en-PH");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
      unitPrice: t.price ?? 0,
      qtyEditable: false,
      contents: config.menu ?? [],
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

      <div class="step-nav step-nav--single">
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
