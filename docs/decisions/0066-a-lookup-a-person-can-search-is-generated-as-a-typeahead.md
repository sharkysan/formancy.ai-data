# 0066 — A lookup a person can search is generated as a typeahead, and a host draws the control it is given

- **Status:** accepted; the failed plain select its costs and **Verified by** describe is formancy 0.5.0's: from 0.6.0 each renderer says "The options could not be loaded. They are asked for again each time you move to this field." under it, and moving to the select asks again, which `apps/host/src/lookup-controls.test.tsx` now holds
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/lookup/searchable.test.ts` — over a table that
  decides every kind of `NormalizedType`, so a kind added to the metadata
  fails its type check until somebody says whether a search matches it:
  `SEARCHABLE_KINDS` and `searchableDisplay` search text and whole numbers
  and no other kind, and a column the label shows twice is searched once,
  in the order the label shows it, with its type (both cases watched
  failing against a `searchableDisplay` that returned every column).
  `packages/data-core/src/lookup/display.test.ts`, *isDisplayType*, over
  the same kind of table: a label shows every kind with a canonical text,
  each with a value `displayText` spells, and no binary, rowversion or
  unsupported column (watched failing with `unsupported` left out of
  `NO_TEXT_KINDS`).
  `packages/data-core/src/generate/generate.test.ts`, *lookup controls
  (0066)*, over the restated fixture-like snapshot of each engine: the
  order's customer is a select with `widget: "typeahead"` whose note says
  "drawn as a typeahead searching name", and "searching customer_no, name"
  when it shows both (watched failing on main, which wrote no widget and
  named no control); the order line's `order`, which shows `order_date`
  alone, has no widget, and its note says it is a plain list of its first
  page and what to show to make it searchable (watched failing with the
  widget written for every lookup); a lookup showing `flag` or `shape`,
  alone or beside `name`, is refused in the words the config refuses it
  with, read from the config (watched failing with the generator accepting
  such a display: the form showing `flag` alone was generated); and for
  every foreign key of
  every restated object and every column of its target shown alone, the
  config builds every lookup the generator writes -- the generator's
  refusals named, `flag`, `shape` and SQL Server's `row_version` -- and
  the field is a typeahead exactly when the config's default search is not
  empty, both outcomes counted, so a loop that checked nothing fails
  (watched failing with the generator drawing a typeahead for text alone:
  `customer_no` is an integer, which the config searches; and with the
  generator accepting a display with no text form: the config refused all
  three). That case cannot catch a rule the generator and the config share
  and get wrong; `searchable.test.ts` and `display.test.ts` hold the rules.
  `apps/host/src/lookup-controls.test.tsx`, *the control a lookup is drawn
  as*, on PostgreSQL and SQL Server, in React and Angular, against the real
  server as tenant 1's clerk: the order's Customer is a box to type into in
  both renderers, through which Muster AG is found by typing (watched
  failing with the widget taken off the form the page was served and the
  page's rewrite gone: a `SELECT` in each pane); the order line's Order,
  opened alone from Forms, is an enabled native select, every lookup query
  the page sends for that form searches `""`, and a line created through it
  in each renderer holds the token of an order the case made for that
  renderer (watched failing with the rewrite kept: an `INPUT`); with the
  database out of reach, each renderer says `@formancy/core`'s own "The
  options could not be loaded. Type to try again." under that select, and
  New record asks again and lists the orders (watched failing with the
  rewrite kept: the words were under an `INPUT`); and a version written
  straight into the store with no widget, as 0.1.0's server wrote one, is
  served and drawn as published, its Customer a select offering Muster AG
  and the run's second customer (watched failing with the rewrite kept).
  axe and a name on every control in every state.
  `apps/host/src/children.test.tsx` — a new line's Order, a disabled select
  preset with the open order, is named by that order's date once its label
  arrives (watched failing with every request for the line form's lookup
  held: the option stayed named by its token).
  `apps/examples/src/previews.test.tsx` — both previews draw Customer as a
  typeahead whose list, opened from the keyboard, offers the two captured
  customers; `apps/examples/src/panes.test.tsx`, *the customer typeahead
  under React* and *under Angular* — the customer chosen by the keyboard
  stores the token of the key (2, 1001) and shows the label (each watched
  failing with `widget` taken out of the generated forms: no listbox
  "Customer suggestions"; the second also with the source storing labels as
  values: `not-a-token`).
  `apps/studio/src/choose.test.tsx` — the Generate step's note names the
  typeahead and both columns it searches. The case's old expectation,
  main's note, fails on this generator; the new one was not watched
  failing against main's. A lookup over `sales.country` offers its bytea
  `flag` and point `shape` disabled, each with the reason in its own type,
  and generates over the suggested `name` (watched failing with every
  readable column offered: both enabled).
  `packages/data-server/src/routes/admin-promotion.integration.test.ts` —
  on both engines, the order form's export with `widget` deleted from its
  customer in the base and the form, as 0.1.0 wrote it, is refused by a
  deployment of its own, 422 `invalid-bundle` with exactly the base's
  problem, and that deployment's versions list is 404 (watched failing on
  main at `308baea`, on both engines: 201, version 1 written).
  The host's browser gate, `apps/host/scripts/browser/workspace.mjs`'s
  states "An order line alone (React)" and "An order line alone, created
  (React)", run by `pnpm test:browser` in every browser: Tab into the React
  paper lands on its Order, a native select, which ArrowDown moves from
  nothing to an order's token, and a line is created through it; each state
  measured as every other is (watched failing with the rewrite kept: "it is
  input", the value going from "" to "", and no "Created record"). Passed
  on 2026-10-16 in Chromium and in Firefox 155 on Windows; in Linux Firefox
  and WebKit it is CI's to show.
  The `examples-order` act of `apps/examples/scripts/pictures.mjs`, in `pnpm
  test:pictures`: in each preview, ArrowDown on Customer opens the listbox
  "Customer suggestions" offering Muster AG (watched failing on 2026-10-16
  with `widget` taken out of the forms `generateExamples` gives the page,
  which drew Customer as a plain select again: "examples-order: the React
  preview's customer list never came"; the old act on this generator
  failed the same way).

## Context

[0029](0029-a-host-renders-a-published-form-through-one-client.md) left
open whether the generator or presentation should draw a lookup as a
typeahead, and the host page drew one itself: `drawLookupsAsTypeaheads`, in
`apps/host/src/widgets.ts`, gave every select with an options source and
no widget of its own `widget: "typeahead"`, on the page's copy of the
form. Every other host drew what the document named, a plain select.

Five facts decided the shape.

- **A plain select with a source asks once and cannot be typed into.** It
  asks its source for `""` when it is drawn and lists the page that comes
  back, at `@formancy/react` and `@formancy/angular` 0.5.0 as at 0.3.0
  ([formancy.ai 0077](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0077-options-may-come-from-a-named-source.md)),
  so a row past that page cannot be chosen. A typeahead asks again as the
  person types.
- **A widget is authored, not registered**
  ([formancy.ai 0065](https://github.com/sharkysan/formancy.ai/blob/main/docs/decisions/0065-a-widget-is-authored-not-registered.md)):
  a typeahead is `widget: "typeahead"` on the select, written into the
  document. It arrived in spec 2, and generated forms are spec 3
  ([0042](0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md)).
- **What a lookup searches is its config's.** `buildLookupConfig` searches
  the lookup's displayed text and integer columns, the two kinds both
  engines spell alike as text
  ([0012](0012-a-lookup-token-is-a-reference-not-a-permission.md), which
  named the cost: "A person who sees a date in a label cannot search for
  it."), and a lookup showing neither refuses every search but the empty
  one, 400 `not-searchable`: "… has no searchable column, so it lists rows
  but cannot search them." (`lookup/query.ts`). The fixture's order line
  shows its order by date alone, so the host page's typeahead over it
  answered the empty search it asks when drawn and refused every search
  typed into it. Measured on 2026-10-16 on both engines, with the rewrite
  still in place: one character typed into the order line's Order was
  answered 400 `not-searchable`, and the box said "The options could not
  be loaded. Type to try again."
- **The generator already picks controls from metadata**
  ([0009](0009-generation-is-deterministic-and-says-what-it-chose.md)): a
  text area for long text, three answers for a nullable boolean. Whether a
  search can match a lookup's label is a fact of its display columns'
  types, which the snapshot holds.
- **A generator change is checked when a version is written, never when
  one is read.** Every write but a restore asks whether its base is what
  this release generates -- a publish
  ([0030](0030-presentation-is-a-patch-over-the-generated-base.md)), an
  import ([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md)),
  and under review a draft's submit and its approval
  ([0065](0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md))
  -- and a read validates a bundle without running the generator
  (`bundle-format2.ts`). 0.1.0 is released, so deployments hold versions
  generated before this record.

## Decision

**The generator writes the control.** `planLookup` writes `widget:
"typeahead"` on a lookup's select exactly when `searchableDisplay` finds a
column among the lookup's display columns: each text or whole-number column
the label shows, once, in the label's order, with its type. It is the
function `buildLookupConfig` derives a lookup's default search from, in
`lookup/searchable.ts` beside `SEARCHABLE_KINDS`, the set it reads and
`records/list.ts` reads for a list's search; so the control, a lookup's
search and a list's search answer to one set. A lookup that shows neither
is a plain select, as every lookup was.

**The generator refuses a label it cannot spell.** A display column with
no text form -- binary, rowversion, a type with no codec -- is refused when
the form is generated, in the words `buildLookupConfig` refuses it with,
through `isDisplayType` in `lookup/display.ts`, the rule both read; the
studio offers such a column disabled, with the reason. Until now the
generator wrote such a lookup and its note named a control, while the
server could build no list for it: the config throws for that display on
every lookup request.

**Its note says which control.** The `inferred` note the generator already
wrote for a lookup gains a clause, so the administrator reads the control
in the Generate step before anything is published:

- "A lookup over fk_order_customer (tenant_id, customer_no), showing name
  of customer, drawn as a typeahead searching name; label from the table
  name."
- "A lookup over fk_order_line_order (order_id), showing order_date of
  order, as a plain list of its first page: a search matches only text and
  whole-number columns and it shows neither, so a row past that page cannot
  be chosen; show a text or whole-number column to make it searchable;
  label from the table name."

**The host page draws the control the published form names.**
`drawLookupsAsTypeaheads` is removed, and `widgets.ts` keeps
`disableFields`, the one change the page makes to a form.

**A version published before this record is drawn as published.** Its
lookups name no widget, so they are plain selects of their first page, on
the host page as on every other host. Nothing rewrites it on read or on
the page; the form regenerated and published again gives its searchable
lookups the typeahead.

## Consequences

**What it buys.** Every host -- the reference page, the examples page and
an integrator's -- draws a lookup a person can search as a box to type
into, because the document says so, and the note says so to the
administrator before it is published. One function decides the control
and the search, one rule what a label may show, and a list's search reads
the same kinds, so the generator writes no lookup whose display the config
refuses. The host page no longer sends a search the server refuses.

**What it costs.**

- **A short list is a typeahead too.** A handful of countries is chosen by
  typing or arrowing, not from a native list, and no administrator can
  choose otherwise.
- **A lookup showing no text or whole-number column is a plain select of
  its first page**, and a row past it cannot be chosen. The note says so
  and names the edit that changes it.
- **When that select's one search fails**, for a database out of reach
  (`unavailable`), which `lookup-controls.test.tsx` drives, or for the
  lookup deadline
  (`lookup-timeout`, [0061](0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)),
  which the server answers 503 too and no test here drives to a plain
  select, each renderer says "The options could not be loaded. Type to try
  again." under a control nobody can type into, and asks again only when
  the form is drawn again: on the host page, New record. The words are
  upstream's.
- **A lookup cannot show a column with no text form.** The generator
  refuses it, where it used to write a lookup whose list the server could
  not build, and the studio offers such a column disabled. A version
  stored with one before this record is served as it was, and its list
  still cannot be built; a regeneration leaves that lookup out and says
  why, as it did, and this release's import refuses its version file.
- **A form published at 0.1.0 names no widget.** Every host, the reference
  host page now included though it drew typeaheads at 0.1.0, draws its
  lookups as plain selects of their first page, which look complete
  (0029), until an administrator regenerates it in the studio's Drift step
  and publishes it again -- under review, submits it and a publisher
  approves it. Restoring such a version brings its plain selects back.
- **A version file exported from 0.1.0 is refused by this release's
  import**, 422 `invalid-bundle`, "base: is not what this server generates
  from the stored snapshot and generation request": 0062's cost, first met
  here. The source deployment upgrades and regenerates first, or the form
  is proposed again in the target.
- **A studio session that proposed before the server's upgrade is refused
  at publish**, 0030's cost, and so is a draft submitted before an upgrade
  and approved after it (0065). 0065 and this record are both unreleased,
  so no release holds such a draft; a release cut with 0065 and without
  this record would make it one, and that cost a line of its own and a
  test.
- **Every generated form with a searchable lookup changes**, so 0042's
  measurement that a host whose reader is at `@formancy/*` 0.3.0 reads
  every generated form was taken before any carried a widget. Measured
  again on 2026-10-16, by a scratch script outside the repository, over
  the forms it generated from the committed snapshots -- `apps/examples`'
  fixture snapshot and the studio's five: each object as root alone; with
  each foreign key as its one lookup, showing each column of its target
  and then all of them; with every foreign key at once, each showing its
  first text or whole-number column; and pinned and versioned where the
  root has `tenant_id` and `row_version`. Each, typeaheads among them,
  validated under `@formancy/spec` 0.3.0 and opened in `@formancy/core`
  0.3.0's engine in the browser's mode and the server's, which read back
  each field's widget; a copy of one with a widget 0.3.0 does not know was
  refused. Other displays and request shapes were not generated, and
  nothing here runs a 0.3.0 renderer, so nothing fails if that stops being
  true.
- **The regeneration report does not say that a republish changes a
  lookup's control.** The Generate step's note does.
- **Two of the README's pictures are taken again**, on Linux with the look
  every other picture was taken on: `studio-generate`, whose note names
  the typeahead, and `examples-order`, whose Customer is now a box. Its
  picture came out byte for byte as before -- under the Blueprint theme
  the empty select and the empty, closed typeahead draw alike -- and what
  changed is its recorded text, which no longer holds the select's
  options.
- **The published performance figures predate this record.**
  `lookup/searchable.ts` is new, and `generate/generate.ts`,
  `lookup/config.ts`, `lookup/display.ts`, `records/list.ts`, data-core's
  `index.ts` and the server's `bundle-format2.ts`, `bundle.ts` and
  `routes/admin-evolution.ts` changed, the last three in comments alone,
  all part of what `docs/performance.md` measured: on 2026-10-16 `node
  scripts/performance-stale.mjs` named them, beside the files 0065
  changed. The figures are measured again before the
  next release, which this blocks, not a pull request.

**What it forecloses.** A host page that redraws a lookup's control: the
control is the document's.

**What it does not do.** Let an administrator choose the control; tell the
person that a list goes on past its page, which waits for an upstream
release (0029's cost); search a lookup's key columns; rewrite a version
published before it; or say in the regeneration report that a control
changed.

## Alternatives considered

- **Presentation carries the widget, as a fifth edit in the studio.** It
  would let an administrator draw a short list as a native select. It needs
  a new presentation property, its rebase rule, studio controls and a
  server check that it never touches a binding (0030); the generator needs
  a default anyway; and presentation widens when a design partner asks for
  it, not before.
- **Keep the host page's rewrite and export it from
  `@formancy/data-client`.** Every host would have to know to call it; the
  published form, the studio's note and the examples page would still say
  "select"; and the definition does not say which lookups can be searched,
  so the rewrite cannot tell the order line's lookup from the customer's,
  which is the defect it had.
- **Keep the rewrite, and have `PublishedForm` name the searchable
  lookups.** A second place deciding the control, beside the generator.
- **Keep the rewrite for a version whose form names no widget**, so a form
  published at 0.1.0 stays a typeahead on the host page. It keeps the
  order line's refused searches for those versions and a second place
  deciding the control, and `PublishedForm` cannot say which lookups can
  be searched.
- **Ask upstream to draw a sourced select as a typeahead.** A widget is
  authored, not registered (formancy.ai 0065), and a select's source is a
  name the document carries, not a control (formancy.ai 0077).
- **Refuse to generate a lookup no search can match.** The fixture's order
  line shows its order by date, and the workspace's child create relies on
  that lookup; a plain select whose cost is said refuses nothing the person
  was promised; and 0061 kept the empty search for every lookup.
- **Search the key columns of such a lookup.** 0012 limits a search to the
  columns the label displays: a key the person does not see would make a
  row match for a reason they cannot see.
- **Go on generating a lookup no label can spell**, and leave it to a
  regeneration to drop it (0030). Published first, its note names a
  control over a list the server cannot build, and nothing says so until
  a person opens the form.

## Older records

Extended, not edited away: [0009](0009-generation-is-deterministic-and-says-what-it-chose.md)
(a lookup's control is chosen from its display columns' types, and its
note says which; a display column with no text form is refused).
Narrowed: [0029](0029-a-host-renders-a-published-form-through-one-client.md),
whose cost "The typeahead is the host page's choice" no longer holds: the
generator chooses, and the page draws what it is given. Its other lookup
cost, that `hasMore` and `omitted` do not reach the person, stands.
Narrowed: [0030](0030-presentation-is-a-patch-over-the-generated-base.md),
whose cost "0028's `buildLookupConfig` refuses more than the generator
does: a display column with no text form, a float key" now holds for a
key alone. Unchanged: 0012 (what a lookup searches), the rest of 0030
(the widget is in the generated base, which presentation patches, and is
no fifth edit), 0042 (spec 3) and 0062 (an import's check of the
generator).
