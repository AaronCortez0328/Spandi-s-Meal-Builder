import {
  TRAY_SIZES, getCategories, getMenuItems, getDishPrice, getDishId,
} from "../data/party-trays.js";
import { DELIVERY_NOTE } from "./copy.js";
import { partyTrayPhoto, photoHtml } from "./menu-photos.js";
import { confirmOnButton, setStepDirection, jumpTo } from "./ui-fx.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import { addLine, removeLine, stepQty, setVariant } from "../domain/cart.js";
import { renderCartInto, cartAction, toggleExpanded } from "./order-cart.js";
import { shareOrderAs, requestReview } from "./order-shell.js";

export function createPartyTrayBuilder() {
  const state = {
    step: 1,
    selectedCategory: null,
    selectedDish: null,
    qty: 1,
    selectedSize: "family",
  };
  // state.cart is a window onto the order every service shares.
  shareOrderAs(state);

  function mount(container) {
    const cats = getCategories();
    if (cats.length > 0) {
      state.selectedCategory = cats[0];
      state.selectedDish = getMenuItems(cats[0])[0] ?? null;
    }
    container.addEventListener("click", handleClick);
    container.addEventListener("input", handleInput);
    // After the defaults above, before the first render: a saved cart should
    // win over the opening selection, and be on screen the moment it draws.
    // Key bumped with the cart's shape. A draft written by the old
    // per-builder cart holds items with none of a line's fields, and
    // Object.assign would restore them straight into a list that now
    // expects lines — a basket of blank rows. Stale drafts are better
    // dropped anyway: prices move, and this one cannot outlive the tab.
    persistState(container, "party-trays.v2", state);
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
      renderCategoryHero();
      renderDishArea();
      return;
    }

    const sizeBtn = e.target.closest("[data-select-size]");
    if (sizeBtn) {
      state.selectedSize = sizeBtn.dataset.selectSize;
      renderDishArea();
      return;
    }

    // One handler for every control the cart draws — quantity, remove, size
    // swap, contents disclosure — instead of four near-identical blocks that
    // each had to remember to re-render.
    const inCart = cartAction(e);
    if (inCart) {
      if (inCart.type === "qty")      state.cart = stepQty(state.cart, inCart.id, inCart.delta);
      if (inCart.type === "remove")   state.cart = removeLine(state.cart, inCart.id);
      if (inCart.type === "variant")  state.cart = setVariant(state.cart, inCart.id, inCart.option);
      if (inCart.type === "expand")   toggleExpanded(inCart.id);
      renderCart();
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

    const addBtn = e.target.closest("[data-add-to-cart]");
    if (addBtn) {
      addToCart();
      confirmOnButton(addBtn);
      return;
    }

    const removeBtn = e.target.closest("[data-remove-cart]");
    if (removeBtn) {
      state.cart = removeLine(state.cart, removeBtn.dataset.removeCart);
      renderCart();
      return;
    }

    const goStep = e.target.closest("[data-go-pt-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goPtStep, 10));
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
      // Typed quantities used to change state and nothing else, so the
      // subtotal beside the field kept showing the figure for the previous
      // quantity until some other action redrew the row. The number added to
      // the cart was always right; the one the customer was reading was not.
      // Patched here rather than by re-rendering, which would drop focus on
      // every keystroke.
      updateSubtotal();
    }
  }

  function updateSubtotal() {
    if (!state.selectedDish || !state.selectedCategory) return;
    const price = getDishPrice(state.selectedDish, state.selectedSize, state.selectedCategory);
    if (!Number.isFinite(price)) return;
    const chip = document.querySelector("[data-pt-subtotal-chip]");
    const out  = document.querySelector("[data-pt-subtotal]");
    if (out)  out.textContent = formatPeso(price * state.qty);
    if (chip) chip.hidden = state.qty <= 1;
  }

  /** Every tray size this dish comes in, priced — the cart re-prices a swap
   *  from these, so it never has to know how party trays are priced. */
  function sizeOptions(dish, category) {
    return TRAY_SIZES.map((s) => ({
      id: s.id,
      label: s.label,
      price: getDishPrice(dish, s.id, category),
    }));
  }

  function addToCart() {
    if (!state.selectedDish || !state.selectedCategory) return;
    const sizeId = state.selectedSize;
    state.cart = addLine(state.cart, {
      service: "party-trays",
      serviceLabel: "Party Trays",
      title: state.selectedDish,
      // The size deliberately stays out of the subtitle: it is swappable
      // from inside the cart, and the swap row already shows which is on.
      subtitle: state.selectedCategory,
      unitPrice: getDishPrice(state.selectedDish, sizeId, state.selectedCategory),
      qty: state.qty,
      variant: {
        label: "Tray size",
        selected: sizeId,
        options: sizeOptions(state.selectedDish, state.selectedCategory),
      },
      // Carried so the server can price this line itself. The name is what
      // the customer sees; the id is what dish_prices is keyed by.
      payload: { dishId: getDishId(state.selectedDish), category: state.selectedCategory },
    });
    state.qty = 1;
    renderCart();
    // Stay put. Trays are ordered several at a time and the picker is right
    // here — sending someone to the review after each one would make a
    // five-tray order a five-round trip. The order below flashes to show it
    // landed, and carries the way forward.
    const cartEl = document.getElementById("pt-cart-section");
    if (cartEl) {
      cartEl.classList.add("cart-flash");
      setTimeout(() => cartEl.classList.remove("cart-flash"), 400);
    }
  }

  function setStep(step) {
    // Step 2 was this builder's own checkout. It cannot run now that the
    // order is shared: its payload maps every line as though this service
    // owned it, so a combo passing through here arrives with no dishId, the
    // server answers "cannot price" rather than "wrong price", and the
    // total goes through unverified under the wrong service_type.
    if (step === 2) { requestReview(); return; }
    setStepDirection(state.step, step);
    state.step = step;
    renderStep();
    // Ignored while a popstate is being applied, so going back does not
    // push the entry it just consumed.
    pushNav("party-trays", step);
    jumpTo(document.getElementById("builder-party-trays"));
  }

  function renderStep() {
    document.querySelectorAll("[data-pt-panel]").forEach((p) => {
      p.hidden = p.dataset.ptPanel !== String(state.step);
    });
    renderStepper();
    if (state.step === 1) {
      renderCategories();
      renderCategoryHero();
      renderDishArea();
      renderCart();
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

  function renderCategoryHero() {
    const hero = document.getElementById("pt-category-hero");
    if (!hero) return;
    const cat = state.selectedCategory;
    // Captioned because it sits beside a named dish. There is one photo per
    // category, not per dish, and without saying so the picture reads as
    // whichever dish the dropdown is showing.
    hero.innerHTML = photoHtml(
      partyTrayPhoto(cat), `${cat} party tray`, "hero", `Sample ${cat} tray`
    );
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
    const price = getDishPrice(state.selectedDish, state.selectedSize, state.selectedCategory);
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
            <strong data-pt-price>${formatPeso(price)}</strong>
          </div>
          <div class="qty-control">
            <button type="button" class="qty-btn" data-qty-dec aria-label="Decrease quantity">−</button>
            <input type="number" id="pt-qty-input" class="qty-input" value="${state.qty}" min="1" max="99" aria-label="Quantity">
            <button type="button" class="qty-btn" data-qty-inc aria-label="Increase quantity">+</button>
          </div>
          <!-- At quantity 1 the subtotal is the price, so the row printed the
               same figure twice under two labels. Kept in the DOM rather than
               rendered conditionally so typing a quantity can reveal it
               without re-rendering the row and stealing focus mid-keystroke. -->
          <div class="price-chip" data-pt-subtotal-chip${state.qty > 1 ? "" : " hidden"}>
            <span>Subtotal</span>
            <strong data-pt-subtotal>${formatPeso(subtotal)}</strong>
          </div>
          <button type="button" class="primary-button" data-add-to-cart>Add to Order</button>
        </div>
      </div>
    `;
  }

  function renderCart() {
    renderCartInto(document.getElementById("pt-cart-section"), state.cart, {
      emptyText: "No items yet. Choose a category, pick a dish, then tap Add to Order. You can adjust tray sizes after adding.",
      forwardLabel: "Review order &rarr;",
      forwardAttr: "data-go-review",
      note: DELIVERY_NOTE,
    });
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

  return { mount, refresh: renderStep, setStep };
}

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
