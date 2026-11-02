# 0125 — A list view may count days from today and compare with the signed-in person's attribute

- **Status:** accepted; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): a view's value may be relative to the day and the person it is offered to, resolved by the server; amends [0124](0124-a-list-view-may-be-offered-to-some-roles-and-open-their-grids.md): a view relative to whoever is signed in, its first cost, is offered
- **Date:** 2026-11-02
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/presentation/views.test.ts` --
  a relative value is `{ today: whole days }`, at most a century either
  way, or `{ attribute: a name }`, and nothing else (watched failing with
  relative values read as a request's: every one was refused); a day
  from today is held only by a date or a timestamp's field and an
  attribute only by an equality on text, a whole number or a uuid
  (watched failing with the stand-in left out: a day on a status was
  stored); a person is offered the view with each value resolved for
  them on the day, and not offered one naming an attribute they do not
  carry
  (watched failing with the values sent as stored: the page was handed
  `{ today: -7 }`); today is the date UTC is on (watched failing with
  the day read in the local zone, in Europe/Zurich).
  `packages/data-server/src/routes/runtime-lists.test.ts`, over fake ports
  -- the form offers a person a view of their own tenant, its value theirs
  (watched failing with the views offered as stored: the person was sent
  `{ attribute: 'tenant' }`).
  `apps/studio/src/list-views.test.tsx` -- a view counted in days from
  today and equal to the person's attribute says so in its words and
  publishes the relative values (watched failing with the relative values
  read as typed ones: nothing was saved).

## Context

0105's views hold values typed when they were made. "Placed last week" was
a range of two dates that stopped being last week a week later, and "the
orders I approve" was one view per employee, or none. 0124 offered a view
by role; a view for whoever is signed in was the cost it named.

## Decision

**A view's value may be relative** (`ViewValue`,
`packages/data-core/src/presentation/view-values.ts`): where a condition
holds a value -- an equality's, a range's bounds -- it may hold
`{ today: n }`, whole days from the day the view is offered, at most
36,500 either way, or `{ attribute: name }`, the signed-in person's
attribute of that name as their token carries it, the attributes a row
filter compares with (0011).

**What may hold one is the field's.** A day from today is a date's or a
timestamp's, where a range of whole days is read as 0104 reads one; an
attribute is text, compared for equality with a field whose input is
text, a whole number or a uuid. A write fits the view with a stand-in of
the field's input in each relative value's place, so what a person could
not have built is refused at publication as before
(`storedViewFit`).

**The server resolves them, for one person, when it offers the views**
(`viewsFor`): today is the server's UTC date, and each value becomes the
typed value a person's own condition would hold. What a page receives and
sends is a list request as before; a relative value never reaches a
browser, and `@formancy/data-client` reads the list unchanged. A view
naming an attribute the person does not carry is not offered to them,
closed as a row filter is on a missing attribute (0011); one whose
resolved value their list cannot run is dropped by the fit 0105 already
makes.

**The studio edits them** in the view's row: "Count in days from today"
on a date's equality or range, "Equals the signed-in person’s attribute"
on an equality the field can hold one for, and the view's words say
"from 7 days before today to today" and "= your employee".

## Consequences

**What it buys.** "Last week", "due in the next fortnight" and "mine" are
one view each, published once, true on every day for every person.

**What it costs.**
- Today is resolved when a person opens the form: a page left open past
  midnight keeps yesterday's views until it is opened again.
- Today is the UTC date, not the person's: near midnight a person east or
  west of UTC sees the next or the previous day's view.
- An attribute is a name the host's token carries: a name misspelt offers
  the view to nobody, and nothing checks it against the token.
- An attribute is compared for equality only, and only on text, a whole
  number or a uuid: "in my region's list" and a date from the token are
  not offered.
- A server of an earlier release refuses a version whose views hold a
  relative value.

**What it forecloses.** Nothing.

## Alternatives considered

**Resolve them in the browser.** The page would read the person's
attributes and the clock, and a view would be decided in two places: a
browser whose clock was wrong would ask for a week that is not the
server's, and the client would need to know what the token carries.

**Relative values in the list request.** A person's own filter could then
say "today" too, but the request would change for every client, and a
person's typed day already says what they mean.

**The person's time zone.** Neither the token nor the request carries
one; a time zone is a later change, and UTC is the one day every server
agrees on.
