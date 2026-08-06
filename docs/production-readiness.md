# Meal Builder — Production Readiness

**Written:** 4 August 2026 · **Branch:** `main`, in sync with `origin/main`
**Status:** for review. Nothing here has been built.

Measured against the live codebase and the live GoHighLevel location, not from memory.

---

## Part 1 — What is actually in the system

### Code

| | |
|---|---:|
| `src/app` | 4,981 lines across 15 files |
| `src/data` | 1,898 lines across 11 files |
| `api` | 858 lines across 8 files |
| `index.html` | 507 lines |
| Tests | **0** |
| CI | **none** |
| Linter | **none** |

**Dead code, imported by nothing:** `src/app/meal-builder.js` (746 lines), `src/data/combo-trays.js` (303), `src/data/sheet.js` (73) — 1,122 lines, plus whatever is reachable only through them.

`src/data/dishes.js` fetches the menu from a **Google Sheet CSV**, reachable only via the dead `meal-builder.js`. It is not live. It is a trap for the next person who greps for where the menu comes from.

### The five live services

| Builder | Opportunity fields sent |
|---|---:|
| `catering-builder.js` | 13 |
| `catering-package-builder.js` | 10 |
| `grazing-builder.js` | 10 |
| `packed-meals-builder.js` | 10 |
| `party-tray-builder.js` | 10 |

The submit flow is duplicated five times. Adding `delivery__pickup_time` required the same edit in five files.

### What reaches GoHighLevel

| Field | Status |
|---|---|
| `branch`, `service_type`, `event_date`, `pax_count`, `package_name`, `dishes_selected`, `event_notes`, `receive_method`, `delivery__pickup_time`, `payment_link` | writing correctly |
| `event_time` | writes when set — **optional since 3 Aug**, 1 record location-wide has it |
| `base_price` | **field does not exist in GHL** — dropped on every inquiry since launch |
| `contact.branch` | **never persists** — silently fails on every submission |
| `price_adjustment`, `swaps_count` | sent empty by Catering, stripped before the request |

### The GoHighLevel location

| | |
|---|---:|
| Opportunities total | 1,164 |
| In `Spandi's Basic Package Ordering System` (live) | 103 |
| In `Old Bookings (For Reconciliation)` | 1,061 |
| Created by this app | **effectively 0** |

The 103 in the live pipeline are the 3 August migration — 102 imported bookings plus one test record. **This application has not yet produced production volume.** Every readiness question below is about what happens when it does.

### API surface

| Endpoint | Authentication |
|---|---|
| `create-payment-link.js` | `X-Webhook-Secret` |
| `ghl-inquiry.js` | **none** |
| `payment-link-info.js` | token in URL |
| `request-upload-urls.js` | token in body |
| `submit-payment-proof.js` | token in body |
| `qr-image.js` | **none** |

---

## Part 2 — Walking the system as each person who uses it

### 🛒 The customer placing an order

**Works.** Five services, live menu from Supabase, real time slots, a clear three-step flow, and a confirmation screen that reads back what they chose.

**Gaps**

1. **A returning customer's order can vanish.** GoHighLevel blocks a second opportunity on the same contact. The handler catches that error, logs a warning, and returns `200 OK`. The customer sees "Inquiry sent." No opportunity exists. Nobody is told.
2. **The form has never been opened in a browser since the 3 August changes** — which are live. The event/delivery time split, the new required field and the label swap are serving customers unverified.

### 🧾 The admin receiving the inquiry

**Mostly works.** Contact, opportunity, note, calendar appointment and payment link all created in one request, with sensible best-effort handling for the parts that can fail.

**Gaps**

1. **`contact.branch` never arrives.** Both contacts this app created carry only `event_date`. The module header specifically names branch as the field that must not break.
2. **Calendar failures are invisible.** A wrong or revoked calendar ID silently stops bookings appearing, with only a `console.warn`.
3. **`base_price` never arrives** — the field does not exist in GHL.
4. **Nothing alerts anyone** when any of the above happens. Every safety net writes to a log nobody reads.

