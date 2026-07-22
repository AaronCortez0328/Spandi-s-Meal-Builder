import {
  buildContactPanel,
  attachBranchDropdown,
  validateAndRead,
  attachInlineValidation,
  clearFilledErrors,
  buildInquiryText,
} from "./contact-form.js";
import { pushInquiryToGHL } from "./ghl.js";
import { getGrazingConfig } from "../data/grazing.js";

function fmt(n) {
  return "PHP " + n.toLocaleString("en-PH");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createGrazingBuilder(serviceKey) {
  const config = getGrazingConfig(serviceKey);

  const state = { step: 2, selectedTierIdx: null };
  let container = null;

  function mount(el) {
    container = el;
    el.addEventListener("click", handleClick);
    renderStep();
  }

  function activeTier() {
    return state.selectedTierIdx !== null ? config.tiers[state.selectedTierIdx] : null;
  }

  function renderStep() {
    container.querySelectorAll("[data-gz-panel]").forEach((p) => {
      p.hidden = Number(p.dataset.gzPanel) !== state.step;
    });
    updateStepper();
    if (state.step === 2) renderPickPanel();
    else if (state.step === 3) renderContactStep();
  }

  function updateStepper() {
    container.querySelectorAll("[data-gz-step]").forEach((el) => {
      const n = Number(el.dataset.gzStep);
      el.classList.toggle("is-active", n === state.step);
      el.classList.toggle("is-completed", n < state.step);
    });
    container.querySelectorAll("[data-gz-connector]").forEach((el) => {
      el.classList.toggle("is-completed", Number(el.dataset.gzConnector) < state.step);
    });
  }

  function renderPickPanel() {
    const panel = container.querySelector("[data-gz-panel='2']");
    if (!panel) return;

    const tiersHtml = config.tiers.map((t, i) => `
      <button type="button" class="gz-tier-card${state.selectedTierIdx === i ? " is-active" : ""}" data-gz-tier="${i}">
        <div class="gz-tier-card__pax">${esc(t.paxRange)}</div>
        <div class="gz-tier-card__pax-label">pax</div>
        <div class="gz-tier-card__price">${fmt(t.price)}</div>
        <div class="gz-tier-card__cta">Select →</div>
      </button>
    `).join("");

    const menuHtml = config.menu.map((item) => `<li>${esc(item)}</li>`).join("");

    const inclusionsHtml = config.inclusions.length ? `
      <div class="gz-detail-card">
        <p class="gz-detail-card__title">Inclusions</p>
        <ul class="gz-items-list gz-items-list--2col">${config.inclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      </div>
    ` : "";

    const addonsHtml = config.addons.length ? `
      <div class="gz-detail-card">
        <p class="gz-detail-card__title">Add-ons &amp; Notes</p>
        <ul class="gz-items-list gz-items-list--muted">${config.addons.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      </div>
    ` : "";

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">Step 2 of 3 · Choose your package</p>
          <h2>${esc(config.name)}</h2>
        </div>
      </div>

      <div class="gz-tier-grid">
        ${tiersHtml}
      </div>

      <div class="gz-detail-grid">
        <div class="gz-detail-card">
          <p class="gz-detail-card__title">${esc(config.menuLabel)}</p>
          <ul class="gz-items-list gz-items-list--2col">${menuHtml}</ul>
        </div>
        ${inclusionsHtml}
        ${addonsHtml}
      </div>

      <div class="step-nav">
        <button class="text-button" type="button" data-service-back>← Back</button>
        <button class="primary-button" type="button" data-gz-continue${state.selectedTierIdx === null ? " disabled" : ""}>
          Continue to Details →
        </button>
      </div>
    `;
  }

  function renderContactStep() {
    const panel = container.querySelector("[data-gz-panel='3']");
    if (!panel) return;

    panel.innerHTML = buildContactPanel({
      backAttr: "data-gz-back",
      copyAttr: "data-gz-submit",
      statusId: "gz-status",
      orderLines: buildOrderLines(activeTier()),
    });

    attachBranchDropdown(panel);
    attachInlineValidation(panel);
    clearFilledErrors(panel);
  }

  function buildOrderLines(t) {
    return [
      `Service : ${config.name}`,
      `Package : ${t ? t.paxRange + " pax" : "—"}`,
      `Price   : ${t ? fmt(t.price) : "—"}`,
    ];
  }

  function goStep(n) {
    state.step = n;
    renderStep();
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleClick(e) {
    const tierBtn = e.target.closest("[data-gz-tier]");
    if (tierBtn) {
      state.selectedTierIdx = Number(tierBtn.dataset.gzTier);
      renderPickPanel();
      return;
    }

    if (e.target.closest("[data-gz-continue]")) {
      if (state.selectedTierIdx === null) return;
      goStep(3);
      return;
    }

    if (e.target.closest("[data-gz-back]")) {
      goStep(2);
      return;
    }

    if (e.target.closest("[data-gz-submit]")) {
      handleSubmit(e.target.closest("[data-gz-submit]"));
    }
  }

  async function handleSubmit(btn) {
    const result = validateAndRead();
    if (!result.valid) return;

    const t = activeTier();
    const { values } = result;
    const statusEl = document.getElementById("gz-status");

    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Sending…";

    const orderLines = buildOrderLines(t);
    const noteBody = buildInquiryText(config.name, orderLines, values);

    try {
      await pushInquiryToGHL({
        contact: {
          firstName: values.firstName,
          lastName:  values.lastName,
          email:     values.email,
          phone:     values.phone,
          address:   values.address,
        },
        opportunityName: `${config.name} — ${t?.paxRange ?? "?"} pax`,
        monetaryValue:   t?.price ?? 0,
        noteBody,
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type: config.name,
          pax_count:    t?.paxRange ?? "",
          base_price:   fmt(t?.price ?? 0),
          event_notes:  values.note,
        },
      });

      const panel = container.querySelector("[data-gz-panel='3']");
      if (panel) renderSuccess(panel, values, t);
    } catch (err) {
      if (statusEl) statusEl.textContent = "Something went wrong. Please try again.";
      btn.disabled = false;
      console.error("GHL push failed:", err);
    }
  }

  function renderSuccess(panel, values, t) {
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
            <span>Package</span>
            <strong>${esc(t?.paxRange ?? "—")} pax</strong>
          </div>
          <div class="success-summary__row">
            <span>Estimated Total</span>
            <strong>${t ? fmt(t.price) : "—"}</strong>
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
