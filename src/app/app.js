import { loadPartyTrayData } from "../data/party-trays.js";
import { loadCateringData } from "../data/catering.js";
import { loadPackedMealsData } from "../data/packed-meals.js";
import { loadGrazingData } from "../data/grazing.js";
import { loadFullServiceCateringData } from "../data/full-service-catering.js";
import { createCateringBuilder } from "./catering-builder.js";
import { createPartyTrayBuilder } from "./party-tray-builder.js";
import { createPackedMealsBuilder } from "./packed-meals-builder.js";
import { createGrazingBuilder } from "./grazing-builder.js";
import { createCateringPackageBuilder } from "./catering-package-builder.js";

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
  let cateringBuilder        = null;
  let partyTrayBuilder       = null;
  let packedMealsBuilder     = null;
  let grazingTableBuilder    = null;
  let grazingBoardBuilder    = null;
  let basicCateringBuilder   = null;
  let classicCateringBuilder = null;

  async function loadAllPrices() {
    const results = await Promise.allSettled([
      loadPartyTrayData(),
      loadCateringData(),
      loadPackedMealsData(),
      loadGrazingData(),
      loadFullServiceCateringData(),
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
    // Prices updated silently in memory — no forced UI re-render
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

  async function mount() {
    showLoading(true);
    await loadAllPrices();

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

    showLoading(false);
    selectService(null);

    setInterval(refreshPrices, PRICE_POLL_MS);

    document.addEventListener("click", (e) => {
      if (e.target.closest("#price-refresh-btn")) {
        manualRefresh();
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
    });
  }

  function selectService(service) {
    mode = service;

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

    updateHeader();
    updatePageTitle();
    hideStickyCartBar(); // reset bar when switching services

    const target = mode
      ? document.getElementById(`builder-${mode}`)
      : document.getElementById("service-selector");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
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

// ── Sticky cart bar ──────────────────────────────────────────────────────────
// Called by builders to keep the mobile sticky bar in sync.

export function updateStickyCartBar(itemCount, total) {
  const bar = document.getElementById("sticky-cart-bar");
  if (!bar) return;

  if (itemCount === 0) {
    bar.hidden = true;
    return;
  }

  const labelEl = bar.querySelector(".sticky-cart-bar__label");
  const totalEl = bar.querySelector(".sticky-cart-bar__total");

  if (labelEl) labelEl.textContent = `${itemCount} item${itemCount !== 1 ? "s" : ""} in order`;
  if (totalEl) totalEl.textContent = total;

  if (bar.hidden) {
    bar.hidden = false;
  }
}

export function hideStickyCartBar() {
  const bar = document.getElementById("sticky-cart-bar");
  if (bar) bar.hidden = true;
}
