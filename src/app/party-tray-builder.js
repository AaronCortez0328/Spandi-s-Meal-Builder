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
    selectedTraySize: "feast",
    qty: 1,
    cart: [],
  };

  let nextItemId = 1;

  const TRAY_SERVES = { family: 5, feast: 11, xxxl: 22 };

  function getServesEstimate() {
    if (state.cart.length === 0) return null;
    const total = state.cart.reduce((sum, item) => {
      return sum + (TRAY_SERVES[item.traySize] || 0) * item.qty;
    }, 0);
    return total > 0 ? total : null;
  }

  function mount(container) {
    const cats = getCategories();
    if (cats.length > 0) {
      state.selectedCategory = cats[0];
      state.selectedDish = getMenuItems(cats[0])[0] ?? null;
    }
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);
    container.addEventListener("input", handleInput);
    renderStep();
  }

  function handleClick(e) {
    const catBtn = e.target.closest("[data-category]");
    if (catBtn) {
      state.selectedCategory = catBtn.dataset.category;
      state.selectedDish = getMenuItems(state.selectedCategory)[0] ?? null;
      renderCategories();
      renderDishArea();
      return;
    }

    const sizeBtn = e.target.closest("[data-tray-size]");
    if (sizeBtn) {
      state.selectedTraySize = sizeBtn.dataset.traySize;
      renderDishArea();
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

    if (e.target.closest("[data-pt-copy]")) {
      copyOrder();
      return;
    }
  }

  function handleChange(e) {
    if (e.target.id === "pt-dish-select") {
      state.selectedDish = e.target.value;
      renderDishArea();
    }
  }

  function handleInput(e) {
    if (e.target.id === "pt-qty-input") {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1) state.qty = Math.min(99, v);
    }
  }

  function addToCart() {
    if (!state.selectedDish || !state.selectedCategory) return;
    const unitPrice = getCategoryPrice(state.selectedCategory, state.selectedTraySize);
    const trayInfo = TRAY_SIZES.find((t) => t.id === state.selectedTraySize);
    state.cart.push({
      id: nextItemId++,
      category: state.selectedCategory,
      dish: state.selectedDish,
      traySize: state.selectedTraySize,
      traySizeLabel: trayInfo?.label ?? state.selectedTraySize,
      traySizeDesc: trayInfo?.desc ?? "",
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

  function renderDishArea() {
    const dishArea = document.getElementById("pt-dish-area");
    if (!dishArea || !state.selectedCategory) return;

    const dishes = getMenuItems(state.selectedCategory);
    const unitPrice = getCategoryPrice(state.selectedCategory, state.selectedTraySize);
    const total = unitPrice * state.qty;

    dishArea.classList.remove("is-animating");
    void dishArea.offsetWidth; // force reflow to restart animation
    dishArea.classList.add("is-animating");

    dishArea.innerHTML = `
      <div class="dish-area__top">
        <div class="form-group">
          <label for="pt-dish-select">Choose dish — ${esc(state.selectedCategory)}</label>
          <select id="pt-dish-select" class="native-select">
            ${dishes.map((d) => `<option value="${esc(d)}"${d === state.selectedDish ? " selected" : ""}>${esc(d)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Tray size</label>
          <div class="tray-size-group">
            ${TRAY_SIZES.map((s) => `
              <button type="button" class="tray-size-btn${s.id === state.selectedTraySize ? " is-active" : ""}" data-tray-size="${s.id}">
                <strong>${esc(s.label)}</strong>
                <span>${esc(s.desc)}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="dish-area__bottom">
        <div class="price-chip">
          <span>Unit price</span>
          <strong>${formatPeso(unitPrice)}</strong>
        </div>
        <div class="qty-control">
          <button type="button" class="qty-btn" data-qty-dec aria-label="Decrease quantity">−</button>
          <input type="number" id="pt-qty-input" class="qty-input" value="${state.qty}" min="1" max="99" aria-label="Quantity">
          <button type="button" class="qty-btn" data-qty-inc aria-label="Increase quantity">+</button>
        </div>
        <div class="price-chip">
          <span>Subtotal</span>
          <strong>${formatPeso(total)}</strong>
        </div>
        <button type="button" class="primary-button" data-add-to-cart>Add to Order</button>
      </div>
    `;
  }

  function renderCart() {
    const section = document.getElementById("pt-cart-section");
    if (!section) return;

    if (state.cart.length === 0) {
      section.innerHTML = `
        <p class="section-kicker">Your Order</p>
        <p class="empty-state">No items yet. Choose a category, pick a dish and size, then tap Add to Order.</p>
        <div class="running-total-bar">
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
              <span>${esc(item.category)} &middot; ${esc(item.traySizeLabel)} (${esc(item.traySizeDesc)})</span>
            </div>
            <div class="cart-item__qty">${item.qty}&times;</div>
            <div class="cart-item__price">${formatPeso(item.unitPrice * item.qty)}</div>
            <button type="button" class="remove-btn" data-remove-cart="${item.id}" aria-label="Remove ${esc(item.dish)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </li>
        `).join("")}
      </ul>
      <div class="running-total-bar">
        <div class="running-total-bar__info">
          <span class="running-total-bar__label">Running total</span>
          <span class="running-total-bar__amount">${formatPeso(total)}</span>
          <span class="running-total-bar__serves">${(() => { const s = getServesEstimate(); return s ? `Approx. ${s}+ servings` : ''; })()}</span>
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
      <div class="summary-body">
        <div class="summary-left">
          <div class="price-block">
            <span>Estimated Total</span>
            <strong>${formatPeso(total)}</strong>
          </div>
          <div class="summary-meta">
            <div><dt>Total trays</dt><dd>${state.cart.reduce((n, i) => n + i.qty, 0)} trays</dd></div>
            <div><dt>Line items</dt><dd>${state.cart.length}</dd></div>
          </div>
        </div>
        <div class="summary-right">
          <p class="section-kicker" style="margin-bottom:10px">Order Details</p>
          <ol class="summary-items">
            ${state.cart.map((item) => `
              <li>
                <span>${item.qty}× ${esc(item.traySizeLabel)}</span>
                <strong>${esc(item.dish)}</strong>
                <b>${formatPeso(item.unitPrice * item.qty)}</b>
              </li>
            `).join("")}
          </ol>
        </div>
      </div>
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

  async function copyOrder() {
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
      ...(values.eventDate ? [`Date     : ${values.eventDate}`] : []),
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
      });
    } catch (e) {
      console.error("GHL submission failed:", e);
      if (statusEl) statusEl.textContent = `Error: ${e.message}`;
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
