import {
  buildContactPanel,
  attachBranchDropdown,
  validateAndRead,
  attachInlineValidation,
  clearFilledErrors,
  buildInquiryText,
} from "./contact-form.js";
import { pushInquiryToGHL } from "./ghl.js";

const PACKAGE_CONFIG = {
  "basic-catering": {
    name: "Basic Catering Package",
    pricePerHead: 950,
    minPax: 50,
    paxStep: 10,
    courses: [
      "1 Chicken Dish", "1 Fish Dish", "1 Beef Dish",
      "1 Type of Soup", "1 Veggie Dish or Salad",
      "1 Pasta Dish", "Rice", "Dessert", "Drinks",
    ],
    inclusions: [
      "8 Seater Round Tables with White Cover",
      "Monoblock Chairs with White Cover",
      "1 Way per 100pax Skirted Buffet Set Up",
      "Waiters in Uniform",
      "Spoon, Fork, Teaspoon, Table Knife",
      "Dinner Plates, Saucer and Soup Bowl",
      "6 Rectangular Chaffing Dish",
      "1 Soup Tureen",
      "6 Swan Lights",
      "Drink Station",
      "Stainless Pitchers",
      "Highball Glasses and Goblets",
      "Color Theme Table Napkins",
      "Color Theme Table Topping",
      "Color Theme Chair Ribbons",
      "Basic Floral Centerpiece",
      "3-4hrs of Service",
    ],
    addons: [
      "Lechon Chopping 2,500 / 2 Lechons",
      "Service Charge 10%",
      "Transpo, Hauling, Sanitation, Team Food, Set Up and Pull Out 12,000 / 100pax",
    ],
  },
  "classic-catering": {
    name: "Classic Catering Package",
    pricePerHead: 1250,
    minPax: 50,
    paxStep: 10,
    courses: [
      "1 Chicken Dish", "1 Fish Dish", "1 Pork Dish", "1 Beef Dish",
      "1 Type of Soup", "1 Veggie Dish or Salad",
      "1 Pasta Dish", "Rice", "2 Types of Dessert", "Drinks",
    ],
    inclusions: [
      "8 Seater Round Tables with White Cover",
      "Monoblock Chairs with White Cover",
      "1 Way per 100pax Skirted Buffet Set Up",
      "Waiters in Uniform",
      "Spoon, Fork, Teaspoon, Table Knife",
      "Dinner Plates, Saucer and Soup Bowl",
      "7 Rectangular Chaffing Dish",
      "1 Soup Tureen",
      "7 Swan Lights",
      "Drink Station",
      "Stainless Pitchers",
      "Highball Glasses and Goblets",
      "Color Theme Table Napkins",
      "Color Theme Table Topping",
      "Color Theme Chair Ribbons",
      "Basic Floral Centerpiece",
      "3-4hrs of Service",
    ],
    addons: [
      "Lechon Chopping 2,500 / 2 Lechons",
      "Service Charge 10%",
      "Transpo, Hauling, Sanitation, Team Food, Set Up and Pull Out 12,000 / 100pax",
    ],
  },
};

