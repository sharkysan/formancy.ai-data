# 0075 — A field may move to another generated section, recorded on its own entry and carried by what it stands for

- **Status:** accepted
- **Date:** 2026-10-16
- **Deciders:** Daniel Bacher
- **Verified by:**
  `packages/data-core/src/presentation/derive.test.ts` — a field placed
  last in another generated section derives `{ field, anchor, section }`
  and no order, and applying it gives the edited form back (watched failing
  on main, which refused it as "paid moved between sections"); placed first,
  it derives the target's order too, and a textarea moved keeps its full
  width with no width entry; a move that leaves a section with no field, a
  field placed in two sections, a field placed nowhere, a section added and
  a numeric span are refused, each naming its JSON path; a move of a field
  with no binding is refused as a label on one is.
  `apply.test.ts` — a move lands at the end of its target, its width with
  it, and two moved into one section land in the base's field order; an
  order is held to the fields its section holds once the moves are made, so
  one still naming a field that moved away is refused and one equal to
  where the moves put them is not a second spelling; a move to the field's
  own section, to a section the base lacks, one that leaves a section with
  no field and a `section` of the wrong shape are each refused by path; an
  entry holding a section and nothing else is accepted (watched failing
  with "says nothing" reading only the label and the span: every move
  refused).
  `rebase.test.ts` — identical bases carry a move and the order it went
  into with no conflict; a move into Record when Record is gone is
  `move-dropped`, the field back last in Order where the generator puts
  it; a moved field whose column is gone is `field-gone` for its section; a
  field the generator now puts where the person moved it keeps no move and
  is not said to have moved (watched failing with `moved-section` computed
  from the generated sections: "created_by moved from section "Order" to
  "Record", where the generator put it."); a carried move that would leave
  Record with no field is `move-dropped` and the field stays; a record
  root whose sections change in number drops a move into one of them, says
  it cannot be told apart, and says no field moved; a renumbered key's move
  follows its column; a column added after a moved field lands after its
  nearest predecessor still in its section while the move keeps its place;
  two runs with a move are byte-identical; every merged form passes
  `@formancy/spec/validate`.
  `packages/data-server/src/bundle.test.ts` — a bundle whose presentation
  moves a field and whose form is that applied is served; the move in the
  form alone, or in the presentation alone, is refused as an edited form; a
  section the base lacks and a move that empties one are refused, named by
  path (watched failing with the form comparison taken out of
  `format2Problems`). `routes/admin.test.ts` — publishing the moved form
  without its entry is 422 `invalid-bundle` and writes nothing, with it 201,
  served with the field in Record (watched failing the same way).
  `routes/admin-evolution.test.ts` — regenerating an unchanged database
  carries the move with no conflict (watched failing with the rebase
  dropping every move: a `moved-section` was reported).
  `apps/studio/src/presentation.test.tsx` — "Move to Record Customer"
  pressed by keyboard puts Customer last in Record, says "Moved Customer to
  Record.", and leaves the keyboard on "Move to Order Customer" (watched
  failing with the focus not given back: it was on `<body>`); a section's
  only field has its button disabled; Undo takes the move back; the test of
  what the step offers is widened on purpose to exactly one "Move to"
  button per field and other section, every other control as before, and
  the published presentation records the move on the field's entry.
  `carry.test.ts` — "Generate again" keeps a dropped move and a moved
  field gone (watched failing with the kinds it kept before this record).
  `journey.test.tsx` — axe and a name on every control with a field in
  another section. `apps/studio/scripts/browser/journey.mjs` — a field
  moved to Record and back by keyboard, the focus checked each way, every
  state measured at every width in each browser the gate runs.
  The refusal by 0.1.0 is measured, not tested: on 2026-10-16
  `validateBundle` of `@formancy/data-server@0.1.0`, installed from npm
  (`sha512-2uBeJ5KHp1vUYczly8A6e8Gkf752LEc+cVbZ+tJHzeeGnVNnkBToCfPiASK4JyVMzznof++45a4QsgxjsR4yyQ==`),
  served a bundle this release wrote without a move and refused the same
  bundle with one: `presentation: /fields/0/section is not a property of a
  field presentation`. Released code does not change, so the measurement
  does not go stale; nothing here would notice a later 0.1.x that read
  moves.

## Context

The generator places a field by what the database does with its column
([0030](0030-presentation-is-a-patch-over-the-generated-base.md)):
columns the database generates or fills go in a section labelled `Record`,
everything else in the section labelled after the root. For most tables
that leaves Record holding the identity alone, split off the fields a
person reads first, and under 0030 a person could relabel and reorder
within a section but not move a field out of one. A buyer judges the first
form by how it is arranged.

What was true when this was decided, each checked on 2026-10-16:

- **`layoutFor` writes at most two sections**, each holding one two-column
  table: the root's, and Record. So the other section is, today, the one
  other.
- **Nothing at runtime reads a field's section.** Outside `presentation/`
  and the generator, `data-core/src`, `data-client`, `data-server` and
  `apps/host` read only `layouts[0].name`. Whether a field is written lives
  in `bindings.writes`, not in the layout. No rule ties a field to a section
  beyond the generator's grouping, so any bound field may move.
