import { renderStepper as drawStepper, STEP_BUILD, substepsHtml } from "./stepper.js";
import { DELIVERY_NOTE } from "./copy.js";
import { getPackageConfig } from "../data/full-service-catering.js";
import { setPriceText, setStepDirection, jumpTo } from "./ui-fx.js";
import { cateringPhoto, photoHtml } from "./menu-photos.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import { addLine } from "../domain/cart.js";
import { cateringBreakdown, CATERING } from "../domain/pricing.js";
import { getOrderLines, setOrderLines, requestReview } from "./order-shell.js";

// Build is two screens for a catering package: how many people, then what
// they eat. Both sit under the order's single "Build" step, so this is what
// says which of the two you are on.
const BUILD_SUBSTEPS = ["Guests", "Dishes"];

const CLASSIC_MENU = [
  {
    key: "chicken",
    label: "Chicken",
    items: [
      "Chicken Rosemary", "Chicken Alexander", "Soy Garlic Chicken Wings",
      "Chicken Parmigiana", "Chicken Cordon Bleu", "Citrus Chicken Confit", "Chicken Corgiana",
    ],
  },
  {
    key: "fish",
    label: "Fish & Seafood",
    items: [
      "Mango Salsa Sole Fish", "Lemon Fish Fillet", "Creamy Mixed Seafood Bouillabaise",
      "Baked Shrimp", "Baked Salmon", "Salmon Teriyaki Melt", "Squid Salpicao", "Curry Baked Mussels",
    ],
  },
  {
    key: "pork",
    label: "Pork",
    classicOnly: true,
    items: [
      "Baby Back Ribs", "Korean Roast Pork Belly", "Braised Macau Pork Belly with Bokchoy",
      "Grilled Pork Belly", "Bicol Express", "Dinuguan", "Spare Ribs in Peanut Sauce",
    ],
  },
  {
    key: "beef",
    label: "Beef",
    items: [
      "Beef Pares with Shiitake and Potato Balls", "Beef Bicol Express Green Curry",
      "Callos", "Lengua Con Setas", "Beef Tenderloin Stroganoff",
      "Beef Tenderloin Salpicao", "Roast Beef with Pink Mashed Potatoes", "Roast Beef Caldereta",
    ],
  },
  {
    key: "veggies",
    label: "Veggies",
    items: [
      "Buttered Baked Veggies", "Herbed Potato Marbles", "Chessey Corn Kernels",
      "Cheese and Brocolli", "Asian Salad (Mango, Feta, Walnut)", "Watermelon Salad", "Grape Salad",
    ],
  },
  {
    key: "soup",
    label: "Soup",
    items: [
      "Cream of Shiitake", "Roasted Pumpkin", "Tomato Basil",
      "Potato and Leeks", "Crab and Corn", "Egg Drop",
    ],
  },
  {
    key: "desserts",
    label: "Desserts",
    items: [
      "Smore's Brownies", "Lemon Bar", "Cinnamon Rolls", "Apple / Strawberry Struddles",
      "Fruit Cocktail", "Mango Tapioca", "Coffee Jelly", "Buko Pandan",
    ],
  },
  {
    key: "pasta",
    label: "Pasta",
    items: [
      "Smoked Bacon Carbonara", "Shrimp Cajun Pasta", "Pesto Cajun Shrimp Pasta",
      "Rolled Lasagna", "Aligue Mac N' Cheese", "Crumble Pasta",
      "Classic Baked Macaroni", "Creamy Truffle Pasta", "Puttanesca",
      "Sausage and Mushroom Pasta", "Eggplant Parmigiana",
    ],
  },
  {
    // Both packages have always listed "Rice" as an included course, and the
    // picker never asked which one -- so the customer read Rice on the
    // inclusions and then got no say in it. Included, so no price changes;
    // this only lets them choose.
    //
    // These three are the catering menu's rice section verbatim. The party
    // tray data carries six entries, but three of those look like the same
    // dishes under other names (Java Rice / Garlic Java Rice alongside Java
    // Garlic Rice, Blue Rice alongside Blue Ternate Rice). Not resolved here
    // -- which of those are genuinely different dishes is a question for the
    // kitchen, not something to guess at while adding a category.
    key: "rice",
    label: "Rice",
    items: [
      "Blue Ternate Rice", "Steamed Rice", "Java Garlic Rice",
    ],
  },
  {
    key: "drinks",
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

/**
 * The breakdown as plain text, for the order summary and for the CRM.
 *
 * The review screen shows one figure against a package the customer chose
 * for its per-head rate — ₱64,250 on a ₱950 package — and that is the screen
 * they commit on. The itemisation exists on the builder; leaving it behind
 * at the moment of decision is where it is needed most.
 *
 * These ride in the line's `contents`, which also reaches GoHighLevel as the
 * order's text, so the same lines are what the caterer invoices against.
 *
 * Module scope and exported so it can be tested. Nothing here reads the DOM.
 */
export function cateringCostLines(config, state) {
  const b = cateringBreakdown(config?.pricePerHead, state?.pax, state?.addons);
  const out = [
    `Food: ${state?.pax} guests × ${fmt(config?.pricePerHead)} — ${fmt(b.food)}`,
    `Service charge (${CATERING.serviceChargePct}% of food) — ${fmt(b.serviceCharge)}`,
    "Logistics & setup (transport, sanitation, ingress & egress, set up and "
      + `pull out, team meals, service staff) — ${fmt(b.logistics)}`,
  ];
  if (b.addons) {
    out.push(`Lechon chopping — you provide the lechon — ${fmt(b.addons)}`);
  }
  // Deliberately priceless. Stair hauling is charged per floor per staff
  // member, and how many staff to send is settled after the booking.
  if (state?.venueStairs) {
    out.push(
      `⚠ Venue access: STAIRS${state.venueFloors ? ` — ${state.venueFloors} floor(s) up` : ""}`
      + " — hauling fee to be quoted",
    );
  }
  return out;
}

/**
 * What the order line carries about this package.
 *
 * The venue answer is here as well as in the text, because the line is the
 * only thing that survives. It used to live in `contents` alone with the
 * radio's state kept by sessionStorage — and draft.js no-ops where storage
 * is unavailable (Safari private mode, some embedded webviews), which is
 * exactly what a cross-origin iframe runs into. There, returning to change
 * the guest count reset the radio to "Ground floor" while the order still
 * said STAIRS, and continuing through rewrote the line without the warning.
 * Silently, on the one answer the caterer cannot learn any other way.
 */
export function cateringPayload(serviceKey, state) {
  return {
    serviceKey,
    pax: state.pax,
    // Only the selection travels; every amount is applied server-side from
    // CATERING — see the "catering-package" case in api/_price-tables.js.
    addons: { ...state.addons },
    venue: { stairs: state.venueStairs === true, floors: state.venueFloors ?? null },
  };
}

/** The inverse of cateringPayload(): a saved line read back into state. */
export function cateringStateFromPayload(payload, defaults) {
  const next = { ...defaults };
  if (payload?.pax) next.pax = payload.pax;
  // Spread onto the default rather than replacing it, so a line saved before
  // an add-on existed does not come back missing the key.
  if (payload?.addons) next.addons = { ...defaults.addons, ...payload.addons };
  if (payload?.venue) {
    next.venueStairs = payload.venue.stairs === true;
    // A floor count without stairs is contradictory; drop it with the answer.
    next.venueFloors = next.venueStairs ? (payload.venue.floors ?? null) : null;
  }
  return next;
}

export function createCateringPackageBuilder(serviceKey) {
  const config = getPackageConfig(serviceKey);
  const isClassic = serviceKey === "classic-catering";

  // addons is what the customer ticked; venue is what they told us about
  // access. Only the first is priced — see cateringBreakdown().
  const state = {
    step: 2,
    pax: config.minPax,
    selectedDishes: {},
    addons: { lechonChopping: false },
    venueStairs: false,
    venueFloors: null,
  };
  let container = null;

  function mount(el) {
    container = el;
    el.addEventListener("click", handleClick);
    el.addEventListener("input",  handlePaxInput);
    el.addEventListener("change", handlePaxChange);
    // Keyed by serviceKey — Basic and Classic are separate builders.
    persistState(el, serviceKey, state);
    restoreFromOrder();
    renderStep();
  }

  /**
   * The line this builder already put in the order, if there is one.
   *
   * Adding replaces rather than appends -- coming back to change the pax
   * count or a course is editing this package, not ordering a second one.
   * It used to do that silently, so the screen now says it is an edit and
   * the button says "Update" rather than "Continue".
   */
  function existingLine() {
    return getOrderLines().find((l) => l.service === serviceKey) ?? null;
  }

  /**
   * Puts the pax count back to what is in the order.
   *
   * The saved draft normally covers this, and the dish choices with it. This
   * is the fallback for when it does not -- a draft is per tab and the order
   * outlives it -- so the customer at least does not find their guest count
   * reset to the minimum.
   */
  function restoreFromOrder() {
    Object.assign(state, cateringStateFromPayload(existingLine()?.payload, state));
  }

  /**
   * The order's lines and its total, from the module the server prices with.
   *
   * Nothing in this file multiplies a rate by a head count any more. The
   * figure on screen and the figure the server verifies have to come from
   * the same place: ghl-inquiry.js compares them exactly, and writes the
   * server's to the opportunity as the booking's value.
   */
  function breakdown() {
    return cateringBreakdown(config.pricePerHead, state.pax, state.addons);
  }

  function estimatedTotal() {
    return breakdown().total;
  }

  /**
   * What makes up the total, itemised.
   *
   * The service charge and the logistics fee used to sit in a grey "Add-ons"
   * list here, unpriced, reading as optional extras — which is how they went
   * uncharged. They are neither optional nor extra: together they are the
   * difference between ₱47,500 and ₱64,250 on a 50pax booking.
   *
   * The logistics line names what it covers. At 50 pax it is 25% on top of
   * the food, and a bare ₱12,000 against a package the customer picked for
   * its per-head price reads as a surprise rather than as a cost.
   */
  function breakdownHtml() {
    const b = breakdown();
    const row = (label, note, value) => `
      <div class="cp-breakdown__row">
        <span class="cp-breakdown__label">${label}${note ? `<small>${note}</small>` : ""}</span>
        <span class="cp-breakdown__value">${fmt(value)}</span>
      </div>`;

    return [
      row("Food", `${state.pax} guests &times; ${fmt(config.pricePerHead)}`, b.food),
      row("Service charge", `${CATERING.serviceChargePct}% of food`, b.serviceCharge),
      row(
        "Logistics &amp; setup",
        "Transport, sanitation, ingress &amp; egress, set up and pull out, "
          + "team meals, and the service staff",
        b.logistics,
      ),
      b.addons ? row("Lechon chopping", "Carving service", b.addons) : "",
    ].join("");
  }

  const costLines = () => cateringCostLines(config, state);

  /**
   * Adds the package to the order.
   *
   * One package is one line, priced per head. The dishes chosen from each
   * course do not move the figure, so they travel as contents. The quantity
   * is not editable — more guests means a higher pax count, not a second
   * package.
   *
   * Replaces rather than appends: coming back to change the pax count or a
   * course is editing this package, not ordering another one.
   */
  function addToOrder() {
    const without = getOrderLines().filter((l) => l.service !== serviceKey);
    setOrderLines(addLine(without, {
      service: serviceKey,
      serviceLabel: config.name,
      title: config.name,
      subtitle: `${state.pax} pax`,
      unitPrice: estimatedTotal(),
      qtyEditable: false,
      contents: [
        ...CLASSIC_MENU
          .filter((cat) => !cat.classicOnly || isClassic)
          .filter((cat) => state.selectedDishes[cat.key])
          .map((cat) => `${cat.label}: ${state.selectedDishes[cat.key]}`),
        ...costLines(),
      ],
      payload: cateringPayload(serviceKey, state),
    }));
  }

  function renderStep() {
    container.querySelectorAll("[data-cp-panel]").forEach((p) => {
      p.hidden = Number(p.dataset.cpPanel) !== state.step;
    });
    updateStepper();
    if (state.step === 2) renderPackagePanel();
    else if (state.step === 3) renderDishStep();
  }

  // The builder is always the order's second step. Its own internal steps
  // ended when the shared checkout took over, so there is nothing left here
  // for the spine to track.
  function updateStepper() {
    const host = container.querySelector("[data-stepper]");
    drawStepper(host, STEP_BUILD, host?.dataset.stepperLabel);
  }

  function renderPackagePanel() {
    const panel = container.querySelector("[data-cp-panel='2']");
    if (!panel) return;

    const coursesHtml = config.courses
      .map((c) => `<span class="item-chip">${esc(c)}</span>`)
      .join("");

    const inclusionsHtml = config.inclusions
      .map((i) => `<li>${esc(i)}</li>`).join("");

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 4 · ${existingLine() ? "Change your package" : "Package details"}</p>
          <h2>${esc(config.name)}</h2>
          ${substepsHtml(BUILD_SUBSTEPS, 0, "data-cp-substep")}
        </div>
        <div class="cp-rate-badge">
          <span>${fmt(config.pricePerHead)}</span>
          <small>per head</small>
        </div>
      </div>

      <!-- Photo beside the estimator rather than above it. The Basic
           package photograph is upright, and a full-width band showed about
           an eighth of it. -->
      <div class="builder-split">
        <div class="builder-split__photo">
          ${photoHtml(cateringPhoto(serviceKey), `${config.name} setup`, "hero", `Sample ${config.name} setup`)}
        </div>
        <div class="builder-split__main">
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
                <p class="cp-total__label">Total</p>
                <p class="cp-total__amount" data-cp-total aria-live="polite" aria-atomic="true">${fmt(estimatedTotal())}</p>
                <p class="cp-total__note">${DELIVERY_NOTE}</p>
              </div>
            </div>

            <!-- Under the figure rather than above it, and titled, so the
                 rows read as an explanation of the total instead of as a
                 sum the customer is expected to do themselves. -->
            <div class="cp-breakdown">
              <p class="cp-breakdown__title">What makes up this total</p>
              <div data-cp-breakdown>${breakdownHtml()}</div>
            </div>
          </div>

          <!-- Beside the price rather than below it. The estimator alone is
               ~173px against a photo nearly twice that, and the courses are
               what a customer weighs while setting a guest count. -->
          <div class="cp-section">
            <p class="cp-section__title">What's included in the menu</p>
            <div class="item-chips">${coursesHtml}</div>
          </div>
        </div><!-- /.builder-split__main -->
      </div><!-- /.builder-split -->

      <div class="cp-section">
        <p class="cp-section__title">Full inclusions</p>
        <ul class="gz-items-list gz-items-list--flow">${inclusionsHtml}</ul>
      </div>

      <div class="cp-section">
        <p class="cp-section__title">Optional add-ons</p>

        <label class="cp-addon">
          <input
            type="checkbox" class="cp-addon__check" data-cp-addon="lechonChopping"
            ${state.addons.lechonChopping ? "checked" : ""}
          />
          <span class="cp-addon__body">
            <span class="cp-addon__name">
              Lechon chopping
              <span class="cp-addon__price">+${fmt(CATERING.lechonChopping)}</span>
            </span>
            <span class="cp-addon__note">
              Minimum 2 lechons. You provide the lechon &mdash; our team carves
              and serves it for your guests.
            </span>
          </span>
        </label>

        <!-- A question, not a price. Stair hauling is charged per floor per
             staff member, and how many staff to send is decided after the
             booking is confirmed — so neither the customer nor this screen
             can work it out. Asking here is what stops it being a surprise
             on the day. -->
        <div class="cp-addon cp-addon--ask">
          <span class="cp-addon__name">Venue access</span>
          <div class="cp-venue">
            <label class="cp-venue__opt">
              <input
                type="radio" name="cp-venue-${esc(serviceKey)}" value="ground"
                data-cp-venue ${state.venueStairs ? "" : "checked"}
              />
              <span>Ground floor, or lift available</span>
            </label>
            <label class="cp-venue__opt">
              <input
                type="radio" name="cp-venue-${esc(serviceKey)}" value="stairs"
                data-cp-venue ${state.venueStairs ? "checked" : ""}
              />
              <span>Stairs only</span>
            </label>
          </div>
          <div class="cp-venue__floors" data-cp-floors ${state.venueStairs ? "" : "hidden"}>
            <label class="cp-venue__floors-label">
              How many floors up?
              <input
                type="number" class="cp-venue__floors-input" data-cp-floors-input
                min="1" max="20" inputmode="numeric" placeholder="2"
                value="${state.venueFloors ?? ""}"
              />
            </label>
            <p class="cp-addon__note">
              A hauling fee applies for stairs access. We&rsquo;ll confirm the
              exact amount with you before your event &mdash; it depends on how
              many staff we send.
            </p>
          </div>
        </div>
      </div>

      <div class="step-nav step-nav--single">
        <button class="primary-button" type="button" data-cp-continue>
          Choose your dishes →
        </button>
      </div>
    `;
  }

  /** The total and the rows that explain it, always repainted together. */
  function paintTotal() {
    const totalEl = container.querySelector("[data-cp-total]");
    const rowsEl  = container.querySelector("[data-cp-breakdown]");
    setPriceText(totalEl, fmt(estimatedTotal()));
    if (rowsEl) rowsEl.innerHTML = breakdownHtml();
  }

  function updateEstimator() {
    const displayEl = container.querySelector("[data-cp-pax-display]");
    if (displayEl) displayEl.value = state.pax;
    paintTotal();
  }

  /**
   * The add-on tick and the venue answer.
   *
   * Handled on "change" rather than "click" beside the pax field: a checkbox
   * read during a click handler still reports the value it had before the
   * click in some browsers, which would show the price of the opposite of
   * what the customer just did.
   */
  function handleAddonChange(e) {
    const addon = e.target.closest("[data-cp-addon]");
    if (addon) {
      state.addons = { ...state.addons, [addon.dataset.cpAddon]: addon.checked };
      paintTotal();
      return true;
    }

    const venue = e.target.closest("[data-cp-venue]");
    if (venue) {
      state.venueStairs = venue.value === "stairs";
      // Dropping the floor count with the answer, so a customer who picks
      // stairs, types 3, then switches back to ground does not leave "3
      // floors up" on an order that no longer says stairs.
      if (!state.venueStairs) state.venueFloors = null;
      const floorsEl = container.querySelector("[data-cp-floors]");
      if (floorsEl) floorsEl.hidden = !state.venueStairs;
      return true;
    }

    const floors = e.target.closest("[data-cp-floors-input]");
    if (floors) {
      const n = parseInt(floors.value, 10);
      state.venueFloors = Number.isFinite(n) && n > 0 ? n : null;
      return true;
    }

    return false;
  }

  function updateDishCategory(key, catEl) {
    if (!catEl) catEl = container.querySelector(`[data-cp-cat="${key}"]`);
    if (!catEl) return;
    const selected = state.selectedDishes[key];
    catEl.querySelectorAll("[data-cp-dish]").forEach((pill) => {
      pill.classList.toggle("is-active", pill.dataset.cpDish === selected);
    });
    const statusEl = catEl.querySelector("[data-cp-dish-status]");
    if (statusEl) {
      statusEl.className = selected ? "cp-dish-category__check" : "cp-dish-category__pick-hint";
      statusEl.textContent = selected ? "✓ Selected" : "Pick 1";
    }
    if (selected) catEl.classList.remove("is-invalid");
  }

  function renderDishStep() {
    const panel = container.querySelector("[data-cp-panel='3']");
    if (!panel) return;

    const dishCategoriesHtml = CLASSIC_MENU
      .filter((cat) => !cat.classicOnly || isClassic)
      .map((cat) => {
        const selected = state.selectedDishes[cat.key];
        const itemsHtml = cat.items.map((dish) => `
          <button type="button" class="cp-radio-item${selected === dish ? " is-active" : ""}" data-cp-dish="${esc(dish)}">
            <span class="cp-radio-dot"></span>
            <span class="cp-radio-label">${esc(dish)}</span>
          </button>
        `).join("");
        return `
          <div class="cp-dish-category" data-cp-cat="${esc(cat.key)}">
            <div class="cp-dish-category__header">
              <p class="cp-dish-category__label">
                ${esc(cat.label)}
                ${cat.classicOnly ? `<span class="cp-classic-only">Classic</span>` : ""}
              </p>
              <span class="${selected ? "cp-dish-category__check" : "cp-dish-category__pick-hint"}" data-cp-dish-status>
                ${selected ? "✓ Selected" : "Pick 1"}
              </span>
            </div>
            <div class="cp-radio-list">${itemsHtml}</div>
          </div>
        `;
      }).join("");

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 4 · ${existingLine() ? "Change your dishes" : "Choose your dishes"}</p>
          <h2>Pick one from each category</h2>
          ${substepsHtml(BUILD_SUBSTEPS, 1, "data-cp-substep")}
        </div>
      </div>

      <div class="cp-dish-list">${dishCategoriesHtml}</div>

      <div class="step-nav step-nav--single">
        <button class="primary-button" type="button" data-cp-continue>
          ${existingLine() ? "Update your order →" : "Continue to Details →"}
        </button>
      </div>
    `;
  }

  function validateDishSelections() {
    const required = CLASSIC_MENU.filter((cat) => !cat.classicOnly || isClassic);
    const missing  = required.filter((cat) => !state.selectedDishes[cat.key]);
    if (missing.length === 0) return true;

    let firstEl = null;
    missing.forEach((cat) => {
      const el = container.querySelector(`[data-cp-cat="${cat.key}"]`);
      if (!el) return;
      el.classList.add("is-invalid");
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
      if (!firstEl) firstEl = el;
    });
    // "center" rather than "start": an unfilled course wants its label and
    // its message both visible, not pinned to the top edge with the reason
    // for the complaint scrolled off above it. Instant like everything else —
    // the shake is what draws the eye.
    jumpTo(firstEl, "center");
    return false;
  }

  function handlePaxInput(e) {
    // Also on "input", not just "change": a customer who types the floor
    // count and goes straight to Continue without leaving the field would
    // otherwise submit an order that says stairs with no number on it.
    // Repainting is a pure re-render, so the duplicate from a control that
    // fires both events costs nothing.
    if (handleAddonChange(e)) return;

    const input = e.target.closest("[data-cp-pax-display]");
    if (!input) return;
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val > 0) {
      state.pax = val;
      // Was `val * config.pricePerHead` — a second, independent copy of the
      // calculation living next to the first. It would have kept painting
      // the food-only figure while the stepper painted the real one, so the
      // total depended on whether you typed the guest count or clicked it.
      paintTotal();
    }
  }

  function handlePaxChange(e) {
    // The add-ons share this listener; they fire "change" like the pax field.
    if (handleAddonChange(e)) return;

    const input = e.target.closest("[data-cp-pax-display]");
    if (!input) return;
    const val = parseInt(input.value, 10);
    state.pax = (!isNaN(val) && val >= config.minPax) ? val : config.minPax;
    updateEstimator();
  }

  function goStep(n) {
    setStepDirection(state.step, n);
    state.step = n;
    renderStep();
    // Ignored while a popstate is being applied, so going back does not
    // push the entry it just consumed.
    pushNav(serviceKey, n);
    jumpTo(container);
  }

  function handleClick(e) {
    // A finished sub-step, tapped. Backwards only: substepsHtml renders the
    // ones ahead as plain text, and goStep would otherwise skip the dish
    // validation that Continue runs.
    const substep = e.target.closest("[data-cp-substep]");
    if (substep) {
      const target = Number(substep.dataset.cpSubstep) + 2;
      if (target < state.step) goStep(target);
      return;
    }

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

    const dishPill = e.target.closest("[data-cp-dish]");
    if (dishPill) {
      const catEl = dishPill.closest("[data-cp-cat]");
      if (!catEl) return;
      const key = catEl.dataset.cpCat;
      const dish = dishPill.dataset.cpDish;
      state.selectedDishes[key] = state.selectedDishes[key] === dish ? undefined : dish;
      if (state.selectedDishes[key] === undefined) delete state.selectedDishes[key];
      updateDishCategory(key, catEl);
      return;
    }

    if (e.target.closest("[data-cp-continue]")) {
      if (state.step === 3 && !validateDishSelections()) return;
      // Step 4 was this builder's own checkout. The order is shared now, so
      // it goes to the one checkout that can price an order spanning
      // services — see party-tray-builder for what happens when it does not.
      if (state.step === 3) { addToOrder(); requestReview(); return; }
      goStep(state.step + 1);
      return;
    }
  }

  return { mount, setStep: goStep };
}
