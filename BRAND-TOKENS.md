# Brand Token Sheet — extracted from the live site
**Source:** `spandisfoodandcatering.com/home` — values pulled from the page's own
CSS custom properties and `.cbutton-*` rules (GHL-generated), 2026-07-24.
This is the implementation reference for Phase 2 of `MEAL-BUILDER-POLISH-PLAN.md`.

## Typography (confirmed in live CSS)
| Role | Value |
|---|---|
| Display / headlines | `'Playfair Display', serif` (site var `--font-display`) — often italic + orange accent spans in heroes |
| Body / UI / buttons | `'Poppins', sans-serif` (site var `--font-body`) |
| Kickers (e.g. "AUTHENTIC FILIPINO CATERING") | Poppins, uppercase |

## Color palette (site's own variables, alpha stripped)
| Hex | Site var | Role |
|---|---|---|
| `#26201B` | `--color-iorwoiuz` | Warm near-black — ink, dark sections, dark button bg |
| `#C94A1A` | `--color-kygtnnzw` | **Burnt-orange brand accent** — headline accent spans, primary CTA bg |
| `#C84B1F` / hover `#A83A14` | `--nav-cta-bg` / `--nav-cta-hover` | Nav CTA (same orange family) |
| `#FAF6F0` | `--color-mlgzvbmf` | Warm off-white — light section bg |
| `#ECE8E2` | `--color-rawpflpa` | Warm grey-beige — alt section bg |
| `#F6F0E6` | `--color-tmdhdhec` | Cream/tan section bg (the "tan leading into the builder") |
| `#D9C5A0` | `--color-aftvjdku` | Deeper sand/tan accent |
| `#FFFFFF` | `--white` | Surfaces |

## Button system (from live `.cbutton-*` rules — all variants share)
- **Shape:** `border-radius: 30px` (pill), `padding: 16px 32px`
- **Type:** Poppins, `letter-spacing: 0`, `text-transform: none`, no box-shadow
- **Variants seen live:**
  1. Solid orange — bg `#C94A1A`, white text (primary CTA, incl. nav "START BUILDING")
  2. Solid dark — bg `#26201B`, white text
  3. Outline — transparent bg, `1px solid #26201B` border, dark text
  4. Text/underline — transparent, `2px` bottom border in `#C94A1A`

## ⚠️ Corrections to the brief's assumptions (Flag 1 resolved)
1. **The orange accent IS the brand** — `#C94A1A` appears in headline spans and as
   the primary CTA background on the live site. Do NOT remove copper from the app.
   The fix is **retuning**: app's `--copper: #E85020` (brighter/neon) → brand
   `#C94A1A`; app's `--copper-dark: #C33D0D` → `#A83A14` (the site's own hover).
2. **"Black pill CTA" from the client's tokens is one variant, not the only one.**
   The live site's most prominent CTAs are *orange* pills; dark pills exist too.
   Phase 2.4 should map: primary action → orange pill (brand `#C94A1A`), with the
   dark pill as the secondary/alternate — matching live-site usage, and confirm
   the final mapping with the client before applying.

## Current app vs brand — key deltas (for Phase 2)
| Token | App today | Brand | Delta |
|---|---|---|---|
| Display font | Montserrat | Playfair Display | **swap (role-mapped)** |
| Body font | DM Sans | Poppins | **swap** |
| Accent | `#E85020` | `#C94A1A` | retune (keep, darken/warm) |
| Accent dark | `#C33D0D` | `#A83A14` | retune |
| Ink | `#1A1714` | `#26201B` | near-identical — align |
| Canvas | `#F5F0E8` | `#F6F0E6` | near-identical — align |
| Button radius | `--r-pill` (9999px) | 30px pill | visually equivalent at button heights — keep |
| Button padding | varies | 16px 32px | align primary CTAs |

## Iframe embed contract (Phase 1 reference — provided by client)
The GHL parent page embeds the app as:
- `<iframe id="spandis-frame" scrolling="no">`, width 100%, initial height **900px**
- Parent listens: `window.addEventListener('message', ...)` for
  `{ type: 'spandis-resize', height: <int> }`; ignores `height < 300`;
  applies `frame.style.height = h + 'px'` with a 180ms ease transition.
- **The app currently never sends this message** → iframe stuck at 900px,
  content below the fold is clipped and unreachable (no scrollbar). Phase 1
  fixes this by posting the height on load, on every panel/step change, and on
  any content resize (ResizeObserver + debounce).

### Floating cart (optional — the page enhances, the app still works without it)

The app cannot float anything. It sits in an iframe as tall as its content,
which never scrolls, so `position: fixed` has no viewport to pin to and a
"fixed" element simply scrolls away with the page. The **parent page** can
float things — that is why the chat widget can.

So the floating cart is rendered by the GHL page and driven by two messages
on the pipe `spandis-resize` already uses.

| Direction | Message | When |
|---|---|---|
| app → page | `{ type: 'spandis-cart', count, total, label }` | every time the order changes |
| page → app | `{ type: 'spandis-open-cart' }` | the customer taps the floating button |

`label` is the total already formatted (`"PHP 12,500"`), so the page never has
to know about currency.

**This is an enhancement, not a dependency.** The app has its own cart button
in its header. If this snippet is missing — or a page rebuild drops it —
customers can still reach their order; they just lose the button that follows
them down the page. Nothing errors, and nothing is lost.

Paste on the page that embeds the builder, after the iframe:

```html
<button id="spandis-cart" type="button" aria-label="Your order" style="display:none">
  🛒 <span id="spandis-cart-label">PHP 0</span> <b id="spandis-cart-count">0</b>
</button>
<script>
  var frame = document.getElementById('spandis-frame');
  var cart  = document.getElementById('spandis-cart');
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'spandis-resize' && d.height > 300) {   // existing behaviour
      frame.style.height = d.height + 'px';
      return;
    }
    if (d.type === 'spandis-cart') {
      document.getElementById('spandis-cart-count').textContent = d.count;
      document.getElementById('spandis-cart-label').textContent = d.label;
      cart.style.display = d.count > 0 ? 'inline-flex' : 'none';
    }
  });
  cart.addEventListener('click', function () {
    // The customer may be far above the builder — bring it into view first,
    // or the review screen opens somewhere they cannot see.
    frame.scrollIntoView({ behavior: 'smooth', block: 'start' });
    frame.contentWindow.postMessage({ type: 'spandis-open-cart' }, '*');
  });
</script>
```

Position it clear of the chat widget — stacked above it on the right works,
since bottom-right is where a thumb sits on a phone.
