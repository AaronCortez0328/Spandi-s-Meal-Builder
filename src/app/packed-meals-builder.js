import { getPackTypes, getPackMenuItems, getPricingTiers, getPriceForQty } from "../data/packed-meals.js";
import { updateStickyCartBar } from "./app.js";
import {
  buildContactPanel,
  validateAndRead,
  attachInlineValidation,
  attachBranchDropdown,
  clearFilledErrors,
  buildInquiryText,
} from "./contact-form.js";
import { pushInquiryToGHL } from "./ghl.js";

export function createPackedMealsBuilder() {
  const state = {
    step: 1,
    selectedPackTypeId: null,
    selectedDish: null,
    qty: 50,
    cart: [],
  };

  let nextId = 1;

  function mount(container) {
    const types = getPackTypes();
    if (types.length > 0) {
      state.selectedPackTypeId = types[0].id;
      const items = getPackMenuItems(types[0].id);
      state.selectedDish = items[0]?.name ?? null;
      state.qty = getMinQty(types[0].id);
    }
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    renderStep();
  }

  function handleClick(e) {
    if (!e.target.closest(".pm-dish-select")) {
      closePmDishDropdown();
    }

    const pmDishTrigger = e.target.closest("[data-pm-dish-trigger]");
    if (pmDishTrigger) {
      const wrap = pmDishTrigger.closest(".pm-dish-select");
      const menu = wrap?.querySelector(".swap-select__menu");
      if (!menu) return;
      const isOpen = wrap.classList.contains("is-open");
      closePmDishDropdown();
      if (!isOpen) {
        menu.hidden = false;
        wrap.classList.add("is-open");
        pmDishTrigger.setAttribute("aria-expanded", "true");
        const rect = wrap.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        wrap.classList.toggle("opens-up", spaceBelow < 260);
      }
      return;
    }

    const pmDishOption = e.target.closest("[data-pm-dish-option]");
    if (pmDishOption) {
      state.selectedDish = pmDishOption.dataset.pmDishOption;
      closePmDishDropdown();
      renderConfigPanel();
      return;
    }

    const packCard = e.target.closest("[data-pack-type]");
    if (packCard) {
      state.selectedPackTypeId = packCard.dataset.packType;
      const items = getPackMenuItems(state.selectedPackTypeId);
      state.selectedDish = items[0]?.name ?? null;
      state.qty = getMinQty(state.selectedPackTypeId);
      renderPackTypes();
      renderConfigPanel();
      return;
    }

    const goStep = e.target.closest("[data-go-pm-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goPmStep, 10));
      return;
    }

    if (e.target.closest("[data-pm-add]")) {
      addToCart();
      return;
    }

    const removeBtn = e.target.closest("[data-pm-remove]");
    if (removeBtn) {
      const id = parseInt(removeBtn.dataset.pmRemove, 10);
      state.cart = state.cart.filter((i) => i.id !== id);
      renderCart();
      return;
    }

    const pmCopyBtn = e.target.closest("[data-pm-copy]");
    if (pmCopyBtn) {
      copyOrder(pmCopyBtn);
      return;
    }
  }

  function closePmDishDropdown() {
    const wrap = document.querySelector(".pm-dish-select");
    const menu = wrap?.querySelector(".swap-select__menu");
    if (!menu) return;
    menu.hidden = true;
    wrap.classList.remove("is-open", "opens-up");
    wrap.querySelector("[data-pm-dish-trigger]")?.setAttribute("aria-expanded", "false");
  }

  function handleInput(e) {
    if (e.target.id === "pm-qty-input") {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1) {
        state.qty = v;
        updateConfigPricing();
      }
    }
  }

  function getMinQty(packTypeId) {
    const tiers = getPricingTiers(packTypeId);
    return tiers.length > 0 ? tiers[tiers.length - 1].minQty : 10;
  }

  function addToCart() {
    if (!state.selectedDish || !state.selectedPackTypeId) return;
    const dish = state.selectedDish;
    const pt = getPackTypes().find((p) => p.id === state.selectedPackTypeId);
    const unitPrice = getPriceForQty(state.selectedPackTypeId, state.qty);
    state.cart.push({
      id: nextId++,
      packTypeId: state.selectedPackTypeId,
      packTypeName: pt?.name ?? state.selectedPackTypeId,
      dish,
      qty: state.qty,
      unitPrice,
    });
    renderCart();
    const cartEl = document.getElementById("pm-cart-section");
    if (cartEl) {
      cartEl.classList.add("cart-flash");
      setTimeout(() => cartEl.classList.remove("cart-flash"), 400);
    }
  }

  function setStep(step) {
    state.step = step;
    renderStep();
    document.getElementById("builder-packed-meals")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderStep() {
    document.querySelectorAll("[data-pm-panel]").forEach((p) => {
      p.hidden = p.dataset.pmPanel !== String(state.step);
    });
    renderStepper();
    if (state.step === 1) {
      renderPackTypes();
      renderConfigPanel();
      renderCart();
    } else if (state.step === 2) {
      renderReview();
    } else if (state.step === 3) {
      renderContact();
    }
  }

  function renderStepper() {
    document.querySelectorAll(".pm-stepper__step[data-step]").forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
      const bubble = el.querySelector(".stepper__bubble");
      if (bubble) bubble.innerHTML = n < state.step ? CHECK_SVG : String(n + 1);
    });
    document.querySelectorAll(".pm-stepper__connector").forEach((c, i) => {
      c.classList.toggle("is-completed", i < state.step);
    });
  }

  function renderPackTypes() {
    const list = document.getElementById("pm-pack-type-list");
    if (!list) return;
    const types = getPackTypes();
    list.replaceChildren(
      ...types.map((pt) => {
        const isActive = pt.active !== false;
        const tiers = getPricingTiers(pt.id);
        const minP = tiers.length > 0 ? tiers[tiers.length - 1].price : 0;
        const maxP = tiers.length > 0 ? tiers[0].price : 0;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pack-type-card"
          + (pt.id === state.selectedPackTypeId ? " is-active" : "")
          + (isActive ? "" : " service-card--disabled");
        if (isActive) {
          btn.dataset.packType = pt.id;
        } else {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
        }
        btn.innerHTML = `
          <strong>${esc(pt.name)}</strong>
          ${isActive
            ? `<span class="pack-type-price">${formatPeso(minP)}–${formatPeso(maxP)} / pc</span>`
            : `<span class="badge badge--soon">Currently Not Available</span>`}
          <small>${esc(pt.description)}</small>
        `;
        return btn;
      })
    );
  }

  function renderConfigPanel() {
    const panel = document.getElementById("pm-config-panel");
    if (!panel || !state.selectedPackTypeId) return;

    const items = getPackMenuItems(state.selectedPackTypeId);
    const tiers = getPricingTiers(state.selectedPackTypeId);
    const minQty = tiers.length > 0 ? tiers[tiers.length - 1].minQty : 1;
    const unitPrice = getPriceForQty(state.selectedPackTypeId, state.qty);
    const total = unitPrice * state.qty;

    // Group items by category
    const grouped = {};
    for (const item of items) {
      const cat = item.category || "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item.name);
    }

    panel.innerHTML = `
      <div class="config-panel__inner">
        <div class="form-group">
          <label id="pm-dish-label">Choose meal</label>
          <div class="pm-dish-select swap-select" aria-labelledby="pm-dish-label">
            <button type="button" class="swap-select__trigger" data-pm-dish-trigger aria-expanded="false" aria-haspopup="listbox">
              <span class="swap-select__label">${esc(state.selectedDish ?? "Select a dish")}</span>
              <svg class="swap-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="swap-select__menu" hidden role="listbox">
              ${Object.entries(grouped).map(([cat, dishes]) => `
                <li class="swap-select__group-label" role="presentation">${esc(cat)}</li>
                ${dishes.map((d) => `
                  <li class="swap-select__item${d === state.selectedDish ? " is-selected" : ""}"
                    data-pm-dish-option="${esc(d)}"
                    role="option"
                    aria-selected="${d === state.selectedDish}">
                    <span class="swap-select__item-name">${esc(d)}</span>
                  </li>
                `).join("")}
              `).join("")}
            </ul>
          </div>
        </div>
        <div class="form-group">
          <label for="pm-qty-input">
            Quantity <span class="muted-text">(min ${minQty} pcs)</span>
          </label>
          <div class="pax-input-row" style="margin-top:0">
            <input type="number" id="pm-qty-input" class="pax-input"
              value="${state.qty}" min="${minQty}" max="9999">
            <span class="pax-unit">pieces</span>
          </div>
        </div>
        <div class="config-panel__footer">
          <div class="price-chip">
            <span>Total (${state.qty} × ${formatPeso(unitPrice)})</span>
            <strong id="pm-total-display">${formatPeso(total)}</strong>
          </div>
          <button type="button" class="primary-button" data-pm-add>Add to Order</button>
        </div>
      </div>
      <div class="pricing-tiers-panel">
        <p class="section-kicker" style="margin-bottom:8px">Pricing Tiers</p>
        ${tiers.map((tier, i) => {
          const isActive = state.qty >= tier.minQty && (i === 0 || state.qty < tiers[i - 1].minQty);
          return `<div class="tier-row${isActive ? " is-active" : ""}">
            <span>${tier.minQty}+ pcs</span>
            <strong>${formatPeso(tier.price)}/pc</strong>
          </div>`;
        }).join("")}
      </div>
    `;
  }

  function updateConfigPricing() {
    if (!state.selectedPackTypeId) return;
    const unitPrice = getPriceForQty(state.selectedPackTypeId, state.qty);
    const total = unitPrice * state.qty;

    const totalEl = document.getElementById("pm-total-display");
    if (totalEl) totalEl.textContent = formatPeso(total);

    const totalLabelEl = totalEl?.previousElementSibling;
    if (totalLabelEl) totalLabelEl.textContent = `Total (${state.qty} × ${formatPeso(unitPrice)})`;

    const tiers = getPricingTiers(state.selectedPackTypeId);
    document.querySelectorAll(".tier-row").forEach((row, i) => {
      const tier = tiers[i];
      const isActive = tier && state.qty >= tier.minQty && (i === 0 || state.qty < tiers[i - 1].minQty);
      row.classList.toggle("is-active", !!isActive);
    });
  }

  function renderCart() {
    const section = document.getElementById("pm-cart-section");
    if (!section) return;

    if (state.cart.length === 0) {
      section.innerHTML = `
        <p class="section-kicker">Your Order</p>
        <p class="empty-state">No items yet. Choose a pack type, select a meal, set quantity, then tap Add to Order.</p>
        <div class="running-total-bar">
          <button class="text-button" type="button" data-service-back>← Services</button>
          <div class="running-total-bar__info">
            <span class="running-total-bar__label">Running total</span>
            <span class="running-total-bar__amount running-total-bar__amount--empty">&mdash;</span>
            <span class="running-total-bar__serves">Add items to see estimate</span>
          </div>
          <button class="primary-button" type="button" disabled aria-disabled="true">Review Quote &rarr;</button>
        </div>
      `;
      updateStickyCartBar(0, "");
      return;
    }

    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const totalPeople = state.cart.reduce((s, i) => s + i.qty, 0);
    updateStickyCartBar(state.cart.length, formatPeso(total));
    section.innerHTML = `
      <p class="section-kicker">Your Order &middot; ${state.cart.length} item${state.cart.length !== 1 ? "s" : ""}</p>
      <ul class="cart-list">
        ${state.cart.map((item) => `
          <li class="cart-item">
            <div class="cart-item__info">
              <strong>${esc(item.dish)}</strong>
              <span>${esc(item.packTypeName)} &middot; ${formatPeso(item.unitPrice)}/pc</span>
            </div>
            <div class="cart-item__qty">${item.qty}&times;</div>
            <div class="cart-item__price">${formatPeso(item.unitPrice * item.qty)}</div>
            <button type="button" class="remove-btn" data-pm-remove="${item.id}" aria-label="Remove ${esc(item.dish)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </li>
        `).join("")}
      </ul>
      <div class="running-total-bar">
        <button class="text-button" type="button" data-service-back>← Services</button>
        <div class="running-total-bar__info">
          <span class="running-total-bar__label">Running total</span>
          <span class="running-total-bar__amount">${formatPeso(total)}</span>
          <span class="running-total-bar__serves">Feeds ${totalPeople} guest${totalPeople !== 1 ? "s" : ""}</span>
        </div>
        <button class="primary-button" type="button" data-go-pm-step="2">Review Quote &rarr;</button>
      </div>
    `;
  }

  function renderReview() {
    const panel = document.querySelector("[data-pm-panel='2']");
    if (!panel) return;
    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
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
            <strong>${formatPeso(total)}</strong>
          </div>
          <div class="summary-meta">
            <div><dt>Total pieces</dt><dd>${state.cart.reduce((n, i) => n + i.qty, 0)} pcs</dd></div>
            <div><dt>Line items</dt><dd>${state.cart.length}</dd></div>
          </div>
        </div>
        <div class="summary-right">
          <p class="section-kicker" style="margin-bottom:10px">Order Details</p>
          <ol class="summary-items">
            ${state.cart.map((item) => `
              <li>
                <span>${item.qty}× ${esc(item.packTypeName)}</span>
                <strong>${esc(item.dish)}</strong>
                <b>${formatPeso(item.unitPrice * item.qty)}</b>
              </li>
            `).join("")}
          </ol>
        </div>
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-go-pm-step="1">← Back</button>
        <button class="primary-button" type="button" data-go-pm-step="3">Your Details →</button>
      </div>
    `;
  }

  function renderContact() {
    const panel = document.querySelector("[data-pm-panel='3']");
    if (!panel) return;
    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);

    const orderLines = [
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.packTypeName} — ${item.dish} — ${formatPeso(item.unitPrice)}/pc = ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total: ${formatPeso(total)}`,
    ];

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-pm-step="2"',
      copyAttr: "data-pm-copy",
      statusId: "pm-copy-status",
      orderLines,
    });
    attachInlineValidation(panel);
    attachBranchDropdown(panel);
  }

  async function copyOrder(btn) {
    const { valid, values } = validateAndRead();
    if (!valid) {
      const panel = document.querySelector("[data-pm-panel='3']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const totalPieces = state.cart.reduce((s, i) => s + i.qty, 0);
    const statusEl = document.getElementById("pm-copy-status");

    const orderLines = [
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.packTypeName} — ${item.dish} — ${formatPeso(item.unitPrice)}/pc = ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total: ${formatPeso(total)}`,
    ];

    const noteBody = [
      `Branch: ${values.branch}`,
      "",
      "── ORDER DETAILS ──────────────────────────",
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.packTypeName} — ${item.dish} — ${formatPeso(item.unitPrice)}/pc = ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total    : ${formatPeso(total)}`,
      "",
      "── CUSTOMER DETAILS ────────────────────────",
      `Name     : ${values.firstName} ${values.lastName}`,
      `Email    : ${values.email}`,
      `Phone    : ${values.phone}`,
      ...(values.eventDate ? [`Date     : ${values.eventDate}${values.eventTime ? ` at ${values.eventTime}` : ""}`] : []),
      ...(values.address   ? [`Address  : ${values.address}`]   : []),
      ...(values.note      ? ["", "── EVENT NOTES ─────────────────────────────", values.note] : []),
      "",
      "────────────────────────────────────────────",
      "Submitted via Spandis Meal Builder",
    ].join("\n");

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }

    try {
      await pushInquiryToGHL({
        contact: values,
        opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · Packed Meals`,
        monetaryValue: total,
        noteBody,
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type:    "Packed Meals",
          branch:          values.branch,
          event_date:      values.eventDate,
          event_time:      values.eventTime,
          pax_count:       `${totalPieces} piece${totalPieces !== 1 ? "s" : ""}`,
          base_price:      formatPeso(total),
          dishes_selected: state.cart.map((item) =>
            `• ${item.qty}× ${item.packTypeName} — ${item.dish} — ${formatPeso(item.unitPrice)}/pc`
          ).join("\n"),
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

    const text = buildInquiryText("Packed Meals", orderLines, values);
    try { await navigator.clipboard.writeText(text); } catch { /* iframe blocked */ }

    const panel = document.querySelector("[data-pm-panel='3']");
    if (panel) renderSuccess(panel, { total, totalPieces, values });
  }

  function renderSuccess(panel, { total, totalPieces, values }) {
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
            <strong>Packed Meals</strong>
          </div>
          <div class="success-summary__row">
            <span>Total Pieces</span>
            <strong>${totalPieces} piece${totalPieces !== 1 ? "s" : ""}</strong>
          </div>
          <div class="success-summary__row">
            <span>Estimated Total</span>
            <strong>${formatPeso(total)}</strong>
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

  function formatPeso(n) {
    if (!n) return "—";
    return `PHP ${Number(n).toLocaleString("en-PH")}`;
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

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
