import {
  buildContactPanel,
  attachFormPickers,
  validateAndRead,
  attachInlineValidation,
  clearFilledErrors,
  buildInquiryText,
  fulfilmentTimeLabel,
} from "./contact-form.js";
import { submitInquiry } from "./submit-inquiry.js";
import { renderInquirySent } from "./inquiry-sent.js";
import { getGrazingConfig } from "../data/grazing.js";
import { applyRushFee, RUSH_FEE } from "../domain/pricing.js";
import { grazingPhoto, photoHtml } from "./menu-photos.js";

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

      ${photoHtml(grazingPhoto(serviceKey), config.name, "hero")}

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

    attachFormPickers(panel);
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

    const originalBtnHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Sending…`;

    const total = applyRushFee(t?.price ?? 0, values.rushOrder);
    const orderLines = [
      ...buildOrderLines(t),
      ...(values.rushOrder
        ? [`Rush fee: +${fmt(RUSH_FEE)}`, `Total   : ${fmt(total)}`]
        : []),
    ];
    const noteBody = buildInquiryText(config.name, orderLines, values);

    const payload = {
        contact: {
          firstName: values.firstName,
          lastName:  values.lastName,
          email:     values.email,
          phone:     values.phone,
          address:   values.address,
          company:   values.company,
        },
        // A flat price per pax band. Identified by the band's label rather
        // than its position, so a tier added or reordered in the dashboard
        // cannot silently reprice an order.
        lineItems: {
          service: "grazing",
          serviceKey,
          paxRange: t?.paxRange ?? null,
          rush: values.rushOrder,
        },
        opportunityName: `${config.name} — ${t?.paxRange ?? "?"} pax`,
        monetaryValue:   total,
        noteBody,
        contactFields: {
          branch:     values.branch,
          event_date: values.eventDate,
        },
        opportunityFields: {
          service_type:    config.name,
          branch:          values.branch,
          event_date:      values.eventDate,
          event_time:      values.eventTime,
          pax_count:       t?.paxRange ?? "",
          dishes_selected: config.menu.join("\n"),
          event_notes:     values.note,
          receive_method:  values.fulfilment,
          delivery__pickup_time: values.fulfilmentTime,
          contacted_via_social: values.contactedViaSocial,
          social_profile_name:  values.socialProfileName,
          // "opportunity.rush_order" — see party-tray-builder.js for why
          // this is blank rather than "No" on a non-rush order.
          rush_order: values.rushOrder ? `Yes (+${fmt(RUSH_FEE)})` : "",
        },
    };

    const panel = container.querySelector("[data-gz-panel='3']");

    await submitInquiry({
      payload,
      panel,
      onSuccess: (pushed) => {
        if (panel) renderSuccess(panel, values, t, pushed?.attached, total);
      },
      onError: (message) => {
        if (statusEl) statusEl.textContent = message;
        btn.disabled = false;
        btn.innerHTML = originalBtnHTML;
      },
    });
  }

  function renderSuccess(panel, values, t, attached, total) {
    renderInquirySent(panel, {
      attached,
      firstName: values.firstName,
      rows: [
        { label: "Service",    value: config.name },
        { label: "Package",    value: t ? `${t.paxRange} pax` : null },
        { label: "Event date", value: values.eventDate },
        { label: "Branch",     value: values.branch },
        ...(values.rushOrder ? [{ label: "Rush order", value: `Yes (+${fmt(RUSH_FEE)})` }] : []),
        { label: "Receive",    value: values.fulfilment },
        { label: fulfilmentTimeLabel(values.fulfilment), value: values.fulfilmentTime },
        { label: "Name",       value: `${values.firstName} ${values.lastName}` },
      ],
      priceLabel: "Package price",
      priceValue: t ? fmt(total) : "—",
    });
  }

  return { mount };
}
