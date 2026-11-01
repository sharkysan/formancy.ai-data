# 0123 — An administrator chooses the fields a form's Filter panel offers

- **Status:** accepted; extends [0104](0104-a-list-and-a-browse-are-filtered-by-conditions-on-their-columns.md): each field a list is filtered by says whether the form's Filter panel offers it; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): the presentation keeps, beside the list views, the fields the panel does not offer, carried by a regeneration by their columns
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/unfiltered.test.ts` -- a list marks
  every field it is filtered by offered but those left out (watched failing
  with every field offered); the choice is a list of field keys a list is
  filtered by, each once, never empty, and a lookup or a key the form does
  not have is refused (watched failing with the fit unasked: customer was
  stored); applying the presentation leaves the form as it was; a
  regeneration carries it by the column and drops a field that is gone
  (watched failing with the keys carried as they were: the gone column's
  key was kept). `packages/data-server/src/routes/runtime-lists.test.ts`,
  over fake ports -- the form says the panel does not offer the field left
  out, and still offers a view that filters on it (watched failing with the
  choice not passed to the list). `routes/admin.test.ts` -- a publish
  refuses a key no list is filtered by and stores one it is (watched
  failing with the fit left out of `storable`).
  `packages/data-client/src/transport.test.ts` -- a field filtered by that
  does not say whether the panel offers it is no form the server sent
  (watched failing with `offered` left unchecked).
  `apps/host/src/filter-panel.test.tsx` and `filter-terms.test.ts`, without
  a server -- the Field menu offers only the fields offered (watched failing
  with the menu over every field: Notes was offered); with none offered,
  no form opens and a condition on a field left out is still said (watched
  failing with the toggle drawn over no field); the panel is drawn for a
  field it offers or a condition applied (watched failing with it drawn for
  any field filtered by). `apps/host/src/filter.test.tsx`, against the real
  server on both engines -- a field left out is not in the Field menu.
  `apps/studio/src/presentation.test.tsx` -- a field unticked under "The
  Filter panel offers" is published as left out (watched failing with the
  choice left out of the publish); `carry.test.ts` -- "Generate again"
  carries it and drops it with its column; `review.test.tsx` -- a draft's
  reviewer reads the fields it leaves out (watched failing with the section
  left out).

## Context

0104 gave every grid of the host page a Filter panel over every field a
list of the form is filtered by, as the server reads that list for the
person. 0105 let an administrator name views -- conditions and an order a
person picks. What a person may filter by on their own was every field the
list offered: an administrator could not keep the panel to the fields
that mean something to the people using the form, and leave out an
internal code, a technical flag, or a column a view already covers.

## Decision

**The presentation names the fields the panel does not offer**
(`unfiltered`, `packages/data-core/src/presentation/unfiltered.ts`): field
keys, each one a list of the form is filtered by, in the bindings' order;
left out when there are none, so a presentation keeps one spelling. A
field new to the form is offered, as before.

**It is presentation, not permission.** A field left out is still one a
list is filtered by: a view may filter on it, the server plans a condition
on it from any client, and the panel says a condition applied on it -- a
view's -- with its Remove. What a person may read or filter by at all is
the policy's (0011, 0044).

**The server says it per field.** `GET /v1/forms/:id`'s `list.filterable`
gives each field `offered`, false for a field left out. A publish refuses
a key no list of the form is filtered by, as it refuses a view that does
not fit (0105). A regeneration carries each key by what it stands for and
drops, without a word, one whose field is gone or no longer filtered by:
the panel could not offer it either way.

**The host's panel offers what is offered.** Its Field menu lists the
fields offered; the grid draws the panel for a field offered or for a
condition applied, and with none offered it says the conditions applied
and opens no form.

**The studio chooses it** in the Presentation step's List views: "The
Filter panel offers", a checkbox per field a list is filtered by, ticked
where the panel offers it. "Generate again" and a regeneration carry it;
a draft's reviewer reads the fields it leaves out.

## Consequences

**What it buys.** An administrator keeps a form's Filter panel to the
fields its people filter by, without taking anything from a view or from
what the server answers.

**What it costs.**
- One choice for everyone: a field is offered to every person who may
  filter by it, or to none; not per role.
- A field left out is still filtered by through the list route, so
  leaving it out hides nothing from a client of its own.
- This release's `@formancy/data-client` reads a filterable field without
  `offered` as unexpected, so a host upgrades its server before its
  client. A server of an earlier release refuses a version whose
  presentation leaves a field out, as `unfiltered is not a property of a
  presentation`.

**What it forecloses.** Nothing.

## Alternatives considered

**The fields the panel offers, rather than those it does not.** A field new
to the form would not be offered until somebody added it, and a form with
no choice would need every field listed to say "all".

**Refuse a condition on a field left out.** It would make a presentation
choice a permission, break the views that filter on it, and differ from
what the policy says a person may read.

**A choice per field in the field's own presentation entry.** A field's
entry is derived from the edited form's document, and the panel is no part
of the document; the choice sits beside the views, which are not either.
