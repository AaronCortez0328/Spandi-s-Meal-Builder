# Meal-Builder Polish & Brand-Consistency Plan
### Execution brief — senior dev → senior dev

**To: Fable 5.** You're implementing this. Read this first, then hold yourself to it as a peer, not a checklist-runner.

You are expected to apply your own senior judgment. If something in this plan looks wrong once you're actually in the code — a task that would break a working flow, an assumption that doesn't hold, a "fix" that's really a symptom of something deeper — **stop and flag it**, don't execute it mechanically. Every visual decision you make must clear one bar: *does this look premium, intentional, and on-brand, or does it look like default AI-template output?* If it's the latter, it's wrong even if it "works." This is the highest-stakes screen on the site — the moment a customer commits real money to catering a wedding/birthday/corporate event. It should feel like a bespoke premium ordering experience, not a generic multi-step form.

**Scope:** the meal-builder app **only** (this repo → `spandi-s-meal-builder.vercel.app`). The main GHL site (`/home`, nav, footer, FAQ, broken links, typos, placeholder content) is being fixed separately by the client, directly in GHL — **do not touch or plan for it**. Assume those are already resolved by the time you execute.

**Confirmed scope depth (from client):** *Whole app, everything* — all 5 builder flows + the service-selection landing + all success screens + the payment / proof-of-payment / QR pages + shared components. Not just the builders.

---

## STANDING CONSTRAINTS — apply to EVERY phase, not once

These are not a phase. They govern all work below. Re-read them before each task.

### A. Design quality bar (anti-AI-template)
- **The home page is the design bar.** Match its look and feel; do not invent new patterns. When in doubt, make it look like it belongs next to the home page, not like a separate product.
- No default/generic gradient buttons. No glassmorphism/neumorphism. No stock "SaaS card with a soft shadow and a purple accent" look.
- Motion is **subtle and purposeful** — gentle fade/slide on step change, smooth price transitions. **No bouncy/springy/playful micro-animations** — those read as template flourishes and cheapen the brand.
- Typography, spacing, imagery should feel **warm and premium** — an authentic Filipino catering brand, not sterile corporate SaaS.
- Every visual decision traces back to the confirmed tokens (below), not to a trend.

### B. Confirmed design tokens (source of truth — from the site's page editor)
| Token | Value |
|---|---|
| Headline font | **Playfair Display, 700**, 52px / line-height 1.3 (hero scale) |
| Body / sub-headline font | **Poppins, 400**, 18px / line-height 1.3 |
| Primary CTA | **Black pill / rounded button** (e.g. "START BUILDING") |
| Section background | Tan / beige (leading into the meal builder) |

> ⚠️ **Do NOT blind-swap** the current fonts. See Phase 2 — Playfair is a *display serif*; putting it on tiny uppercase labels, buttons, or kickers looks broken. Intelligent mapping required.

### C. Responsiveness (hard requirement)
- Test & fix at **375px (mobile), 768px (tablet), 1440px (desktop)** — and anything in between that breaks.
- Test **inside the real iframe embed context** (see Phase 1), not just by resizing a standalone browser tab. Behavior differs because of the fixed-width/`scrolling="no"` iframe.
- Highest-risk interactive areas: step navigation, the live price estimate, the custom `.swap-select` dropdowns, images, long success summaries, and the payment-upload file cards.

### D. Build & deployment safety (this is LIVE production)
- **Stack (confirmed):** Vite v8 + vanilla JS (no framework), Supabase JS SDK, serverless functions in `/api`. Build = `npm run build` (`vite build`). Hosted on Vercel. No `vercel.json`, no CI.
- **Verify after EVERY phase**, not just at the end: `npm run build` must succeed, and the app must load and function on a **Vercel preview deployment** before the phase is "done."
- **Nothing reaches production without a preview check first.** Use Vercel preview deployments — they're free and automatic per push/branch.
- **Every phase must include a one-line rollback note** (what commit/file to revert). Because it's embedded live, a broken deploy is customer-facing immediately.
- Do not run `git push` — the client is the only one who pushes. Commit locally; they deploy.

---

## ASSUMPTIONS & SENIOR FLAGS (read before starting)

