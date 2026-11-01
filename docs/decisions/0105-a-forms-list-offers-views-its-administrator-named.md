# 0105 — A form's list offers views its administrator named, each one a filter and a sort a person could have built

- **Status:** accepted; extends [0030](0030-presentation-is-a-patch-over-the-generated-base.md): a presentation names a list's views, carried by the rebase; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): a view is a person's filter and sort, named and published; extended by [0106](0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md): a grid opens on the view its viewer last picked, kept by name in their browser, before the default; extended by [0123](0123-an-administrator-chooses-the-fields-a-forms-filter-panel-offers.md): the presentation keeps, beside the views, the fields the Filter panel does not offer
- **Date:** 2026-10-28
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/presentation/views.test.ts` --
  a view's shape read on every read, a name a picker can show and two
  alike but for case refused, two views asking the same refused, `views:
  []` refused, and a contains a search could not run left to the fit
  without hiding a malformed condition after it; the fit refusing a value its column cannot
  hold, a field a list neither filters nor sorts by, an operator not
  offered and a contains stored untrimmed; `listColumns` withholding a view
  naming a field the person may not read, and its default with it, and a
  stored view that no longer fits, and every view it offers accepted by
  `planList`; and the rebase following a renumbered key and dropping,
  after the fields' and sections' conflicts, a view whose column is gone,
  no longer answers or was never bound. `packages/data-server/src/bundle.test.ts` -- views
  read by shape and their fit not asked on read;
  `routes/admin.test.ts` -- a publish refusing a view its bindings cannot
  run, naming it, and storing one they can; `routes/runtime-lists.test.ts`
  -- `GET` offering a clerk only the views they could have built;
  `routes/admin-evolution.test.ts` -- a regeneration answering
  `view-dropped`. `packages/data-client/src/transport.test.ts` -- a list
  without views, or with one a picker could not send, refused.
  `apps/studio/src/list-views.test.tsx`, `carry.test.ts`,
  `publish.test.tsx`, `regenerate.test.tsx` and `review.test.tsx` -- a
  view defined by keyboard published, refused before saving as the server
  would refuse it, edited, moved and removed, carried by Generate again
  and a regeneration with a dropped one said, held back from a publish
  when it no longer fits, and shown to a reviewer.
  `apps/host/src/views.test.ts` and `view-picker.test.tsx`, on both engines
  -- a grid opening on its default in one request, a choice sending
  nothing until Show view, a view shown as one first page in its filter and
  its sort, a condition or a header making the
  section the person's own, All records, a default on a field the person
  may not read leaving the grid on every record, the file in the view's
  filter and sort, a child section's own views, and no picker without
  views. The browser gates' `apps/studio/scripts/browser/journey.mjs` and
  `apps/host/scripts/browser/viewing.mjs`.

## Context

A person filters a form's list by conditions on its columns and sorts it
by its headers
([0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md),
[0044](0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)).
The questions a team asks of one form are mostly the same few -- the
orders still open, the customers with no credit limit, last month's
shipments by weight -- and every person built each of them again, condition
by condition, and lost it with the next reload, since a filter is kept in
no address (0104).

What the administrator who publishes the form knows is which of those
questions matter. A view names one: conditions and an order, which a person
picks above the grid and may then change.

## Decision

**A view is a list request with a name.** `ListView` (data-core's
`runtime.ts`) is `{ name, filter, sort }`, each term exactly what a list
request carries (`ListFilterTerm`, `ListSortTerm`), and `default: true` on
at most one view, the one a grid opens on. Picking a view sends its filter
and its sort as a person's own are sent, and `planList` plans them as it
plans a person's: a view narrows what the policy admits and never widens it,
and nothing new reaches an adapter.

**A view is part of the presentation.** `PresentationOverrides.views`
holds them in the order a picker lists them, and is left out when there are
none, never `[]`, so a presentation keeps one spelling (0030). A view
therefore travels where a presentation does: in a published version, a
draft under review
([0065](0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)), a
restored or imported version
([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md)), and
through a regeneration.

**Three questions, asked at three times.**

| Question | Asked | By | What a failure does |
|---|---|---|---|
| Is it shaped as a view? | every read of a version, and every write | `viewShapeProblems` (`presentation/views.ts`), through `presentationShapeProblems` | the version is not served ([0019](0019-a-published-form-is-checked-every-time-it-is-read.md)) |
| Could a list of these bindings run it? | every write but a restore | `viewProblems` (`records/list.ts`), from `storable` (`data-server/src/publishing.ts`) | 422 `invalid-bundle`, naming the view |
| Could this person have built it? | every `GET /v1/forms/:id` | `listColumns(bindings, fields, views)` | the view is not offered to them |

The shape is a non-empty list of `{ name, filter, sort }` with an optional
`default: true`. A name is words with no space around them, no control
character and no lone surrogate, and no two names are alike but for case.
A filter and a sort are read by the request's own readers, `readFilter`
and `readSort`, each field named once. Filter and sort are not both empty,
which would be the list itself. No two views ask the same -- the same
conditions, in whatever order, and the same sort -- since a picker shows
a grid's filter and sort as the first view that asks them, and could never
show the second. At most one view is the default.

What `contains` may find is a search's rule (0104), which a later release
may tighten. A view whose text a search could not be is therefore a fit
problem, not a shape problem: the version stays readable, and that view is
not offered. Each condition is read on its own, so a contains of that kind
hides no malformed condition after it.

The fit, `viewFit`, is one decision for a write and for an offer:
- its filter reads as a request's does, and is stored as it reads, with a
  contains trimmed;
- every condition is on a field `filterable` offers, planned by
  `columnFilter` over that field's column, so a value its column cannot
  hold is refused;
- every sort field is one `sortable` holds.

At a write it is asked against everything the list offers, so a view on a
field only some may read is stored. At an offer it is asked against what
this person's list offers them.

**A view is offered only whole.** A person who may not read a field a view
names is not offered the view at all. Offered it with that condition, they
could tell which rows match without reading a value. Offered it without
that condition, they would see a wider list under the view's name. A
default whose view is not offered leaves the grid opening on every record.

**A regeneration carries a view by what its fields stand for**
(`rebase-views.ts`). Each key it names is followed by its column, as a
label is, so a renumbered key keeps its view. Then the view is fitted to
the new bindings as a write would fit it. A view naming a column that is
gone, or one that no longer offers what the view asks (a date retyped as a
timestamp has no equality, 0104), is dropped whole and said as
`view-dropped`, after the fields' and sections' conflicts, and its default
goes with it.

**The studio defines them, and the host offers them.** The Presentation
step's List views (`apps/studio/src/list-views.tsx`, `view-form.tsx`)
makes, edits, removes and moves views by keyboard. Its fields are offered
by their labels, from `listColumns` over every field, and its conditions
are typed with the Browse step's boxes and hints, one module both use
(`condition-draft.tsx`). Before a view is saved it is checked by
`viewShapeProblems` and `viewProblems`, the server's own checks. Generate
again and a regeneration carry the views through `rebasePresentation`;
the Publish step sends them in the presentation; and the Review step shows
a draft's views under its policy, so a publisher approves what they can
see.

The host's View picker (`apps/host/src/view-picker.tsx`) is a form before
a grid's Filter panel, in the Records panel and in each child section,
shown only where the server offers a view: a native select and Show view,
as the search is a box and Search. Its choices are "All records", each
view by name, and "Your own filter and sort". The last is there only while
the section's filter and sort match no view and are not both empty.

A choice in the select sends nothing. A browser may change a closed
select's value with each arrow key, firing `change` each time, and applied
on change, each step would be a request and would throw away the person's
own conditions on the way past; nothing here measured which browsers do. What the select starts at is derived from the filter and the
sort (`views.ts`) and never kept, so a condition added or a header pressed
after a view is shown is the person's own, and the view's exact conditions
and order show the view again.

The grid's sort is the section's, held beside its filter, as Download CSV
sends it. Show view sets both at once and asks for one first page, or
nothing for the choice the grid already lists, and leaves the keyboard on
the button.
A grid opens on the view offered as the default, and no view enters the
address, as no filter does (0104).

## Consequences

An administrator writes a form's common questions once, and every person
who may read what they ask finds them above the grid. A view publishes,
reviews, restores and regenerates with the presentation it belongs to. It
adds no statement and no route, and it puts no value in a URL.

The costs:

A view is only what a person could have built: conditions joined by AND, no
OR, and no value relative to the day or the person. "Overdue" (a date
before today) and "assigned to me" cannot be views yet. Each needs a value
the server fills in at request time, and that is a decision of its own.

A view's name is text in one language, not a translatable message.

Views are the same for everyone who may read their fields. A view cannot
be kept to a role. A person cannot save a view of their own, and the host
remembers no choice across a reload.

A view on a field nobody may read is stored and offered to nobody, and the
studio says nothing of which roles will be offered which view: its panel
says only that a person is offered a view if they may read every field it
names. Saving, removing and moving a view are not on the Presentation
step's Undo and Redo, which are the form document's, and a view being
defined and not saved is lost when the step is left. A refusal is said in
data-core's sentence, with its path counted from 0 and the field's key,
where the panel counts from 1 and names labels.

A stored view that a later release no longer runs is not offered, and
nothing says so to the person or in the log. It is found by publishing
again, when the write refuses it.

A regeneration drops a view whose field is gone rather than carrying it
without that condition. The administrator defines it again if the rest
still matters.

`@formancy/data-client` refuses a form whose list says nothing of views, as
it refuses one that says nothing of filters (0104), so a host upgrades its
server before its client.

## Alternatives considered

- **A server-side `view` in the list request, resolved by name.** Rejected
  for now: the server would apply conditions the person cannot see or
  change, and a view on a field they may not read would filter by it. Sent
  as the person's own filter, a view can do nothing the person could not.
  It is the place to start when a view needs a value only the server
  knows, such as today's date or the person's own attribute.
- **Views as a part of the bundle beside the presentation.** Rejected: the
  presentation already travels with drafts, imports, restores and
  regenerations, and has the rebase that follows a key to its column.
  A part of its own would need all of that again.
- **Fit asked on every read, as the form's presentation is applied.**
  Rejected: a later release that offers less, such as a shorter contains,
  would make every version holding such a view unreadable, and the whole
  form unserved for one preset. The fit is asked at write and at offer
  instead.
- **Offer a view without the conditions a person may not use.** Rejected:
  it would be a different, wider list under the same name.
- **Carry a view without the condition whose column is gone.** Rejected
  for the same reason.
