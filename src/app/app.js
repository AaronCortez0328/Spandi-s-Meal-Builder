import { loadPartyTrayData } from "../data/party-trays.js";
import { loadCateringData } from "../data/catering.js";
import { prepareChangeCart } from "./change-prefill.js";
import { touchChange, clearExpiry } from "../domain/change-session.js";
import { loadPackedMealsData } from "../data/packed-meals.js";
import { loadGrazingData } from "../data/grazing.js";
import { loadFullServiceCateringData } from "../data/full-service-catering.js";
import { loadServices, isServiceActive } from "../data/services.js";
import { loadBlockedDates } from "../data/blocked-dates.js";
import { badgeFor } from "../data/badges.js";
import { checkDateAvailability } from "./contact-form.js";
import { createCateringBuilder } from "./catering-builder.js";
import { createPartyTrayBuilder } from "./party-tray-builder.js";
import { createPackedMealsBuilder } from "./packed-meals-builder.js";
import { createGrazingBuilder } from "./grazing-builder.js";
import { createCateringPackageBuilder } from "./catering-package-builder.js";
import { createCustomBuilder, renderCustomServiceCards, getCustomService } from "./custom-service.js";
import { jumpTo } from "./ui-fx.js";
import { initNavHistory, pushNav, lastPlace } from "./nav-history.js";
import {
  restoreOrder, onOrderChange, renderReview, onEditRequested,
  renderCheckout, submitOrder, publishOrderToParent, listenForParentCartTap, requestEdit,
  getOrderLines, setOrderLines, clearOrder, onReviewRequested, orderCount, orderTotal,
} from "./order-shell.js";
import { cartAction, toggleExpanded } from "./order-cart.js";
import { formatPeso } from "../domain/pricing.js";
import { stepQty, removeLine, setVariant } from "../domain/cart.js";

const PRICE_POLL_MS = 30_000;

const SERVICE_TITLES = {
  catering:            "Combo Party Trays",
  "party-trays":       "Party Tray Builder",
  "packed-meals":      "Packed Meals",
  "grazing-table":     "Grazing Table",
  "grazing-board":     "Grazing Board",
  "basic-catering":    "Basic Catering Package",
  "classic-catering":  "Classic Catering Package",
};

const HEADER_MAP = {
  catering:            ["Combo Party Trays",        "Packages for 15 to 100 pax"],
  "party-trays":       ["Party Trays",              "À la carte Family, Feast and XXXL"],
  "packed-meals":      ["Packed Meals",             "Per-person estimates"],
  "grazing-table":     ["Grazing Table",            "50–200 pax · Fixed spread"],
  "grazing-board":     ["Grazing Board",            "15–100 pax · Fixed board"],
  "basic-catering":    ["Basic Catering Package",   "PHP 950/head · Min. 50 pax"],
  "classic-catering":  ["Classic Catering Package", "PHP 1,250/head · Min. 50 pax"],
};

