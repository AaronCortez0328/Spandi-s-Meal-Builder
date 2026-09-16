# Notes for the dashboard team — round 3

**From:** Meal Builder · 15 September 2026
**Re:** Order Status, and change/add order

**Two** things we need from you — a view, and agreement on a shared table.
Three you should know about but do not have to act on. One reporting problem
that is yours to decide and ours to live with.

Everything below is on branch `feat/order-status`, not yet merged.

---

## What we built

**Order Status** — a page a customer reaches days or weeks after booking,
holding nothing: no link, no token, no login. They give us the email or mobile
they booked with plus the date of their event, and we show them where the order
is. Six steps, collapsed from the nineteen across your board and the GoHighLevel
pipeline.

It is read-only. It writes to nothing you own.

---

## 1 · What we need — `order_progress_public`

**This is the only blocking ask.** We agreed it on 15 September; this is the
written version.

A view over `kitchen_order_state` exposing **two columns**:

```sql
ghl_opportunity_id
stage
```

`updated_at` was in your original offer and we asked you to **drop it**. You
asked us not to show timestamps, and the surest way to keep that promise is not
to have the column. Your ticks are batched by hand — 23 of your 37 rows sit at
the last stage — so any time we printed would be confidently wrong.

**We do not need `food_status`.** You declined it citing your own seeding note,
and the live data agreed: 30 of 37 rows null. `STAGE_IDS` already contains
`cooking` as a distinct stage, which separates our Preparing step from our
Cooking step on its own. Driving a customer-facing step off a field that is null
on four rows in five would show most people nothing.

**Until the view exists**, our reader catches the error and treats it as "no
kitchen row", which is the normal case anyway — so nothing breaks, orders simply
never show Preparing or Cooking.

### What we do with `stage`, exactly

Two of our six steps read your data. Four never do.

| Our step | Source |
|---|---|
| Order received | GoHighLevel pipeline |
| **Confirmed** | GoHighLevel pipeline — **and every order with no row of yours** |
| Preparing | your `stage`: `white-board`, `procured` |
| Cooking | your `stage`: `cooking` |
| Ready | **GoHighLevel pipeline only — never a tick of yours** |
| Completed | GoHighLevel pipeline |

**`confirm` never means Ready.** You flagged this as the bug you most expected
us to ship and you were right to: it means the chef finished the checklist, not
that food is waiting for a customer. Reading it as Ready would send someone to a
branch for an order nobody released. Your kitchen's ceiling is our Cooking step.

**A missing row is the normal case, not an error.** 37 rows against 1,592
opportunities — the overwhelming majority of lookups find nothing, and that has
to render as a real step rather than "unknown" or a blank page. This was the gap
in our first reply to you; it is now the most-tested path in the mapper.

### The list we copied

Mirrored from `STAGE_IDS` in your `api/_lib/kitchenChecklist.js` — your single
source of truth — as a **copy**, because the two repositories deploy separately:

```
upcoming-orders → white-board → procured → cooking → confirm
```

**Please tell us before you rename one.** A changed value makes our page show
the wrong step silently: no error, no alert, nothing on screen to say why.

---

## 2 · We added a column to `payment_links`

`payment_links.order_groups`, `jsonb`, nullable. Migration in
`supabase/payment_links_order_groups.sql`.

**You read that table, which is why you are being told.** It holds the order's
line structure — a booking can contain a grazing board, two party trays and
fifty packed meals at once, priced by four different rules and counted in three
different units, and GoHighLevel cannot hold that.

**Purely additive. `order_summary` is untouched** — same keys, same shapes.
We checked `api/_lib/paymentBackfill.js:117`; your
`orderSummary.Total ?? orderSummary.monetaryValue` read is unaffected.

It is a separate column rather than a key inside `order_summary` because that
object is a display contract — our payment page renders every key of it as a
labelled row, so a `groups` key would have printed `[object Object]` to
customers.

---

## 3 · The customer payment page now reads `amount_paid`

We fixed a live bug. That page printed the **order total** under the label
"Amount due", always — so a customer who had paid in full was told she owed all
of it, directly beneath a receipts list reading "Confirmed".

It now reads `amount_paid` from the opportunity, which **your verify path
writes** (`api/payment-submissions.js:227`).

**Two consequences for you:**

**A blank `amount_paid` is now visible to a customer**, not just to staff. We
handle it safely — an unrecorded figure reads as unknown, never as zero, and the
page falls back to showing the full total rather than guessing. But the field
now has a customer-facing audience.

**Sampling 40 live opportunities:**

| | Count |
|---|---:|
| Both `payment_status` and `amount_paid` | 28 |
| `payment_status` but **no** `amount_paid` | 1 |
| Neither (untouched inquiries) | 11 |

That one is `FULLY PAID` with `amount_paid` empty. We render it as "Payment
received — we're applying it to your booking" rather than claiming a number, so
nothing wrong is said. **Worth knowing it exists**, in case verification
sometimes happens in GoHighLevel directly rather than through your dashboard.

We also stopped **displaying** the customer's name, email, phone and address on
that page, because Order Status can now reach it and that page is gated on an
email plus an event date — enough for a booking, not enough to hand over a home
address.

**We did NOT remove them from `order_summary`.** `paymentBackfill.js:110` picks
`customer_name` from `[contactName, Contact, Name, opportunityName]`, and on a
link minted by the inquiry path only `Name` is present. Dropping it at the
source would have blanked the customer name on every new payment row in your
history with nothing to say why. **Display trimmed, data untouched.**

