# Notes for the dashboard team — round 4

**From:** Meal Builder · 9 October 2026
**Re:** Receive method and ready time

**Two** things we needed from you before we merge. Two you should know about.
Everything below is on branch `feat/assisted-delivery`, not yet merged.

**Status: answered 9 October 2026. Nothing on your side blocks our merge.**
Your answers are recorded under each item.

---

## 1 · `receive_method` has new values

New bookings write **`Assisted delivery`** or **`Client pickup`**, replacing
`Delivery` and `Pickup`. The old names described a delivery fleet Spandi's
doesn't run: a rider we book collects from the branch.

Older bookings keep `Delivery` / `Pickup` / `Courier`. We are not backfilling
them. Our own `isPickup()` accepts both `Client pickup` and the old `Pickup`,
so the payment page labels older bookings correctly.

**What we asked:**

- **The field type in GoHighLevel.** If `receive_method` is a dropdown with
  fixed options, add the two new values and keep the old ones for history.
- **Any exact match on `"Delivery"`.** Please check filters, report groupings
  and board labels.

**Your answer:**

- `receive_method` is `TEXT`, with no picklist. The new values write straight
  through and there is nothing to configure in GoHighLevel. (`payment_status`
  and `payment_method` are `SINGLE_OPTIONS`. If either ever changes, its
  options need adding.)
- There are no exact matches. Every comparison is a case-insensitive
  substring test: `/delivery/i` in OrderCard, OrderSheet, orderBoardReport and
  Bookings, and `/pickup/i` in `confirmTargetFor`. All five behave correctly
  with both old and new values. Everything else displays the raw string.

---

## 2 · `delivery__pickup_time` is now a ready time, not an arrival time

The field and its GHL key are unchanged. What it means has changed. It is now
**when the food is ready at the branch**, for the rider or for the customer to
collect. It is not when it reaches the venue.

We work it out from the event start: 2 hours before for assisted delivery,
1 hour 30 for pickup, kept inside the branch's kitchen hours. Customers can
change it.

**What we asked:** if your kitchen board or rider booking treats this as a
delivery arrival time, please switch it to "leaves the kitchen". On our
screens the labels are now "Ready for the rider" and "Ready for collection".

**Your answer:** the countdown and the kitchen board already treat it as when
the food must be ready, never as an arrival. The labels are what's wrong.
`OrderSheet.jsx:437` says "Delivery time" / "Pickup time", and the production
sheet says "Pick up time". You will change both to "Ready for the rider" /
"Ready for collection".

**Agreed timing:** your label fix lands **before or with** our merge, never
after. Until we merge, "Delivery time" is still correct. From the moment we
merge, it tells chefs the wrong thing.

---

## 3 · For your information — `event_time` is now always filled

In round 1 we told you `event_time` was usually blank. It is now required on
every new booking.

**Your answer:** noted. The order sheet already hides the event time when it
equals the pickup time, so this makes that more useful.

---

## 4 · For your information — the server checks kitchen hours per branch

`api/ghl-inquiry.js` rejects a ready time outside the branch's hours: Cavite
06:00–17:00, Batangas and Montalban 08:00–17:00. **These hours are
unconfirmed.** The pickup card shows different ones (Cavite 8–5, Batangas
10–4), and Montalban has none. We are asking the caterer for the real hours.

**Your answer:** you hold no branch hours anywhere, so we are the only source.
Once the caterer confirms, you may want to read them from us rather than hold
a copy.

---

## Summary

| # | What | Who acts | Status |
|---|---|---|---|
| 1 | Field type, and any exact `"Delivery"` matches | You | **Cleared** — TEXT field, substring matches only |
| 2 | Sheet labels say "Delivery time" / "Pick up time" | You | **Agreed** — lands before or with our merge |
| 3 | `event_time` always filled | FYI | Noted |
| 4 | Kitchen hours by branch | Caterer | **Open** — asking for real hours |
