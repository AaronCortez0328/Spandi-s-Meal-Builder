import {
  getCateringPackages,
  getDishById,
  getDishPrice,
  getPackageItems,
  getReplacementDishes,
} from "../data/catering.js";
import {
  buildContactPanel,
  validateAndRead,
  attachInlineValidation,
  attachBranchDropdown,
  clearFilledErrors,
  buildInquiryText,
} from "./contact-form.js";
import { pushInquiryToGHL } from "./ghl.js";

// Sub-views within Step 1
const VIEW = { PAX: "pax", COMBO: "combo", CUSTOMIZE: "customize" };

export function createCateringBuilder() {
  const state = {
    step: 1,
    view: VIEW.PAX,       // current sub-view within step 1
    selectedPax: null,    // e.g. "15 pax"
    selectedComboId: null,
    swaps: {},
  };

  function mount(container) {
    // Don't pre-select — let the customer choose their pax first
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);
    renderStep();
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function handleClick(e) {
    // Close swap menus when clicking outside them
    if (!e.target.closest(".swap-select")) {
      closeAllSwapMenus();
    }

    // Swap dropdown: toggle open/close
    const swapTrigger = e.target.closest("[data-swap-trigger]");
    if (swapTrigger) {
      const wrap = swapTrigger.closest(".swap-select");
      const menu = wrap?.querySelector(".swap-select__menu");
      if (!menu) return;
      const isOpen = wrap.classList.contains("is-open");
      closeAllSwapMenus();
      if (!isOpen) {
        menu.hidden = false;
        wrap.classList.add("is-open");
        swapTrigger.setAttribute("aria-expanded", "true");
      }
      return;
    }

    // Swap dropdown: pick an option
    const swapOption = e.target.closest("[data-swap-option]");
    if (swapOption) {
      const wrap = swapOption.closest(".swap-select");
      if (!wrap) return;
      const key = wrap.dataset.swapSlot;
      const original = wrap.dataset.originalDish;
      const dishId = swapOption.dataset.dishId;
      if (dishId === original) delete state.swaps[key];
      else state.swaps[key] = dishId;
      closeAllSwapMenus();
      refreshQuotePanel();
      refreshSwapPrices();
      return;
    }

    // Pax group card
    const paxCard = e.target.closest("[data-pax-key]");
    if (paxCard) {
      state.selectedPax = paxCard.dataset.paxKey;
      state.view = VIEW.COMBO;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Combo card
    const comboCard = e.target.closest("[data-combo-id]");
    if (comboCard) {
      const newId = comboCard.dataset.comboId;
      if (state.selectedComboId !== newId) {
        state.selectedComboId = newId;
        state.swaps = {}; // clear swaps when picking a new combo
      }
      state.view = VIEW.CUSTOMIZE;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Back: customize → combo list
    if (e.target.closest("[data-back-to-combos]")) {
      state.view = VIEW.COMBO;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Back: combo list → pax selector
    if (e.target.closest("[data-back-to-pax]")) {
      state.view = VIEW.PAX;
      state.selectedComboId = null;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Reset swaps
    if (e.target.closest("[data-reset-combo]")) {
      resetActiveCombo();
      renderCustomizerBody();
      return;
    }

    // Step navigation
    const goStep = e.target.closest("[data-go-cat-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goCatStep, 10));
      return;
    }

    // Copy
    if (e.target.closest("[data-cat-copy]")) {
      copyOrder();
    }
  }

  function handleChange(e) {
    const select = e.target.closest("[data-swap-slot]");
    if (!select) return;
    const key = select.dataset.swapSlot;
    const original = select.dataset.originalDish;
    if (select.value === original) delete state.swaps[key];
    else state.swaps[key] = select.value;
    refreshQuotePanel();
    refreshSwapPrices();
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function getActiveCombo() {
    return getCateringPackages().find((c) => c.id === state.selectedComboId);
  }

  function getSwapKey(item) {
    return `${item.packageId}:${item.itemOrder}`;
  }

  function getSelectedDishId(item) {
    return state.swaps[getSwapKey(item)] || item.dishId;
  }

  function getPricedItems() {
    const combo = getActiveCombo();
    if (!combo) return [];
    return getPackageItems(combo.id).map((item) => {
      const selectedDishId = getSelectedDishId(item);
      const selectedDish = getDishById(selectedDishId);
      const originalPrice = getDishPrice(item.dishId, item.traySize);
      const selectedPrice = getDishPrice(selectedDishId, item.traySize);
      const priceDiff = (selectedPrice - originalPrice) * item.quantity;
      return {
        ...item,
        selectedDishId,
        selectedName: selectedDish?.name || item.displayName,
        selectedCategory: selectedDish?.category || item.category,
        originalPrice,
        selectedPrice,
        priceDiff,
        isChanged: selectedDishId !== item.dishId,
      };
    });
  }

  function getTotals() {
    const combo = getActiveCombo();
    const items = getPricedItems();
    const adjustment = items.reduce((sum, item) => sum + item.priceDiff, 0);
    return {
      base: combo?.price || 0,
      adjustment,
      total: (combo?.price || 0) + adjustment,
      changedCount: items.filter((item) => item.isChanged).length,
    };
  }

  function resetActiveCombo() {
    const combo = getActiveCombo();
    if (!combo) return;
    for (const item of getPackageItems(combo.id)) {
      delete state.swaps[getSwapKey(item)];
    }
  }

  // Returns distinct pax groups with metadata
  function getPaxGroups() {
    const map = new Map();
    for (const combo of getCateringPackages()) {
      const key = combo.paxLabel || "Other";
      if (!map.has(key)) {
        map.set(key, { label: key, combos: [], minPrice: Infinity, maxPrice: -Infinity });
      }
      const g = map.get(key);
      g.combos.push(combo);
      if (combo.price < g.minPrice) g.minPrice = combo.price;
      if (combo.price > g.maxPrice) g.maxPrice = combo.price;
    }
    return [...map.values()];
  }

  function getCombosForPax(paxKey) {
    return getCateringPackages().filter((c) => c.paxLabel === paxKey);
  }

  // ── Step control ──────────────────────────────────────────────────────────

  function setStep(step) {
    state.step = step;
    renderStep();
    document.getElementById("builder-catering")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToBody() {
    document.getElementById("cat-step1-body")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Top-level render ──────────────────────────────────────────────────────

  function renderStep() {
    document.querySelectorAll("[data-cat-panel]").forEach((p) => {
      p.hidden = p.dataset.catPanel !== String(state.step);
    });
    renderStepper();
    updatePanelHeader();
    if (state.step === 1) renderStep1Body();
    if (state.step === 2) renderReview();
    if (state.step === 3) renderContact();
  }

  function updatePanelHeader() {
    const kicker = document.getElementById("cat-step-kicker");
    const title  = document.getElementById("cat-title-1");
    if (!kicker || !title) return;

    if (state.step === 1) {
      const subtitles = {
        [VIEW.PAX]:       ["Step 2 of 4 · Choose package size", "How many guests?"],
        [VIEW.COMBO]:     [`Step 2 of 4 · ${state.selectedPax}`, "Choose a combo package"],
        [VIEW.CUSTOMIZE]: ["Step 2 of 4 · Customize your combo", "Review &amp; swap dishes"],
      };
      const [k, t] = subtitles[state.view] ?? ["Step 2 of 4", "Choose a Combo Package"];
      kicker.textContent = k;
      title.innerHTML = t;
    }
  }

  function renderStepper() {
    document.querySelectorAll(".cat-stepper__step[data-step]").forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
      const bubble = el.querySelector(".stepper__bubble");
      if (bubble) bubble.innerHTML = n < state.step ? CHECK_SVG : String(n + 1);
    });
    document.querySelectorAll(".cat-stepper__connector").forEach((c, i) => {
      c.classList.toggle("is-completed", i < state.step);
    });
  }

  // ── Sub-view router ───────────────────────────────────────────────────────

  function renderStep1Body() {
    const body = document.getElementById("cat-step1-body");
    if (!body) return;

    // Animate transition
    body.classList.remove("cat-view-fade");
    void body.offsetWidth;
    body.classList.add("cat-view-fade");

    if (state.view === VIEW.PAX)       body.innerHTML = buildPaxSelector();
    if (state.view === VIEW.COMBO)     body.innerHTML = buildComboGrid();
    if (state.view === VIEW.CUSTOMIZE) body.innerHTML = buildCustomizer();
  }

  // ── Sub-view A: Pax Selector ──────────────────────────────────────────────

  function buildPaxSelector() {
    const groups = getPaxGroups();
    return `
      <div class="pax-selector">
        <p class="pax-selector__hint">Select the group size closest to your event to see matching packages.</p>
        <div class="pax-grid">
          ${groups.map((g) => buildPaxCard(g)).join("")}
        </div>
      </div>
    `;
  }

  function buildPaxCard(group) {
    const count = group.combos.length;
    const priceRange = group.minPrice === group.maxPrice
      ? formatPeso(group.minPrice)
      : `${formatPeso(group.minPrice)} – ${formatPeso(group.maxPrice)}`;

    // Extract numeric pax from label for the big display number
    const paxNum = group.label.replace(/[^0-9\-–]/g, "").trim() || group.label;

    return `
      <button type="button" class="pax-card" data-pax-key="${esc(group.label)}">
        <div class="pax-card__num">${esc(paxNum)}</div>
        <div class="pax-card__label">guests</div>
        <div class="pax-card__divider"></div>
        <div class="pax-card__price">${esc(priceRange)}</div>
        <div class="pax-card__count">${count} package${count !== 1 ? "s" : ""} available</div>
      </button>
    `;
  }

  // ── Sub-view B: Combo Grid ────────────────────────────────────────────────

  function buildComboGrid() {
    const combos = getCombosForPax(state.selectedPax);

    // Group by tray-size tier (combo name prefix like "Family", "Feast", etc.)
    const tiers = {};
    for (const combo of combos) {
      // Use combo.group if available, otherwise derive from name prefix
      const tier = combo.group || deriveTier(combo.name);
      if (!tiers[tier]) tiers[tier] = [];
      tiers[tier].push(combo);
    }

    const tiersHtml = Object.entries(tiers).map(([tier, tierCombos]) => `
      <div class="combo-tier">
        <p class="combo-tier__label section-kicker">${esc(tier)}</p>
        <div class="combo-grid">
          ${tierCombos.map((combo) => buildComboCard(combo)).join("")}
        </div>
      </div>
    `).join("");

    return `
      <div class="combo-browser">
        <button type="button" class="cat-breadcrumb" data-back-to-pax>
          ${BACK_SVG} Change group size
        </button>
        <div class="combo-tier-list">
          ${tiersHtml}
        </div>
      </div>
    `;
  }

  function deriveTier(name) {
    const match = name.match(/^(Family|Feast|XXXL|Premium|Combo)/i);
    return match ? match[1] + " Combos" : "Packages";
  }

  function buildComboCard(combo) {
    const items = getPackageItems(combo.id);
    const preview = items.slice(0, 4);
    const isActive = combo.id === state.selectedComboId;

    return `
      <button type="button" class="combo-card${isActive ? " is-active" : ""}" data-combo-id="${esc(combo.id)}" aria-pressed="${isActive}">
        <div class="combo-card__top">
          <strong>${esc(combo.name)}</strong>
          <b>${formatPeso(combo.price)}</b>
        </div>
        <div class="combo-card__meta">
          <span>${items.length} tray slots</span>
        </div>
        <ul class="combo-card__items">
          ${preview.map((item) => `<li>${esc(formatItemLabel(item))}</li>`).join("")}
          ${items.length > 4 ? `<li class="combo-card__more">+${items.length - 4} more…</li>` : ""}
        </ul>
        <div class="combo-card__cta">
          ${isActive ? `${CHECK_SVG} Selected` : "Select →"}
        </div>
      </button>
    `;
  }

  // ── Sub-view C: Customizer ────────────────────────────────────────────────

  function buildCustomizer() {
    const combo = getActiveCombo();
    if (!combo) return `<p class="empty-state">No combo selected.</p>`;

    const items = getPricedItems();
    const totals = getTotals();

    return `
      <div class="customize-view">
        <button type="button" class="cat-breadcrumb" data-back-to-combos>
          ${BACK_SVG} Choose a different combo
        </button>

        <!-- Selected combo banner -->
        <div class="customize-banner">
          <div class="customize-banner__info">
            <p class="section-kicker">Selected combo · ${esc(state.selectedPax)}</p>
            <h3>${esc(combo.name)}</h3>
            <p class="customize-banner__note">Swap any dish below. Only the price difference is added or deducted from the base price.</p>
          </div>
          <div class="customize-banner__price">
            <span>Base price</span>
            <strong>${formatPeso(combo.price)}</strong>
          </div>
        </div>

        <!-- Two-column layout: swaps + live quote -->
        <div class="customize-layout">
          <div class="swap-list" id="cat-swap-list">
            ${items.map((item) => buildSwapRow(item)).join("")}
          </div>

          <!-- Sticky quote panel -->
          <aside class="quote-panel" id="cat-quote-panel" aria-label="Live price summary">
            <p class="section-kicker">Live Estimate</p>
            <div class="quote-panel__total" id="cat-quote-total">${formatPeso(totals.total)}</div>
            <dl class="quote-panel__lines">
              <div>
                <dt>Serves</dt>
                <dd>${esc(combo.paxLabel)}</dd>
              </div>
              <div>
                <dt>Base combo</dt>
                <dd>${formatPeso(totals.base)}</dd>
              </div>
              <div>
                <dt>Substitutions</dt>
                <dd id="cat-quote-adj">${formatSignedPeso(totals.adjustment)}</dd>
              </div>
              <div>
                <dt>Dishes changed</dt>
                <dd id="cat-quote-changed">${totals.changedCount}</dd>
              </div>
            </dl>
            <button type="button" class="text-button" data-reset-combo>Reset all dishes</button>
          </aside>
        </div>
        <div class="step-nav">
          <button class="text-button" type="button" data-back-to-combos>← Back</button>
          <button class="primary-button" type="button" data-go-cat-step="2">Review Order →</button>
        </div>
      </div>
    `;
  }

  function buildSwapRow(item) {
    const key = getSwapKey(item);
    const options = item.replaceable ? getReplacementDishes(item) : [];
    const isFixed = !item.replaceable || options.length === 0;

    const hasAdj = item.isChanged && item.priceDiff !== 0;
    const priceCell = `
      <div class="swap-row__price" id="swap-price-${esc(key)}">
        <span>${hasAdj ? "Adj." : "Incl."}</span>
        <strong>${hasAdj ? formatSignedPeso(item.priceDiff) : formatPeso(item.originalPrice * item.quantity)}</strong>
      </div>`;

    if (isFixed) {
      return `
        <article class="swap-row is-fixed" data-swap-article="${esc(key)}">
          <div class="swap-row__dish">
            <span class="swap-row__cat">${esc(item.category)}</span>
            <strong class="swap-row__name">${esc(item.displayName)}</strong>
            <span class="swap-row__size">${esc(item.traySize)} tray · ${item.quantity > 1 ? `${item.quantity}×` : "1 tray"}</span>
          </div>
          <div class="swap-row__control">
            <div class="swap-row__fixed-label">Fixed</div>
          </div>
          ${priceCell}
        </article>`;
    }

    const selectedDish = getDishById(item.selectedDishId);
    const currentName = selectedDish?.name || item.selectedName;
    const statusText = item.isChanged ? "Swapped" : "Original";
    const statusClass = item.isChanged ? "swapped" : "original";

    const menuItems = options.map((dish) => {
      const sel = dish.id === item.selectedDishId;
      return `<li class="swap-select__item${sel ? " is-selected" : ""}"
                  role="option" aria-selected="${sel}"
                  data-swap-option data-dish-id="${esc(dish.id)}">
                <span class="swap-select__item-name">${esc(dish.name)}</span>
              </li>`;
    }).join("");

    return `
      <article class="swap-row${item.isChanged ? " is-changed" : ""}" data-swap-article="${esc(key)}">
        <div class="swap-row__dish">
          <span class="swap-row__cat">${esc(item.category)}</span>
          <strong class="swap-row__name">${esc(currentName)}</strong>
          ${item.isChanged ? `<span class="swap-row__was">was: ${esc(item.displayName)}</span>` : ""}
          <span class="swap-row__size">${esc(item.traySize)} tray · ${item.quantity > 1 ? `${item.quantity}×` : "1 tray"}</span>
        </div>
        <div class="swap-row__control">
          <div class="swap-select" data-swap-slot="${esc(key)}" data-original-dish="${esc(item.dishId)}">
            <button class="swap-select__trigger" type="button" data-swap-trigger
                    aria-haspopup="listbox" aria-expanded="false">
              <span class="swap-select__label">Swap dish</span>
              <span class="swap-select__status swap-select__status--${statusClass}">${statusText}</span>
              <svg class="swap-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="swap-select__menu" role="listbox" hidden>${menuItems}</ul>
          </div>
        </div>
        ${priceCell}
      </article>`;
  }

  // ── Live swap refresh (no full re-render) ─────────────────────────────────

  function refreshQuotePanel() {
    const totals = getTotals();
    const totalEl   = document.getElementById("cat-quote-total");
    const adjEl     = document.getElementById("cat-quote-adj");
    const changedEl = document.getElementById("cat-quote-changed");
    if (totalEl)   totalEl.textContent   = formatPeso(totals.total);
    if (adjEl)     adjEl.textContent     = formatSignedPeso(totals.adjustment);
    if (changedEl) changedEl.textContent = String(totals.changedCount);
  }

  function refreshSwapPrices() {
    const items = getPricedItems();
    for (const item of items) {
      const key = getSwapKey(item);
      const priceEl = document.getElementById(`swap-price-${key}`);
      const article = document.querySelector(`[data-swap-article="${CSS.escape(key)}"]`);
      if (priceEl) {
        const hasAdj = item.isChanged && item.priceDiff !== 0;
        priceEl.innerHTML = `
          <span>${hasAdj ? "Adj." : "Incl."}</span>
          <strong>${hasAdj ? formatSignedPeso(item.priceDiff) : formatPeso(item.originalPrice * item.quantity)}</strong>
        `;
      }
      if (article) article.classList.toggle("is-changed", item.isChanged);

      // Update dropdown trigger status badge
      const sel = document.querySelector(`.swap-select[data-swap-slot="${CSS.escape(key)}"]`);
      if (sel) {
        const statusEl = sel.querySelector(".swap-select__status");
        if (statusEl) {
          statusEl.textContent = item.isChanged ? "Swapped" : "Original";
          statusEl.className = `swap-select__status swap-select__status--${item.isChanged ? "swapped" : "original"}`;
        }
        sel.querySelectorAll(".swap-select__item").forEach((opt) => {
          const isSel = opt.dataset.dishId === item.selectedDishId;
          opt.classList.toggle("is-selected", isSel);
          opt.setAttribute("aria-selected", String(isSel));
        });
      }
    }
  }

  function closeAllSwapMenus() {
    document.querySelectorAll(".swap-select.is-open").forEach((wrap) => {
      wrap.classList.remove("is-open");
      const menu    = wrap.querySelector(".swap-select__menu");
      const trigger = wrap.querySelector("[data-swap-trigger]");
      if (menu)    menu.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  // Also re-render customizer body when reset is hit
  function renderCustomizerBody() {
    const body = document.getElementById("cat-step1-body");
    if (!body) return;
    body.innerHTML = buildCustomizer();
  }

  // ── Step 2: Review ────────────────────────────────────────────────────────

  function renderReview() {
    const panel = document.querySelector("[data-cat-panel='2']");
    if (!panel) return;
    const combo = getActiveCombo();
    if (!combo) return;
    const items = getPricedItems();
    const totals = getTotals();

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 3 of 4 &middot; Review your order</p>
          <h2>Review Quote</h2>
        </div>
      </div>
      <div class="summary-body">
        <div class="summary-left">
          <div class="price-block">
            <span>Estimated Total</span>
            <strong>${formatPeso(totals.total)}</strong>
          </div>
          <div class="summary-meta">
            <div><dt>Combo</dt><dd>${esc(combo.name)}</dd></div>
            <div><dt>Serves</dt><dd>${esc(combo.paxLabel)}</dd></div>
            <div><dt>Substitutions</dt><dd>${formatSignedPeso(totals.adjustment)}</dd></div>
          </div>
        </div>
        <div class="summary-right">
          <p class="section-kicker" style="margin-bottom:10px">Final Dish List</p>
          <ul class="summary-items">
            ${items.map((item) => `
              <li>
                <span>${esc(item.traySize)}</span>
                <strong>${esc(formatSelectedItemLabel(item))}${item.isChanged ? ` <em>was ${esc(item.displayName)}</em>` : ""}</strong>
                <b>${item.isChanged ? formatSignedPeso(item.priceDiff) : "Included"}</b>
              </li>
            `).join("")}
          </ul>
        </div>
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-go-cat-step="1">← Back</button>
        <button class="primary-button" type="button" data-go-cat-step="3">Your Details →</button>
      </div>
    `;
  }

  // ── Step 3: Contact ───────────────────────────────────────────────────────

  function renderContact() {
    const panel = document.querySelector("[data-cat-panel='3']");
    if (!panel) return;
    const combo = getActiveCombo();
    if (!combo) return;
    const items = getPricedItems();
    const totals = getTotals();

    const orderLines = [
      `Package : ${combo.name}`,
      `Serves  : ${combo.paxLabel}`,
      `Base    : ${formatPeso(totals.base)}`,
      ...(totals.adjustment !== 0 ? [`Swaps   : ${formatSignedPeso(totals.adjustment)}`] : []),
      `Total   : ${formatPeso(totals.total)}`,
      "",
      "Dishes:",
      ...items.map((item) => {
        const changed = item.isChanged
          ? ` (was: ${item.displayName}, ${formatSignedPeso(item.priceDiff)})`
          : "";
        return `  • ${formatSelectedItemLabel(item)}${changed}`;
      }),
    ];

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-cat-step="2"',
      copyAttr: "data-cat-copy",
      statusId: "cat-copy-status",
      orderLines,
    });
    attachInlineValidation(panel);
    attachBranchDropdown(panel);
  }

  // ── Copy + submit to GHL ──────────────────────────────────────────────────

  async function copyOrder() {
    const { valid, values } = validateAndRead();
    if (!valid) {
      // Autofill doesn't fire input events — poll and clear any filled fields
      const panel = document.querySelector("[data-cat-panel='3']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const combo = getActiveCombo();
    if (!combo) return;
    const items = getPricedItems();
    const totals = getTotals();
    const statusEl = document.getElementById("cat-copy-status");

    const orderLines = [
      `Package : ${combo.name}`,
      `Serves  : ${combo.paxLabel}`,
      `Base    : ${formatPeso(totals.base)}`,
      ...(totals.adjustment !== 0 ? [`Swaps   : ${formatSignedPeso(totals.adjustment)}`] : []),
      `Total   : ${formatPeso(totals.total)}`,
      "",
      "Dishes:",
      ...items.map((item) => {
        const changed = item.isChanged
          ? ` (was: ${item.displayName}, ${formatSignedPeso(item.priceDiff)})`
          : "";
        return `  • ${formatSelectedItemLabel(item)}${changed}`;
      }),
    ];

    const text = buildInquiryText("Catering", orderLines, values);

    if (statusEl) statusEl.textContent = "Sending to team…";

    // Send to GHL first — clipboard is best-effort only
    try {
      await pushInquiryToGHL({
        contact: values,
        opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · Catering`,
        monetaryValue: totals.total,
        noteBody: buildGHLNote({ combo, items, totals, values }),
      });
    } catch (e) {
      console.error("GHL submission failed:", e);
      if (statusEl) statusEl.textContent = `Error: ${e.message}`;
      return;
    }

    // Try clipboard — non-fatal
    try { await navigator.clipboard.writeText(text); } catch { /* iframe blocked */ }

    // Show success screen
    const panel = document.querySelector("[data-cat-panel='3']");
    if (panel) renderSuccess(panel, { combo, totals, values });
  }

  function renderSuccess(panel, { combo, totals, values }) {
    panel.innerHTML = `
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>Inquiry Sent!</h2>
          <p>Spandi's team will reach out shortly to confirm your booking details.</p>
        </div>
        <div class="success-summary">
          <div class="success-summary__row">
            <span>Service</span>
            <strong>Combo Party Trays</strong>
          </div>
          <div class="success-summary__row">
            <span>Package</span>
            <strong>${esc(combo.name)}</strong>
          </div>
          <div class="success-summary__row">
            <span>Serves</span>
            <strong>${esc(combo.paxLabel)}</strong>
          </div>
          <div class="success-summary__row">
            <span>Estimated Total</span>
            <strong>${formatPeso(totals.total)}</strong>
          </div>
          <div class="success-summary__row">
            <span>Branch</span>
            <strong>${esc(values.branch)}</strong>
          </div>
          <div class="success-summary__row">
            <span>Contact</span>
            <strong>${esc(values.firstName)} ${esc(values.lastName)}</strong>
          </div>
        </div>
        <button class="primary-button" type="button" data-service-back>Start New Inquiry</button>
      </div>
    `;
  }

  function buildGHLNote({ combo, items, totals, values }) {
    return [
      `Branch: ${values.branch}`,
      "",
      "── ORDER DETAILS ──────────────────────────",
      `Package  : ${combo.name}`,
      `Serves   : ${combo.paxLabel}`,
      `Base     : ${formatPeso(totals.base)}`,
      ...(totals.adjustment !== 0 ? [`Swaps    : ${formatSignedPeso(totals.adjustment)}`] : []),
      `Total    : ${formatPeso(totals.total)}`,
      "",
      "── DISHES ──────────────────────────────────",
      ...items.map((item) => {
        const swap = item.isChanged ? `  [swapped from: ${item.displayName}]` : "";
        return `• ${item.traySize} — ${item.selectedName}${swap}`;
      }),
      "",
      "── CUSTOMER DETAILS ────────────────────────",
      `Name     : ${values.firstName} ${values.lastName}`,
      `Email    : ${values.email}`,
      `Phone    : ${values.phone}`,
      ...(values.eventDate ? [`Date     : ${values.eventDate}`] : []),
      ...(values.address ? [`Address  : ${values.address}`] : []),
      ...(values.note ? ["", "── EVENT NOTES ─────────────────────────────", values.note] : []),
      "",
      "────────────────────────────────────────────",
      "Submitted via Spandis Meal Builder",
    ].join("\n");
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  function formatItemLabel(item) {
    const qty = item.quantity > 1 ? `${item.quantity}× ` : "";
    return `${qty}${item.traySize} ${item.displayName}`.trim();
  }

  function formatSelectedItemLabel(item) {
    const qty = item.quantity > 1 ? `${item.quantity}× ` : "";
    return `${qty}${item.traySize} ${item.selectedName}`.trim();
  }

  function formatPeso(n) {
    return `PHP ${Number(n || 0).toLocaleString("en-PH")}`;
  }

  function formatSignedPeso(n) {
    const v = Number(n || 0);
    if (v === 0) return "PHP 0";
    return `${v > 0 ? "+" : "−"}PHP ${Math.abs(v).toLocaleString("en-PH")}`;
  }

  function formatOptionDiff(n) {
    const v = Number(n || 0);
    if (v === 0) return "included";
    return v > 0 ? `+PHP ${v.toLocaleString("en-PH")}` : `−PHP ${Math.abs(v).toLocaleString("en-PH")}`;
  }

  function esc(val) {
    return String(val ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  return { mount, refresh: renderStep };
}

// ── SVG constants ─────────────────────────────────────────────────────────────

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const BACK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