- **builder-core accepts `moveLayoutNode` into another section's grid**
  (0030's probe PD2), and an empty table is valid spec — the schema sets
  no `minItems` — so refusing a section with no field is ours to do.
- **0.1.0 refuses a field entry with any property but `field`, `anchor`,
  `label` and `span`** (`presentationShapeProblems` at tag `v0.1.0`), and
  runs that check on every read and import. Measured, above.
- **Help text has nowhere to go**: `@formancy/spec` 0.5.0's
  `formancy.schema.json` has no `help`, `hint`, `description` or `tooltip`
  property anywhere, read on 2026-10-16. A field's help text is spec work
  upstream first ([0002](0002-depend-on-upstream-never-copy-it.md)).

## Decision

**A field may be placed in another generated section of the same layout,
and the move is presentation.** It is recorded on the field's own entry as
`section`, the target's anchor — the label the generator wrote and which of
the sections with that label it is — beside the field's anchor, its column
or its lookup's foreign key. Never by key or index. Present only where it
is not the base's section, so a presentation with no move is byte-equal to
what 0.1.0 writes.

- **The presentation stays version 1.** The property is additive and
  optional. A reader that ignored it would check a form the presentation
  does not describe, so a version-1 reader must refuse one, and 0.1.0 does,
  by the unknown-property refusal it shipped with.
- **Where fields sit is one decision**, `presentation/placement.ts`, which
  applying, deriving and rebasing all ask: a section holds its own
  generated fields that stayed, in the base's order, then those moved into
  it, in the base's field order. A section's `order` is a rearrangement of
  exactly that set, present only where it differs. So the target's order
  names the moved field, the source's never does, and a field moved to the
  end records no order at all.
- **A section keeps at least one field.** A move that empties one is
  refused at publish, by `presentationOf` and `applyPresentation`.
- **A regeneration carries a move** by the field's anchor and the
  section's: the field gone is `field-gone` for its section; a target gone,
  or one of two sections with one label whose number changed, drops the
  move, says so as the new conflict `move-dropped`, and puts the field
  where the generator puts it; a move into the section the generator now
  picks itself goes without a word; and, until none does, a section the
  carried moves would leave empty drops every move out of it, each said.
  `moved-section` compares where a field was and is placed, the person's
  section where they moved it, so a move the person made is not reported
  as one, and a dropped move is said once, as `move-dropped`.
- **The studio** offers, on each field row, one button per other section,
  "Move to Record", named "Move to Record Customer" as Move up is named
  "Move up Customer". It appends the field to that section, says "Moved
  Customer to Record.", and gives the keyboard to the moved field's
  button for the way back, since the row is made again in the other
  section's list. It is disabled for a section's only field. "Generate
  again" keeps every conflict whose resolution was to drop something, so a
  dropped move is still reported; its remedy is the Move to button, and the
  carried panel offers no choice for it.
- **The server changes nothing.** `format2Problems` already holds the form
  to the base with its presentation applied, on publish and on every read.

## Consequences

It buys what the generator's grouping took away: a person can put Created
by beside the identity, or a field the database fills among the fields a
person reads, and the next regeneration keeps it there, by the column and
the section, or says why not.

What it costs:

- **A section keeps one field.** Record's only field, often `id`, cannot
  leave it, and no section can be emptied or removed this way.
- **A moved field lands last** in its new section; a person places it with
  Move up.
- **A 0.1.0 server refuses a version holding a move**, on read and on
  import, naming `/fields/N/section`. A deployment rolled back to 0.1.0
  stops serving such a newest version until an earlier one is restored
  there, and a version file holding a move cannot be imported into 0.1.0.
  Versions without a move move between them as before
  ([0062](0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
- **A move into a section a regeneration drops, or cannot tell apart, is
  dropped**, and said; the person moves the field again.
- **Emptying drops every move out of that section**, not the fewest that
  would keep it one field: the rebase does not choose between the person's
  moves.
- **The buttons name a section by its current label**, so two sections a
  person labelled alike read alike.
- **Help text is not offered.** Spec 0.5.0 has no property to hold it.

## Alternatives considered

- **A move implied by an order naming another section's key.** Anchored by
  key, which renumbers, and spelled in two orders that must agree.
- **Moves recorded on the section** — the keys it gained. Two places would
  say where a field is, the field's entry and the section's, and a
  regeneration would have to reconcile them.
- **Presentation version 2.** Written always, 0.1.0 would refuse every
  version this release writes, moves or not; written only with a move, it
  is a second rule for what the property already says.
- **A `<select>` of sections.** Arrow keys on a closed select change its
  value, and fire `change`, in some browsers, so each keypress would move
  the field — a change on input — and that difference would be one more
  fact the browser gates must name (0058). A button is one keystroke per
  move, like Move up and Move down.
- **Allowing an emptied section, or hiding it.** Allowed, it draws a heading
  over nothing; hidden, the layout no longer holds the generated sections,
  and every anchor after it shifts.
- **Reporting a dropped move as `moved-section` "followed".** "Generate
  again" keeps only what was dropped, and would forget it.
- **Help text now.** Spec 0.5.0 cannot hold it; it goes upstream first.

## Older records

Extended, not edited away:
[0030](0030-presentation-is-a-patch-over-the-generated-base.md)'s
presentation gains the field's section, and its refusal of "moves between
sections" at publish now covers only a move that empties a section;
[0024](0024-the-studio-speaks-only-the-admin-plane.md)'s presentation
step offers the move, and its cost "no moves between sections" is answered
here.