export function createApp() {
  let mode = null;
  // Whether the order screen was opened from the navbar (a lookup) rather
  // than reached through the flow (a step). See selectService.
  let reviewAsCart = false;
  // False until the customer has moved somewhere themselves. The first
  // selectService runs during mount and must not take focus.
  let hasNavigated = false;
  let cateringBuilder        = null;
  let partyTrayBuilder       = null;
  let packedMealsBuilder     = null;
  let grazingTableBuilder    = null;
  let grazingBoardBuilder    = null;
  let basicCateringBuilder   = null;
  let classicCateringBuilder = null;
  // One instance for every admin-created service, not one each.
  let customBuilder          = null;

  async function loadAllPrices() {
    const results = await Promise.allSettled([
      loadPartyTrayData(),
      loadCateringData(),
      loadPackedMealsData(),
      loadGrazingData(),
      loadFullServiceCateringData(),
      // Which cards may be offered at all. Rides the same poll so a service
      // the dashboard closes disappears within half a minute, like a date.
      loadServices(),
      // Rides the same 30-second poll as prices. A date the kitchen closes is
      // live for customers within half a minute, which is what the dashboard
      // team asked for and costs one more request on a cycle that was already
      // running.
      loadBlockedDates(),
    ]);
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Failed to load sheet data source ${index + 1}:`, result.reason);
      }
    });
    updateSyncIndicator(results.some((r) => r.status === "rejected") ? "error" : "ok");
  }

  async function refreshPrices() {
    await loadAllPrices();
    // Prices updated silently in memory — no forced builder re-render,
    // but the top-level service cards still need their availability synced.
    updateServiceAvailability();
    // The blocked list has just been refreshed, so a date already sitting in
    // the form may have closed since it was chosen. Without this the customer
    // fills in the rest of the page and only learns at Send — the check would
    // still catch it, but after the work rather than before. No-ops when the
    // details step is not on screen.
    checkDateAvailability();
  }

  /**
   * Fills the badge slot on every service card from src/data/badges.js.
   *
   * The markup carries an empty slot on all seven cards and the data decides
   * which get filled, rather than the badge being typed into the two cards
   * that happen to have it. Adding or moving a pick is then one line in
   * badges.js and no change here.
   *
   * Left hidden where there is no badge, and updateServiceAvailability()
   * hides it again on anything that cannot be ordered -- an unavailable card
   * says only that.
   */
  function applyServiceBadges() {
    for (const btn of document.querySelectorAll("[data-service]")) {
      const slot = btn.querySelector('[data-badge="pick"]');
      if (!slot) continue;
      const badge = badgeFor("service", btn.dataset.service);
      if (!badge) { slot.hidden = true; continue; }
      slot.textContent = badge.label;
      slot.className = `badge badge--${badge.variant}`;
      slot.hidden = false;
    }
  }

  // Toggles the "Currently Not Available" state on the service cards.
  //
  // Driven off the DOM rather than a list of slugs kept here: index.html
  // already declares every card with a data-service attribute, and that
  // attribute is the same string the meal_builder_services table is keyed by.
  // A card added to the markup and a row added to the table is the whole of
  // adding a service -- there is no third place to remember.
  //
  // This used to name four slugs explicitly and read catering_services /
  // grazing_services for their active flag, which left Combo Party Trays,
  // Party Trays and Packed Meals with no switch anywhere. All seven now ask
  // one source.
  function updateServiceAvailability() {
    // Before the walk below, not after: these cards are drawn from the table
    // rather than typed into index.html, so a card switched on in the
    // dashboard has to exist in the DOM before anything iterates [data-service]
    // looking for badges to fill or availability to stamp.
    //
    // Called on the 30-second refresh too, so a card switched off disappears
    // without a reload — and one switched on appears the same way.
    renderCustomServiceCards();

    applyServiceBadges();

    for (const btn of document.querySelectorAll("[data-service]")) {
      // isServiceActive fails open: an unreadable table, a slug with no row
      // and a null all answer true. Only a literal false closes a card.
      const isActive = isServiceActive(btn.dataset.service);

      btn.classList.toggle("service-card--disabled", !isActive);
      // aria-disabled, never the disabled attribute. disabled takes the card
      // out of the tab order, so a keyboard or screen-reader customer could
      // not reach it to find out the service was unavailable -- it simply
      // was not there. aria-disabled says the same thing to assistive tech
      // while leaving the card reachable, and the badge inside the button
      // is part of what gets announced on focus. The click handler already
      // refuses anything carrying it, so nothing can be ordered this way.
      btn.setAttribute("aria-disabled", String(!isActive));

      const unavailableBadge = btn.querySelector('[data-badge="unavailable"]');
      if (unavailableBadge) unavailableBadge.hidden = isActive;

      // A card that cannot be ordered says exactly that and nothing else.
      // Below 860px both badges share one grid cell, so a second would land
      // on top of the first -- and badging something the customer is then
      // refused is the fault this app removed everywhere else.
      const pickBadge = btn.querySelector('[data-badge="pick"]');
      if (pickBadge && !isActive) pickBadge.hidden = true;
    }
  }

  async function manualRefresh() {
    const btn = document.getElementById("price-refresh-btn");
    if (btn) btn.disabled = true;
    updateSyncIndicator("syncing");
    try {
      await refreshPrices();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function updateSyncIndicator(status) {
    const el = document.getElementById("price-sync-status");
    if (!el) return;
    if (status === "syncing") {
      el.innerHTML = `<span class="sync-text sync-text--syncing">↻ Syncing…</span>`;
      return;
    }
    const time = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const isError = status === "error";
    el.innerHTML = `
      <span class="sync-text ${isError ? "sync-text--error" : "sync-text--ok"}">
        ${isError ? `Sheet error · ${time}` : `Synced ${time}`}
      </span>
      <button type="button" id="price-refresh-btn" class="sync-refresh-btn" title="Refresh prices now" aria-label="Refresh prices now">↻</button>
    `;
  }

  /**
   * Turns a ?service= value into a service to open, or null for the chooser.
   *
   * Matched against the cards in the DOM rather than a list kept here, for
   * two reasons. A hardcoded list is a second place for the service keys to
   * live and therefore a second place for them to fall out of step with the
   * markup. And it avoids interpolating a URL parameter into a selector
   * string, where a stray quote would throw rather than simply not match.
   *
   * The disabled check is the point of the whole function. Four of these
   * services carry an `active` flag from the dashboard, and
   * updateServiceAvailability() has already stamped it onto the cards by the
   * time this runs — so asking the card is asking the same source of truth a
   * customer clicking it would hit. Without this, a link shared on Facebook
   * would keep opening a builder for something the kitchen has switched off,
   * which is the one thing a disabled card exists to prevent.
   */
  function resolveInitialService(requested) {
    if (!requested) return null;
    const card = [...document.querySelectorAll("[data-service]")]
      .find((el) => el.dataset.service === requested);
    if (!card) return null;
    if (card.disabled || card.getAttribute("aria-disabled") === "true") return null;
    return requested;
  }

  async function mount(requestedService = null) {
    showLoading(true);
    await loadAllPrices();
    updateServiceAvailability();

    // Both of these settle what is in the order, and both run BEFORE any
    // builder mounts, because a builder draws its copy of the cart as it
    // mounts and selectService only unhides it again — it does not re-render.
    // A line that arrived after the mount therefore stayed invisible until
    // the customer happened to click something.
    //
    // That was survivable for a restored draft and not for a change: the
    // whole point of arriving with your order already in the cart is seeing
    // it there.
    //
    // restoreOrder first, or it would read sessionStorage over the top of a
    // prefill. prepareChangeCart second, so it has the last word — and after
    // loadAllPrices above, because the package is rebuilt out of the
    // catalogue and it has to be the loaded one.
    restoreOrder();
    prepareChangeCart();

    const cateringEl    = document.getElementById("builder-catering");
    const partyTrayEl   = document.getElementById("builder-party-trays");
    const packedMealsEl = document.getElementById("builder-packed-meals");

    if (cateringEl)    { cateringBuilder    = createCateringBuilder();    cateringBuilder.mount(cateringEl); }
    if (partyTrayEl)   { partyTrayBuilder   = createPartyTrayBuilder();   partyTrayBuilder.mount(partyTrayEl); }
    if (packedMealsEl) { packedMealsBuilder = createPackedMealsBuilder(); packedMealsBuilder.mount(packedMealsEl); }

    const grazingTableEl    = document.getElementById("builder-grazing-table");
    const grazingBoardEl    = document.getElementById("builder-grazing-board");
    const basicCateringEl   = document.getElementById("builder-basic-catering");
    const classicCateringEl = document.getElementById("builder-classic-catering");

    if (grazingTableEl)    { grazingTableBuilder    = createGrazingBuilder("grazing-table");             grazingTableBuilder.mount(grazingTableEl); }
    if (grazingBoardEl)    { grazingBoardBuilder    = createGrazingBuilder("grazing-board");             grazingBoardBuilder.mount(grazingBoardEl); }
    if (basicCateringEl)   { basicCateringBuilder   = createCateringPackageBuilder("basic-catering");    basicCateringBuilder.mount(basicCateringEl); }
    if (classicCateringEl) { classicCateringBuilder = createCateringPackageBuilder("classic-catering");  classicCateringBuilder.mount(classicCateringEl); }

    // Mounted whether or not any custom service exists right now: the cards
    // arrive with the 30-second refresh, and a builder created only when one
    // happened to be present at boot would be missing for the customer who
    // was already on the page when it was switched on.
    const customEl = document.getElementById("builder-custom");
    if (customEl) { customBuilder = createCustomBuilder(); customBuilder.mount(customEl); }

    // The cart itself is drawn by the GHL navbar, which is on every page of
    // the site rather than only on this one. All this side does is say what
    // is in the order; see BRAND-TOKENS.md for the contract.
    publishOrderToParent();
    onOrderChange(publishOrderToParent);
    onOrderChange(announceOrder);
    // Every change to the basket says the customer is still here, which
    // pushes the change session's idle timeout out. Choosing dishes for a
    // hundred-pax package takes longer than half an hour, and a session that
    // expired under someone mid-build would drop them into ordinary ordering
    // at the worst possible moment. A no-op when nobody is changing anything.
    onOrderChange(() => touchChange());
    // The floating button on the GHL page, tapped.
    listenForParentCartTap(() => selectService("review", { asCart: true }));
    // A shared builder refusing to run its own checkout.
    onReviewRequested(() => selectService("review"));
    // A line asking to be edited, from a builder's cart or from the review.
    // The builders cannot resolve this themselves -- each one's cart is the
    // whole shared order, so a grazing line appears inside the combo
    // builder, and only this knows which builder owns which service.
    onEditRequested((id) => {
      const line = getOrderLines().find((l) => l.id === id);
      if (!line) return;
      selectService(line.service);
      // Grazing and the catering packages reopen on their own line already;
      // packed meals has to be told which, because it can hold several.
      builderFor(line.service)?.editLine?.(id);
    });

    showLoading(false);
    // Before the first selectService, not after. This claims the entry the
    // page loaded on and stamps it as the chooser; if a ?service= link then
    // pushes a second entry, Back from it lands on the chooser rather than on
    // an unstamped entry the handler ignores — which would spend one press
    // appearing to do nothing before the next press left the site.
    initNavHistory(({ service, step, view }) => {
      selectService(service);
      if (service && step !== null) builderFor(service)?.setStep(step);
      // Combo Trays moves through three views without its step changing.
      // Without this, Back from "Review your dishes" restored the step it
      // was already on and appeared to do nothing.
      if (view) builderFor(service)?.setView?.(view);
    });

    // Where to open.
    //
    // A ?service= link wins outright — somebody followed it deliberately and
    // it is about this visit, not the last one. Otherwise the screen this
    // tab was last on, so a reload does not dump a customer who was four
    // screens deep back onto the service cards as though the app had
    // forgotten them. The chooser is the answer when there is neither.
    //
    // resolveInitialService guards both the same way: a service that no
    // longer exists, or that the dashboard has switched off since, resolves
    // to null and lands on the chooser rather than on a blank panel.
    const place = requestedService ? null : lastPlace();
    const opening = resolveInitialService(requestedService ?? place?.service);
    selectService(opening);

    // Only once the service itself is known to be valid. Restoring a step
    // into a builder that never opened would leave the chooser on screen
    // with a builder silently set to step 3 behind it.
    if (opening && place && opening === place.service) {
      if (place.step !== null) builderFor(opening)?.setStep?.(place.step);
      if (place.view) builderFor(opening)?.setView?.(place.view);
    }

    setInterval(refreshPrices, PRICE_POLL_MS);

    document.addEventListener("click", (e) => {
      if (e.target.closest("#price-refresh-btn")) {
        manualRefresh();
        return;
      }
      // The review screen's own controls. Every builder handles these inside
      // its own container, and the review panel is inside none of them — so
      // without this its remove and quantity buttons are decoration.
      if (e.target.closest("#order-review")) {
        const action = cartAction(e);
        if (action) {
          if (action.type === "qty")     setOrderLines(stepQty(getOrderLines(), action.id, action.delta));
          if (action.type === "remove")  setOrderLines(removeLine(getOrderLines(), action.id));
          if (action.type === "variant") setOrderLines(setVariant(getOrderLines(), action.id, action.option));
          if (action.type === "expand")  toggleExpanded(action.id);
          // Editing leaves this screen: the line goes back to the builder
          // that knows how to price it. Grazing and the catering packages
          // reopen on their existing line already; packed meals is told
          // which one, because it can hold several.
          if (action.type === "edit") { requestEdit(action.id); return; }
          const review = document.getElementById("order-review");
          renderReview(review, { asCart: reviewAsCart });
          // Re-rendering destroys the button that was just pressed. For a
          // mouse that goes unnoticed; for a keyboard it drops focus to the
          // document and the customer loses their place with nothing
          // announced. Only when focus was actually lost — otherwise this
          // would yank it away from someone who is still using the list.
          if (document.activeElement === document.body) focusScreen(review);
          return;
        }
      }

      // The order's own screens, reachable from the bar and from a builder.
      if (e.target.closest("[data-go-review]")) {
        selectService("review");
        return;
      }
      const submitBtn = e.target.closest("[data-order-submit]");
      if (submitBtn) {
        submitOrder(submitBtn);
        return;
      }
      if (e.target.closest("[data-go-checkout]")) {
        selectService("checkout");
        return;
      }

      const serviceBtn = e.target.closest("[data-service]");
      // Ignore disabled cards (button[disabled] won't fire, but guard data-service-back too)
      if (serviceBtn && !serviceBtn.disabled && serviceBtn.getAttribute("aria-disabled") !== "true") {
        selectService(serviceBtn.dataset.service);
        return;
      }
      if (e.target.closest("[data-service-back]")) {
        selectService(null);
        return;
      }
      // "Find my booking", from the panel shown when a change timed out.
      // The site does the navigating, as it does everywhere else in this
      // flow; the chooser is where they land if it is not listening, which
      // is a working app rather than a dead button.
      if (e.target.closest("[data-change-restart]")) {
        clearExpiry();
        clearOrder();
        window.parent?.postMessage({ type: "spandis-go-status" }, "*");
        selectService(null);
        return;
      }
    });
  }

  /** The builder instance behind a service key, once mount() has made them. */

  /**
   * Says what the order now holds, for anyone not watching the screen.
   *
   * Nothing announced any of this. Adding an item, changing a quantity and
   * removing a line all redrew a total in silence -- and inconsistently so,
   * since packed meals and the catering packages each put aria-live on
   * their own figure while the shared cart every service now goes through
   * had none.
   *
   * The count and the total rather than "X added": this runs from
   * onOrderChange, which reports the order, not the edit. Saying what is
   * true after the change is honest for all three -- add, remove, and a
   * quantity that moved -- and it is the figure the customer is deciding
   * against either way.
   */
  function announceOrder() {
    const el = document.getElementById("order-live");
    if (!el) return;
    const n = orderCount();
    el.textContent = n
      ? `${n} item${n === 1 ? "" : "s"} in your order. Total ${formatPeso(orderTotal())}.`
      : "Your order is empty.";
  }
  function builderFor(service) {
    return {
      "catering":         cateringBuilder,
      "party-trays":      partyTrayBuilder,
      "packed-meals":     packedMealsBuilder,
      "grazing-table":    grazingTableBuilder,
      "grazing-board":    grazingBoardBuilder,
      "basic-catering":   basicCateringBuilder,
      "classic-catering": classicCateringBuilder,
    }[service] ?? null;
  }

  /* Where each builder starts. The history entry for "opened this service"
     has to carry it, otherwise going back from step 3 to the service would
     leave the builder sitting on step 3 while the entry claimed otherwise —
     Back would look like it had done nothing.
     Grazing and the catering packages begin at 2 because their step 1 is the
     service choice itself, which happens on the chooser. */
  const FIRST_STEP = {
    "catering":         1,
    "party-trays":      1,
    "packed-meals":     1,
    "grazing-table":    2,
    "grazing-board":    2,
    "basic-catering":   2,
    "classic-catering": 2,
  };

  /**
   * @param {string|null} service
   * @param {{asCart?: boolean}} [opts]  asCart when the customer opened the
   *   order from the navbar rather than arriving at it through the flow.
   *   Looking at your basket is not a step forward, and drawing the progress
   *   bar over it says it was.
   */
  function selectService(service, opts = {}) {
    // A slug that no longer resolves to anything on the page.
    //
    // Reached by the Back button after a custom card was switched off in the
    // dashboard mid-session: the 30-second refresh takes the card out of the
    // chooser, but a history entry still names it. Every builder would hide,
    // and so would the chooser -- `selector.hidden = mode !== null` -- leaving
    // a blank page with nothing to click.
    //
    // Asks the page rather than a list: the seven each have a builder-<slug>
    // section, a live custom service has a row, and the order's own screens
    // are neither. Anything else is a service that is not there any more, and
    // the chooser is the honest answer.
    if (service && service !== "review" && service !== "checkout"
        && !document.getElementById(`builder-${service}`)
        && !getCustomService(service)) {
      service = null;
    }

    // Leaving a builder for the chooser is a customer saying they are done
    // with that service — so it starts from the beginning next time.
    //
    // Combo Trays is the one with sub-steps inside step 1: guests, then the
    // combos for that group size, then the dishes. It kept its view, so
    // somebody who backed out to the services and came straight back landed
    // on a grid of combos for a guest count they had chosen minutes ago and
    // could no longer see — the step that decides which combos are on that
    // page, silently skipped.
    //
    // Only on the way OUT to the chooser. A reload restores the screen on
    // purpose (see lastPlace), and Back inside the builder is setView's job.
    if (service === null && mode && mode !== "review" && mode !== "checkout") {
      builderFor(mode)?.reset?.();
    }

    mode = service;
    // Remembered rather than passed once. The review re-renders whenever a
    // line changes, and a re-render that forgot this made the progress bar
    // appear out of nowhere on someone who had opened their cart from the
    // navbar -- the screen changing identity while they were using it.
    if (service === "review") reviewAsCart = Boolean(opts.asCart);
    // No-op while a popstate is being applied, and when it would repeat the
    // entry we are already on.
    pushNav(service, service ? FIRST_STEP[service] ?? null : null);

    const selector        = document.getElementById("service-selector");
    const catering        = document.getElementById("builder-catering");
    const partyTrays      = document.getElementById("builder-party-trays");
    const packedMeals     = document.getElementById("builder-packed-meals");
    const grazingTable    = document.getElementById("builder-grazing-table");
    const grazingBoard    = document.getElementById("builder-grazing-board");
    const basicCatering   = document.getElementById("builder-basic-catering");
    const classicCatering = document.getElementById("builder-classic-catering");

    if (selector)        selector.hidden        = mode !== null;
    if (catering)        catering.hidden        = mode !== "catering";
    if (partyTrays)      partyTrays.hidden      = mode !== "party-trays";
    if (packedMeals)     packedMeals.hidden     = mode !== "packed-meals";
    if (grazingTable)    grazingTable.hidden    = mode !== "grazing-table";
    if (grazingBoard)    grazingBoard.hidden    = mode !== "grazing-board";
    if (basicCatering)   basicCatering.hidden   = mode !== "basic-catering";
    if (classicCatering) classicCatering.hidden = mode !== "classic-catering";

    // Every admin-created service shares one section. Which one it is showing
    // is decided here rather than by a list of slugs -- asking the data is
    // what stops this file needing an edit each time the dashboard adds a
    // card, which is the entire point of the table.
    //
    // A slug whose row has since been switched off resolves to false, so the
    // section stays hidden and the chooser is what shows. The builder renders
    // its own "no longer available" panel for the case where the row vanishes
    // while somebody is standing in it.
    const custom = document.getElementById("builder-custom");
    const isCustom = Boolean(mode && getCustomService(mode));
    if (custom) custom.hidden = !isCustom;
    if (isCustom) customBuilder?.setService(mode);

    // The order's own screens. They are not services, so they hide every
    // builder and the chooser alike.
    const review   = document.getElementById("order-review");
    const checkout = document.getElementById("order-checkout");
    const onOrderScreen = mode === "review" || mode === "checkout";
    if (review)   review.hidden   = mode !== "review";
    if (checkout) checkout.hidden = mode !== "checkout";
    if (mode === "review") renderReview(review, { asCart: reviewAsCart });
    if (mode === "checkout") renderCheckout(checkout);

    // The bar exists to get you to the order. On the order's own screens it
    // would be a button pointing at the page you are already reading — and
    // during checkout it would offer a way out of a form someone is part way
    // through filling in.

    updateHeader();
    updatePageTitle();

    // builder-<slug> exists for the seven only. A custom slug has no section
    // of its own -- it shares builder-custom -- so resolving it by name would
    // hand jumpTo() a null and leave the customer wherever they were.
    const target = onOrderScreen
      ? document.getElementById(`order-${mode}`)
      : isCustom
        ? custom
        : mode
          ? document.getElementById(`builder-${mode}`)
          : document.getElementById("service-selector");
    jumpTo(target);

    // Scrolling moves the page; it does not move the keyboard. Every one of
    // these swaps the whole screen, so a customer who pressed "Review order"
    // with the keyboard was left focused on a button that no longer exists
    // -- focus falls back to <body>, and reaching what they just opened
    // means tabbing from the top of the document past the skip link, the
    // trust bar and the stepper.
    //
    // Not on the first call. That one runs during mount to show the opening
    // screen, and stealing focus before the customer has done anything
    // would jump a screen reader past the header they were reading.
    if (hasNavigated) focusScreen(target);
    hasNavigated = true;
  }

  /**
   * Puts focus on the heading of the screen just opened.
   *
   * The heading rather than the panel: a screen reader announces what it
   * lands on, and "Choose a combo package" says where you are, where the
   * panel would read out everything inside it. tabindex="-1" makes it
   * focusable without adding it to the tab order -- the next Tab still goes
   * to the first real control.
   */
  function focusScreen(target) {
    if (!target) return;
    const heading = target.querySelector("h1, h2") ?? target;
    heading.setAttribute("tabindex", "-1");
    // preventScroll: jumpTo has already put the screen where it belongs,
    // and focus() would otherwise scroll again to a different position.
    heading.focus({ preventScroll: true });
  }

  function updateHeader() {
    const noteEl = document.getElementById("header-note");
    if (!noteEl) return;
    const [label, sub] = mode
      ? (HEADER_MAP[mode] ?? ["Meal Estimator", "Choose a service"])
      : ["Meal Estimator", "Choose a service"];
    noteEl.innerHTML = `<span>${label}</span><strong>${sub}</strong>`;
  }

  function updatePageTitle() {
    const h1 = document.getElementById("page-title");
    if (!h1) return;
    h1.textContent = mode ? (SERVICE_TITLES[mode] ?? "Order Builder") : "Order Builder";
  }

  function showLoading(show) {
    const loadingEl  = document.getElementById("loading-state");
    const selectorEl = document.getElementById("service-selector");
    if (loadingEl)  loadingEl.hidden  = !show;
    if (selectorEl) selectorEl.hidden = show;
  }

  return { mount };
}

// The mobile sticky cart bar was removed: position:fixed can't stick inside
// the content-height iframe we're embedded in (the parent page does the
// scrolling), so it only ever sat at the bottom of the content while
// overlaying it — and it duplicated the in-flow .running-total-bar that
// Party Trays and Packed Meals already render on every screen size.
