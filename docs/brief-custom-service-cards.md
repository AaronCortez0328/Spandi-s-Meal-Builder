# Brief: render admin-created service cards

From the dashboard team (`D:\GHL\spandis-kitchen`), 9 Sep 2026.

## What has already happened

**1. The database is done.** The migration has been RUN against Supabase —
not pending, already applied. `public.meal_builder_services` now has:

| Column | Type | Notes |
|---|---|---|
| `slug` | text PK | unchanged — matches `data-service` exactly |
| `label` | text | unchanged |
| `active` | boolean | unchanged |
| `sort_order` | integer | unchanged |
| `available_from` / `available_until` | date | unchanged, still unread by anything |
| **`is_builtin`** | boolean, default false | **true** for the original seven |
| **`description`** | text | the line under the card name |
| **`price_from`** | numeric | the "From PHP x" fact |
| **`facts_label`** | text | free text, e.g. `15–25 · 30–50 pax` |
| `created_at` / `created_by_name` | — | audit; `created_by_name` is NOT granted to anon |

A CHECK constraint now enforces `slug ~ '^[a-z0-9-]+$'`, and anon has `select`
on every column above except `created_by_name` and `updated_by_name`.

**2. The dashboard can now create cards.** Admins add/edit/delete rows where
`is_builtin = false`. The seven built-ins cannot be deleted — refused by an RLS
policy, not merely hidden in the UI.

**3. Nothing is visible to customers yet — that is your half.**

## Why nothing has broken so far

Extra rows are currently inert here. `services` is a `Map` read only by key,
nothing iterates it, and `updateServiceAvailability()` walks the **DOM**
(`querySelectorAll("[data-service]")`), which comes from hardcoded markup in
`index.html`. A row whose slug has no card is never looked up.

That is exactly what stops being true once you render from data — so please
read the next section before writing anything.

## ⚠️ The one thing that must not go wrong

`isServiceActive` fails **open**:

```js
// src/data/services.js:62
export function isServiceActive(slug) {
  return services.get(slug)?.active !== false;   // unknown slug -> true
}
```

That is correct and must stay correct for the seven: a dropped request must
never close a live card.

But it means a custom card must **never be rendered and then switched off** —
if its row fails to load, it would come back as available with nothing behind
it.

**Recommended approach: only inject a custom card into the DOM when
`active === true`.** An inactive or unloaded custom card then simply does not
exist on the page, and `isServiceActive` never has to answer for it. This
avoids changing the fail-open rule at all, so the seven keep today's exact
behaviour.

Please do NOT invert `isServiceActive` globally. That would change how the
seven behave during a network failure, which is a separate decision nobody has
asked for.

## What to build

### 1. `src/data/services.js` — fetch the new columns

Line 89 currently reads:

```js
.select("slug, active");
```

It needs the descriptive columns too. Keep the explicit list — do not switch
to `*`, because `updated_by_name` and `created_by_name` are deliberately not
granted to anon and a star select is refused outright:

```js
.select("slug, active, label, is_builtin, description, price_from, facts_label, sort_order");
```

Then expose the custom rows, e.g. `getCustomServices()` returning
`is_builtin === false && active === true`, sorted by `sort_order`.

### 2. `index.html` — one generic builder section

Add a single `<section id="builder-custom" hidden>` alongside the existing
seven (`builder-catering`, `builder-party-trays`, …). **One section, not one
per card** — the whole point is that new services need no markup.

### 3. Render the cards

After `loadServices()` resolves, append a `<button class="service-card"
data-service="<slug>">` per custom row into the same grid the seven live in.
Copy the structure of an existing card (`data-service="grazing-board"` is a
good template) so styling, the `data-badge` spans and the CTA all match.

Populate from the row: `label`, `description`, `price_from`, `facts_label`.
There is no icon column — use one default icon for all custom cards, or add an
`icon` column and tell us and we will surface it in the dashboard.

### 4. `src/app/app.js` — routing

- `FIRST_STEP` (line ~394): custom cards all take the same first step.
- `selectService` (line ~411): the existing seven each toggle a named section.
  Custom slugs should all resolve to `builder-custom`, with the chosen slug
  remembered so the section knows which service it is showing.

### 5. The flow itself

Simplest thing that works: pax, event date, branch, contact details, notes →
submit as an inquiry. It should reuse the existing confirmation screen
(`src/app/inquiry-sent.js`) so a custom service says the same thing to a
customer as every other service already does.

Whatever creates the GHL opportunity for the other flows should create it here
too, with the service name carried through.

## What must NOT change

- The seven built-in cards, their markup, their flows, or their slugs. Those
  slugs are a contract in both directions.
- `isServiceActive`'s fail-open behaviour.
- Nothing may write to `meal_builder_services`. The Meal Builder reads with
  the anon key; anon has SELECT only, and it should stay that way.

## How to check it works

1. In the dashboard: Menu / Packages → Service Cards → **Add service card**.
   New cards are created switched **off** deliberately.
2. Confirm it does **not** appear on the Meal Builder while off.
3. Switch it on in the dashboard → it appears, and opens the generic flow.
4. Switch it off → it disappears (not greyed — custom cards are absent when
   off, unlike the seven which grey out).
5. Break the network / block the Supabase request → the seven must still be
   **visible and orderable**; custom cards simply do not appear.

## Questions to the dashboard team

If you need a column we did not add — an icon, an image, a longer body — say
so and we will add it to both the migration and the admin form. Better that
than encoding it into `facts_label`.

Contact: the dashboard repo is `D:\GHL\spandis-kitchen`; the migration is
`supabase-meal-builder-services-custom.sql` and the admin UI is the Service
Cards tab in `src/pages/MenuPackages.jsx`.
