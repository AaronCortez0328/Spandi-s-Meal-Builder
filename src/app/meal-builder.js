import {
  getCategoryLabel,
  getDishOptions,
  getPackedMealPackTypes,
  getPartyTrayCategories,
  loadDishCategories
} from "../data/dishes.js";
import { getPackageGroups, getPackages } from "../data/packages.js";
import {
  buildOrderLines,
  buildOrderSummaryText,
  calculateTotalPrice,
  createDefaultSelections,
  formatPeso,
  getSelectedDish,
  getSlotKey
} from "../domain/package-rules.js";

const SERVICE_META = {
  "combo-trays": {
    title: "Combo Party Trays",
    note: "Fixed-set combos with customizable dish slots"
  },
  "party-trays": {
    title: "Party Trays",
    note: "Ala carte trays by category and size"
  },
  "packed-meals": {
    title: "Packed Meals",
    note: "Packed meal tiers by minimum quantity"
  }
};

export function createMealBuilder() {
  const state = {
    service: "",
    combo: {
      step: 1,
      groupId: "",
      packageId: "",
      selectionsByPackage: {}
    },
    partyTray: {
      step: 1,
      categoryId: "",
      dishName: "",
      traySize: "",
      qty: 1,
      items: []
    },
    packedMeals: {
      step: 1,
      packTypeId: "",
      mealName: "",
      qty: 10,
      items: []
    }
  };

  async function mount() {
    bindEvents();
    await loadDishCategories();
    initializeState();
    document.getElementById("loading-state")?.setAttribute("hidden", "");
    showServiceSelector();
  }

  function initializeState() {
    const firstComboGroup = getPackageGroups()[0];
    const firstCombo = getPackages()[0];
    if (firstComboGroup) state.combo.groupId = firstComboGroup.id;
    if (firstCombo) setComboPackage(firstCombo.id, false);

    const firstCategory = getPartyTrayCategories()[0];
    if (firstCategory) {
      state.partyTray.categoryId = firstCategory.id;
      state.partyTray.dishName = firstCategory.dishes[0]?.name ?? "";
      state.partyTray.traySize = Object.keys(firstCategory.prices)[0] ?? "";
    }

    const firstPack = getPackedMealPackTypes()[0];
    if (firstPack) {
      state.packedMeals.packTypeId = firstPack.id;
      state.packedMeals.mealName = firstPack.menuItems[0]?.name ?? "";
      state.packedMeals.qty = firstPack.tiers.at(-1)?.minOrderQty || 10;
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const serviceButton = event.target.closest("[data-service]");
      if (serviceButton) {
        showService(serviceButton.dataset.service);
        return;
      }

      if (event.target.closest("[data-service-back]")) {
        showServiceSelector();
        return;
      }

      const comboGroup = event.target.closest("[data-combo-group]");
      if (comboGroup) {
        state.combo.groupId = comboGroup.dataset.comboGroup;
        const firstInGroup = getVisibleCombos()[0];
        if (firstInGroup) setComboPackage(firstInGroup.id, false);
        renderComboBuilder();
        return;
      }

      const comboCard = event.target.closest("[data-combo-id]");
      if (comboCard) {
        setComboPackage(comboCard.dataset.comboId);
        return;
      }

      const comboStep = event.target.closest("[data-go-cat-step]");
      if (comboStep) {
        state.combo.step = clampStep(comboStep.dataset.goCatStep);
        renderComboBuilder();
        return;
      }

      const partyCategory = event.target.closest("[data-pt-category]");
      if (partyCategory) {
        setPartyTrayCategory(partyCategory.dataset.ptCategory);
        return;
      }

      const traySize = event.target.closest("[data-tray-size]");
      if (traySize) {
        state.partyTray.traySize = traySize.dataset.traySize;
        renderPartyTrayBuilder();
        return;
      }

      if (event.target.closest("[data-add-party-tray]")) {
        addPartyTrayItem();
        return;
      }

      const removeParty = event.target.closest("[data-remove-party-item]");
      if (removeParty) {
        state.partyTray.items.splice(Number(removeParty.dataset.removePartyItem), 1);
        renderPartyTrayBuilder();
        return;
      }

      const partyStep = event.target.closest("[data-go-pt-step]");
      if (partyStep) {
        state.partyTray.step = clampStep(partyStep.dataset.goPtStep);
        renderPartyTrayBuilder();
        return;
      }

      const packCard = event.target.closest("[data-pack-type]");
      if (packCard) {
        setPackType(packCard.dataset.packType);
        return;
      }

      if (event.target.closest("[data-add-packed-meal]")) {
        addPackedMealItem();
        return;
      }

      const removePacked = event.target.closest("[data-remove-packed-item]");
      if (removePacked) {
        state.packedMeals.items.splice(Number(removePacked.dataset.removePackedItem), 1);
        renderPackedMealsBuilder();
        return;
      }

      const packedStep = event.target.closest("[data-go-pm-step]");
      if (packedStep) {
        state.packedMeals.step = clampStep(packedStep.dataset.goPmStep);
        renderPackedMealsBuilder();
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-combo-slot]")) {
        const packageItem = getActiveCombo();
        if (!packageItem) return;
        const slotIndex = Number(event.target.dataset.comboSlot);
        state.combo.selectionsByPackage[packageItem.id][getSlotKey(packageItem.id, slotIndex)] = event.target.value;
        renderComboBuilder();
      }

      if (event.target.matches("#pt-dish-select")) {
        state.partyTray.dishName = event.target.value;
        renderPartyTrayBuilder();
      }

      if (event.target.matches("#pt-qty-input")) {
        state.partyTray.qty = Math.max(1, Number(event.target.value) || 1);
        renderPartyTrayBuilder();
      }

      if (event.target.matches("#pm-meal-select")) {
        state.packedMeals.mealName = event.target.value;
        renderPackedMealsBuilder();
      }

      if (event.target.matches("#pm-qty-input")) {
        state.packedMeals.qty = Math.max(1, Number(event.target.value) || 1);
        renderPackedMealsBuilder();
      }
    });
  }

  function showServiceSelector() {
    state.service = "";
    document.getElementById("service-selector").hidden = false;
    document.getElementById("builder-catering").hidden = true;
    document.getElementById("builder-party-trays").hidden = true;
    document.getElementById("builder-packed-meals").hidden = true;
    setHeader("Meal Estimator", "Choose a service");
  }

  function showService(service) {
    state.service = service;
    document.getElementById("service-selector").hidden = true;
    document.getElementById("builder-catering").hidden = service !== "combo-trays";
    document.getElementById("builder-party-trays").hidden = service !== "party-trays";
    document.getElementById("builder-packed-meals").hidden = service !== "packed-meals";

    const meta = SERVICE_META[service];
    setHeader(meta.title, meta.note);

    if (service === "combo-trays") renderComboBuilder();
    if (service === "party-trays") renderPartyTrayBuilder();
    if (service === "packed-meals") renderPackedMealsBuilder();
  }

  function setHeader(label, note) {
    const noteEl = document.getElementById("header-note");
    if (!noteEl) return;
    noteEl.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(note)}</strong>`;
  }

  function renderComboBuilder() {
    renderTwoStep("[data-cat-panel]", ".cat-stepper__step", ".cat-stepper__connector", state.combo.step);
    renderComboChooser();
    renderComboReview();
  }

  function renderComboChooser() {
    const target = document.getElementById("cat-package-list");
    const groups = getPackageGroups();
    const packages = getVisibleCombos();
    const active = getActiveCombo();

    target.innerHTML = `
      <div class="segmented-control segmented-control--dynamic" role="tablist" aria-label="Combo pax group">
        ${groups.map((group) => `
          <button type="button" class="${group.id === state.combo.groupId ? "is-active" : ""}" data-combo-group="${escapeAttribute(group.id)}">
            ${escapeHtml(group.label)}
          </button>
        `).join("")}
      </div>
      <div class="combo-grid">
        ${packages.map((packageItem) => comboCardTemplate(packageItem, packageItem.id === state.combo.packageId)).join("")}
      </div>
      ${active ? comboCustomizerTemplate(active) : emptyTemplate("No combo packages found.")}
    `;
  }

  function comboCardTemplate(packageItem, isActive) {
    const selections = getComboSelections(packageItem);
    const previewLines = buildOrderLines(packageItem, selections).slice(0, 4);

    return `
      <button type="button" class="combo-card ${isActive ? "is-active" : ""}" data-combo-id="${escapeAttribute(packageItem.id)}">
        <span class="package-card__eyebrow">${escapeHtml(packageItem.pax)}</span>
        <span class="combo-card__top">
          <strong>${escapeHtml(packageItem.name)}</strong>
          <b>${formatPeso(packageItem.price)}</b>
        </span>
        <ol class="combo-card__items">
          ${previewLines.map((line) => `<li>${escapeHtml(line.quantity)} ${escapeHtml(line.dish || line.label)}</li>`).join("")}
          ${packageItem.slots.length > previewLines.length ? `<li class="combo-card__more">+${packageItem.slots.length - previewLines.length} more</li>` : ""}
        </ol>
      </button>
    `;
  }

  function comboCustomizerTemplate(packageItem) {
    const selections = getComboSelections(packageItem);

    return `
      <article class="selected-package combo-editor">
        <div>
          <p class="section-kicker">Customize combo</p>
          <h3>${escapeHtml(packageItem.name)}</h3>
          <p>${escapeHtml(packageItem.pax)} | ${packageItem.slots.length} tray slots</p>
        </div>
        <div class="selected-package__price">
          <span>Combo price</span>
          <strong>${formatPeso(calculateTotalPrice(packageItem, selections))}</strong>
        </div>
      </article>
      <div class="slot-list">
        ${packageItem.slots.map((slot, index) => comboSlotTemplate(packageItem, slot, selections, index)).join("")}
      </div>
    `;
  }

  function comboSlotTemplate(packageItem, slot, selections, index) {
    const currentDish = getSelectedDish(packageItem, selections, index);
    const options = withSelectedDish(getDishOptions(slot.categories), currentDish);

    return `
      <article class="slot-card">
        <div class="slot-card__label">
          <label for="combo-slot-${packageItem.id}-${index}">
            <span>${escapeHtml(slot.quantity)}</span>
            <strong>${escapeHtml(slot.label)}</strong>
          </label>
          <p>${slot.categories.map(getCategoryLabel).map(escapeHtml).join(" / ")}</p>
        </div>
        <div class="slot-card__right">
          <select class="native-select" id="combo-slot-${packageItem.id}-${index}" data-combo-slot="${index}">
            ${options.map((dish) => `<option value="${escapeAttribute(dish)}" ${dish === currentDish ? "selected" : ""}>${escapeHtml(dish)}</option>`).join("")}
          </select>
        </div>
      </article>
    `;
  }

  function renderComboReview() {
    const panel = document.querySelector("[data-cat-panel='2']");
    const packageItem = getActiveCombo();
    if (!packageItem) {
      panel.innerHTML = emptyTemplate("Choose a combo first.");
      return;
    }

    const selections = getComboSelections(packageItem);
    const lines = buildOrderLines(packageItem, selections);
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 2</p>
          <h2>Review Order</h2>
        </div>
        <button class="text-button" type="button" data-go-cat-step="1">Back to Combo</button>
      </div>
      ${summaryTemplate(packageItem.name, packageItem.pax, calculateTotalPrice(packageItem, selections), lines)}
      <div class="step-nav">
        <button class="text-button" type="button" data-go-cat-step="1">Back</button>
        <button class="primary-button" type="button" data-copy-combo>Copy Order Summary</button>
      </div>
    `;

    panel.querySelector("[data-copy-combo]")?.addEventListener("click", () => copyText(buildOrderSummaryText(packageItem, selections)));
  }

  function setComboPackage(packageId, shouldRender = true) {
    const packageItem = getPackages().find((item) => item.id === packageId);
    if (!packageItem) return;

    state.combo.packageId = packageId;
    state.combo.groupId = packageItem.group;
    if (!state.combo.selectionsByPackage[packageId]) {
      state.combo.selectionsByPackage[packageId] = createDefaultSelections(packageItem);
    }

    if (shouldRender) renderComboBuilder();
  }

  function getVisibleCombos() {
    return getPackages().filter((item) => item.group === state.combo.groupId);
  }

  function getActiveCombo() {
    return getPackages().find((item) => item.id === state.combo.packageId) ?? getPackages()[0];
  }

  function getComboSelections(packageItem) {
    if (!state.combo.selectionsByPackage[packageItem.id]) {
      state.combo.selectionsByPackage[packageItem.id] = createDefaultSelections(packageItem);
    }
    return state.combo.selectionsByPackage[packageItem.id];
  }

  function setPartyTrayCategory(categoryId) {
    const category = getPartyTrayCategories().find((item) => item.id === categoryId);
    if (!category) return;

    state.partyTray.categoryId = categoryId;
    state.partyTray.dishName = category.dishes[0]?.name ?? "";
    state.partyTray.traySize = Object.keys(category.prices)[0] ?? "";
    renderPartyTrayBuilder();
  }

  function renderPartyTrayBuilder() {
    renderTwoStep("[data-pt-panel]", ".pt-stepper__step", ".pt-stepper__connector", state.partyTray.step);

    const category = getActivePartyTrayCategory();
    renderPartyTrayForm(category);
    renderPartyTrayCart();
    renderPartyTrayReview();
  }

  function renderPartyTrayForm(category) {
    document.getElementById("pt-category-tabs").innerHTML = getPartyTrayCategories().map((item) => `
      <button type="button" class="category-tab ${item.id === state.partyTray.categoryId ? "is-active" : ""}" data-pt-category="${escapeAttribute(item.id)}">
        ${escapeHtml(item.label)}
      </button>
    `).join("");

    const price = getActivePartyTrayPrice(category);
    document.getElementById("pt-dish-area").innerHTML = category ? `
      <div class="dish-area__top">
        <div class="form-group">
          <label for="pt-dish-select">Dish</label>
          <select class="native-select" id="pt-dish-select">
            ${category.dishes.map((dish) => `<option value="${escapeAttribute(dish.name)}" ${dish.name === state.partyTray.dishName ? "selected" : ""}>${escapeHtml(dish.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <span class="form-label">Tray size</span>
          <div class="tray-size-group">
            ${Object.values(category.prices).map((size) => `
              <button type="button" class="tray-size-btn ${size.id === state.partyTray.traySize ? "is-active" : ""}" data-tray-size="${escapeAttribute(size.id)}">
                <strong>${escapeHtml(size.label)}</strong>
                <span>${escapeHtml(size.pax)}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="dish-area__bottom">
        <div class="price-chip">
          <span>Tray price</span>
          <strong>${formatPeso(price)}</strong>
        </div>
        <div class="form-group">
          <label for="pt-qty-input">Quantity</label>
          <input class="qty-input" id="pt-qty-input" type="number" min="1" value="${state.partyTray.qty}" />
        </div>
        <button class="primary-button" type="button" data-add-party-tray>Add Tray</button>
      </div>
    ` : emptyTemplate("No party tray data found.");
  }

  function renderPartyTrayCart() {
    document.getElementById("pt-cart-section").innerHTML = cartTemplate(
      "Current Tray Order",
      state.partyTray.items,
      "party"
    );
  }

  function renderPartyTrayReview() {
    const panel = document.querySelector("[data-pt-panel='2']");
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 2</p>
          <h2>Review Party Trays</h2>
        </div>
        <button class="text-button" type="button" data-go-pt-step="1">Back to Build</button>
      </div>
      ${cartReviewTemplate("Party Tray Order", state.partyTray.items)}
      <div class="step-nav">
        <button class="text-button" type="button" data-go-pt-step="1">Back</button>
        <button class="primary-button" type="button" data-copy-party>Copy Order Summary</button>
      </div>
    `;
    panel.querySelector("[data-copy-party]")?.addEventListener("click", () => copyText(buildCartSummary("Party Tray Order", state.partyTray.items)));
  }

  function addPartyTrayItem() {
    const category = getActivePartyTrayCategory();
    if (!category || !state.partyTray.dishName || !state.partyTray.traySize) return;

    const size = category.prices[state.partyTray.traySize];
    state.partyTray.items.push({
      name: state.partyTray.dishName,
      meta: `${category.label} | ${size.label} | ${size.pax}`,
      qty: state.partyTray.qty,
      unitPrice: size.price,
      total: size.price * state.partyTray.qty
    });
    renderPartyTrayBuilder();
  }

  function getActivePartyTrayCategory() {
    return getPartyTrayCategories().find((item) => item.id === state.partyTray.categoryId) ?? getPartyTrayCategories()[0];
  }

  function getActivePartyTrayPrice(category) {
    return category?.prices[state.partyTray.traySize]?.price ?? 0;
  }

  function setPackType(packTypeId) {
    const packType = getPackedMealPackTypes().find((item) => item.id === packTypeId);
    if (!packType) return;

    state.packedMeals.packTypeId = packTypeId;
    state.packedMeals.mealName = packType.menuItems[0]?.name ?? "";
    state.packedMeals.qty = packType.tiers.at(-1)?.minOrderQty || 10;
    renderPackedMealsBuilder();
  }

  function renderPackedMealsBuilder() {
    renderTwoStep("[data-pm-panel]", ".pm-stepper__step", ".pm-stepper__connector", state.packedMeals.step);
    renderPackTypeList();
    renderPackedMealConfig();
    renderPackedMealCart();
    renderPackedMealReview();
  }

  function renderPackTypeList() {
    document.getElementById("pm-pack-type-list").innerHTML = getPackedMealPackTypes().map((packType) => {
      const lowest = packType.tiers.at(-1);
      return `
        <button type="button" class="pack-type-card ${packType.id === state.packedMeals.packTypeId ? "is-active" : ""}" data-pack-type="${escapeAttribute(packType.id)}">
          <strong>${escapeHtml(packType.name)}</strong>
          <span class="pack-type-price">${lowest ? `From ${formatPeso(lowest.price)} / pc` : "Pricing unavailable"}</span>
          <small>${escapeHtml(packType.description || "")}</small>
        </button>
      `;
    }).join("");
  }

  function renderPackedMealConfig() {
    const packType = getActivePackType();
    const tier = getActivePackedMealTier(packType);
    document.getElementById("pm-config-panel").innerHTML = packType ? `
      <div class="config-panel__inner">
        <div class="form-group">
          <label for="pm-meal-select">Meal</label>
          <select class="native-select" id="pm-meal-select">
            ${packType.menuItems.map((meal) => `<option value="${escapeAttribute(meal.name)}" ${meal.name === state.packedMeals.mealName ? "selected" : ""}>${escapeHtml(meal.name)}</option>`).join("")}
          </select>
        </div>
        <div class="config-panel__footer">
          <div class="form-group">
            <label for="pm-qty-input">Quantity</label>
            <input class="pax-input" id="pm-qty-input" type="number" min="1" value="${state.packedMeals.qty}" />
          </div>
          <div class="price-chip">
            <span>Unit price</span>
            <strong>${formatPeso(tier?.price ?? 0)}</strong>
          </div>
          <button class="primary-button" type="button" data-add-packed-meal>Add Meals</button>
        </div>
      </div>
      <div class="pricing-tiers-panel">
        ${packType.tiers.map((item) => `
          <div class="tier-row ${tier?.id === item.id ? "is-active" : ""}">
            <span>Min ${item.minOrderQty}</span>
            <strong>${formatPeso(item.price)}</strong>
          </div>
        `).join("")}
      </div>
    ` : emptyTemplate("No packed meal data found.");
  }

  function renderPackedMealCart() {
    document.getElementById("pm-cart-section").innerHTML = cartTemplate(
      "Current Packed Meal Order",
      state.packedMeals.items,
      "packed"
    );
  }

  function renderPackedMealReview() {
    const panel = document.querySelector("[data-pm-panel='2']");
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 2</p>
          <h2>Review Packed Meals</h2>
        </div>
        <button class="text-button" type="button" data-go-pm-step="1">Back to Configure</button>
      </div>
      ${cartReviewTemplate("Packed Meal Order", state.packedMeals.items)}
      <div class="step-nav">
        <button class="text-button" type="button" data-go-pm-step="1">Back</button>
        <button class="primary-button" type="button" data-copy-packed>Copy Order Summary</button>
      </div>
    `;
    panel.querySelector("[data-copy-packed]")?.addEventListener("click", () => copyText(buildCartSummary("Packed Meal Order", state.packedMeals.items)));
  }

  function addPackedMealItem() {
    const packType = getActivePackType();
    const tier = getActivePackedMealTier(packType);
    if (!packType || !tier || !state.packedMeals.mealName) return;

    state.packedMeals.items.push({
      name: state.packedMeals.mealName,
      meta: packType.name,
      qty: state.packedMeals.qty,
      unitPrice: tier.price,
      total: tier.price * state.packedMeals.qty
    });
    renderPackedMealsBuilder();
  }

  function getActivePackType() {
    return getPackedMealPackTypes().find((item) => item.id === state.packedMeals.packTypeId) ?? getPackedMealPackTypes()[0];
  }

  function getActivePackedMealTier(packType) {
    if (!packType) return null;
    return packType.tiers.find((tier) => state.packedMeals.qty >= tier.minOrderQty) ?? packType.tiers.at(-1);
  }

  function renderTwoStep(panelSelector, stepSelector, connectorSelector, currentStep) {
    document.querySelectorAll(panelSelector).forEach((panel) => {
      panel.hidden = Number(panel.dataset.catPanel || panel.dataset.ptPanel || panel.dataset.pmPanel) !== currentStep;
    });

    document.querySelectorAll(stepSelector).forEach((stepEl) => {
      const step = Number(stepEl.dataset.step);
      stepEl.classList.toggle("is-active", step === currentStep);
      stepEl.classList.toggle("is-completed", step < currentStep);
    });

    document.querySelectorAll(connectorSelector).forEach((connector, index) => {
      connector.classList.toggle("is-completed", index + 1 < currentStep);
    });
  }

  return { mount };
}

function summaryTemplate(title, subtitle, total, lines) {
  return `
    <div class="summary-body">
      <div class="summary-left">
        <div class="price-block">
          <span>Estimated total</span>
          <strong>${formatPeso(total)}</strong>
        </div>
        <dl class="summary-meta">
          <div><dt>Package</dt><dd>${escapeHtml(title)}</dd></div>
          <div><dt>Good for</dt><dd>${escapeHtml(subtitle)}</dd></div>
        </dl>
      </div>
      <div class="summary-right">
        <p class="section-kicker" style="margin-bottom: 10px;">Selected Menu</p>
        <ol class="summary-items">
          ${lines.map((line) => `<li><span>${escapeHtml(line.quantity)}</span><strong>${escapeHtml(line.dish || line.label)}</strong><b></b></li>`).join("")}
        </ol>
      </div>
    </div>
  `;
}

function cartTemplate(title, items, type) {
  return `
    <p class="section-kicker">${escapeHtml(title)}</p>
    ${items.length ? `
      <ul class="cart-list">
        ${items.map((item, index) => `
          <li class="cart-item">
            <span class="cart-item__info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.meta)}</span></span>
            <span class="cart-item__qty">x${item.qty}</span>
            <span class="cart-item__price">${formatPeso(item.total)}</span>
            <button class="remove-btn" type="button" aria-label="Remove ${escapeAttribute(item.name)}" data-remove-${type}-item="${index}">&times;</button>
          </li>
        `).join("")}
      </ul>
      <div class="cart-total"><span>Total</span><strong>${formatPeso(sumItems(items))}</strong></div>
      <div class="step-nav">
        <span></span>
        <button class="primary-button" type="button" data-go-${type === "party" ? "pt" : "pm"}-step="2">Review Order &rarr;</button>
      </div>
    ` : `<div class="empty-state">No items added yet.</div>`}
  `;
}

function cartReviewTemplate(title, items) {
  return `
    <div class="summary-body">
      <div class="summary-left">
        <div class="price-block"><span>Total</span><strong>${formatPeso(sumItems(items))}</strong></div>
      </div>
      <div class="summary-right">
        <p class="section-kicker" style="margin-bottom: 10px;">${escapeHtml(title)}</p>
        ${items.length ? `
          <ol class="summary-items">
            ${items.map((item) => `<li><span>x${item.qty}</span><strong>${escapeHtml(item.name)}<br><small>${escapeHtml(item.meta)}</small></strong><b>${formatPeso(item.total)}</b></li>`).join("")}
          </ol>
        ` : `<div class="empty-state">No items to review yet.</div>`}
      </div>
    </div>
  `;
}

function buildCartSummary(title, items) {
  const lines = items.map((item, index) => `${index + 1}. ${item.qty}x ${item.name} (${item.meta}) - ${formatPeso(item.total)}`);
  return `Spandi's ${title}

Order:
${lines.join("\n") || "No items selected."}

Estimated Total: ${formatPeso(sumItems(items))}`;
}

function withSelectedDish(options, selected) {
  if (!selected || options.includes(selected)) return options;
  return [selected, ...options];
}

function sumItems(items) {
  return items.reduce((total, item) => total + item.total, 0);
}

function clampStep(value) {
  return Math.max(1, Math.min(2, Number(value) || 1));
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    window.prompt("Copy this order summary:", value);
  }
}

function emptyTemplate(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

export function packageGroupCount() {
  return getPackageGroups().length;
}