### 👨‍🍳 The kitchen (downstream, via the dashboard)

**Not our UI, but our data.**

1. **`event_time` is now empty almost everywhere.** Their calendar wants a day view from it. The real operational time is `delivery__pickup_time`, and their board does not know that field exists.
2. **Pax and dishes move independently on two services.** Grazing and Catering Package both use a fixed menu with a separate pax control, so a 50→100 pax change leaves `dishes_selected` byte-identical. Their change fingerprint hashes dishes only.

### 💰 The owner

**Gaps**

1. **The customer sets their own price.** `monetaryValue` is computed in the browser and written to GoHighLevel with no server-side check. A ₱50,000 order can be submitted as ₱1 — and because the payment page renders its total from that same number, the proof of payment *matches* and reconciliation looks clean.
2. **The inquiry endpoint is an open write API.** No auth, no rate limit, no origin check, no captcha. It creates contacts, opportunities, notes and calendar entries.
3. **The full pricing database is public.** By design — the anon key ships in the bundle — but the cost structure is readable by anyone.

### 🛠 The developer

**Gaps**

1. **No tests, no CI, no linter.** Nothing prevents a regression. The field-contract check that found `base_price` dropping was written in a scratch directory on 3 August and is already gone.
2. **The submit flow is duplicated five times.** Miss one and that service silently stops sending a field — exactly how `base_price` rotted.
3. **1,122 lines of dead code**, including a Google Sheets data path that looks authoritative.
4. **`esc()` is defined eight times** in eight files.
5. **No staging.** Changes go straight to production; the 3 August test record went into the live pipeline because there was nowhere else to put it.

---

## Part 3 — The gaps, ranked

| # | Gap | Who it hurts | Severity |
|---|---|---|---|
| 1 | 3 Aug form changes live and never opened in a browser | customer, now | **Critical** |
| 2 | Repeat customer sees success, no opportunity created | customer, owner | **Critical** |
| 3 | `/api/ghl-inquiry` open to the internet, no rate limit | owner | **Critical** |
| 4 | Customer sets their own price; no server-side check | owner | **Critical** |
| 5 | `contact.branch` never persists | admin | **High** |
| 6 | No tests, no CI, no linter | everyone | **High** |
| 7 | `qr-image.js` passes raw user input to storage with the service-role key | owner | **High** |
| 8 | Upload size limit skippable; filename unsanitised in storage path | owner | **Medium** |
| 9 | No alerting — every safety net logs to nowhere | admin | **Medium** |
| 10 | `event_time` empty; dashboard still keyed on it | kitchen | **Medium** |
| 11 | Pax change invisible on Grazing and Catering Package | kitchen | **Medium** |
| 12 | Calendar appointment failures silent | admin | **Medium** |
| 13 | Submit flow duplicated 5× | developer | **Medium** |
| 14 | `base_price` field does not exist in GHL | owner | **Low** |
| 15 | 1,122 lines of dead code incl. a misleading Sheets path | developer | **Low** |
| 16 | No staging environment | developer | **Low** |

**Code fixes:** 1–13, 15
**Decisions or data, no amount of code substitutes:** 14, 16

---

## Part 4 — The plan

### Step 0 · Open the form in a browser — *today, 30 min*
The 3 August changes are live and unverified. Click through all five services, both receive methods, and confirm the label swaps between "Delivery time" and "Pickup time".
**Fixes gap 1.**

### Step 1 · Stop losing repeat customers — *~½ day*
The duplicate-opportunity catch must not return success. Options: surface a real error, attach to the existing opportunity, or disambiguate the name. **Needs a product decision** — the code change is small either way.
**Fixes gap 2.**

### Step 2 · Close the open endpoint — *~½ day*
Rate limit per IP, verify `Origin`/`Referer` against `SITE_URL`, add a honeypot field. None of these are heavy.
**Fixes gap 3.**

### Step 3 · Fix `contact.branch` — *~1 hour*
Switch the contact custom-field write from the key-object form to `customFields: [{ id, field_value }]` with resolved IDs — the shape the migration importer used successfully on 102 records.
**Fixes gap 5.**

