import {
  TRAY_SIZES, getCategories, getMenuItems, getCategoryPrice, getDishPrice, getDishId,
} from "../data/party-trays.js";
import {
  buildContactPanel,
  validateAndRead,
  attachInlineValidation,
  attachFormPickers,
  clearFilledErrors,
  buildInquiryText,
  fulfilmentTimeLabel,
} from "./contact-form.js";
import { submitInquiry } from "./submit-inquiry.js";
import { renderInquirySent } from "./inquiry-sent.js";
import { DELIVERY_NOTE } from "./copy.js";
import { applyRushFee, RUSH_FEE } from "../domain/pricing.js";
import { partyTrayPhoto, photoHtml } from "./menu-photos.js";
import { confirmOnButton, setStepDirection, jumpTo } from "./ui-fx.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import {
  addLine, removeLine, stepQty, setVariant,
  lineTotal, cartTotal, itemCount, dishesSelectedText,
  selectedVariantId, selectedVariantLabel,
} from "../domain/cart.js";
import { renderCartInto, cartAction, toggleExpanded } from "./order-cart.js";

export function createPartyTrayBuilder() {
  const state = {
    step: 1,
    selectedCategory: null,
    selectedDish: null,
    qty: 1,
    selectedSize: "family",
    cart: [],
  };

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
    const cartEl = document.getElementById("pt-cart-section");
    if (cartEl) {
      cartEl.classList.add("cart-flash");
      setTimeout(() => cartEl.classList.remove("cart-flash"), 400);
    }
  }

  function setStep(step) {
    setStepDirection(state.step, step);
    state.step = step;
    renderStep();
    // Ignored while a popstate is being applied, so going back does not
    // push the entry it just consumed.
    pushNav("party-trays", step);
    jumpTo(document.getElementById("builder-party-trays"));
  }

  function getTotal() {
    return cartTotal(state.cart);
  }

  function getTotalForSize(sizeId) {
    return state.cart.reduce((sum, line) => {
      return sum + getCategoryPrice(line.payload.category, sizeId) * line.qty;
    }, 0);
  }

  function switchAllToSize(sizeId) {
    if (!TRAY_SIZES.some((t) => t.id === sizeId)) return;
    state.cart = state.cart.map((line) => setVariant([line], line.id, sizeId)[0]);
    renderCart();
  }

  function getUniformSize() {
    if (state.cart.length === 0) return null;
    const first = selectedVariantId(state.cart[0]);
    return state.cart.every((line) => selectedVariantId(line) === first) ? first : null;
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
    } else if (state.step === 2) {
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

    // Addressed by name, not by position. chips[0] / chips[1] only worked
    // while both chips were always present in that order; the subtotal now
    // hides itself at quantity 1, and an index would have started writing
    // the subtotal into the price.
    const priceEl = document.querySelector("[data-pt-price]");
    const subEl   = document.querySelector("[data-pt-subtotal]");
    const subChip = document.querySelector("[data-pt-subtotal-chip]");
    if (priceEl) priceEl.textContent = `PHP ${Number(fromPrice).toLocaleString("en-PH")}`;
    if (subEl)   subEl.textContent   = `PHP ${Number(fromTotal).toLocaleString("en-PH")}`;
    if (subChip) subChip.hidden = state.qty <= 1;
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
      forwardLabel: "Your Details &rarr;",
      forwardAttr: `data-go-pt-step="2"`,
      note: DELIVERY_NOTE,
    });
  }

  function renderContact() {
    const panel = document.querySelector("[data-pt-panel='2']");
    if (!panel) return;
    const summaryRows = state.cart.map((line) => ({
      label: `${line.qty}× ${selectedVariantLabel(line)} · ${line.title}`,
      value: formatPeso(lineTotal(line)),
    }));

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-pt-step="1"',
      copyAttr: "data-pt-copy",
      statusId: "pt-copy-status",
      summaryRows,
      orderTotal: getTotal(),
    });
    attachInlineValidation(panel);
    attachFormPickers(panel);
  }

  async function copyOrder(btn) {
    const { valid, values } = validateAndRead();
    if (!valid) {
      const panel = document.querySelector("[data-pt-panel='2']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const total = applyRushFee(getTotal(), values.rushOrder);
    const statusEl = document.getElementById("pt-copy-status");

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }

    const noteBody = buildInquiryText("Party Trays",
      [
        ...(values.rushOrder ? ["Rush fee : +" + formatPeso(RUSH_FEE)] : []),
        `Total    : ${formatPeso(total)}`,
      ], values,
      state.cart.map((line, i) =>
        `${i + 1}. ${line.qty}× ${selectedVariantLabel(line)} ${line.subtitle} — ${line.title} — ${formatPeso(lineTotal(line))}`
      ));

    const trayCount = itemCount(state.cart);

    const payload = {
        contact: values,
        // What the server needs to price this order itself. Ids and
        // quantities only — never prices, since those are the thing being
        // checked.
        lineItems: {
          service: "party-trays",
          lines: state.cart.map((line) => ({
            dishId:   line.payload.dishId,
            traySize: selectedVariantId(line),
            qty:      line.qty,
          })),
          rush: values.rushOrder,
        },
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
          pax_count:       `${trayCount} tray${trayCount !== 1 ? "s" : ""}`,
          dishes_selected: dishesSelectedText(state.cart, formatPeso),
          event_notes:     values.note,
          receive_method:  values.fulfilment,
          delivery__pickup_time: values.fulfilmentTime,
          contacted_via_social: values.contactedViaSocial,
          social_profile_name:  values.socialProfileName,
          // "opportunity.rush_order" — Single Line field, created in GHL
          // manually (Settings → Custom Fields → Opportunities) on 7 Aug
          // 2026. Blank rather than "No" for a non-rush order, matching how
          // every other optional field here is only sent when it has
          // something to say.
          rush_order: values.rushOrder ? `Yes (+${formatPeso(RUSH_FEE)})` : "",
        },
    };

    const panel = document.querySelector("[data-pt-panel='2']");

    await submitInquiry({
      payload,
      panel,
      onSuccess: (result) => {
        // Clipboard is best-effort — an embedding iframe can block it.
        try { navigator.clipboard.writeText(noteBody); } catch { /* iframe blocked */ }
        if (panel) renderSuccess(panel, { total, values, attached: result?.attached });
      },
      onError: (message) => {
        if (statusEl) statusEl.textContent = message;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalBtnHTML;
        }
      },
    });
  }

  function renderSuccess(panel, { total, values, attached }) {
    const trayCount = itemCount(state.cart);
    renderInquirySent(panel, {
      attached,
      firstName: values.firstName,
      rows: [
        { label: "Service",    value: "Party Trays" },
        { label: "Trays",      value: `${trayCount} tray${trayCount !== 1 ? "s" : ""}` },
        { label: "Event date", value: values.eventDate },
        { label: "Branch",     value: values.branch },
        ...(values.rushOrder ? [{ label: "Rush order", value: `Yes (+${formatPeso(RUSH_FEE)})` }] : []),
        { label: "Receive",    value: values.fulfilment },
        { label: fulfilmentTimeLabel(values.fulfilment), value: values.fulfilmentTime },
        { label: "Name",       value: `${values.firstName} ${values.lastName}` },
      ],
      priceLabel: "Total",
      priceValue: formatPeso(total),
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
