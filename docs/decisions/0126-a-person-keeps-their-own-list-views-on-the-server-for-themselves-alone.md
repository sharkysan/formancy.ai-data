# 0126 — A person keeps their own list views, on the server, for themselves alone

- **Status:** accepted; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): beside the views a form's administrator named, a person's own, offered to them alone; extends [0106](0106-a-hosts-grid-keeps-its-columns-sort-and-view-in-the-viewers-browser.md): a filter of a person's own is kept as a view of theirs, on the server and never in their browser, the alternative 0106 left to a decision of its own; extends [0013](0013-published-configuration-is-files-with-link-based-swap.md): the store keeps each person's views beside the versions, the newest alone; amended by [0128](0128-the-grids-of-an-open-form-share-a-persons-own-views.md): the grids of the open form share the person's views, a save or a remove in one shown in every one at once
- **Date:** 2026-11-02
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/records/own-views.test.ts` --
  a view is read as a list request reads it (watched failing with the
  filter kept as sent: a contains kept its spaces), saved last and in
  place of theirs named alike (every save appended), refused where their
  list could not run it (no fit: the auditor kept a view on an amount)
  and where it asks what a view the form offers them or another of theirs
  asks (the asks unread), at most twenty with a correction in place
  allowed (the limit asked before the name), offered only while it fits
  (passed through unfitted), and read back from the server's file only as
  written (names not compared: two "Placed").
  `packages/data-server/src/config-store.test.ts` -- a person's store
  beside the versions keeps each form's newest version alone (every
  version kept). `packages/data-server/src/routes/runtime-lists.test.ts`,
  over fake ports -- a saved view is offered to the person alone and kept
  under a hash of who they are (one name for everyone: the other clerk
  was offered it); saved in place and removed once however often it is
  asked (the remove answering the views as they were); a refusal keeps
  nothing (the save unfitted); a save that lost to another page reads
  again (no second read: 409); a damaged file offers nothing and is not
  written over (read unchecked: the form offered a person's view as the
  grid's default); and the audit names `view-save` and `view-remove`,
  never the view. `packages/data-client/src/transport.test.ts` -- a save
  sends exactly the view's keys (the view sent whole: its default reached
  the server) and a form without `own` is unexpected (`own` unchecked).
  `apps/host/src/view-save.test.tsx` -- the picker names a saved view
  under "Your views" (the person's views left out of what it matches), a
  refusal keeps the name as typed (the box emptied), one save is sent
  while one is on its way (no guard), the keyboard goes to the name box
  when View goes (sent to View alone), and a view of theirs is picked as
  the form's are (read by place among the form's).
  `packages/data-client/src/lists.integration.test.ts` and
  `apps/host/src/view-picker.test.tsx`, on both engines against the real
  server -- a saved view offered when the form is opened again (watched
  failing in CI with the form's own views left unread: none was offered
  after the save); `apps/host/src/plane.test.tsx`, whose journey saves and
  removes one, as it uses every route of the runtime plane; and
  `apps/host/scripts/browser/viewing.mjs`, in each browser.

## Context

0104 lets a person filter a list and 0105 lets a form's administrator name
views, a filter and a sort each, which a person picks. 0106 keeps a grid's
columns, its sort and the view it shows in the viewer's browser, and
refused to keep a person's own conditions there: a value typed into one --
a customer's name, an amount -- would outlast the person on a shared
machine. "A condition worth keeping is a view," it said, but only an
administrator could make one. It left keeping a person's settings on the
server, per person, "to a decision of its own". This is that decision, for
views.

## Decision

**A person saves the filter and the sort a grid shows as a view of their
own**, under a name, and removes the one shown. In the host's View picker,
while the filter and the sort are their own: "Name of your view" and Save
your view; while they are one of theirs: Remove your view. The picker
names theirs under "Your views", after the form's, and picks one as it
picks the form's. What the server answered is said on the picker's line.

**Two routes of the runtime plane** (`routes/runtime-own-views.ts`):
`POST /v1/forms/:id/views/save` with `{ name, filter, sort }` and
`POST /v1/forms/:id/views/remove` with `{ name }`, each answering the
person's views as the form now offers them, `{ own }`, or `invalid-view`
with a sentence for the person. A person who may not list the form is
refused as a list would be. Each is audited as `view-save` or
`view-remove`, never with the view. `GET /v1/forms/:id`'s `list` carries
`own`.

**A view of theirs is what their own list could run**
(`records/own-views.ts`): read as a list request reads it, a contains
trimmed; fitted as an administrator's view is (`viewFit`, 0105); never
asking what a view the form offers them asks, or another of theirs --
a picker would show either name for it; saved again under a name alike
but for case, it takes that view's place. At most twenty per form, and a
name of at most eighty characters: both choices, not measurements. No
default, no roles and no relative value, which are how an administrator
offers a view to others (0124, 0125). Offered back only while it fits;
one that no longer does -- a field they may no longer read -- is kept,
and offered again once it fits.

**Kept by the server, in the configuration store**, beside the versions as
drafts are (0065): `<store>/.people/<person>/<form>/<n>.json`, `<person>`
the SHA-256 of the token's subject, so no subject spells a path. A save
or a remove reads the person's views, changes the one it names, and
writes the next version by the store's compare-and-swap (0013), which
then removes the version before it, so a person who saves all day leaves
one file. One that lost to another page of the same person reads again,
up to three times. A file that does not read as the server writes it is
a 500, and nothing is written over it.

**A browser keeps none of it.** The views come from the server each time
the form opens, and a grid's kept list (0106) treats a person's view as a
filter of their own: its sort alone is kept.

## Consequences

**What it buys.** "My rush orders" is one name a person picks, on any
device they sign in from, and nothing of it is left in a browser.

**What it costs.**

- A person's views are in the configuration store: a backup or a copy of
  the store holds them, and nothing removes a person's views but the
  person, a person the host no longer knows included.
- The directory is a hash of the token's subject, not a secret: an
  operator who knows a subject can find that person's views. A host that
  changes how it names a person leaves their views behind.
- Each grid holds its own: a view saved in one grid of a form is offered
  in another grid of that form, or another page, once that one opens the
  form again.
- A reload does not open the grid on a person's own view: the browser
  keeps no view of theirs by name, only its sort (0106).
- Opening a form reads one more file.
- This release's `@formancy/data-client` requires `list.own`, so it
  refuses a form from a server of an earlier release as `unexpected`.

**What it forecloses.** Nothing.

## Alternatives considered

**In the browser, as 0106 keeps the rest.** Refused for 0106's reason: a
value typed into a condition would outlast the person.

**A table in the form's database.** The module writes nothing to a
customer's database but the records a form edits, and an account that may
create a table is one a deployment should not need.

**A store of its own, configured apart.** Another volume to back up and
another setting to forget; the configuration store already changes at
runtime, under the same compare-and-swap.

**Replace a person's whole list on each save.** A page holding an older
list would remove a view another page had saved since; a save or a remove
changes only the view it names.