### Step 4 · Tests, CI and lint — *~1 day*
Copy `eslint.config.js` and `.github/workflows/ci.yml` from the dashboard repo; add `vitest`. Same stack, choices already proven next door. First tests: the field-key contract check, `to24h`/`timeSlots`, `isFulfilmentTimeInWindow` (duplicated client and server with nothing enforcing agreement), `buildInquiryText`, `splitName`.
**Fixes gap 6. Protects everything after it.**

### Step 5 · Server-side price validation — *~2–3 days*
Recompute the total server-side from the submitted line items against the same Supabase pricing tables the client reads, and reject a mismatch. One recompute path per service.
**Fixes gap 4 — the largest single piece of work here.**

### Step 6 · Input hardening — *~½ day*
Validate `qr-image.js`'s `path` against known `branch_payment_info.qr_storage_path` values. Slugify upload filenames; treat a missing `size` as a rejection rather than a pass.
**Fixes gaps 7 and 8.**

### Step 7 · Make failures visible — *~½ day*
Route `console.error` to something that alerts — the dropped-field warning, the calendar failure, the contact custom-field failure. A log nobody reads is not a safety net.
**Fixes gaps 9 and 12.**

### Step 8 · One submit flow — *~1–2 days*
Collapse the five duplicated submit paths into one shared module. Delete the 1,122 lines of dead code and the Google Sheets data path in the same pass.
**Fixes gaps 13 and 15.** *Do this after Step 4, not before — the tests are what make it safe.*

### Step 9 · Kitchen contract — *~½ day, cross-team*
Tell the dashboard team `delivery__pickup_time` exists and is the real operational time; agree who repoints their day view. Confirm the pax fingerprint covers Grazing and Catering Package.
**Fixes gaps 10 and 11.**

**Steps 0–7: about 5 days.**

---

## Part 5 — What only you can do

| | Owner | Why it blocks |
|---|---|---|
| Decide what a duplicate opportunity should do | you | Step 1 — error, attach, or rename |
| Decide on `base_price` | you | create the GHL field, or delete the five lines |
| Approve a staging environment | you | every test today lands in the live pipeline |
| Backup and restore verification | whoever owns Supabase | never tested; shared with the dashboard |
| Secrets rotation policy | you | `GHL_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_WEBHOOK_SECRET` — no policy, no record of holders |
| PII retention | you | `order_summary` snapshots customer name, phone and address indefinitely, with no deletion path |
| Phone re-export for the 103 migrated bookings | you | they have no phone and no email; payment links cannot be delivered |
| Tell the dashboard team the `event_date` ask is misdirected | you or me | this app already populates it on 100% of what it creates; their 1,061 gap is legacy records in another pipeline |

---

## What has not been verified

Stated plainly so nothing here reads as a clean bill of health:

- **The live form.** Step 0 exists because of this.
- **`npm audit`** — never run.
- **Security headers / CSP** — never checked.
- **Accessibility, cross-browser, mobile, load** — not examined.
- **Backup restore** — never tested.
- **What fires on the Awaiting Confirmation stage** — 103 opportunities were moved there on 3 August without checking.

---

## Shared with the dashboard

Both applications use **one Supabase project and one GoHighLevel location**. Consequences:

- Gaps 3 and 4 write into the database the dashboard reads. Its security posture is capped by this repo's.
- The dashboard **owns menu writes**; this app only reads. Menu changes need no deploy here.
- The GHL field contract is owned by neither repo and documented in neither. That is the real gap between the two systems, and it is why a field rename here can silently change behaviour there.

---

## Recommended order

**Step 0 today** — it is thirty minutes and the code is already live.

Then **1 → 2 → 3** as one run: they are the three that cost money, and none takes more than half a day.

**Step 4 before Step 8.** Consolidating five duplicated submit paths without tests is how you lose a field on one service and find out months later.

**Step 5** is the largest and can follow. **Step 9** whenever the dashboard team reaches their Step 5 — they are currently blocked on an answer this repo already contains.
