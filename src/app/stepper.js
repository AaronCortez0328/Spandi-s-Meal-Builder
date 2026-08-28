/**
 * The journey, drawn once.
 *
 * There were six copies of this: four hand-written into index.html, one
 * built by order-shell.js and one more updated by each builder's own
 * renderStepper(). They had drifted, and the drift was visible to the
 * customer. Catering Packages counted to four ("Step 2 of 4", "Step 3 of
 * 4") and then handed over to a screen that said "Step 3 of 3". Grazing
 * called its middle step "Choose Package" while every other service called
 * the same position "Build".
 *
 * ── Why four steps and not three ───────────────────────────────────────────
 *
 * The old spine was Select → Build → Confirm, where "Confirm" covered two
 * separate screens: the order review, and the contact form. Every customer
 * walks through both, on every service, so a single bubble spanning them
 * left the marker frozen across the two screens where someone is deciding
 * whether to spend money.
 *
 * Naming them separately is also what gives the longer services room. The
 * combo builder moves through three sub-views inside Build and the catering
 * packages through two; those are sub-steps of Build,
 * not steps of the order. Numbering has to belong to the order rather than
 * the service, because an order can hold a catering package *and* party
 * trays at once and the shared review can only show one number.
 */

/** The order's four steps, in order. Index + 1 is the number shown. */
export const STEPS = ["Select", "Build", "Review", "Details"];

export const STEP_SELECT = 1;
export const STEP_BUILD = 2;
export const STEP_REVIEW = 3;
export const STEP_DETAILS = 4;

const CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * What tapping a finished bubble does.
 *
 * Only backwards. A forward bubble would skip the validation the Continue
 * button runs, which is how someone reached the dish step with no pax set.
 * Steps ahead of the current one are rendered as plain text rather than
 * buttons, so there is nothing to tap and nothing to explain.
 */
const BACK_TO = {
  [STEP_SELECT]: "data-service-back",
  [STEP_REVIEW]: "data-go-review",
};

function bubble(step, state) {
  const label = `Step ${step}: ${STEPS[step - 1]}`;
  const face = state === "completed" ? CHECK : String(step);

  const attr = state === "completed" ? BACK_TO[step] : null;
  if (attr) {
    return `<button class="stepper__bubble" type="button" ${attr} aria-label="${label}">${face}</button>`;
  }
  // aria-current marks where the customer actually is, which is the one
  // thing a screen reader cannot get from the styling.
  return `<span class="stepper__bubble"${state === "active" ? ' aria-current="step"' : ""} aria-label="${label}">${face}</span>`;
}

/**
 * @param {number} current  1-4, one of the STEP_* constants
 * @param {string} [ariaLabel]  names this particular journey for screen readers
 */
export function stepperHtml(current, ariaLabel = "Order steps") {
  const parts = STEPS.map((name, i) => {
    const step = i + 1;
    const state = step < current ? "completed" : step === current ? "active" : "ahead";
    const cls = state === "ahead" ? "" : ` is-${state}`;
    const connector = i === 0
      ? ""
      : `<div class="stepper__connector${step <= current ? " is-completed" : ""}"></div>`;
    return `${connector}
        <div class="stepper__step${cls}" data-step="${step}">
          ${bubble(step, state)}
          <span class="stepper__label">${name}</span>
        </div>`;
  }).join("");

  return `
    <nav class="stepper" aria-label="${ariaLabel}">
      <div class="stepper__track">${parts}
      </div>
    </nav>`;
}

/** Draws the stepper into `el`, if it is there. */
export function renderStepper(el, current, ariaLabel) {
  if (!el) return;
  el.innerHTML = stepperHtml(current, ariaLabel);
}

/**
 * The steps inside Build, for the two services that have more than one.
 *
 * Combo Party Trays moves through three screens between choosing the
 * service and reviewing the order -- group size, then the combo, then the
 * dishes -- and the catering packages through two. All of that used to
 * happen under a single "Build" bubble that never moved, so the longest
 * stretch of the flow was the one part giving no sign of progress.
 *
 * Deliberately not a second stepper. It sits below the heading at label
 * size, in muted ink, so it reads as detail about where you are inside
 * Build rather than as a competing set of steps. The services with one
 * build screen get nothing at all -- a "1 of 1" is noise.
 *
 * Backwards only, same rule as the spine: a forward jump skips the
 * validation Continue runs. Steps ahead are plain text with nothing to tap.
 *
 * @param {string[]} names     the sub-steps, in order
 * @param {number} current     0-based index of the one being shown
 * @param {string} backAttrFor data attribute name; the value is the index
 */
export function substepsHtml(names, current, backAttrFor) {
  const items = names.map((name, i) => {
    if (i < current) {
      return `<li class="substeps__item is-done"><button type="button" class="substeps__link" ${backAttrFor}="${i}">${name}</button></li>`;
    }
    if (i === current) {
      return `<li class="substeps__item is-current" aria-current="step">${name}</li>`;
    }
    return `<li class="substeps__item">${name}</li>`;
  }).join("");

  return `
    <nav class="substeps" aria-label="Steps in this build">
      <ol class="substeps__list">${items}</ol>
    </nav>`;
}
