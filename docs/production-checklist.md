# The Five — production checklist

**Goal:** finish all five. Nothing here is started.
**Written:** 4 August 2026 · tracked on `development`

Each item has the plain-language version for the client, then the actual work.
Anything marked **BLOCKED** needs an answer from someone before it can start.

---

## Totals

| # | Item | Effort | Blocked on |
|---|---|---:|---|
| 1 | Customer details on payment links | 30 min | — |
| 2 | The order total | 2–3 days | — |
| 3 | Closed dates | 1 day | the dates |
| 4 | Being told when something goes wrong | ½ day | a Sentry account |
| 5 | Capacity limits | 1–2 days | **the pax conversion** |

**About 5–7 working days**, of which roughly a day and a half is blocked on answers rather than work.

---

## 1 · Customer details on payment links — *30 min*

> Customer names, phones and addresses stored with each payment link should sit
> behind two locks. Only one is switched on. Nothing is exposed — we tested it —
> but it should be two.

- [ ] Write `supabase/revoke_anon_grants.sql`
- [ ] `revoke all on public.payment_links from anon, authenticated`
- [ ] `revoke all on public.payment_submissions from anon, authenticated`
- [ ] **Ask the dashboard team about `activity_log`** before touching it — it's their table and the dashboard may read it with a logged-in session, so revoking `authenticated` could break their Activity Log page
- [ ] Run it in Supabase
- [ ] Verify: all three return **401**, not `200` with an empty list
- [ ] Re-run the full anon sweep to confirm nothing else regressed

**Why 401 matters:** `200 + []` means the permission is granted and only a row-level rule is hiding the data. `401` means there is no permission at all. Two locks instead of one.

---

## 2 · The order total — *2–3 days*

> The total is calculated on the customer's phone and we record whatever number
> arrives. Someone technical could send ₱1 for a ₱50,000 order, and the payment
> page would agree with it.

**This is two problems, which is why it isn't an afternoon.**

### 2a · The server can't currently see the order

It receives `dishes_selected` as display text — `"• 2× XXXL (serves 15-20) Beef — Baby Back Ribs — PHP 8,000"` — which is for a human to read, not something a price can be recalculated from.

- [ ] Add structured line items to the payload: item id, tray size / pack type, quantity
- [ ] Send them from all five builders
- [ ] Keep `dishes_selected` as-is — the admin and kitchen read it

### 2b · Five different pricing rules

- [ ] Party Trays — category + tray size → unit price × qty, per line
- [ ] Packed Meals — pack type + quantity tier → per-piece price × qty
- [ ] Grazing — flat tier price
- [ ] Catering Package — pax × price per head
- [ ] Catering combos — fixed combo price
- [ ] Reject on mismatch with a clear message, don't silently correct
- [ ] Tolerance for rounding — decide whether an exact match is required
- [ ] Tests per service, including a deliberately tampered total

### Worth telling the owner

- [ ] Menu prices are **already public** — the site has to read them to display them
- [ ] This change discloses **nothing new**; line items go browser → server, and the browser already knows them
- [ ] Her decision is *"they're already visible, are we comfortable?"* — not *"should we start showing them?"*

---

## 3 · Closed dates — *1 day*

> The website will currently take a booking for Christmas Day.

**Do this before September** — that's when Christmas party bookings start.

### Needed from the owner — **BLOCKED**

- [ ] **Holy Week dates** — moves every year, cannot be set once and forgotten
- [ ] Confirm the fixed ones: 24 Dec from 12nn · 25–27 Dec · 31 Dec from 12nn · 1–5 Jan
- [ ] Confirm 23–31 Dec: no events, but trays / packed meals / frozen tubs still allowed
- [ ] Who enters next year's dates, and when

### The work