---

## 4 · A new table of ours

`order_lookup_attempts` — a per-IP throttle for the unauthenticated lookup.
Migration in `supabase/order_lookup_rate_limit.sql`. Ours entirely; nothing
reads or writes it but `api/order-status.js`. Listed only so it is not a
surprise in the table list.

Not shared with `inquiry_attempts` on purpose: a customer checking their order
eight times should not lose the budget that lets them place one.

---

## 5 · The reporting problem — yours to decide

**Unrelated to this feature. It predates it and we are not proposing a fix.**

When one booking holds several kinds of item — party trays *and* packed meals
*and* a grazing board — the meal builder writes **one** `service_type` to
GoHighLevel: **whichever group has the most money in it.** It is a documented
placeholder, marked `DECISION NEEDED` at `src/app/order-shell.js:471`.

`pax_count` has the same problem one line down: "2 trays", "50 pieces" and
"15 pax" are all correct and none can stand for the others, so it stores the
joined string.

**What it costs you:** mixed bookings are filed entirely under one service, so
the smaller groups disappear from revenue-by-service, Reports and Branch
Performance. The full breakdown survives as text in `dishes_selected`, so
nothing is lost — it just is not countable.

We have not touched it because what that field should *mean* is a business
decision, not a technical one. Flagging it so it is not a surprise in a
month-end number.

---

## 6 · Change & add order — built on our side, waiting on yours

Everything you asked for on 16 September is answered and built. Three things
changed as a result of your reply, and one we found afterwards that you need.

### The `after` shape — yours, and you were right

```json
change   { "package_id": "jeanette-100" }
add      { "items": [ { "dish_id": "…", "tray_size": "Family", "quantity": 1 } ] }
```

No prices, ever. `before` carries money as a display snapshot only, and now
carries `branch` as you asked.

### One thing you need that nobody specified

**`package_name` on the opportunity is not a catalogue name.** We checked
thirty live orders rather than trusting the field:

| What is stored | Count |
|---|---:|
| blank entirely (`service_type` = Combo Trays) | 18 of 30 |
| `Jeanette 100PAX` | vs catalogue `Jeanette Package` |
| `Maryrose Package 100Pax` | vs `Mary Rose Package` |
| `Sabrina 50pax` and `Sabrina 50Pax` | in the same sample |

So neither of us can resolve a package by name. **We now persist the real
catalogue id** on the order line — it was always in the builder's payload and
simply never kept — and it reaches you in `payment_links.order_groups` as
`packageId`.

**Read the id, not the name.** Use names only to find siblings, where the
catalogue is internally consistent.

**Known limit:** orders placed before `order_groups` existed carry no id, so
no change can be offered on them, ever. That is the right failure — offering a
size against a package nobody can identify is how a Jeanette becomes a Mary
Rose.

### The three guards — agreed, with your refinements taken

- **`before` compared on touched fields only.** You were right; comparing the
  whole booking would refuse a valid approval because somebody fixed a phone
  number.
- **The cutoff, evaluated at approve time.** The constant you asked for:

  ```js
  // src/domain/availability.js — beside STANDARD_LEAD_DAYS
  export const CHANGE_LOCK_DAYS = 7;
  export const ADD_LOCK_DAYS    = 3;
  ```

  Mirror it as we mirror `STAGE_IDS`. **Neither number moves without telling
  you first.**
- **`procured` is necessary, not sufficient.** Agreed and worth having in
  writing: those ticks are batched, so a late one means the guard passes after
  ingredients were bought. It narrows the window; it does not close it.

**No `expired` status.** It is computed, not stored — a pending request past
its cutoff *is* expired, from the event date alone. No job, no writer, and no
way for the two of us to hold different opinions about the same row.

### The table

`supabase/order_change_requests.sql`, with the partial unique index you asked
for. We treat the unique violation as the answer rather than asking first.

### What we have built

The request screens, the cutoff rules, one open request at a time, the pending
and decided states on Order Status, and the notice at checkout telling a
customer that booking this close means the order is final.

**Add is built too.** The picker offers only that booking's own package
contents — `package_items` read by the id above — so no new persistence and no
second builder. The tray size comes from the package rather than being asked,
and no price is shown: unlike a size change, an addition is priced by your
kitchen, and the panel tells the customer you will confirm it.

### What we need from you

1. **The queue screen**, with `procured` visible beside each request.
2. **Approve** — the three guards, then apply and set `status`.
3. **Decline** — set the status and a note. We show the note to the customer.
4. **The tag strings**, so the customer hears back:
   `order-change:approved` / `order-change:declined`. Record that the tag was
   set — your point about a renamed workflow failing silently is right, and
   that is what makes it traceable.

### Still open, and still Faithy's

**Price drop after a deposit — refund, credit, or refuse.** Unanswered. Your
queue needs somewhere for that decision to go and we cannot design the column
without the policy.

---

## Summary

| # | Item | Needs you? |
|---|---|---|
| 1 | `order_progress_public` view — two columns | **Yes — blocking** |
| 2 | `payment_links.order_groups` added | No — additive |
| 3 | Payment page reads `amount_paid` | No — but worth knowing |
| 4 | `order_lookup_attempts` table | No |
| 5 | `service_type` on mixed bookings | Your decision, no rush |
| 6 | Change / add order — `order_change_requests` + an approval queue | **Yes — agree the table first** |

Reply with just the numbers you want to change. Anything you do not mention we
will take as agreed.
