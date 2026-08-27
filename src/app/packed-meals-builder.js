import { getPackTypes, getPackMenuItems, getPricingTiers, getPriceForQty } from "../data/packed-meals.js";
import { setPriceText, confirmOnButton, setStepDirection, jumpTo } from "./ui-fx.js";
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
import { packedMealPhoto, photoHtml } from "./menu-photos.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import {
  addLine, removeLine, lineTotal, cartTotal, itemCount, dishesSelectedText,
} from "../domain/cart.js";
import { renderCartInto, cartAction, toggleExpanded } from "./order-cart.js";
import { shareOrderAs, requestReview } from "./order-shell.js";

export function createPackedMealsBuilder() {
  const state = {
    step: 1,
    selectedPackTypeId: null,
    selectedDish: null,
    qty: 50,
  };
  // state.cart is a window onto the order every service shares.
  shareOrderAs(state);

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
    // Key bumped with the cart's shape — a draft written by the old cart
    // would restore items with none of a line's fields. See
    // party-tray-builder for the longer note.
    persistState(container, "packed-meals.v2", state);
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
      // Mark the choice rather than rebuilding the row. renderPackTypes()
      // recreates every card, and each card carries a photograph — so on a
      // tap all four <img> elements were replaced by fresh ones, which reset
      // them to the transparent state they fade in from. Choosing a pack type
      // made the other three blink. Nothing about a selection changes any of
      // that markup; only which card is marked.
      markSelectedPackType();
      renderConfigPanel();
      return;
    }

    const tierBtn = e.target.closest("[data-pm-tier]");
    if (tierBtn) {
      // Jump to the tier's floor, but never below the pack type's own
      // minimum order — the cheapest tier is not always the smallest one
      // you are allowed to buy.
      const min = getMinQty(state.selectedPackTypeId);
      state.qty = Math.max(min, parseInt(tierBtn.dataset.pmTier, 10));
      const qtyInput = document.getElementById("pm-qty-input");
      if (qtyInput) qtyInput.value = state.qty;
      updateConfigPricing();
      return;
    }

    const goStep = e.target.closest("[data-go-pm-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goPmStep, 10));
      return;
    }

    const pmAddBtn = e.target.closest("[data-pm-add]");
    if (pmAddBtn) {
      addToCart();
      confirmOnButton(pmAddBtn);
      return;
    }

    const inCart = cartAction(e);
    if (inCart) {
      if (inCart.type === "remove") state.cart = removeLine(state.cart, inCart.id);
      if (inCart.type === "expand") toggleExpanded(inCart.id);
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
    const packTypeName = pt?.name ?? state.selectedPackTypeId;
    state.cart = addLine(state.cart, {
      service: "packed-meals",
      serviceLabel: "Packed Meals",
      title: dish,
      subtitle: `${packTypeName} · ${formatPeso(unitPrice)}/pc`,
      unitPrice,
      qty: state.qty,
      // Priced per piece on a volume tier chosen at this moment, so the
      // quantity cannot be edited from inside the cart without re-pricing
      // the tier. Set it before adding, as before.
      qtyEditable: false,
      payload: { packTypeId: state.selectedPackTypeId, packTypeName },
    });
    renderCart();
    // Stay put — several packs are usually ordered in one visit, and the
    // picker is right here. See party-tray-builder.
    const cartEl = document.getElementById("pm-cart-section");
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
    pushNav("packed-meals", step);
    jumpTo(document.getElementById("builder-packed-meals"));
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
          btn.setAttribute("aria-pressed", String(pt.id === state.selectedPackTypeId));
        } else {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
        }
        // Photo only on a type that can actually be ordered — showing the
        // food next to "Currently Not Available" sells something we cannot
        // make today.
        btn.innerHTML = `
          ${isActive ? photoHtml(packedMealPhoto(pt.id), pt.name, "card") : ""}
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

  /**
   * The selection half of renderPackTypes(), for when only the choice has
   * changed. Everything else on these cards — photo, name, price range,
   * availability — comes from data a tap cannot alter, so rebuilding them
   * threw away four loaded images to change one class.
   */
  function markSelectedPackType() {
    document.querySelectorAll("[data-pack-type]").forEach((btn) => {
      const picked = btn.dataset.packType === state.selectedPackTypeId;
      btn.classList.toggle("is-active", picked);
      btn.setAttribute("aria-pressed", String(picked));
    });
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
            <strong id="pm-total-display" aria-live="polite" aria-atomic="true">${formatPeso(total)}</strong>
          </div>
          <button type="button" class="primary-button" data-pm-add>Add to Order</button>
        </div>
      </div>
      <div class="pricing-tiers-panel">
        <p class="section-kicker" style="margin-bottom:8px">Pricing Tiers · tap to jump</p>
        <!-- Buttons, not divs. The active row is tinted with the same copper
             this app uses for "selected" everywhere else, so these already
             read as a set of choices — they just weren't one, and a customer
             tapping the cheaper rate got nothing. Tapping now moves the
             quantity to that tier's minimum, which is the thing they were
             reaching for. -->
        ${tiers.map((tier, i) => {
          const isActive = state.qty >= tier.minQty && (i === 0 || state.qty < tiers[i - 1].minQty);
          return `<button type="button" class="tier-row${isActive ? " is-active" : ""}"
            data-pm-tier="${tier.minQty}"
            aria-pressed="${isActive}"
            aria-label="Set quantity to ${tier.minQty} pieces for ${formatPeso(tier.price)} each">
            <span>${tier.minQty}+ pcs</span>
            <strong>${formatPeso(tier.price)}/pc</strong>
          </button>`;
        }).join("")}
      </div>
    `;
  }

  function updateConfigPricing() {
    if (!state.selectedPackTypeId) return;
    const unitPrice = getPriceForQty(state.selectedPackTypeId, state.qty);
    const total = unitPrice * state.qty;

    const totalEl = document.getElementById("pm-total-display");
    setPriceText(totalEl, formatPeso(total));

    const totalLabelEl = totalEl?.previousElementSibling;
    if (totalLabelEl) totalLabelEl.textContent = `Total (${state.qty} × ${formatPeso(unitPrice)})`;

    const tiers = getPricingTiers(state.selectedPackTypeId);
    document.querySelectorAll(".tier-row").forEach((row, i) => {
      const tier = tiers[i];
      const isActive = tier && state.qty >= tier.minQty && (i === 0 || state.qty < tiers[i - 1].minQty);
      row.classList.toggle("is-active", !!isActive);
      row.setAttribute("aria-pressed", String(!!isActive));
    });
  }

  function renderCart() {
    renderCartInto(document.getElementById("pm-cart-section"), state.cart, {
      emptyText: "No items yet. Choose a pack type, select a meal, set quantity, then tap Add to Order.",
      forwardLabel: "Review order &rarr;",
      forwardAttr: "data-go-review",
      note: DELIVERY_NOTE,
      // Packed meals are counted in people fed, not in lines on a list.
      serves: (lines) => {
        const n = itemCount(lines);
        return `Feeds ${n} guest${n !== 1 ? "s" : ""}`;
      },
    });
  }

  function renderContact() {
    const panel = document.querySelector("[data-pm-panel='2']");
    if (!panel) return;
    const total = cartTotal(state.cart);

    const summaryRows = state.cart.map((line) => ({
      label: `${line.qty}× ${line.payload.packTypeName} · ${line.title}`,
      value: formatPeso(lineTotal(line)),
    }));

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-pm-step="1"',
      copyAttr: "data-pm-copy",
      statusId: "pm-copy-status",
      summaryRows,
      orderTotal: total,
    });
    attachInlineValidation(panel);
    attachFormPickers(panel);
  }

  async function copyOrder(btn) {
    const { valid, values } = validateAndRead();
    if (!valid) {
      const panel = document.querySelector("[data-pm-panel='2']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    const total = applyRushFee(
      cartTotal(state.cart),
      values.rushOrder
    );
    const totalPieces = itemCount(state.cart);
    const statusEl = document.getElementById("pm-copy-status");

    const dishLines = state.cart.map((line, i) =>
      `${i + 1}. ${line.qty}× ${line.payload.packTypeName} — ${line.title} — ${formatPeso(line.unitPrice)}/pc = ${formatPeso(lineTotal(line))}`
    );

    const noteBody = buildInquiryText(
      "Packed Meals",
      [
        ...(values.rushOrder ? ["Rush fee : +" + formatPeso(RUSH_FEE)] : []),
        `Total    : ${formatPeso(total)}`,
      ],
      values,
      dishLines
    );

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }

    const payload = {
        contact: values,
        lineItems: {
          service: "packed-meals",
          lines: state.cart.map((line) => ({
            packTypeId: line.payload.packTypeId,
            qty:        line.qty,
          })),
          rush: values.rushOrder,
        },
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
          dishes_selected: dishesSelectedText(state.cart, formatPeso),
          event_notes:     values.note,
          receive_method:  values.fulfilment,
          delivery__pickup_time: values.fulfilmentTime,
          contacted_via_social: values.contactedViaSocial,
          social_profile_name:  values.socialProfileName,
          // "opportunity.rush_order" — see party-tray-builder.js for why
          // this is blank rather than "No" on a non-rush order.
          rush_order: values.rushOrder ? `Yes (+${formatPeso(RUSH_FEE)})` : "",
        },
    };

    const panel = document.querySelector("[data-pm-panel='2']");

    await submitInquiry({
      payload,
      panel,
      onSuccess: (result) => {
        // Clipboard is best-effort — an embedding iframe can block it.
        try { navigator.clipboard.writeText(noteBody); } catch { /* iframe blocked */ }
        if (panel) renderSuccess(panel, { total, totalPieces, values, attached: result?.attached });
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

  function renderSuccess(panel, { total, totalPieces, values, attached }) {
    renderInquirySent(panel, {
      attached,
      firstName: values.firstName,
      rows: [
        { label: "Service",    value: "Packed Meals" },
        { label: "Meals",      value: `${totalPieces} piece${totalPieces !== 1 ? "s" : ""}` },
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