- [ ] `kitchen_closures` table — start, end, reason, which services are blocked, whether an override is allowed
- [ ] Half-days matter: 24 and 31 Dec close at **12nn**, so this needs times, not just dates. `delivery__pickup_time` makes that checkable
- [ ] Read it in the form, block the date at selection with a real reason — *"We're closed on 25 December"*, not a silent failure
- [ ] Server re-checks on submit — a date picker is a courtesy, anything can POST
- [ ] Dashboard needs a screen to edit these, or she asks us each year
- [ ] Tests: closed day, half-day boundary, service-specific block

---

## 4 · Being told when something goes wrong — *½ day*

> Quiet failures currently go into a log nobody reads. That's how a field was
> dropping off every order since launch without anyone knowing.

### Needed — **BLOCKED**

- [ ] A Sentry account (free tier is enough at this volume)
- [ ] Who receives the alerts

### The work

- [ ] Wire Sentry into the serverless functions
- [ ] Alert on these five only, so it stays signal:
  - [ ] Opportunity create failed
  - [ ] A custom field was dropped — the field doesn't exist in GoHighLevel
  - [ ] Calendar appointment failed
  - [ ] Contact custom-field write failed
  - [ ] Price mismatch rejected *(once item 2 exists)*
- [ ] Deliberately break one and confirm the alert arrives
- [ ] Keep customer-facing email in GoHighLevel — different job, different tool

---

## 5 · Capacity limits — *1–2 days*

> 500 pax/day Batangas, 1,000 Cavite, 200 Montalban, plus the weekly event caps.

**Correction to what was said earlier:** this is *not* blocked on the dashboard
team's data sync. We can keep our own count. It is blocked on a business
question.

### Needed from the owner — **BLOCKED**

- [ ] **How much capacity does a tray use?** Her limits are in pax; tray orders are recorded as trays — "3 trays", "20 pieces". Only combo packages carry a pax figure. Without a conversion the two cannot be added together.
  - [ ] XXXL tray = ? pax
  - [ ] Feast tray = ? pax
  - [ ] Family tray = ? pax
  - [ ] Packed meals — 1 piece = 1 pax?
- [ ] Do the weekly event caps count events, or pax, or both?
- [ ] What happens at the limit — refuse, or accept and flag for manual approval?

### The work

- [ ] `branch_capacity` table — branch, service type, max pax/day, max events/week, max event pax
- [ ] `booking_tally` table — date, branch, running totals
- [ ] Hourly background job reads GoHighLevel and refreshes the tally — catches phone orders your admin enters by hand
- [ ] Every website booking updates the tally immediately, so within-the-hour bookings count too
- [ ] Form checks the tally — instant, because it never asks GoHighLevel
- [ ] Seed it from the 103 migrated bookings
- [ ] Dashboard screen so she can change the limits without a deploy
- [ ] Tests: at the limit, over the limit, weekly cap, override

### Honest limitation

A phone order entered by hand could take up to an hour to appear in the tally, so
on a very busy day one or two bookings could slip past. Compared with today —
no limit at all — that is a large improvement, and worth saying plainly rather
than implying the count is perfect.

---

## What to chase, and from whom

| Answer needed | From | Blocks |
|---|---|---|
| Tray → pax conversion | owner | **5** |
| Holy Week dates + confirm the fixed ones | owner | **3** |
| At the limit: refuse or flag? | owner | **5** |
| Sentry account + who gets alerts | you | **4** |
| Is `activity_log` safe to revoke? | dashboard team | part of **1** |
| Comfortable with menu prices being public? | owner | nothing — **2** proceeds either way |

---

## Suggested order

**1** first — it's thirty minutes and closes a gap on customer data.

**3** next once the dates arrive — it has a real deadline in September, and nothing
else depends on it.

**4** after that — half a day, and it makes everything built afterwards easier to
trust, because failures stop being invisible.

**2** then. Longest single piece, and the only one that needs someone to
deliberately attack you rather than failing on its own.

**5** last — most dependent on answers, and the interim (dashboard warns the team)
covers the worst of it meanwhile.
