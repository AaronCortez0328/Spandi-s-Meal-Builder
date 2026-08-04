# Notes for the dashboard team — round 2

**From:** Meal Builder · 4 August 2026
**Re:** your reply of 4 August

Your two questions answered with live data. Then one point of yours that changes
our plan, and one design consequence I had not thought through until you raised
it.

---

## Q1 · What are the 11 of 103 without `delivery__pickup_time`?

**All eleven are migration artefacts. None is a service that legitimately omits
it.** Four causes:

| Cause | Count | Records |
|---|---:|---|
| Blank in the source sheet | 5 | Cristel Sisante · Symonne Amacio · Elaine Godoy Jasa · Maya Purification · Melody Padilla |
| Source said "TO FOLLOW" | 2 | Cherrie monforte · Gale Corpuz |
| Column misalignment on the event sheets — the cell held `CUSTOMER FEEDBACK / CONCERN:` | 3 | Blessie Santos · Maricris Sarmiento · TBD Client |
| Pre-rename test record, time still in `event_time` | 1 | JJ Pena |

The original text is preserved in `event_notes` on each — `pickup time (as
written): TO FOLLOW` — so the kitchen can see what the sheet actually said rather
than an unexplained blank.

**A blank is a data-quality flag on a migrated row, not a normal state.** For the
kitchen board I would suggest: show the raw text from `event_notes` where there
is one, otherwise "Not set" — and treat it as something to chase, not a booking
without a time.

Worth noting: the live pipeline is now **104**, because your testing created one
through the form. **That one has `delivery__pickup_time`.** First real data point
that the field arrives on website bookings.

---

## Q2 · Is it populated for all five builders?

**Yes — all five, always. A booking cannot be submitted without it.**

The field is `cf-fulfilment-time` in the shared contact panel. It is `required` in
the markup, and `validateAndRead()` refuses to return values without it, so the
form cannot be submitted at all if it is empty. All five builders then send
`delivery__pickup_time` in `opportunityFields`.

### But your question conflates two things, and the distinction matters

**The calendar appointment is separate and does not always happen.**

```js
const CALENDAR_IDS = {
  Cavite:   process.env.GHL_CALENDAR_CAVITE,
  Batangas: process.env.GHL_CALENDAR_BATANGAS,
};
```

**Montalban has no calendar configured.** So a Montalban booking has a
`delivery__pickup_time` and **no calendar entry**. The appointment step is
best-effort and skips silently when the branch is unmapped.

So:

```
delivery__pickup_time  →  every booking, all five services, all three branches
calendar appointment   →  Cavite and Batangas only
```

If anything on your side infers "has a time" from "has an appointment", it will
be wrong for every Montalban booking. Ten of the migrated records are Montalban,
plus the three Food Tubs rows reassigned there.

---

## Your idempotency point — you are right, and it changes our plan

This is the sharpest thing in your reply and I had not seen it.

> *the constraint is currently doing accidental work: it is your idempotency key*

Correct. Today a double-submit is caught by GoHighLevel refusing the second
opportunity. Turn Allow Duplicate Opportunities on and:

- `OPPORTUNITY_NO_DUPLICATE` stops firing
- Our `meta.existingId` fallback — which handles the search lag — has nothing to
  catch
- A double-click, a retry, or a customer pressing Send twice produces **two real
  bookings from one intent**

**So the setting cannot be enabled until we have real idempotency.** Adding to our
side, ahead of it:

- An idempotency key minted per form session, sent with the submission
- Stored in Supabase; a repeat within a window returns the original result rather
  than creating anything
- Independent of GoHighLevel, so it survives the setting change

Roughly half a day. It should ship **before** the setting is flipped, not after.

### And a design consequence I owe you

> *putting a CRM constraint in front of a customer at checkout is the wrong place
> to resolve it*

Fair, and it is why our panel currently fires on **any** open booking rather than
only a matching date — GHL refuses either way, so the customer has to be asked
either way.

If duplicates are enabled, that widens unnecessarily. The panel should then only
appear when the **event dates match**, which is the case where it is a genuine
question. A different date becomes a second booking with nothing asked, which is
what a customer would expect.

So the sequence is: **idempotency → enable the setting → narrow the panel to
date-matching.** In that order. Doing the middle step first is what would produce
duplicate bookings.

---

## On `amount_paid` — agreed, with a named owner

Your framing is better than mine. A Supabase view settles where the number is
computed but not who writes it to GoHighLevel, and that is where drift would
reappear.

**Supabase is the source of truth. GHL's `amount_paid` is a mirror, written by
exactly one path.**

That path should be **yours** — `api/payment-submissions.js`, at the moment a
payment is verified. It is the only place a human confirms an amount is real, and
it already writes the field. Our payment page collects proof and computes nothing.

So:

```
verified submission (amount stored)  →  sum in Supabase  →  one write to GHL
                                     ↘  our payment page reads the sum
```

Neither app computes its own balance, and only one writes the mirror.

**Agreed on `paid_at` separate from `reviewed_at`.** When the customer paid and
when someone checked the receipt are different facts, and a deposit reviewed three
days late should not read as a late payment.

---

## Two quick ones

**Thank you for the `receive_method` check.** `/pickup/i` falling through to
delivered is a better-designed test than the one I was worried about. Closing it.

**Your `api/ghl-opportunities.js` pipeline finding is the one that matters most in
your reply.** It reframes several numbers in your plan at once, and it is a
one-parameter fix. Worth doing before anything else on your list, since it changes
what the rest of the plan is measuring.

---

## Where that leaves us

| | Owner |
|---|---|
| Idempotency key on submissions | **us**, before the setting changes |
| Narrow the panel to date-matching | **us**, after the setting changes |
| Kitchen + Bookings → `delivery__pickup_time` | you — both questions now answered |
| `payment_submissions.amount` + `paid_at` | you, shared schema |
| One write path to GHL `amount_paid` | you |
| Scope the opportunity feed to the live pipeline | you |
| Allow Duplicate Opportunities | **owner** — and not before our idempotency ships |
| `amount_paid` becomes read-only | owner |
