import {
  getCateringPackages,
  getDishById,
  getPackageItems,
} from "../data/catering.js";
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
import { applyRushFee, RUSH_FEE } from "../domain/pricing.js";
import { comboTraysPhoto, photoHtml } from "./menu-photos.js";
import { setStepDirection, jumpTo, confirmOnButton } from "./ui-fx.js";
import { DELIVERY_NOTE } from "./copy.js";
import { pushNav } from "./nav-history.js";
import { persistState } from "./draft.js";
import {
  addLine, removeLine, stepQty, lineTotal, cartTotal, itemCount, dishesSelectedText,
} from "../domain/cart.js";
import { renderCartInto, cartAction, toggleExpanded } from "./order-cart.js";
import { shareOrderAs, requestReview } from "./order-shell.js";

// Sub-views within Step 1
const VIEW = { PAX: "pax", COMBO: "combo", CUSTOMIZE: "customize" };

export function createCateringBuilder() {
  const state = {
    step: 1,
    view: VIEW.PAX,       // current sub-view within step 1
    selectedPax: null,    // e.g. "15 pax"
    selectedComboId: null,
    // How many of the combo currently being looked at, before it is added.
    qty: 1,
  };
  // state.cart is a window onto the order every service shares. Until now
  // this builder held one combo id and that was the whole order, so "1×
  // Family Combo 1 and 2× Family Combo 3" could not be expressed at all.
  shareOrderAs(state);

  function mount(container) {
    // Don't pre-select — let the customer choose their pax first
    container.addEventListener("click", handleClick);
    // Key bumped with the cart's shape; see party-tray-builder for why.
    persistState(container, "combo-trays.v2", state);
    renderStep();
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function handleClick(e) {
    // Pax group card
    const paxCard = e.target.closest("[data-pax-key]");
    if (paxCard) {
      state.selectedPax = paxCard.dataset.paxKey;
      state.view = VIEW.COMBO;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Combo card
    const comboCard = e.target.closest("[data-combo-id]");
    if (comboCard) {
      state.selectedComboId = comboCard.dataset.comboId;
      state.qty = 1;
      state.view = VIEW.CUSTOMIZE;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // How many of the combo being looked at, before it joins the order.
    const catQty = e.target.closest("[data-cat-qty]");
    if (catQty) {
      state.qty = Math.min(99, Math.max(1, state.qty + Number(catQty.dataset.catQty)));
      const out = document.getElementById("cat-qty");
      if (out) out.textContent = String(state.qty);
      return;
    }

    const addBtn = e.target.closest("[data-cat-add]");
    if (addBtn) {
      addToCart();
      confirmOnButton(addBtn);
      return;
    }

    const inCart = cartAction(e);
    if (inCart) {
      if (inCart.type === "qty")    state.cart = stepQty(state.cart, inCart.id, inCart.delta);
      if (inCart.type === "remove") state.cart = removeLine(state.cart, inCart.id);
      if (inCart.type === "expand") toggleExpanded(inCart.id);
      renderCart();
      return;
    }

    // Back: customize → combo list
    if (e.target.closest("[data-back-to-combos]")) {
      state.view = VIEW.COMBO;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Back: combo list → pax selector
    if (e.target.closest("[data-back-to-pax]")) {
      state.view = VIEW.PAX;
      state.selectedComboId = null;
      renderStep1Body();
      scrollToBody();
      return;
    }

    // Step navigation
    const goStep = e.target.closest("[data-go-cat-step]");
    if (goStep) {
      setStep(parseInt(goStep.dataset.goCatStep, 10));
      return;
    }

    // Copy
    const copyBtn = e.target.closest("[data-cat-copy]");
    if (copyBtn) {
      copyOrder(copyBtn);
    }
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function getActiveCombo() {
    return getCateringPackages().find((c) => c.id === state.selectedComboId);
  }

  // Combos are fixed — dishes can't be changed. selectedName resolves the
  // canonical dish name from the dishes sheet, falling back to the package
  // row's display name.
  function getPricedItems() {
    const combo = getActiveCombo();
    if (!combo) return [];
    return getPackageItems(combo.id).map((item) => ({
      ...item,
      selectedName: getDishById(item.dishId)?.name || item.displayName,
    }));
  }

  function getTotals() {
    const combo = getActiveCombo();
    return {
      base: combo?.price || 0,
      total: combo?.price || 0,
    };
  }

  /**
   * Adds the combo on screen to the order.
   *
   * A combo is ONE priced line that contains several trays — it is not one
   * line per tray. The trays travel as `contents`, shown behind a disclosure,
   * and never touch the price.
   */
  function addToCart() {
    const combo = getActiveCombo();
    if (!combo) return;
    const items = getPricedItems();
    state.cart = addLine(state.cart, {
      service: "combo-trays",
      serviceLabel: "Combo Trays",
      title: combo.name,
      subtitle: combo.paxLabel,
      unitPrice: combo.price || 0,
      qty: state.qty,
      contents: items.map((item) => `${item.traySize} — ${item.selectedName}`),
      payload: { comboId: combo.id, paxLabel: combo.paxLabel },
    });
    state.qty = 1;
    renderCart();
    const el = document.getElementById("cat-cart-section");
    if (el) {
      el.classList.add("cart-flash");
      setTimeout(() => el.classList.remove("cart-flash"), 400);
    }
  }

  function renderCart() {
    renderCartInto(document.getElementById("cat-cart-section"), state.cart, {
      emptyText: "No combos yet. Pick a group size, choose a combo, then tap Add to Order.",
      forwardLabel: "Review order &rarr;",
      forwardAttr: "data-go-review",
      note: DELIVERY_NOTE,
      serves: (lines) => {
        const n = itemCount(lines);
        return `${n} combo${n !== 1 ? "s" : ""}`;
      },
    });
  }

  // Returns distinct pax groups with metadata
  function getPaxGroups() {
    const map = new Map();
    for (const combo of getCateringPackages()) {
      const key = combo.paxLabel || "Other";
      if (!map.has(key)) {
        map.set(key, { label: key, combos: [], minPrice: Infinity, maxPrice: -Infinity, isSpecial: false });
      }
      const g = map.get(key);
      g.combos.push(combo);
      if (combo.price < g.minPrice) g.minPrice = combo.price;
      if (combo.price > g.maxPrice) g.maxPrice = combo.price;
      if (combo.group === "Special Package") g.isSpecial = true;
    }
    // Order by the first number in the label ("50–70 pax" -> 50) so the
    // tiers read 15 -> 25 -> 45 -> 50–70 -> 100. Map preserves insertion
    // order, which is just the sequence the rows arrive from Supabase —
    // that had "50–70 pax" listed ahead of "15 pax". Anything without a
    // number sorts last. Display only; nothing downstream depends on it.
    const paxSortKey = (label) => {
      const firstNumber = String(label).match(/\d+/);
      return firstNumber ? Number(firstNumber[0]) : Number.POSITIVE_INFINITY;
    };
    return [...map.values()].sort((a, b) => paxSortKey(a.label) - paxSortKey(b.label));
  }

  function getCombosForPax(paxKey) {
    return getCateringPackages().filter((c) => c.paxLabel === paxKey);
  }

  // ── Step control ──────────────────────────────────────────────────────────

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
    pushNav("catering", step);
    jumpTo(document.getElementById("builder-catering"));
  }

  /**
   * Combo Trays runs three views inside step 1 — pax, then combos, then the
   * customiser — and each swap is as much a change of screen as a step is,
   * so each one lands where a step change lands.
   *
   * The target is the whole builder, not #cat-step1-body. The body starts
   * below both the stepper and the "Choose a Combo Package" heading, so
   * scrolling to it put those above the fold and dropped you straight onto
   * the photograph with no indication of where you were — which read as
   * landing in the middle of the page, because in every sense that matters
   * you had.
   *
   * (It was worse before: block "nearest" moved the least it could get away
   * with, so if any part of the body was already visible it barely scrolled
   * at all.)
   */
  function scrollToBody() {
    jumpTo(document.getElementById("builder-catering"));
  }

  // ── Top-level render ──────────────────────────────────────────────────────

  function renderStep() {
    document.querySelectorAll("[data-cat-panel]").forEach((p) => {
      p.hidden = p.dataset.catPanel !== String(state.step);
    });
    renderStepper();
    updatePanelHeader();
    if (state.step === 1) renderStep1Body();
    if (state.step === 2) renderContact();
  }

  function updatePanelHeader() {
    const kicker = document.getElementById("cat-step-kicker");
    const title  = document.getElementById("cat-title-1");
    if (!kicker || !title) return;

    if (state.step === 1) {
      const subtitles = {
        [VIEW.PAX]:       ["Step 2 of 3 · Choose package size", "How many guests?"],
        [VIEW.COMBO]:     [`Step 2 of 3 · ${state.selectedPax}`, "Choose a combo package"],
        [VIEW.CUSTOMIZE]: ["Step 2 of 3 · Your combo", "Review your dishes"],
      };
      const [k, t] = subtitles[state.view] ?? ["Step 2 of 3", "Choose a Combo Package"];
      kicker.textContent = k;
      title.innerHTML = t;
    }
  }

  function renderStepper() {
    document.querySelectorAll(".cat-stepper__step[data-step]").forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
      const bubble = el.querySelector(".stepper__bubble");
      if (bubble) bubble.innerHTML = n < state.step ? CHECK_SVG : String(n + 1);
    });
    document.querySelectorAll(".cat-stepper__connector").forEach((c, i) => {
      c.classList.toggle("is-completed", i < state.step);
    });
  }

  // ── Sub-view router ───────────────────────────────────────────────────────

  function renderStep1Body() {
    const body = document.getElementById("cat-step1-body");
    if (!body) return;

    // Animate transition
    body.classList.remove("cat-view-fade");
    void body.offsetWidth;
    body.classList.add("cat-view-fade");

    if (state.view === VIEW.PAX)       body.innerHTML = buildPaxSelector();
    if (state.view === VIEW.COMBO)     body.innerHTML = buildComboGrid();
    if (state.view === VIEW.CUSTOMIZE) body.innerHTML = buildCustomizer();
    // The order sits outside the sub-views, so it survives someone going
    // back to pick a second combo — which is the entire point of the cart.
    renderCart();
  }

  // ── Sub-view A: Pax Selector ──────────────────────────────────────────────

  function buildPaxSelector() {
    const groups  = getPaxGroups();
    const regular = groups.filter(g => !g.isSpecial);
    const special = groups.filter(g => g.isSpecial);

    return `
      <div class="pax-selector">
        <p class="pax-selector__hint">Select the group size closest to your event to see matching packages.</p>
        <div class="pax-grid">
          ${regular.map(g => buildPaxCard(g)).join("")}
        </div>
        ${special.length > 0 ? `
          <div class="pax-special-header">
            <div class="pax-special-header__line"></div>
            <div class="pax-special-header__label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Limited Time Offer
            </div>
            <div class="pax-special-header__line"></div>
          </div>
          <div class="pax-grid pax-grid--special">
            ${special.map(g => buildPaxCard(g, true)).join("")}
          </div>
        ` : ""}
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>← Services</button>
      </div>
    `;
  }

  function buildPaxCard(group, isSpecial = false) {
    const count = group.combos.length;
    const priceRange = group.minPrice === group.maxPrice
      ? formatPeso(group.minPrice)
      : `${formatPeso(group.minPrice)} – ${formatPeso(group.maxPrice)}`;

    const paxNum = group.label.replace(/[^0-9\-–]/g, "").trim() || group.label;

    return `
      <button type="button" class="pax-card${isSpecial ? " pax-card--special" : ""}" data-pax-key="${esc(group.label)}">
        ${isSpecial ? `<div class="pax-card__offer-tag">Limited Time</div>` : ""}
        <div class="pax-card__num">${esc(paxNum)}</div>
        <div class="pax-card__label">pax</div>
        <div class="pax-card__divider"></div>
        <div class="pax-card__price">${esc(priceRange)}</div>
        <div class="pax-card__count">${count} package${count !== 1 ? "s" : ""}</div>
        <div class="pax-card__cta">Select →</div>
      </button>
    `;
  }

  // ── Sub-view B: Combo Grid ────────────────────────────────────────────────

  function buildComboGrid() {
    const combos = getCombosForPax(state.selectedPax);

    // Group by tray-size tier (combo name prefix like "Family", "Feast", etc.)
    const tiers = {};
    for (const combo of combos) {
      // Use combo.group if available, otherwise derive from name prefix
      const tier = combo.group || deriveTier(combo.name);
      if (!tiers[tier]) tiers[tier] = [];
      tiers[tier].push(combo);
    }

    const tiersHtml = Object.entries(tiers).map(([tier, tierCombos]) => `
      <div class="combo-tier">
        <p class="combo-tier__label section-kicker">${esc(tier)}</p>
        <div class="combo-grid">
          ${tierCombos.map((combo) => buildComboCard(combo)).join("")}
        </div>
      </div>
    `).join("");

    // One photo for the service, above all the tiers — not one per combo.
    // The 30 combos each hold a different dish lineup and are fixed once
    // booked, so a photo attached to any single group would be claiming a
    // precision there are no photos for yet.
    return `
      ${photoHtml(comboTraysPhoto(), "Combo party tray spread", "hero", "Sample combo tray spread")}
      <div class="combo-browser">
        <div class="combo-tier-list">
          ${tiersHtml}
        </div>
      </div>
      <div class="step-nav">
        <button class="text-button" type="button" data-back-to-pax>← Change group size</button>
      </div>
    `;
  }

  function deriveTier(name) {
    const match = name.match(/^(Family|Feast|XXXL|Premium|Combo)/i);
    return match ? match[1] + " Combos" : "Packages";
  }

  function buildComboCard(combo) {
    // Every dish, not the first four with "+2 more…" under them. What makes
    // one combo different from the next is precisely which dishes are in it,
    // so hiding two of six withheld the only thing the customer is choosing
    // between — and a combo runs to six or eight short lines, so there was
    // nothing to save.
    const items = getPackageItems(combo.id);
    const isActive = combo.id === state.selectedComboId;

    return `
      <button type="button" class="combo-card${isActive ? " is-active" : ""}" data-combo-id="${esc(combo.id)}" aria-pressed="${isActive}">
        <div class="combo-card__top">
          <strong>${esc(combo.name)}</strong>
          <b>${formatPeso(combo.price)}</b>
        </div>
        <div class="combo-card__meta">
          <span>${items.length} tray slots</span>
        </div>
        <ul class="combo-card__items">
          ${items.map((item) => `<li>${esc(formatItemLabel(item))}</li>`).join("")}
        </ul>
        <div class="combo-card__cta">
          ${isActive ? `${CHECK_SVG} Selected` : "Select →"}
        </div>
      </button>
    `;
  }

  // ── Sub-view C: Customizer ────────────────────────────────────────────────

  function buildCustomizer() {
    const combo = getActiveCombo();
    if (!combo) return `<p class="empty-state">No combo selected.</p>`;

    const items = getPricedItems();
    const totals = getTotals();

    return `
      <div class="customize-view">

        <!-- Selected combo banner -->
        <div class="customize-banner">
          <div class="customize-banner__info">
            <p class="section-kicker">Selected combo · ${esc(state.selectedPax)}</p>
            <h3>${esc(combo.name)}</h3>
            <p class="customize-banner__note">Party Tray combos are fixed and cannot be changed or tweaked.</p>
          </div>
          <div class="customize-banner__price">
            <span>Package price</span>
            <strong>${formatPeso(combo.price)}</strong>
          </div>
        </div>

        <!-- Two-column layout: dishes + live quote -->
        <div class="customize-layout">
          <div class="swap-list" id="cat-swap-list">
            ${items.map((item) => buildSwapRow(item)).join("")}
          </div>

          <!-- Sticky quote panel -->
          <aside class="quote-panel" id="cat-quote-panel" aria-label="Price summary">
            <p class="section-kicker">Price Summary</p>
            <div class="quote-panel__total" id="cat-quote-total">${formatPeso(totals.total)}</div>
            <dl class="quote-panel__lines">
              <div>
                <dt>Serves</dt>
                <dd>${esc(combo.paxLabel)}</dd>
              </div>
              <div>
                <dt>Package total</dt>
                <dd>${formatPeso(totals.base)}</dd>
              </div>
            </dl>
            <div class="quote-panel__qty">
              <span class="quote-panel__qty-label">How many?</span>
              <div class="review-item__controls">
                <button type="button" class="qty-btn" data-cat-qty="-1" aria-label="Fewer of this combo">&minus;</button>
                <span class="review-item__qty" id="cat-qty">${state.qty}</span>
                <button type="button" class="qty-btn" data-cat-qty="1" aria-label="More of this combo">+</button>
              </div>
            </div>
          </aside>
        </div>
        <div class="step-nav">
          <button class="text-button" type="button" data-back-to-combos>← Back</button>
          <button class="primary-button" type="button" data-cat-add>Add to Order</button>
        </div>
      </div>
    `;
  }

  function buildSwapRow(item) {
    return `
      <article class="swap-row is-fixed">
        <div class="swap-row__dish">
          <span class="swap-row__cat">${esc(item.category)}</span>
          <strong class="swap-row__name">${esc(item.displayName)}</strong>
          <span class="swap-row__size">${esc(item.traySize)} tray · ${item.quantity > 1 ? `${item.quantity}×` : "1 tray"}</span>
        </div>
        <div class="swap-row__included">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Included</span>
        </div>
      </article>`;
  }

  // ── Step 2: Contact ───────────────────────────────────────────────────────
  //
  // There used to be a "Review Quote" step between the combo customiser and
  // this one. It re-listed the same dishes with the same "Included" tags and
  // the same package price the customiser was already showing on screen — an
  // extra click that told the customer nothing new. Every other builder is
  // Select → Build → Confirm; this one now matches.

  function renderContact() {
    const panel = document.querySelector("[data-cat-panel='2']");
    if (!panel) return;
    if (!state.cart.length) return;

    // Each combo is one fixed price; the trays inside it are listed as what
    // is included rather than as priced lines of their own.
    const summaryRows = state.cart.flatMap((line) => [
      {
        label: `${line.qty > 1 ? `${line.qty}× ` : ""}${line.title} · serves ${line.subtitle}`,
        value: formatPeso(lineTotal(line)),
      },
      ...line.contents.map((c) => ({ label: c, value: "Included" })),
    ]);

    panel.innerHTML = buildContactPanel({
      backAttr: 'data-go-cat-step="1"',
      copyAttr: "data-cat-copy",
      statusId: "cat-copy-status",
      summaryRows,
      orderTotal: cartTotal(state.cart),
    });
    attachInlineValidation(panel);
    attachFormPickers(panel);
  }

  // ── Copy + submit to GHL ──────────────────────────────────────────────────

  async function copyOrder(btn) {
    const { valid, values } = validateAndRead();
    if (!valid) {
      // Autofill doesn't fire input events — poll and clear any filled fields
      const panel = document.querySelector("[data-cat-panel='2']");
      const t = setInterval(() => {
        clearFilledErrors(panel);
        if (!panel?.querySelector(".form-field__input.is-invalid")) clearInterval(t);
      }, 150);
      setTimeout(() => clearInterval(t), 5000);
      return;
    }

    if (!state.cart.length) return;
    const finalTotal = applyRushFee(cartTotal(state.cart), values.rushOrder);
    const statusEl = document.getElementById("cat-copy-status");

    const orderLines = [
      ...state.cart.map((line) =>
        `Package  : ${line.qty > 1 ? `${line.qty}× ` : ""}${line.title} (serves ${line.subtitle}) — ${formatPeso(lineTotal(line))}`),
      ...(values.rushOrder ? [`Rush fee : +${formatPeso(RUSH_FEE)}`] : []),
      `Total    : ${formatPeso(finalTotal)}`,
    ];
    // Every tray in every combo, grouped under the combo it belongs to, so a
    // two-combo order does not arrive as one undifferentiated list.
    const dishLines = state.cart.flatMap((line) => [
      `${line.qty > 1 ? `${line.qty}× ` : ""}${line.title}:`,
      ...line.contents.map((c) => `  • ${c}`),
    ]);

    // One string for both the GHL note and the clipboard copy.
    const text = buildInquiryText("Combo Party Trays", orderLines, values, dishLines);

    const originalBtnHTML = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;
    }

    // Send to GHL first — clipboard is best-effort only
    const payload = {
        contact: values,
        // Combos are sold at a fixed package price; the dishes inside come
        // from fixed slots and do not move the figure. So the id is the
        // whole of what the server needs.
        lineItems: {
          service: "combo-trays",
          lines: state.cart.map((line) => ({ packageId: line.payload.comboId, qty: line.qty })),
          rush: values.rushOrder,
        },
        opportunityName: `${values.firstName} ${values.lastName} · ${values.branch} · Catering`,
        monetaryValue: finalTotal,
        noteBody: text,
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type:     "Catering",
          branch:           values.branch,
          event_date:       values.eventDate,
          event_time:       values.eventTime,
          package_name:     state.cart.map((l) => (l.qty > 1 ? `${l.qty}× ${l.title}` : l.title)).join(", "),
          pax_count:        [...new Set(state.cart.map((l) => l.subtitle))].join(", "),
          dishes_selected:  dishesSelectedText(state.cart, formatPeso),
          event_notes:      values.note,
          receive_method:   values.fulfilment,
          delivery__pickup_time: values.fulfilmentTime,
          contacted_via_social: values.contactedViaSocial,
          social_profile_name:  values.socialProfileName,
          // "opportunity.rush_order" — see party-tray-builder.js for why
          // this is blank rather than "No" on a non-rush order.
          rush_order: values.rushOrder ? `Yes (+${formatPeso(RUSH_FEE)})` : "",
        },
    };

    const panel = document.querySelector("[data-cat-panel='2']");

    await submitInquiry({
      payload,
      panel,
      onSuccess: (result) => {
        // Clipboard is best-effort — an embedding iframe can block it.
        try { navigator.clipboard.writeText(text); } catch { /* iframe blocked */ }
        if (panel) renderSuccess(panel, { lines: state.cart, total: finalTotal, values, attached: result?.attached });
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

  function renderSuccess(panel, { lines, total, values, attached }) {
    const packages = lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.title}` : l.title)).join(", ");
    const serves = [...new Set(lines.map((l) => l.subtitle))].join(", ");
    renderInquirySent(panel, {
      attached,
      firstName: values.firstName,
      rows: [
        { label: "Service",    value: "Combo Party Trays" },
        { label: packages.includes(",") ? "Packages" : "Package", value: packages },
        { label: "Serves",     value: serves },
        { label: "Event date", value: values.eventDate },
        { label: "Branch",     value: values.branch },
        ...(values.rushOrder ? [{ label: "Rush order", value: `Yes (+${formatPeso(RUSH_FEE)})` }] : []),
        { label: "Receive",    value: values.fulfilment },
        { label: fulfilmentTimeLabel(values.fulfilment), value: values.fulfilmentTime },
        { label: "Name",       value: `${values.firstName} ${values.lastName}` },
      ],
      priceLabel: "Package price",
      priceValue: formatPeso(total),
    });
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  function formatItemLabel(item) {
    const qty = item.quantity > 1 ? `${item.quantity}× ` : "";
    return `${qty}${item.traySize} ${item.displayName}`.trim();
  }

  function formatPeso(n) {
    return `PHP ${Number(n || 0).toLocaleString("en-PH")}`;
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

// ── SVG constants ─────────────────────────────────────────────────────────────

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const BACK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