1. **The copper/orange accent (`#E85020`) may not be a real brand color.** The confirmed tokens mention black CTAs and tan backgrounds — no orange. The builder currently leans heavily on copper for buttons, prices, and accents. **Verify against the live home page (🔍 LIVE):** if the brand has no orange, the copper accent is itself off-brand and should be dialed back to the site's actual accent (or to black/neutral), with copper reduced to at most a small warm highlight. Don't preserve copper just because it's there.
2. **Font mismatch is the root cause of "feels inconsistent," and it's confirmed in code**, not assumed: app loads **Montserrat + DM Sans**; brand is **Playfair Display + Poppins**. This is the #1 brand fix.
3. **The iframe is clipping content on the live site (likely a current bug).** The GHL parent listens for `spandis-resize` postMessages but the app never sends them → iframe stuck at 900px, `scrolling="no"` → taller content unreachable. This is why Phase 1 comes first. (See Phase 1 for the exact contract.)
4. **The swap feature is already ~half-removed** (fixed "Included" rows, no dropdown), but dead handlers, `state.swaps`, `refreshSwapPrices`, and the "Review & swap dishes" step label remain. Client decision: **remove entirely now.** ⚠️ The `.swap-select` CSS class is **reused as the legitimate dish-picker** in Party Trays & Packed Meals — removal must be surgical.
5. **Deeper-problem note:** the brand drift exists because the builder was built in isolation from the site's design system. The durable fix isn't a one-time recolor — it's a single, documented `:root` token block that mirrors the brand, so future edits can't drift again. Bake that into Phase 2.

**Legend:** 🔍 LIVE = needs browser/screenshot inspection · 💻 CODE = doable from code alone.

---

## PHASE 0 — Verify & baseline (foundation — blocks everything visual)

- [ ] **0.1 Confirm build & preview pipeline works untouched.** 🔍 LIVE — Run `npm run build`, push a no-op branch, confirm a Vercel preview deploys and loads. Establishes the safety net before any change. **Done:** green build + working preview URL.
- [ ] **0.2 Extract the real home-page tokens by inspection.** 🔍 LIVE — Open the live home page. Confirm: exact background hex(es), the actual accent color (is there any orange? — see Flag 1), the black-pill button's exact radius/padding/weight/letter-spacing, and the hero type scale. **Done:** a short written token sheet you'll implement against. *This blocks Phase 2 — don't start typography until it's done.*
- [ ] **0.3 Capture regression baseline screenshots.** 🔍 LIVE — Every surface (landing, all 5 builders each step, all success screens, payment-upload, QR/proof) at 375 / 768 / 1440, **inside the iframe embed** and standalone. **Done:** baseline set saved to compare against after each phase.
- [ ] **0.4 Document the iframe embed contract** (already provided — record it in-repo for reference): parent embeds `scrolling="no"` iframe, initial height 900px, listens for `window.postMessage({ type: 'spandis-resize', height:<int> }, ...)`, ignores height < 300, transitions height 180ms. 💻 CODE. **Done:** contract noted where Phase 1 code will reference it.

---

## PHASE 1 — Fix the iframe height clipping (CRITICAL — do first, highest impact/effort ratio)

> Until this lands, all responsive work below is invisible on the live embedded page because content is clipped at 900px. This is the single most important task in the plan.

