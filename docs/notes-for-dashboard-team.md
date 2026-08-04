# Notes for the dashboard team

**From:** Meal Builder · 4 August 2026
**Why:** we share one Supabase project and one GoHighLevel location, and several
things changed on our side this week that your code reads. Two of them answer
questions your own plan is currently blocked on.

Nothing here is a request to stop what you are doing. Items 1–3 unblock you.

---

## 1 · Your `event_date` ask is pointed at the wrong place

Your Part 5 lists *"Populate `event_date` in the Meal Builder — Meal Builder team"*
against the 91% of opportunities missing it.

**The Meal Builder already populates it on 100% of what it creates.** It is a
required field in all five builders. We measured the split:

```
Spandi's Basic Package Ordering System   103 opps | 103 with event_date (100%)
Old Bookings (For Reconciliation)       1061 opps |   0 with event_date (0%)
```

The 1,061 are legacy records in a **different pipeline**. Nothing we change can
reach them. The fix is a backfill on that pipeline, or scoping the dashboard to
the live one.

Worth knowing: those 103 are almost entirely the 3 August migration — 102
imported bookings plus one test. **The Meal Builder has not yet produced
production volume**, so "9% have a real event date" is really "the only records
with one are the migrated ones".

---

## 2 · Your pax fingerprint question — answered

Your Step 5 is *"Blocked on Meal Builder confirmation"* as to whether pax and
dishes always move together.

**They do not, on two of five services:**

| Service | pax derived from | dishes derived from | Coupled? |
|---|---|---|---|
| Party Trays | the cart | the cart | yes |
| Packed Meals | the cart | the cart | yes |
| Catering combos | the combo | the combo | yes |
| **Grazing** | the selected tier | **a fixed menu** | **no** |
| **Catering Package** | a free-entry stepper | **a fixed menu** | **no** |

For Grazing and Catering Package, changing pax changes the price and leaves
`dishes_selected` byte-identical. Your dish-only fingerprint will not see it.

**So build the pax fingerprint.** Your instinct to flag rather than reset is
right — the dishes are still correct, only the quantities changed.

---

## 3 · A new field, and one you should stop keying on

**`opportunity.delivery__pickup_time` now exists.** Double underscore — GHL
derived the key from the label "Delivery / Pickup Time".

This is the **operational** time: when food leaves the kitchen. It carries the
06:00–17:00 kitchen release window, and it is what the branch calendar
appointment is booked against.

**`event_time` is now optional and almost always empty.** Across the entire
location, **one** opportunity has it. It means when the customer's event starts,
which is often unknown at booking and can legitimately be 7pm.

```
delivery__pickup_time   92 of 103 populated   ← use this for a day view
event_time               1 of 1164 populated  ← effectively dead
```

If the Bookings calendar or the Kitchen board keys on `event_time`, it is reading
a blank field. That is our change and we should have told you before shipping it.

**Also: `receive_method` values changed from `Courier|Pickup` to
`Delivery|Pickup`.** Your Confirm step routes on this to decide Ready for Pickup
versus Clear to Delivered. `Pickup` is unchanged; `Courier` no longer appears on
new bookings. Two historical records still carry it.

---

## 4 · GoHighLevel allows one open opportunity per contact

Verified against the live location with two throwaway records, since a code
comment claimed it and nothing had tested it:

```
opportunity 1  →  201 created
opportunity 2  →  400 OPPORTUNITY_NO_DUPLICATE
```

Different names, different content, no `event_date` at all — still refused. **The
rule is per contact, not per date.**

Two consequences:

- A repeat customer cannot hold two open bookings. We now detect this and ask the
  customer whether the new order belongs to the existing booking or is a separate
  event, rather than silently merging or failing.
- GHL's **opportunity search is eventually consistent** — for roughly a minute
  after creation it does not come back from a lookup. If anything on your side
  reads back an opportunity right after writing it, expect a miss. The
  `meta.existingId` on the rejection is authoritative and has no lag.

Worth deciding together: whether to turn on **Allow Duplicate Opportunities** at
the location. It would let genuinely separate bookings be separate records, which
is the correct data model for both of us.

---

## 5 · Payments and balances — needs agreeing before either side builds

Your booking data shows deposits are normal: `DP (₱9,500); REMAINING (₱9,500)`,
`RESERVATION FEE PAID 10,000`. Eight of the seventeen migrated records that
mention payment at all are partial.

The current flow does not really support that:

**On our side** — a payment link is single-use and expires 15 minutes after first
open. Once a deposit is uploaded the link is dead, so there is no way for the
customer to pay a balance later.

**On your side** — `api/payment-submissions.js` writes `amount_paid: String(amount)`,
which **replaces** rather than accumulates, and the per-payment amount is not
stored in Supabase at all. Only `status`, `reviewed_at` and `reviewed_by` are
saved. So there is no payment history to sum, and nothing cross-checks the amount
against the order total.

### What we would propose

```
balance    = order total − sum(verified payments)
fully paid = balance <= 0
```

- Store the amount on each verified submission — one column, gives a real history
- Sum them per booking instead of overwriting a single field
- Derive the status rather than offering it as a dropdown
- Our payment page shows total / paid / balance and stays open until settled

### Two things to agree first

**Who owns the balance calculation.** If both sides compute it independently they
will drift, and they will drift about money. We would suggest a Postgres view or
function in Supabase that both read, so neither app can implement its own version.

**The schema change.** `payment_submissions` is one table used by both repos.
Adding an `amount` column affects you and us, so it needs agreeing rather than one
side running it.

---

## 6 · Small ask: `activity_log`

We are revoking public read access on `payment_links` and `payment_submissions` —
they hold customer names, phones and addresses, and currently answer `200 []`
rather than `401`, meaning the grant exists and only RLS is withholding rows.

`activity_log` is in the same state, but it is yours: `LogContext.jsx` reads it at
`:17` and writes at `:54` from the browser with a signed-in session.

**We would revoke `anon` only, never `authenticated`** — a logged-out visitor has
no reason to reach an audit trail. Can you confirm that is safe before we run it?

---

## 7 · Two things from reading your repo

Offered as observations, not requests.

**No migration tracking.** 35 loose `.sql` files, no runner, no applied-log. It
matters more than usual here because three of them put `owner_financial_periods`
in three different security states — `relax-rls` opens it, `page-access-rls`
closes it, `page-access-rls-rollback` re-opens it — and nothing records which one
production is in. Your own `page-access-rls.sql` warns that running two files out
of order would "silently strip developer accounts of Owner Financials with no
error to notice", which is only a risk because nothing enforces order.

With 23 tables reachable directly from the browser, including
`restricted_compensation`, a test asserting RLS is enabled and policied on each
would be the highest-value test in the repo.

**You have one serverless function slot left.** `api/` holds 11; Vercel Hobby
allows 12. `kitchen.js` is already a 380-line monolith because splitting it broke
the build. Your plan adds an ingredient importer, Costing persistence, break-even
settings and offline sync — plausibly 3–5 new endpoints against one free slot.
Worth resolving at Step 0 rather than mid-Step-1.

---

## What we need back

| | From you |
|---|---|
| 1 | Is revoking `anon` on `activity_log` safe? |
| 2 | Do you want to own the balance calculation, or shall we propose a shared Supabase view? |
| 3 | Are you happy for `payment_submissions` to gain an `amount` column? |
| 4 | Anything on your side still keyed on `event_time` that should move to `delivery__pickup_time`? |
| 5 | Any objection to enabling Allow Duplicate Opportunities at the location? |