const CLASSIC_MENU = [
  {
    label: "Chicken",
    items: [
      "Chicken Rosemary", "Chicken Alexander", "Soy Garlic Chicken Wings",
      "Chicken Parmigiana", "Chicken Cordon Bleu", "Citrus Chicken Confit", "Chicken Corgiana",
    ],
  },
  {
    label: "Fish & Seafood",
    items: [
      "Mango Salsa Sole Fish", "Lemon Fish Fillet", "Creamy Mixed Seafood Bouillabaise",
      "Baked Shrimp", "Baked Salmon", "Salmon Teriyaki Melt", "Squid Salpicao", "Curry Baked Mussels",
    ],
  },
  {
    label: "Pork",
    classicOnly: true,
    items: [
      "Baby Back Ribs", "Korean Roast Pork Belly", "Braised Macau Pork Belly with Bokchoy",
      "Grilled Pork Belly", "Bicol Express", "Dinuguan", "Spare Ribs in Peanut Sauce",
    ],
  },
  {
    label: "Beef",
    items: [
      "Beef Pares with Shiitake and Potato Balls", "Beef Bicol Express Green Curry",
      "Callos", "Lengua Con Setas", "Beef Tenderloin Stroganoff",
      "Beef Tenderloin Salpicao", "Roast Beef with Pink Mashed Potatoes", "Roast Beef Caldereta",
    ],
  },
  {
    label: "Veggies",
    items: [
      "Buttered Baked Veggies", "Herbed Potato Marbles", "Chessey Corn Kernels",
      "Cheese and Brocolli", "Asian Salad (Mango, Feta, Walnut)", "Watermelon Salad", "Grape Salad",
    ],
  },
  {
    label: "Soup",
    items: [
      "Cream of Shiitake", "Roasted Pumpkin", "Tomato Basil",
      "Potato and Leeks", "Crab and Corn", "Egg Drop",
    ],
  },
  {
    label: "Desserts",
    items: [
      "Smore's Brownies", "Lemon Bar", "Cinnamon Rolls", "Apple / Strawberry Struddles",
      "Fruit Cocktail", "Mango Tapioca", "Coffee Jelly", "Buko Pandan",
    ],
  },
  {
    label: "Pasta",
    items: [
      "Smoked Bacon Carbonara", "Shrimp Cajun Pasta", "Pesto Cajun Shrimp Pasta",
      "Rolled Lasagna", "Aligue Mac N' Cheese", "Crumble Pasta",
      "Classic Baked Macaroni", "Creamy Truffle Pasta", "Puttanesca",
      "Sausage and Mushroom Pasta", "Eggplant Parmigiana",
    ],
  },
  {
    label: "Drinks",
    items: [
      "Cucumber Lemonade", "Blue Lemonade", "Pink Lychee Juice", "Mango Juice",
      "Orange Juice", "Pineapple Juice", "Gulaman", "Melon Juice", "Apple Honey Iced Tea",
    ],
  },
];