- [ ] **1.1 Send height to the parent via postMessage.** 💻 CODE (verify 🔍 LIVE) — Add a small module that posts `{ type: 'spandis-resize', height }` to `window.parent`. Trigger it on: initial load (after content renders), every step/panel change, and every dynamic content change (cart add/remove, form expand, success/skeleton swaps). Use a `ResizeObserver` on the page shell + a debounce; send `document.documentElement.scrollHeight` (or the shell's height). Prefer targeting the known GHL origin over `'*'` (height is low-sensitivity, but be clean). **Done:** on the live embedded page, the iframe grows and shrinks to fit every step at every breakpoint — no clipped content, no internal scrollbar, no large empty gap.
- [ ] **1.2 Handle tall dropdowns near the bottom edge.** 💻 CODE + 🔍 LIVE — The custom `.swap-select` menus are absolutely positioned; if one opens near the bottom of a content-sized iframe with `scrolling="no"`, it can be clipped by the iframe boundary. Verify; if it clips, either post an increased height while a menu is open, or flip the menu upward when near the bottom. **Done:** every dropdown is fully visible when open, on mobile especially.
- [ ] **1.3 Verify + rollback note.** Build, preview, test embedded. **Rollback:** revert the resize module import in the app entry (`src/main.js`) — the app functions without it (just clips), so reverting is safe.

---

## PHASE 2 — Typography & brand-token alignment (depends on 0.2)

> This is the core "make it feel native" work. Intelligent mapping, not find-replace.

- [ ] **2.1 Swap font loading.** 💻 CODE — In `index.html`, replace the Montserrat + DM Sans Google Fonts link with **Playfair Display (700)** + **Poppins (400, 500, 600; add 700 only if the site uses it)**. Keep `display=swap` and the preconnects. **Done:** correct fonts load; no FOIT; no leftover Montserrat/DM Sans requests in the network tab.
- [ ] **2.2 Map fonts by ROLE, not by find-replace.** 💻 CODE — Establish two CSS variables (`--font-display`, `--font-body`) and apply:
  - **Playfair Display → large display headings only** (hero title, step/section H2s). This is where the ~30 current `font-family: 'Montserrat'` usages must be triaged.
  - **Poppins → everything else**: body, sub-headings, form labels, buttons, prices, uppercase "kicker" labels (with letter-spacing), badges, nav.
  - ⚠️ Do **not** put Playfair on buttons, tiny uppercase labels, or dense UI text — a serif display face there looks broken and un-premium. Use judgment per selector; when unsure, Poppins.
  **Done:** headings read as elegant Playfair; UI/body reads as clean Poppins; nothing looks like a serif was forced onto a control.
- [ ] **2.3 Establish a type scale from the tokens.** 💻 CODE — 52px/1.3 is the *hero* scale, not every heading. Derive a restrained scale (hero → H2 → H3 → body 18/1.3 → small) and apply consistently. **Done:** consistent, hierarchical sizing across all surfaces; no random per-component font sizes.
- [ ] **2.4 Reconcile the button system to the brand.** 💻 CODE + 🔍 LIVE — Primary CTAs → **black pill** matching the home page's exact radius/padding/weight (from 0.2). Reduce copper from "primary button color" to at most a small warm accent (or remove if 0.2 shows no orange in the brand). Keep secondary/text buttons quiet. **Done:** primary buttons are indistinguishable in style from the home page's; side-by-side, the builder reads as the same brand.
- [ ] **2.5 Consolidate the `:root` token block to mirror the brand** (deeper-fix per Flag 5). 💻 CODE — One documented source-of-truth token block; components reference tokens, not hardcoded hexes. **Done:** changing a brand color is a one-line edit; no stray hardcoded colors in components.
- [ ] **2.6 Verify + rollback.** Build, preview, compare against 0.3 baseline + live home page. **Rollback:** revert `index.html` font link + the CSS token/font commits.

---

## PHASE 3 — Remove the unapproved swap feature (independent — can run parallel to Phase 2)

> Client decision: remove entirely now. Surgical, not a blanket delete.

- [ ] **3.1 Remove dead swap machinery from `catering-builder.js`.** 💻 CODE — Delete `state.swaps`, the `data-swap-trigger` / `data-swap-option` / `data-swap-slot` click handlers, `refreshSwapPrices`, `getSwapKey`/swap-resolution helpers, and swap-related menu code. Keep the combo rendering as fixed "Included" rows. **Done:** no swap logic remains; no console errors; the catering combo still renders and submits.
- [ ] **3.2 Rename the "Review & swap dishes" step.** 💻 CODE — Update the `VIEW.CUSTOMIZE` label (e.g. "Review your combo" / "Confirm your dishes"). **Done:** no "swap" wording anywhere customer-facing.
- [ ] **3.3 DO NOT remove `.swap-select`.** ⚠️ 💻 CODE — That class is the **dish-picker** in Party Trays & Packed Meals. Leave its CSS and their handlers fully intact. Only remove swap CSS that is exclusively the catering-combo swap control (e.g. former `.swap-row__control`), not the shared dropdown. **Done:** Party Trays & Packed Meals dish selection works unchanged.
- [ ] **3.4 Verify the data contract still holds.** 💻 CODE + 🔍 LIVE — Confirm the catering combo still sends `package_name`, `pax_count`, and `dishes_selected` to GHL correctly after removal (this was recently wired and must not regress). **Done:** a test catering inquiry produces a correct GHL opportunity + payment-page summary.
- [ ] **3.5 Verify + rollback.** Build, preview, submit one catering combo end-to-end. **Rollback:** revert the Phase 3 commit; swap code returns as-is (harmless, since already non-rendering).

---

## PHASE 4 — Premium micro-UX on the ordering flow (the "elevate" work — depends on Phase 2)

> This is where it goes from "consistent" to "premium." Every interaction should feel deliberate and reassuring. Anti-template bar (Constraint A) applies hardest here.

- [ ] **4.1 Step transitions.** 💻 CODE — Subtle fade/slide between builder steps (~150–200ms, ease). **No bounce/spring.** Honor `prefers-reduced-motion` (the codebase already has these blocks — extend them). **Done:** moving between steps feels smooth and considered, not janky or playful.
- [ ] **4.2 Live price estimate reassurance.** 💻 CODE + 🔍 LIVE — When the running total updates, animate it gently (soft count/fade, not a flashy pop). It's the trust anchor of the flow. **Done:** price changes feel confident and calm; never distracting.
- [ ] **4.3 Selection / active / hover / focus states.** 💻 CODE — Make choosing a package or dish feel tactile and clearly confirmed (considered active states, not just a border color flip). **Done:** the user always knows what's selected; states feel crafted.
- [ ] **4.4 Loading, empty, and error states.** 💻 CODE + 🔍 LIVE — Audit skeletons (already present), empty carts, and submission errors across all 5 builders. Ensure they're on-brand and reassuring, not default-grey placeholders. **Done:** no jarring or generic state anywhere in the flow.
- [ ] **4.5 Success screens = the commit moment.** 💻 CODE + 🔍 LIVE — These now share a consistent structure across all 5 builders (recently standardized). Polish them to feel like a confident confirmation of a premium booking. **Done:** all 5 success screens feel identical in quality and clearly on-brand.
- [ ] **4.6 Payment / proof-of-payment / QR pages (in scope).** 💻 CODE + 🔍 LIVE — Bring the payment-upload page, file cards, and QR display up to the same brand + premium bar. This is literally the "paying money" screen — it must feel the most trustworthy of all. **Done:** the payment surface is visually continuous with the builder and reads as secure/premium.
- [ ] **4.7 Verify + rollback.** Build, preview, walk all 5 flows through to payment. **Rollback:** phase is componentized — revert individual task commits as needed.

---

## PHASE 5 — Responsive QA sweep (depends on 1, 2, 4)

> Do this AFTER Phase 1, or content is still clipped and you'll chase ghosts.

- [ ] **5.1 Full sweep at 375 / 768 / 1440, inside the iframe.** 🔍 LIVE — Every surface. Current breakpoints are ad-hoc (860/760/700/680/640/560/480) — reconcile toward a clean, intentional set; don't just patch. **Done:** no horizontal scroll at any width; nothing clipped; layout intentional at each breakpoint.
- [ ] **5.2 Interactive problem areas.** 🔍 LIVE — Step nav, live price bar, `.swap-select` dropdowns (open/scroll/select on touch), images, long success summaries, payment file cards. **Done:** all usable and correct on a real phone-width viewport.
- [ ] **5.3 Touch ergonomics.** 💻 CODE + 🔍 LIVE — Tap targets ≥ ~44px; adequate spacing; no hover-only affordances. **Done:** comfortable one-thumb use on mobile.
- [ ] **5.4 Verify + rollback.** Build, preview, test on a real device. **Rollback:** revert offending responsive commit.

---

## PHASE 6 — Accessibility & final QA (last)

- [ ] **6.1 Keyboard & focus.** 💻 CODE — All controls reachable/operable by keyboard, including the custom `.swap-select` dropdowns (arrow keys, Esc, focus return). Visible focus rings (already partly present). **Done:** full keyboard operability; no focus traps.
- [ ] **6.2 Contrast & ARIA.** 💻 CODE + 🔍 LIVE — Verify text/UI contrast (especially any remaining copper on white/tan) meets AA; confirm `aria-expanded`/labels on custom controls and `aria-live` on price/status. **Done:** AA contrast; screen-reader-sane structure.
- [ ] **6.3 Reduced motion.** 💻 CODE — All Phase 4 motion honors `prefers-reduced-motion`. **Done:** motion off when requested, no loss of function.
- [ ] **6.4 Cross-browser + final regression.** 🔍 LIVE — Chrome/Safari/Firefox + iOS Safari (the iframe host). Compare every surface against the 0.3 baseline and the live home page. **Done:** consistent everywhere; reads as one brand with the home page.
- [ ] **6.5 Final preview → client deploys.** Build, final Vercel preview, hand the preview URL to the client for the production push. **Do not push.**

---

## Sequencing summary (dependency order, not category order)
```
Phase 0  (verify + tokens + baseline)   ── blocks ─▶ everything visual
Phase 1  (iframe height fix)            ── blocks ─▶ all responsive validation   ◀ DO FIRST
Phase 2  (typography/brand)  ─┐
Phase 3  (remove swap)       ─┤ 2 & 3 independent, can run in parallel
                              └─▶ Phase 4 (premium micro-UX) needs Phase 2 done
Phase 5  (responsive QA)     ── needs 1, 2, 4
Phase 6  (a11y + final QA)   ── last
```

## Key tradeoffs called out
- **Fix-in-place vs. rebuild:** the codebase is sound (clean tokens, real skeletons, existing a11y hooks). **Recommendation: fix in place.** A rebuild is unjustified risk on a live tool for a consistency pass.
- **Speed vs. thoroughness on responsive:** Phase 1 is the 80/20 — it alone removes the worst live symptom. If time-boxed, ship Phase 1 + Phase 2 first (biggest perceived-quality jump), then 3–6.
- **Copper accent:** don't preserve it by default. Verify against the brand (0.2) and be willing to remove it — keeping an off-brand orange would undercut the whole "native + premium" goal.
