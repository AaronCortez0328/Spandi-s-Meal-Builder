/**
 * Keyboard support for the app's custom listbox dropdowns
 * (.swap-select and .branch-select).
 *
 * They were mouse-only: the trigger is a real <button>, so a keyboard user
 * could OPEN a dropdown, but the options are <li role="option"> with only
 * click handlers — unreachable and unselectable by keyboard. That's a WCAG
 * 2.1.1 (Keyboard) failure on the single most important flow in the app.
 *
 * One document-level listener drives whichever dropdown is currently open
 * (they all share the .is-open convention). It never reimplements
 * selection or closing: Enter/Space dispatches a real click() on the
 * focused option, so each builder's own selection logic runs unchanged,
 * and Escape/Tab route through the trigger's own click() to close. This
 * keeps behaviour and state in exactly one place per builder.
 */

const OPEN_SELECTOR = ".swap-select.is-open, .branch-select.is-open";

function getOptions(dropdown) {
  return [...dropdown.querySelectorAll('[role="option"]')];
}

function focusOptionAt(options, index) {
  const wrapped = (index + options.length) % options.length;
  const option = options[wrapped];
  // <li> isn't focusable by default — make it programmatically focusable
  // just-in-time. Elements are rebuilt on each open, so no cleanup needed.
  option.setAttribute("tabindex", "-1");
  option.focus();
}

export function initListboxKeys() {
  document.addEventListener("keydown", (e) => {
    const dropdown = document.querySelector(OPEN_SELECTOR);
    if (!dropdown) return;

    const options = getOptions(dropdown);
    if (!options.length) return;

    const trigger = dropdown.querySelector('[aria-haspopup="listbox"]');
    const activeIndex = options.indexOf(document.activeElement);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusOptionAt(options, activeIndex < 0 ? 0 : activeIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusOptionAt(options, activeIndex < 0 ? options.length - 1 : activeIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        focusOptionAt(options, 0);
        break;
      case "End":
        e.preventDefault();
        focusOptionAt(options, options.length - 1);
        break;
      case "Enter":
      case " ":
        if (activeIndex >= 0) {
          e.preventDefault();
          options[activeIndex].click(); // reuse the builder's own selection
          trigger?.focus();
        }
        break;
      case "Escape":
        e.preventDefault();
        trigger?.click(); // reuse the builder's own close path
        trigger?.focus();
        break;
      case "Tab":
        // Close on tab-out so focus never strands inside a hidden menu.
        // Not prevented — the tab itself proceeds to the next field.
        trigger?.click();
        break;
      default:
        break;
    }
  });
}
