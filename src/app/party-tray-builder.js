import { TRAY_SIZES, getCategories, getMenuItems, getCategoryPrice } from "../data/party-trays.js";
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

export function createPartyTrayBuilder() {
  const state = {
    step: 1,
    selectedCategory: null,
    selectedDish: null,
    qty: 1,
    selectedSize: "family",
    cart: [],
  };

  let nextItemId = 1;

  function mount(container) {
    const cats = getCategories();
    if (cats.length > 0) {
      state.selectedCategory = cats[0];
      state.selectedDish = getMenuItems(cats[0])[0] ?? null;
    }
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    renderStep();
  }

  function handleClick(e) {
    if (!e.target.closest(".pt-dish-select")) {
      closeDishDropdown();
    }

    const dishTrigger = e.target.closest("[data-dish-trigger]");
    if (dishTrigger) {
      const wrap = dishTrigger.closest(".pt-dish-select");
      const menu = wrap?.querySelector(".swap-select__menu");
      if (!menu) return;
      const isOpen = wrap.classList.contains("is-open");
      closeDishDropdown();
      if (!isOpen) {
        menu.hidden = false;
        wrap.classList.add("is-open");
        dishTrigger.setAttribute("aria-expanded", "true");
        const rect = wrap.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        wrap.classList.toggle("opens-up", spaceBelow < 260);
      }
      return;
    }

    const dishOption = e.target.closest("[data-dish-option]");
    if (dishOption) {
      state.selectedDish = dishOption.dataset.dishOption;
      closeDishDropdown();
      renderDishArea();
      return;
    }

    const catBtn = e.target.closest("[data-category]");
    if (catBtn) {
      state.selectedCategory = catBtn.dataset.category;
      state.selectedDish = getMenuItems(state.selectedCategory)[0] ?? null;
      renderCategories();
      renderDishArea();
      return;
    }

    const sizeBtn = e.target.closest("[data-select-size]");
    if (sizeBtn) {
      state.selectedSize = sizeBtn.dataset.selectSize;
      renderDishArea();
      return;
    }

    const reviewRemove = e.target.closest("[data-review-remove]");
    if (reviewRemove) {
      const id = parseInt(reviewRemove.dataset.reviewRemove, 10);
      state.cart = state.cart.filter((i) => i.id !== id);
      renderReview();
      return;
    }

    const reviewQtyDec = e.target.closest("[data-review-qty-dec]");
    if (reviewQtyDec) {
      const id = parseInt(reviewQtyDec.dataset.reviewQtyDec, 10);
      const item = state.cart.find((i) => i.id === id);
      if (item && item.qty > 1) { item.qty--; renderReview(); }
      return;
    }

    const reviewQtyInc = e.target.closest("[data-review-qty-inc]");
    if (reviewQtyInc) {
      const id = parseInt(reviewQtyInc.dataset.reviewQtyInc, 10);
      const item = state.cart.find((i) => i.id === id);
      if (item) { item.qty = Math.min(99, item.qty + 1); renderReview(); }
      return;
    }

    const reviewSizeBtn = e.target.closest("[data-review-size]");
    if (reviewSizeBtn) {
      const id = parseInt(reviewSizeBtn.dataset.reviewSize, 10);
      const newSize = reviewSizeBtn.dataset.size;
      const item = state.cart.find((i) => i.id === id);
      const trayInfo = TRAY_SIZES.find((t) => t.id === newSize);
      if (item && trayInfo) {
        item.traySize = newSize;
        item.traySizeLabel = trayInfo.label;
        item.traySizeDesc = trayInfo.desc;
        item.unitPrice = getCategoryPrice(item.category, newSize);
        renderReview();
      }
      return;
    }

    if (e.target.closest("[data-qty-dec]")) {
      state.qty = Math.max(1, state.qty - 1);
      renderDishArea();
      return;
    }

    if (e.target.closest("[data-qty-inc]")) {
      state.qty = Math.min(99, state.qty + 1);
      renderDishArea();
      return;
    }

    if (e.target.closest("[data-add-to-cart]")) {
      addToCart();
      return;
    }

    const removeBtn = e.target.closest("[data-remove-cart]");
    if (removeBtn) {
      const id = parseInt(removeBtn.dataset.removeCart, 10);
      state.cart = state.cart.filter((item) => item.id !== id);
      renderCart();
      return;
    }

    const goStep = e.target.closest("[data-go-pt-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goPtStep, 10));
      return;
    }

    const ptCopyBtn = e.target.closest("[data-pt-copy]");
    if (ptCopyBtn) {
      copyOrder(ptCopyBtn);
      return;
    }
  }

  function closeDishDropdown() {
    const wrap = document.querySelector(".pt-dish-select");
    const menu = wrap?.querySelector(".swap-select__menu");
    if (!menu) return;
    menu.hidden = true;
    wrap.classList.remove("is-open", "opens-up");
    wrap.querySelector("[data-dish-trigger]")?.setAttribute("aria-expanded", "false");
  }

  function handleInput(e) {
    if (e.target.id === "pt-qty-input") {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1) state.qty = Math.min(99, v);
    }
  }

  function addToCart() {
    if (!state.selectedDish || !state.selectedCategory) return;
    const sizeId = state.selectedSize;
    const unitPrice = getCategoryPrice(state.selectedCategory, sizeId);
    const trayInfo = TRAY_SIZES.find((t) => t.id === sizeId);
    state.cart.push({
      id: nextItemId++,
      category: state.selectedCategory,
      dish: state.selectedDish,
      traySize: sizeId,
      traySizeLabel: trayInfo.label,
      traySizeDesc: trayInfo.desc,
      unitPrice,
      qty: state.qty,
    });
    state.qty = 1;
    renderCart();
    const cartEl = document.getElementById("pt-cart-section");
    if (cartEl) {
      cartEl.classList.add("cart-flash");
      setTimeout(() => cartEl.classList.remove("cart-flash"), 400);
    }
  }

  function setStep(step) {
    state.step = step;
    renderStep();
    document.getElementById("builder-party-trays")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function getTotal() {
    return state.cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }

  function getTotalForSize(sizeId) {
    return state.cart.reduce((sum, item) => {
      return sum + getCategoryPrice(item.category, sizeId) * item.qty;
    }, 0);
  }

  function switchAllToSize(sizeId) {
    const trayInfo = TRAY_SIZES.find((t) => t.id === sizeId);
    if (!trayInfo) return;
    state.cart.forEach((item) => {
      item.traySize = sizeId;
      item.traySizeLabel = trayInfo.label;
      item.traySizeDesc = trayInfo.desc;
      item.unitPrice = getCategoryPrice(item.category, sizeId);
    });
    renderCart();
  }

  function getUniformSize() {
    if (state.cart.length === 0) return null;
    const first = state.cart[0].traySize;
    return state.cart.every((item) => item.traySize === first) ? first : null;
  }

  function renderStep() {
    document.querySelectorAll("[data-pt-panel]").forEach((p) => {
      p.hidden = p.dataset.ptPanel !== String(state.step);
    });
    renderStepper();
    if (state.step === 1) {
      renderCategories();
      renderDishArea();
      renderCart();
    } else if (state.step === 2) {
      renderReview();
    } else if (state.step === 3) {
      renderContact();
    }
  }

  function renderStepper() {
    document.querySelectorAll(".pt-stepper__step[data-step]").forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
      const bubble = el.querySelector(".stepper__bubble");
      if (bubble) bubble.innerHTML = n < state.step ? CHECK_SVG : String(n + 1);
    });
    document.querySelectorAll(".pt-stepper__connector").forEach((c, i) => {
      c.classList.toggle("is-completed", i < state.step);
    });
  }

  function renderCategories() {
    const container = document.getElementById("pt-category-tabs");
    if (!container) return;
    container.replaceChildren(
      ...getCategories().map((cat) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.category = cat;
        btn.className = "category-tab" + (cat === state.selectedCategory ? " is-active" : "");
        btn.textContent = cat;
        return btn;
      })
    );
  }

  function patchDishArea() {
    if (!state.selectedCategory) return;
    const dishes = getMenuItems(state.selectedCategory);
    const fromPrice = getCategoryPrice(state.selectedCategory, "family");
    const fromTotal = fromPrice * state.qty;

    const catLabel = document.querySelector(".pt-dish-row .swap-row__cat");
    if (catLabel) catLabel.textContent = state.selectedCategory;

    const dropLabel = document.querySelector(".pt-dish-select .swap-select__label");
    if (dropLabel) dropLabel.textContent = state.selectedDish ?? "Select a dish";

    const menu = document.querySelector(".pt-dish-select .swap-select__menu");
    if (menu) {
      menu.innerHTML = dishes.map(d => `
        <li class="swap-select__item${d === state.selectedDish ? " is-selected" : ""}"
          data-dish-option="${esc(d)}" role="option" aria-selected="${d === state.selectedDish}">
          <span class="swap-select__item-name">${esc(d)}</span>
        </li>
      `).join("");
    }

    const chips = document.querySelectorAll(".pt-dish-row .price-chip strong");
    if (chips[0]) chips[0].textContent = `PHP ${Number(fromPrice).toLocaleString("en-PH")}`;
    if (chips[1]) chips[1].textContent = `PHP ${Number(fromTotal).toLocaleString("en-PH")}`;
  }

  function renderDishArea() {
    const dishArea = document.getElementById("pt-dish-area");
    if (!dishArea || !state.selectedCategory) return;

    const dishes = getMenuItems(state.selectedCategory);
    const price = getCategoryPrice(state.selectedCategory, state.selectedSize);
    const subtotal = price * state.qty;

    dishArea.classList.remove("is-animating");
    void dishArea.offsetWidth;
    dishArea.classList.add("is-animating");

    dishArea.innerHTML = `
      <div class="pt-dish-row">
        <div class="pt-dish-row__select">
          <span class="swap-row__cat">${esc(state.selectedCategory)}</span>
          <div class="pt-dish-select swap-select">
            <button type="button" class="swap-select__trigger" data-dish-trigger aria-expanded="false" aria-haspopup="listbox">
              <span class="swap-select__label">${esc(state.selectedDish ?? "Select a dish")}</span>
              <svg class="swap-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="swap-select__menu" hidden role="listbox">
              ${dishes.map(d => `
                <li class="swap-select__item${d === state.selectedDish ? " is-selected" : ""}"
                  data-dish-option="${esc(d)}"
                  role="option"
                  aria-selected="${d === state.selectedDish}">
                  <span class="swap-select__item-name">${esc(d)}</span>
                </li>
              `).join("")}
            </ul>
          </div>
          <div class="pt-size-picker">
            ${TRAY_SIZES.map(s => `
              <button type="button"
                class="pt-size-btn${state.selectedSize === s.id ? " is-active" : ""}"
                data-select-size="${s.id}"
                aria-pressed="${state.selectedSize === s.id}">
                <span class="pt-size-btn__label">${esc(s.label)}</span>
                <span class="pt-size-btn__desc">${esc(s.desc)}</span>
              </button>
            `).join("")}
          </div>
        </div>
        <div class="pt-dish-row__actions">
          <div class="price-chip">
            <span>Price</span>
            <strong>${formatPeso(price)}</strong>
          </div>
          <div class="qty-control">
            <button type="button" class="qty-btn" data-qty-dec aria-label="Decrease quantity">−</button>
            <input type="number" id="pt-qty-input" class="qty-input" value="${state.qty}" min="1" max="99" aria-label="Quantity">
            <button type="button" class="qty-btn" data-qty-inc aria-label="Increase quantity">+</button>
          </div>
          <div class="price-chip">
            <span>Subtotal</span>
            <strong>${formatPeso(subtotal)}</strong>
          </div>
          <button type="button" class="primary-button" data-add-to-cart>Add to Order</button>
        </div>
      </div>
    `;
  }

  function renderCart() {
    const section = document.getElementById("pt-cart-section");
    if (!section) return;

    if (state.cart.length === 0) {
      section.innerHTML = `
        <p class="section-kicker">Your Order</p>
        <p class="empty-state">No items yet. Choose a category, pick a dish, then tap Add to Order. You can adjust tray sizes after adding.</p>
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

    const total = getTotal();
    updateStickyCartBar(state.cart.length, formatPeso(total));
    section.innerHTML = `
      <p class="section-kicker">Your Order &middot; ${state.cart.length} item${state.cart.length !== 1 ? "s" : ""}</p>
      <ul class="cart-list">
        ${state.cart.map((item) => `
          <li class="cart-item">
            <div class="cart-item__info">
              <strong>${esc(item.dish)}</strong>
              <span>${esc(item.category)} &middot; ${esc(item.traySizeLabel)}</span>
            </div>
            <div class="cart-item__qty"><span>Qty</span><strong>${item.qty}</strong></div>
            <div class="cart-item__price">${formatPeso(item.unitPrice * item.qty)}</div>
            <button type="button" class="remove-btn" data-remove-cart="${item.id}" aria-label="Remove ${esc(item.dish)}">
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
        </div>
        <button class="primary-button" type="button" data-go-pt-step="2">Review Quote &rarr;</button>
      </div>
    `;
  }

  function renderReview() {
    const panel = document.querySelector("[data-pt-panel='2']");
    if (!panel) return;
    const total = getTotal();
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 3 of 4 &middot; Review your order</p>
          <h2>Review Quote</h2>
        </div>
      </div>
      <div class="review-total-bar">
        <div class="price-block">
          <span>Estimated Total</span>
          <strong>${formatPeso(total)}</strong>
        </div>
        <div class="review-total-bar__meta">
          <span>${state.cart.reduce((n, i) => n + i.qty, 0)} tray${state.cart.reduce((n, i) => n + i.qty, 0) !== 1 ? "s" : ""}</span>
          <span>&middot;</span>
          <span>${state.cart.length} line item${state.cart.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <p class="review-hint">Need to adjust? Change size, quantity, or remove items below.</p>
      <ul class="review-list">
        ${state.cart.map((item) => `
          <li class="review-item">
            <div class="review-item__info">
              <strong>${esc(item.dish)}</strong>
              <span>${esc(item.category)}</span>
            </div>
            <div class="review-item__size-row">
              ${TRAY_SIZES.map(s => `
                <button type="button"
                  class="review-size-btn${item.traySize === s.id ? " is-active" : ""}"
                  data-review-size="${item.id}"
                  data-size="${s.id}"
                  aria-pressed="${item.traySize === s.id}">
                  ${esc(s.label)}
                </button>
              `).join("")}
            </div>
            <div class="review-item__controls">
              <button type="button" class="qty-btn" data-review-qty-dec="${item.id}" aria-label="Decrease quantity">−</button>
              <span class="review-item__qty">${item.qty}</span>
              <button type="button" class="qty-btn" data-review-qty-inc="${item.id}" aria-label="Increase quantity">+</button>
            </div>
            <div class="review-item__price">${formatPeso(item.unitPrice * item.qty)}</div>
            <button type="button" class="remove-btn" data-review-remove="${item.id}" aria-label="Remove ${esc(item.dish)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </li>
        `).join("")}
      </ul>
      <div class="step-nav">
        <button class="text-button" type="button" data-go-pt-step="1">← Back</button>
        <button class="primary-button" type="button" data-go-pt-step="3">Your Details →</button>
      </div>
    `;
  }

  function renderContact() {
    const panel = document.querySelector("[data-pt-panel='3']");
    if (!panel) return;
    const total = getTotal();

    const orderLines = [
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.traySizeLabel} (${item.traySizeDesc}) ${item.category} — ${item.dish} — ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total: ${formatPeso(total)}`,
    ];

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-pt-step="2"',
      copyAttr: "data-pt-copy",
      statusId: "pt-copy-status",
      orderLines,
    });
    attachInlineValidation(panel);
    attachBranchDropdown(panel);
  }

  async function copyOrder(btn) {
    const { valid, values } = validateAndRead();
    if (!valid) {
      const panel = document.querySelector("[data-pt-panel='3']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const total = getTotal();
    const orderLines = [
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.traySizeLabel} (${item.traySizeDesc}) ${item.category} — ${item.dish} — ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total: ${formatPeso(total)}`,
    ];

    const text = buildInquiryText("Party Trays", orderLines, values);
    const statusEl = document.getElementById("pt-copy-status");

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }
    if (statusEl) statusEl.textContent = "Sending to team…";

    const noteBody = [
      `Branch: ${values.branch}`,
      "",
      "── ORDER DETAILS ──────────────────────────",
      ...state.cart.map((item, i) =>
        `${i + 1}. ${item.qty}× ${item.traySizeLabel} (${item.traySizeDesc}) ${item.category} — ${item.dish} — ${formatPeso(item.unitPrice * item.qty)}`
      ),
      "",
      `Total    : ${formatPeso(total)}`,
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

    try {
      await pushInquiryToGHL({
        contact: values,
        opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · Party Trays`,
        monetaryValue: total,
        noteBody,
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type:    "Party Trays",
          branch:          values.branch,
          event_date:      values.eventDate,
          event_time:      values.eventTime,
          pax_count:       "",
          base_price:      formatPeso(total),
          dishes_selected: state.cart.map((item) =>
            `• ${item.qty}× ${item.traySizeLabel} (${item.traySizeDesc}) ${item.category} — ${item.dish} — ${formatPeso(item.unitPrice * item.qty)}`
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

    // Try clipboard — non-fatal
    try { await navigator.clipboard.writeText(text); } catch { /* iframe blocked */ }

    // Show success screen
    const panel = document.querySelector("[data-pt-panel='3']");
    if (panel) renderSuccess(panel, { total, values });
  }

  function renderSuccess(panel, { total, values }) {
    const itemCount = state.cart.reduce((n, i) => n + i.qty, 0);
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
            <strong>Party Trays</strong>
          </div>
          <div class="success-summary__row">
            <span>Total Trays</span>
            <strong>${itemCount} tray${itemCount !== 1 ? "s" : ""}</strong>
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