function fmt(n) {
  return "PHP " + n.toLocaleString("en-PH");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createCateringPackageBuilder(serviceKey) {
  const config = PACKAGE_CONFIG[serviceKey];
  const isClassic = serviceKey === "classic-catering";

  const state = { step: 2, pax: config.minPax };
  let container = null;

  function mount(el) {
    container = el;
    el.addEventListener("click", handleClick);
    el.addEventListener("input",  handlePaxInput);
    el.addEventListener("change", handlePaxChange);
    renderStep();
  }

  function estimatedTotal() {
    return state.pax * config.pricePerHead;
  }

  function renderStep() {
    container.querySelectorAll("[data-cp-panel]").forEach((p) => {
      p.hidden = Number(p.dataset.cpPanel) !== state.step;
    });
    updateStepper();
    if (state.step === 2) renderPackagePanel();
    else if (state.step === 3) renderContactStep();
  }

  function updateStepper() {
    container.querySelectorAll("[data-cp-step]").forEach((el) => {
      const n = Number(el.dataset.cpStep);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
    });
    container.querySelectorAll("[data-cp-connector]").forEach((el) => {
      el.classList.toggle("is-completed", Number(el.dataset.cpConnector) < state.step);
    });
  }

  function renderPackagePanel() {
    const panel = container.querySelector("[data-cp-panel='2']");
    if (!panel) return;

    const coursesHtml = config.courses
      .map((c) => `<span class="cp-course-chip">${esc(c)}</span>`)
      .join("");

    const inclusionsHtml = config.inclusions
      .map((i) => `<li>${esc(i)}</li>`).join("");

    const addonsHtml = config.addons
      .map((a) => `<li>${esc(a)}</li>`).join("");

    const menuCategories = CLASSIC_MENU
      .filter((cat) => !cat.classicOnly || isClassic)
      .map((cat) => `
        <div class="cp-menu-category">
          <p class="cp-menu-category__label">${esc(cat.label)}${cat.classicOnly ? " <span class='cp-classic-only'>Classic only</span>" : ""}</p>
          <ul class="cp-menu-category__items">${cat.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        </div>
      `).join("");

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 3 · Package details</p>
          <h2>${esc(config.name)}</h2>
        </div>
        <div class="cp-rate-badge">
          <span>${fmt(config.pricePerHead)}</span>
          <small>per head</small>
        </div>
      </div>

      <div class="cp-estimator">
        <div class="cp-estimator__row">
          <div class="cp-estimator__info">
            <p class="cp-estimator__label">Number of guests</p>
            <p class="cp-estimator__hint">Minimum ${config.minPax} pax</p>
          </div>
          <div class="cp-pax-control">
            <button type="button" class="cp-pax-btn" data-cp-pax-dec aria-label="Decrease guests">−</button>
            <input
              type="number"
              class="cp-pax-display"
              data-cp-pax-display
              value="${state.pax}"
              min="${config.minPax}"
              aria-label="Number of guests"
            />
            <button type="button" class="cp-pax-btn" data-cp-pax-inc aria-label="Increase guests">+</button>
          </div>
          <div class="cp-total">
            <p class="cp-total__label">Estimated Total</p>
            <p class="cp-total__amount" data-cp-total>${fmt(estimatedTotal())}</p>
          </div>
        </div>
        <div class="cp-estimator__divider"></div>
        <div class="cp-quick-add">
          <span class="cp-quick-add__label">Quick add</span>
          <button type="button" class="cp-quick-add-btn" data-cp-pax-add="5">+5</button>
          <button type="button" class="cp-quick-add-btn" data-cp-pax-add="10">+10</button>
          <button type="button" class="cp-quick-add-btn" data-cp-pax-add="15">+15</button>
          <button type="button" class="cp-quick-add-btn" data-cp-pax-add="20">+20</button>
        </div>
      </div>

      <div class="cp-section">
        <p class="cp-section__title">What's included in the menu</p>
        <div class="cp-courses-chips">${coursesHtml}</div>
      </div>

      <div class="cp-section">
        <p class="cp-section__title">Full inclusions</p>
        <ul class="gz-items-list gz-items-list--2col">${inclusionsHtml}</ul>
      </div>

      <div class="cp-section">
        <p class="cp-section__title">Classic menu — choose from these options</p>
        <div class="cp-menu-grid">${menuCategories}</div>
      </div>

      <div class="cp-section">
        <p class="cp-section__title">Add-ons</p>
        <ul class="gz-items-list gz-items-list--muted">${addonsHtml}</ul>
      </div>

      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>← Back</button>
        <button class="primary-button" type="button" data-cp-continue>
          Continue to Details →
        </button>
      </div>
    `;
  }

  function updateEstimator() {
    const displayEl = container.querySelector("[data-cp-pax-display]");
    const totalEl   = container.querySelector("[data-cp-total]");
    if (displayEl) displayEl.value = state.pax;
    if (totalEl)   totalEl.textContent = fmt(estimatedTotal());
  }

  function handlePaxInput(e) {
    const input = e.target.closest("[data-cp-pax-display]");
    if (!input) return;
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val > 0) {
      state.pax = val;
      const totalEl = container.querySelector("[data-cp-total]");
      if (totalEl) totalEl.textContent = fmt(val * config.pricePerHead);
    }
  }

  function handlePaxChange(e) {
    const input = e.target.closest("[data-cp-pax-display]");
    if (!input) return;
    const val = parseInt(input.value, 10);
    state.pax = (!isNaN(val) && val >= config.minPax) ? val : config.minPax;
    updateEstimator();
  }

  function renderContactStep() {
    const panel = container.querySelector("[data-cp-panel='3']");
    if (!panel) return;

    panel.innerHTML = buildContactPanel({
      backAttr: "data-cp-back",
      copyAttr: "data-cp-submit",
      statusId: "cp-status",
      orderLines: buildOrderLines(),
    });

    attachBranchDropdown(panel);
    attachInlineValidation(panel);
    clearFilledErrors(panel);
  }

  function buildOrderLines() {
    return [
      `Service       : ${config.name}`,
      `Rate          : ${fmt(config.pricePerHead)} / head`,
      `Guests        : ${state.pax} pax`,
      `Estimated Total : ${fmt(estimatedTotal())}`,
    ];
  }

  function goStep(n) {
    state.step = n;
    renderStep();
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleClick(e) {
    if (e.target.closest("[data-cp-pax-dec]")) {
      state.pax = Math.max(config.minPax, state.pax - 1);
      updateEstimator();
      return;
    }

    if (e.target.closest("[data-cp-pax-inc]")) {
      state.pax = state.pax + 1;
      updateEstimator();
      return;
    }

    const addBtn = e.target.closest("[data-cp-pax-add]");
    if (addBtn) {
      state.pax = state.pax + Number(addBtn.dataset.cpPaxAdd);
      updateEstimator();
      return;
    }

    if (e.target.closest("[data-cp-continue]")) {
      goStep(3);
      return;
    }

    if (e.target.closest("[data-cp-back]")) {
      goStep(2);
      return;
    }

    if (e.target.closest("[data-cp-submit]")) {
      handleSubmit(e.target.closest("[data-cp-submit]"));
    }
  }

  async function handleSubmit(btn) {
    const result = validateAndRead();
    if (!result.valid) return;

    const { values } = result;
    const statusEl = document.getElementById("cp-status");

    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Sending…";

    const orderLines = buildOrderLines();
    const noteBody   = buildInquiryText(config.name, orderLines, values);

    try {
      await pushInquiryToGHL({
        contact: {
          firstName: values.firstName,
          lastName:  values.lastName,
          email:     values.email,
          phone:     values.phone,
          address:   values.address,
        },
        opportunityName: `${config.name} — ${state.pax} pax`,
        monetaryValue:   estimatedTotal(),
        noteBody,
        opportunityFields: {
          service_type:  config.name,
          pax_count:     String(state.pax),
          event_date:    values.eventDate,
          branch:        values.branch,
          note:          values.note,
        },
      });

      const panel = container.querySelector("[data-cp-panel='3']");
      if (panel) renderSuccess(panel, values);
    } catch (err) {
      if (statusEl) statusEl.textContent = "Something went wrong. Please try again.";
      btn.disabled = false;
      console.error("GHL push failed:", err);
    }
  }

  function renderSuccess(panel, values) {
    panel.innerHTML = `
      <div class="success-screen">
        <div class="success-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="success-text">
          <h2>Inquiry Sent!</h2>
          <p>Spandi's team will reach out shortly to confirm your <strong>${esc(config.name)}</strong> booking.</p>
        </div>
        <div class="success-summary">
          <div class="success-summary__row">
            <span>Service</span>
            <strong>${esc(config.name)}</strong>
          </div>
          <div class="success-summary__row">
            <span>Rate</span>
            <strong>${fmt(config.pricePerHead)} / head</strong>
          </div>
          <div class="success-summary__row">
            <span>Guests</span>
            <strong>${state.pax} pax</strong>
          </div>
          <div class="success-summary__row">
            <span>Estimated Total</span>
            <strong>${fmt(estimatedTotal())}</strong>
          </div>
          <div class="success-summary__row">
            <span>Event Date</span>
            <strong>${esc(values.eventDate)}</strong>
          </div>
        </div>
        <button class="primary-button" type="button" data-service-back>← Back to services</button>
      </div>
    `;
  }

  return { mount };
}
