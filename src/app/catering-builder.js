import {
  getCateringPackages,
  getDishById,
  getPackageItems,
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
  };

  function mount(container) {
    // Don't pre-select — let the customer choose their pax first
    container.addEventListener("click", handleClick);
    renderStep();
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function handleClick(e) {
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
      state.selectedComboId = comboCard.dataset.comboId;
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

    // Step navigation
    const goStep = e.target.closest("[data-go-cat-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goCatStep, 10));
      return;
    }

    // Copy
    const copyBtn = e.target.closest("[data-cat-copy]");
    if (copyBtn) {
      copyOrder(copyBtn);
    }
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function getActiveCombo() {
    return getCateringPackages().find((c) => c.id === state.selectedComboId);
  }

  // Combos are fixed — dishes can't be changed. selectedName resolves the
  // canonical dish name from the dishes sheet, falling back to the package
  // row's display name.
  function getPricedItems() {
    const combo = getActiveCombo();
    if (!combo) return [];
    return getPackageItems(combo.id).map((item) => ({
      ...item,
      selectedName: getDishById(item.dishId)?.name || item.displayName,
    }));
  }

  function getTotals() {
    const combo = getActiveCombo();
    return {
      base: combo?.price || 0,
      total: combo?.price || 0,
    };
  }

  // Returns distinct pax groups with metadata
  function getPaxGroups() {
    const map = new Map();
    for (const combo of getCateringPackages()) {
      const key = combo.paxLabel || "Other";
      if (!map.has(key)) {
        map.set(key, { label: key, combos: [], minPrice: Infinity, maxPrice: -Infinity, isSpecial: false });
      }
      const g = map.get(key);
      g.combos.push(combo);
      if (combo.price < g.minPrice) g.minPrice = combo.price;
      if (combo.price > g.maxPrice) g.maxPrice = combo.price;
      if (combo.group === "Special Package") g.isSpecial = true;
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
        [VIEW.CUSTOMIZE]: ["Step 2 of 4 · Your combo", "Review your dishes"],
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
    const groups  = getPaxGroups();
    const regular = groups.filter(g => !g.isSpecial);
    const special = groups.filter(g => g.isSpecial);

    return `
      <div class="pax-selector">
        <p class="pax-selector__hint">Select the group size closest to your event to see matching packages.</p>
        <div class="pax-grid">
          ${regular.map(g => buildPaxCard(g)).join("")}
        </div>
        ${special.length > 0 ? `
          <div class="pax-special-header">
            <div class="pax-special-header__line"></div>
            <div class="pax-special-header__label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Limited Time Offer
            </div>
            <div class="pax-special-header__line"></div>
          </div>
          <div class="pax-grid pax-grid--special">
            ${special.map(g => buildPaxCard(g, true)).join("")}
          </div>
        ` : ""}
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>← Services</button>
      </div>
    `;
  }

  function buildPaxCard(group, isSpecial = false) {
    const count = group.combos.length;
    const priceRange = group.minPrice === group.maxPrice
      ? formatPeso(group.minPrice)
      : `${formatPeso(group.minPrice)} – ${formatPeso(group.maxPrice)}`;

    const paxNum = group.label.replace(/[^0-9\-–]/g, "").trim() || group.label;

    return `
      <button type="button" class="pax-card${isSpecial ? " pax-card--special" : ""}" data-pax-key="${esc(group.label)}">
        ${isSpecial ? `<div class="pax-card__offer-tag">Limited Time</div>` : ""}
        <div class="pax-card__num">${esc(paxNum)}</div>
        <div class="pax-card__label">pax</div>
        <div class="pax-card__divider"></div>
        <div class="pax-card__price">${esc(priceRange)}</div>
        <div class="pax-card__count">${count} package${count !== 1 ? "s" : ""}</div>
        <div class="pax-card__cta">Select →</div>
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
        <div class="combo-tier-list">
          ${tiersHtml}
        </div>
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-back-to-pax>← Change group size</button>
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

        <!-- Selected combo banner -->
        <div class="customize-banner">
          <div class="customize-banner__info">
            <p class="section-kicker">Selected combo · ${esc(state.selectedPax)}</p>
            <h3>${esc(combo.name)}</h3>
            <p class="customize-banner__note">Party Tray combos are fixed and cannot be changed or tweaked.</p>
          </div>
          <div class="customize-banner__price">
            <span>Package price</span>
            <strong>${formatPeso(combo.price)}</strong>
          </div>
        </div>

        <!-- Two-column layout: dishes + live quote -->
        <div class="customize-layout">
          <div class="swap-list" id="cat-swap-list">
            ${items.map((item) => buildSwapRow(item)).join("")}
          </div>

          <!-- Sticky quote panel -->
          <aside class="quote-panel" id="cat-quote-panel" aria-label="Price summary">
            <p class="section-kicker">Price Summary</p>
            <div class="quote-panel__total" id="cat-quote-total">${formatPeso(totals.total)}</div>
            <dl class="quote-panel__lines">
              <div>
                <dt>Serves</dt>
                <dd>${esc(combo.paxLabel)}</dd>
              </div>
              <div>
                <dt>Package total</dt>
                <dd>${formatPeso(totals.base)}</dd>
              </div>
            </dl>
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
    return `
      <article class="swap-row is-fixed">
        <div class="swap-row__dish">
          <span class="swap-row__cat">${esc(item.category)}</span>
          <strong class="swap-row__name">${esc(item.displayName)}</strong>
          <span class="swap-row__size">${esc(item.traySize)} tray · ${item.quantity > 1 ? `${item.quantity}×` : "1 tray"}</span>
        </div>
        <div class="swap-row__included">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Included</span>
        </div>
      </article>`;
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
          </div>
        </div>
        <div class="summary-right">
          <p class="section-kicker" style="margin-bottom:10px">Final Dish List</p>
          <ul class="summary-items">
            ${items.map((item) => `
              <li>
                <span>${esc(item.traySize)}</span>
                <strong>${esc(formatSelectedItemLabel(item))}</strong>
                <b>Included</b>
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
      `Total   : ${formatPeso(totals.total)}`,
      "",
      "Dishes:",
      ...items.map((item) => `  • ${formatSelectedItemLabel(item)}`),
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

  async function copyOrder(btn) {
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
      `Total   : ${formatPeso(totals.total)}`,
      "",
      "Dishes:",
      ...items.map((item) => `  • ${formatSelectedItemLabel(item)}`),
    ];

    const text = buildInquiryText("Catering", orderLines, values);

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }

    // Send to GHL first — clipboard is best-effort only
    try {
      await pushInquiryToGHL({
        contact: values,
        opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · Catering`,
        monetaryValue: totals.total,
        noteBody: buildGHLNote({ combo, items, totals, values }),
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type:     "Catering",
          branch:           values.branch,
          event_date:       values.eventDate,
          event_time:       values.eventTime,
          package_name:     combo.name,
          pax_count:        combo.paxLabel,
          base_price:       formatPeso(totals.base),
          // Combos are fixed — kept as empty strings so the GHL field
          // contract is unchanged (fields exist from the swap-era schema).
          price_adjustment: "",
          swaps_count:      "",
          dishes_selected:  items.map((item) => `• ${item.traySize} — ${item.selectedName}`).join("\n"),
          event_notes: values.note,
        },
      });
    } catch (e) {
      console.error("GHL submission failed:", e);
      if (statusEl) statusEl.textContent = `Error: ${e.message}`;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHTML;
      }
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
            <span>Name</span>
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
      `Total    : ${formatPeso(totals.total)}`,
      "",
      "── DISHES ──────────────────────────────────",
      ...items.map((item) => `• ${item.traySize} — ${item.selectedName}`),
      "",
      "── CUSTOMER DETAILS ────────────────────────",
      `Name     : ${values.firstName} ${values.lastName}`,
      `Email    : ${values.email}`,
      `Phone    : ${values.phone}`,
      ...(values.eventDate ? [`Date     : ${values.eventDate}${values.eventTime ? ` at ${values.eventTime}` : ""}`] : []),
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
